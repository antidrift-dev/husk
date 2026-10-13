import AppKit

/// Hold ⌘Q to quit, like Chrome. A tap only shows "Hold ⌘Q to Quit"; keeping the keys down
/// for `holdDuration` quits, and the hold stands in for the "Quit husk?" dialog. Only quits
/// started from the keyboard wait for a hold: the menu, the Dock, AppleScript and logout
/// quit as before.
enum HuskHoldToQuit {
    static let holdDuration: TimeInterval = 1.0

    /// Set once the hold completes, so the terminate it triggers goes straight through.
    private(set) static var confirmed = false

    private static var timer: Timer?
    private static var keyMonitor: Any?
    private static var resignObserver: NSObjectProtocol?
    private static var hud: NSPanel?
    private static var hideWork: DispatchWorkItem?

    /// Called from applicationShouldTerminate. True means cancel this terminate and wait for the hold.
    static func shouldHold() -> Bool {
        if confirmed { return false }
        guard let event = NSApp.currentEvent, event.type == .keyDown,
              event.modifierFlags.contains(.command) else { return false }
        // Key repeats re-send the quit while the keys are held; the running hold covers them.
        if timer == nil { begin(event) }
        return true
    }

    private static func begin(_ event: NSEvent) {
        let keyCode = event.keyCode
        let key = (event.charactersIgnoringModifiers ?? "q").uppercased()
        showHUD("Hold ⌘\(key) to Quit")

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyUp, .flagsChanged]) { e in
            if (e.type == .keyUp && e.keyCode == keyCode)
                || (e.type == .flagsChanged && !e.modifierFlags.contains(.command)) {
                cancel()
            }
            return e
        }
        // Once the app is in the background its key-ups never arrive, so stop there.
        resignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
        ) { _ in cancel() }

        timer = Timer.scheduledTimer(withTimeInterval: holdDuration, repeats: false) { _ in
            stopTracking()
            hideHUD(after: 0)
            confirmed = true
            NSApp.terminate(nil)
        }
    }

    private static func cancel() {
        stopTracking()
        hideHUD(after: 1.5)   // leave the hint up long enough to read
    }

    private static func stopTracking() {
        timer?.invalidate()
        timer = nil
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        resignObserver = nil
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
