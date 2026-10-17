import AppKit
import Combine
import GhosttyKit
import SwiftUI

/// What the sidebar and status bar show for one tab (Husk "session").
struct HuskTabStatus: Equatable {
    var cwd: String?
    var process: String?
    var memoryMB: Int?
    var git: HuskGitInfo?
    var agentContext: HuskClaudeContext?  // claude or codex
    /// Other Claude sessions running in this tab's Claude session folder, in any terminal.
    var otherSessions: [HuskOtherSession] = []
    var caffeinated = false
}

/// Husk-wide state: per-tab status, polled every 2s like Husk's status bar,
/// plus the hooks that keep the sidebar in sync with macOS tab groups.
final class HuskModel: ObservableObject {
    static let shared = HuskModel()

    @Published private(set) var statuses: [ObjectIdentifier: HuskTabStatus] = [:]
    @Published private(set) var diskAvailableGB: Int?
    /// Bumped whenever tabs may have been added, closed, reordered or selected.
    @Published private(set) var tabsVersion = 0
    @Published var showSidebar: Bool {
        didSet {
            UserDefaults.standard.set(showSidebar, forKey: "HuskShowSidebar")
            updateNativeTabBars()
        }
    }

    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private let queue = DispatchQueue(label: "dev.antidrift.husktty.status", qos: .utility)
    private var polling = false

