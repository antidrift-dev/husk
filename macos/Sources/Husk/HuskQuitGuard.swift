import AppKit

/// Press ⌘Q three times to quit, so a stray ⌘Q doesn't close every session. The first press
/// shows "Press ⌘Q 2 more times to quit", the second "1 more time", and the third quits in place
/// of Ghostty's "Quit husk?" dialog. The count starts over when the next press is more than
/// `pressWindow` later. Holding the keys down doesn't count, and only quits started from the
/// keyboard are counted: the menu, the Dock, AppleScript and logout quit as before.
enum HuskQuitGuard {
    static let pressesToQuit = 3
    static let pressWindow: TimeInterval = 1.0

    private static var presses = 0
    private static var lastPress = Date.distantPast
    private static var hud: NSPanel?
    /// The message showing now, for the self-test.
    static var hudText: String? { hud?.alphaValue == 1 ? (hud?.contentView?.subviews.first as? NSTextField)?.stringValue : nil }
    private static var hideWork: DispatchWorkItem?

    /// Hook in applicationShouldTerminate. Nil leaves the decision to Ghostty.
    static func terminateReply() -> NSApplication.TerminateReply? {
        guard let event = NSApp.currentEvent, event.type == .keyDown,
              event.modifierFlags.contains(.command) else { return nil }
        // Key repeat from holding ⌘Q down.
        if event.isARepeat { return .terminateCancel }

        let now = Date()
        if now.timeIntervalSince(lastPress) > pressWindow { presses = 0 }
        presses += 1
        lastPress = now

        if presses >= pressesToQuit {
            presses = 0
            hideHUD(after: 0)
            return .terminateNow
        }

        let left = pressesToQuit - presses
        let key = (event.charactersIgnoringModifiers ?? "q").uppercased()
        showHUD("Press ⌘\(key) \(left) more time\(left == 1 ? "" : "s") to quit")
        // Gone when the count starts over.
        hideHUD(after: pressWindow)
        return .terminateCancel
    }

    // MARK: HUD

    private static func showHUD(_ text: String) {
        hideWork?.cancel()
        hideWork = nil

        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 20, weight: .medium)
        label.textColor = .labelColor
        label.sizeToFit()

        let pad = NSSize(width: 28, height: 16)
        let size = NSSize(width: label.frame.width + pad.width * 2,
                          height: label.frame.height + pad.height * 2)

        let background = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        background.material = .hudWindow
        background.state = .active
        background.wantsLayer = true
        background.layer?.cornerRadius = 12
        label.setFrameOrigin(NSPoint(x: pad.width, y: pad.height))
        background.addSubview(label)

        let panel = hud ?? NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                                   backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.ignoresMouseEvents = true
        panel.isReleasedWhenClosed = false
        panel.contentView = background

        // Centered on the active window, or the screen when there is none.
        let area = NSApp.keyWindow?.frame ?? NSScreen.main?.visibleFrame ?? .zero
        panel.setFrame(NSRect(x: area.midX - size.width / 2, y: area.midY - size.height / 2,
                              width: size.width, height: size.height), display: true)
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        hud = panel
    }

    private static func hideHUD(after delay: TimeInterval) {
        let work = DispatchWorkItem {
            guard let panel = hud else { return }
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.2
                panel.animator().alphaValue = 0
            }, completionHandler: {
                // A new tap may have shown the HUD again while this faded out.
                if panel.alphaValue == 0 { panel.orderOut(nil) }
            })
        }
        hideWork?.cancel()
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }
}