    private init() {
        // Default: native top tabs (how Chris uses Husk); the sidebar is opt-in.
        showSidebar = UserDefaults.standard.object(forKey: "HuskShowSidebar") as? Bool ?? false
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.poll() }
        let names: [Notification.Name] = [
            NSWindow.didBecomeKeyNotification,
            NSWindow.didBecomeMainNotification,
            NSWindow.willCloseNotification,
        ]
        for name in names {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                // Tab group membership settles a runloop turn after these fire.
                DispatchQueue.main.async { self?.tabsChanged() }
            })
        }
    }

    func tabsChanged() {
        tabsVersion &+= 1
        updateNativeTabBars()
        MainActor.assumeIsolated { updateTabProcessLabels() }
        poll()
    }

    // MARK: Menu

    /// View → Show Sidebar: sidebar + hidden tab bar (Husk default), or native top tabs.
    @MainActor
    func installMenu() {
        guard let view = NSApp.mainMenu?.item(withTitle: "View")?.submenu,
              view.item(withTitle: "Show Sidebar") == nil else { return }
        let item = NSMenuItem(title: "Show Sidebar", action: #selector(SidebarToggle.toggle(_:)), keyEquivalent: "s")
        item.keyEquivalentModifierMask = [.command, .control]
        item.target = SidebarToggle.shared
        item.state = showSidebar ? .on : .off
        view.insertItem(item, at: 0)
        view.insertItem(.separator(), at: 1)
    }

    private final class SidebarToggle: NSObject {
        static let shared = SidebarToggle()
        @MainActor @objc func toggle(_ sender: NSMenuItem) {
            HuskModel.shared.showSidebar.toggle()
            sender.state = HuskModel.shared.showSidebar ? .on : .off
        }
    }

    // MARK: Tabs

    /// The tabs (TerminalControllers) in the tab group of `window`, in tab order.
    static func tabs(of window: NSWindow?) -> [TerminalController] {
        guard let window else { return [] }
        return (window.tabbedWindows ?? [window]).compactMap { $0.windowController as? TerminalController }
    }

    func status(for controller: TerminalController) -> HuskTabStatus {
        statuses[ObjectIdentifier(controller)] ?? HuskTabStatus()
    }

    /// Tab name: a manual rename wins, otherwise the focused pane's directory.
    func label(for controller: TerminalController) -> String {
        if let override = controller.titleOverride, !override.isEmpty { return override }
        if let pwd = controller.focusedSurface?.pwd, !pwd.isEmpty { return HuskDirLabel.label(for: pwd) }
        if let cwd = status(for: controller).cwd { return HuskDirLabel.label(for: cwd) }
        return "~"
    }

    /// Move a tab to a new position in its tab group (sidebar drag and drop).
    /// Same remove-and-re-add technique as TerminalController's move_tab.
    @MainActor
    func moveTab(_ tab: TerminalController, to index: Int) {
        guard let window = tab.window, let group = window.tabGroup else { return }
        let windows = group.windows
        guard let from = windows.firstIndex(of: window), index != from,
              windows.indices.contains(index) else { return }
        let target = windows[index]
        NSAnimationContext.beginGrouping()
        NSAnimationContext.current.duration = 0
        group.removeWindow(window)
        target.addTabbedWindowSafely(window, ordered: index < from ? .below : .above)
        window.makeKeyAndOrderFront(nil)
        NSAnimationContext.endGrouping()
        tabsChanged()
    }

    /// Husk "Pop Out to Window": take a tab out of its group into its own window.
    @MainActor
    func popOut(_ tab: TerminalController) {
        guard let window = tab.window, let group = window.tabGroup, group.windows.count > 1 else { return }
        let origin = window.frame.origin
        group.removeWindow(window)
        window.setFrameOrigin(NSPoint(x: origin.x + 30, y: origin.y - 30))
        window.makeKeyAndOrderFront(nil)
        tabsChanged()
    }

    /// Process name in each native tab, and the whole tab tinted with Husk's process colour
    /// (60% on the active tab, 30% on the others; Husk's TabBar.tsx uses ~33% / ~21%, which
    /// reads too dark over native tabs).
    @MainActor
    func updateTabProcessLabels() {
        #if DEBUG
        HuskTintDebug.write()
        #endif
        // Every tab's process label first: setting one resets its text colour, so the tint
        // (which recolours the labels for contrast) has to come after all of them.
        for window in NSApp.windows {
            guard let window = window as? TerminalWindow,
                  let controller = window.windowController as? TerminalController else { continue }
            let process = status(for: controller).process
            window.huskSetProcess(process, color: HuskProcessColors.nsColor(for: process))
        }

        var seenGroups = Set<ObjectIdentifier>()
        for window in NSApp.windows {
            guard window.windowController is TerminalController,
                  let group = window.tabGroup, seenGroups.insert(ObjectIdentifier(group)).inserted else { continue }
            // Each window in the group has its own tab bar, and only the selected window's
            // is on screen: tint them all so whichever one is showing is already right.
            // A window can also hold a stale bar (one full-width button) ahead of the live one,
            // so check every bar rather than the first (`tabBarView`), and tint the bars
            // that have a button per tab.
            let windows = group.windows
            for host in windows {
                for buttons in Self.tabBarButtons(in: host) where buttons.count == windows.count {
                    for (button, tabWindow) in zip(buttons, windows) {
                        let tabProcess = (tabWindow.windowController as? TerminalController).flatMap { status(for: $0).process }
                        let color = HuskProcessColors.nsColor(for: tabProcess)
                        let alpha: CGFloat = tabWindow == group.selectedWindow ? 0.6 : 0.3
                        HuskTabTint.apply(color?.withAlphaComponent(alpha), to: button)
                    }
                }
            }
        }
    }

    /// The tab buttons of every native tab bar in `window`, each bar's in visual order.
    /// Searches the whole window frame, plus the titlebar (which lives in a separate
    /// window in fullscreen).
    static func tabBarButtons(in window: NSWindow) -> [[NSView]] {
        var bars: [NSView] = []
        for root in [window.contentView?.rootView, window.titlebarView].compactMap({ $0 }) {
            for bar in root.descendants(withClassName: "NSTabBar") where !bars.contains(bar) {
                bars.append(bar)
            }
        }
        return bars.map { bar in
            bar.descendants(withClassName: "NSTabButton").sorted { $0.frame.minX < $1.frame.minX }
        }
    }

    /// Shell pids for every pane in a tab (main thread: touches surfaces).
    func childPids(of controller: TerminalController) -> [pid_t] {
        controller.surfaceTree.compactMap { view in
            view.surface.map { pid_t(truncatingIfNeeded: ghostty_surface_child_pid($0)) }
        }.filter { $0 > 0 }
    }

    /// With the sidebar on, the native macOS tab bar is redundant: keep it hidden.
    /// (`toggleTabBar` can't hide it once a window has 2+ tabs, so hide its accessory instead.)
    func updateNativeTabBars() {
        var seenGroups = Set<ObjectIdentifier>()
        for window in NSApp.windows where window.windowController is TerminalController {
            for accessory in window.titlebarAccessoryViewControllers
            where accessory.identifier == TerminalWindow.tabBarIdentifier && accessory.isHidden != showSidebar {
                accessory.isHidden = showSidebar
            }

            // Top tabs: always show the tab bar, even with a single tab (macOS hides it
            // until there are two). Like Husk's tab bar.
            if !showSidebar, let group = window.tabGroup,
               seenGroups.insert(ObjectIdentifier(group)).inserted,
               !group.isTabBarVisible, window.isVisible {
                window.toggleTabBar(nil)
            }
        }
    }

    /// Whether every native tab bar is currently hidden (self-test).
    var nativeTabBarsHidden: Bool {
        NSApp.windows.allSatisfy { window in
            window.titlebarAccessoryViewControllers
                .filter { $0.identifier == TerminalWindow.tabBarIdentifier }
                .allSatisfy { $0.isHidden }
        }
    }

    // MARK: Polling

    private struct Snapshot {
        let id: ObjectIdentifier
        let pwd: String?
        let childPids: [pid_t]
        let foregroundPid: pid_t
    }

    func poll() {
        guard !polling else { return }
        polling = true
        // New tabs don't always make a window key (e.g. app in background): re-check here too.
        updateNativeTabBars()

        // Read pids on the main thread: surfaces must not be touched off-main.
        var snapshots: [Snapshot] = []
        for window in NSApp.windows {
            guard let controller = window.windowController as? TerminalController else { continue }
            var childPids: [pid_t] = []
            for view in controller.surfaceTree {
                if let surface = view.surface {
                    let pid = pid_t(truncatingIfNeeded: ghostty_surface_child_pid(surface))
                    if pid > 0 { childPids.append(pid) }
                }
            }
            var fg: pid_t = 0
            if let surface = controller.focusedSurface?.surface {
                fg = pid_t(truncatingIfNeeded: ghostty_surface_foreground_pid(surface))
            }
            snapshots.append(Snapshot(id: ObjectIdentifier(controller),
                                      pwd: controller.focusedSurface?.pwd,
                                      childPids: childPids,
                                      foregroundPid: fg))
        }

        queue.async { [weak self] in
            var result: [ObjectIdentifier: HuskTabStatus] = [:]
            let claudeSessions = HuskClaude.liveSessions()
            let codexSessions = HuskCodex.liveSessions()
            // Every other Claude Code or Codex session in the folder.
            let others = { (cwd: String, pid: pid_t) in
                HuskClaude.others(in: cwd, excluding: pid, among: claudeSessions)
                    + HuskCodex.others(in: cwd, excluding: pid, among: codexSessions)
            }
            for snap in snapshots {
                var status = HuskTabStatus()
                status.cwd = snap.pwd
                if snap.foregroundPid > 0 {
                    status.process = HuskProcess.displayName(pid: snap.foregroundPid)
                }
                let bytes = snap.childPids.reduce(UInt64(0)) { $0 + HuskProcess.treeResidentBytes(root: $1) }
                if bytes > 0 { status.memoryMB = Int(bytes / 1_048_576) }
                status.caffeinated = snap.childPids.contains { HuskProcess.hasCaffeinate(under: $0) }
                if let pwd = snap.pwd, !pwd.isEmpty {
                    status.git = HuskGit.info(for: pwd)
                    switch status.process {
                    case "claude":
                        if let session = HuskClaude.session(foregroundPid: snap.foregroundPid, among: claudeSessions) {
                            status.agentContext = HuskClaude.context(for: session)
                            status.otherSessions = others(session.cwd, session.pid)
                        }
                    case "codex":
                        status.agentContext = HuskCodex.context(for: pwd)
                        if let session = HuskCodex.session(foregroundPid: snap.foregroundPid, among: codexSessions) {
                            status.otherSessions = others(session.cwd, session.pid)
                        }
                    default: break
                    }
                }
                result[snap.id] = status
            }
            let disk = Self.diskAvailableGB()
            DispatchQueue.main.async {
                guard let self else { return }
                if self.statuses != result { self.statuses = result }
                MainActor.assumeIsolated { self.updateTabProcessLabels() }
                if self.diskAvailableGB != disk { self.diskAvailableGB = disk }
                self.polling = false
            }
        }
    }

    private static func diskAvailableGB() -> Int? {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        guard let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
              let bytes = values.volumeAvailableCapacityForImportantUsage else { return nil }
        return Int(bytes / 1_000_000_000)
    }
}

/// The process colour behind a native tab. The button's own layer background is drawn
/// under the tab's glass effect on current macOS, so the tint is a view of its own placed
/// inside the glass (ContentHolderView), below the title and labels.
@MainActor
enum HuskTabTint {
    private static let id = NSUserInterfaceItemIdentifier("HuskTabTint")

    private final class TintView: NSView {
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }

    static func apply(_ color: NSColor?, to button: NSView) {
        let host = button.firstDescendant(withClassName: "ContentHolderView") ?? button
        let existing = host.subviews.first { $0.identifier == id }
        guard let color else {
            existing?.removeFromSuperview()
            setText(nil, in: button)
            return
        }
        let view = existing ?? {
            let view = TintView(frame: host.bounds)
            view.identifier = id
            view.autoresizingMask = [.width, .height]
            view.wantsLayer = true
            host.addSubview(view, positioned: .below, relativeTo: nil)
            return view
        }()
        view.frame = host.bounds
        // Native tabs are capsules on current macOS: round the tint to match so it
        // doesn't poke out past the pill's ends.
        view.layer?.cornerRadius = host.bounds.height / 2
        view.layer?.cornerCurve = .continuous
        view.layer?.backgroundColor = color.cgColor
        setText(readableText(on: color, in: button), in: button)
    }

    // MARK: Text

    /// Each tab label's own colour from before Husk recoloured it, to put back when the tint goes.
    private static var originalText: [ObjectIdentifier: NSColor] = [:]

    /// Black or white, whichever contrasts more with the tint as it shows over the tab bar.
    private static func readableText(on tint: NSColor, in button: NSView) -> NSColor {
        let dark = button.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let base: CGFloat = dark ? 0.12 : 0.95
        guard let c = tint.usingColorSpace(.sRGB) else { return .labelColor }
        let a = c.alphaComponent
        func channel(_ v: CGFloat) -> CGFloat {
            let mixed = v * a + base * (1 - a)
            return mixed <= 0.03928 ? mixed / 12.92 : pow((mixed + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * channel(c.redComponent) + 0.7152 * channel(c.greenComponent)
            + 0.0722 * channel(c.blueComponent)
        let onWhite = 1.05 / (luminance + 0.05)
        let onBlack = (luminance + 0.05) / 0.05
        return onBlack > onWhite ? .black : .white
    }

    /// Recolour every label in the tab (title, process, ⌘N); nil restores their own colours.
    private static func setText(_ color: NSColor?, in button: NSView) {
        for field in button.descendants(withClassName: "NSTextField").compactMap({ $0 as? NSTextField }) {
            let key = ObjectIdentifier(field)
            let current = field.attributedStringValue
            let own = current.length > 0
                ? current.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor
                : nil
            if color != nil, originalText[key] == nil, let own = own ?? field.textColor,
               own != .black, own != .white {
                originalText[key] = own
            }
            guard let target = color ?? originalText.removeValue(forKey: key) else { continue }
            if own != target, current.length > 0 {
                let recoloured = NSMutableAttributedString(attributedString: current)
                recoloured.addAttribute(.foregroundColor, value: target, range: NSRange(location: 0, length: current.length))
                field.attributedStringValue = recoloured
            }
            field.textColor = target
        }
    }
}

/// Husk's default process colours (husk/src/renderer/Settings.tsx DEFAULT_PROCESS_COLORS).
enum HuskProcessColors {
    static let defaults: [String: String] = [
        "claude": "#d97757", "codex": "#5b8def", "gemini": "#4285f4", "copilot": "#6e5494",
        "docker": "#2496ed", "git": "#f05032", "vim": "#019733", "nvim": "#019733",
        "node": "#8cc84b", "python": "#3776ab", "ssh": "#a855f7",
        "zsh": "#94a3b8", "bash": "#94a3b8", "fish": "#94a3b8", "sh": "#94a3b8",
    ]

    static func color(for process: String?) -> Color? {
        nsColor(for: process).map(Color.init(nsColor:))
    }

    static func nsColor(for process: String?) -> NSColor? {
        guard let process, let hex = defaults[process] else { return nil }
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                       blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

extension Color {
    init?(huskHex hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

#if DEBUG
/// TEMPORARY diagnostic for the tab tint: where every NSTabBar lives and how many tab
/// buttons each holds. Appends to a plain file whenever the picture changes.
@MainActor
enum HuskTintDebug {
    static let url = URL(fileURLWithPath: "/private/tmp/claude-501/-Users-chriswelker-Projects-antidrift-husktty/11f996a9-7703-441e-97bb-5a90d6062253/scratchpad/tint-debug.log")
    private static var last = ""

    static func write() {
        var lines: [String] = []
        for window in NSApp.windows {
            let kind = String(describing: type(of: window))
            let group = window.tabGroup
            let selected = group?.selectedWindow === window
            lines.append("window #\(window.windowNumber) \(kind) visible=\(window.isVisible) key=\(window.isKeyWindow) "
                + "groupSize=\(group?.windows.count ?? 0) selected=\(selected) tabBarView=\(window.tabBarView != nil) "
                + "tabBarVisible=\(group?.isTabBarVisible ?? false)")
            guard let root = window.contentView?.rootView else { continue }
            for bar in root.descendants(withClassName: "NSTabBar") {
                let buttons = bar.descendants(withClassName: "NSTabButton")
                let frames = buttons.map { b -> String in
                    let r = b.convert(b.bounds, to: nil)
                    return "\(Int(r.minX))+\(Int(r.width))\(b.isHiddenOrHasHiddenAncestor ? "(hidden)" : "")"
                }
                let inTitlebar = window.titlebarView.map { bar.isDescendant(of: $0) } ?? false
                let tinted = buttons.filter { !$0.descendants(withClassName: "TintView").isEmpty }.count
                lines.append("  NSTabBar hidden=\(bar.isHiddenOrHasHiddenAncestor) width=\(Int(bar.frame.width)) "
                    + "inTitlebar=\(inTitlebar) tinted=\(tinted) "
                    + "buttons=\(buttons.count) at \(frames.joined(separator: " "))")
            }
        }
        let text = lines.joined(separator: "\n")
        guard text != last else { return }
        last = text
        let entry = "--- \(Date())\n\(text)\n"
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(entry.utf8))
            try? handle.close()
        } else {
            try? entry.write(to: url, atomically: true, encoding: .utf8)
        }
    }
}
#endif
