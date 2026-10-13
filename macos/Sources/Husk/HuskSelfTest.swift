import AppKit
import GhosttyKit

/// Headless smoke test of the Husk layer, for runs where nobody can look at the screen.
///
///     HUSKTTY_SELFTEST=/path/to/outdir  Ghostty.app/Contents/MacOS/ghostty
///
/// Opens a window, adds a second tab, `cd /tmp` in it, then writes `report.json`
/// (tab labels, window titles, per-tab status) and `window.png` (the window's
/// SwiftUI chrome rendered offscreen) to the out dir and quits.
enum HuskSelfTest {
    static var outDir: URL? {
        ProcessInfo.processInfo.environment["HUSKTTY_SELFTEST"].map { URL(fileURLWithPath: $0) }
    }

    @MainActor private static var windowsAtStart = 0
    @MainActor private static var extra: [String: Any] = [:]

    @MainActor
    static func run(ghostty: Ghostty.App) {
        guard let outDir else { return }
        windowsAtStart = NSApp.windows.filter { $0.windowController is TerminalController }.count
        closeAllTerminalWindows()
        let first = TerminalController.newWindow(ghostty)
        after(3) {
            first.newTab(nil)
            after(3) {
                let tabs = HuskModel.tabs(of: first.window)
                // `text:` types raw input; sendText would arrive as a bracketed paste and not run.
                if let surface = tabs.last?.focusedSurface?.surface {
                    let action = "text:cd /tmp\\r"
                    _ = ghostty_surface_binding_action(surface, action, UInt(action.lengthOfBytes(using: .utf8)))
                }
                // Foreground process detection: run vim in the first tab
                if let surface = tabs.first?.focusedSurface?.surface {
                    let action = "text:vim -u NONE\\r"
                    _ = ghostty_surface_binding_action(surface, action, UInt(action.lengthOfBytes(using: .utf8)))
                }
                after(4) {
                    HuskModel.shared.poll()
                    after(2) {
                        // Reorder: move the last tab to the front
                        let model = HuskModel.shared
                        let before = HuskModel.tabs(of: first.window)
                        extra["firstTabProcess"] = before.first.map { model.status(for: $0).process ?? "" } ?? ""
                        extra["firstTabHasColor"] = before.first.map { HuskProcessColors.color(for: model.status(for: $0).process) != nil } ?? false
                        extra["orderBeforeMove"] = before.map { model.label(for: $0) }
                        // Drag-reorder only exists in the sidebar; with native top tabs macOS reorders tabs itself.
                        if model.showSidebar, let last = before.last { model.moveTab(last, to: 0) }
                        extra["orderAfterMove"] = HuskModel.tabs(of: first.window).map { model.label(for: $0) }
                        let tabs = HuskModel.tabs(of: first.window)
                        write(tabs: tabs, to: outDir)
                        // Pop-out: the first tab leaves the group
                        if model.showSidebar, let tab = tabs.first { model.popOut(tab) }
                        extra["tabsAfterPopOut"] = HuskModel.tabs(of: tabs.last?.window).count
                        write(tabs: tabs, to: outDir)
                        // Leave nothing for window restoration to bring back next launch.
                        closeAllTerminalWindows()
                        after(1) { exit(0) }
                    }
                }
            }
        }
    }

    @MainActor
    private static func write(tabs: [TerminalController], to dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let model = HuskModel.shared
        var report: [String: Any] = [
            "tabCount": tabs.count,
            "nativeTabBarHidden": model.nativeTabBarsHidden,
            "tabBarAccessories": NSApp.windows.flatMap { $0.titlebarAccessoryViewControllers }.filter { $0.identifier == TerminalWindow.tabBarIdentifier }.count,
            "sidebarShown": model.showSidebar,
            "theme": HuskThemes.selectedID,
            "windowsAtStart": windowsAtStart,
            "terminalWindows": NSApp.windows.compactMap { w -> String? in
                guard w.windowController is TerminalController else { return nil }
                return "\(w.title) visible=\(w.isVisible) tabs=\(w.tabbedWindows?.count ?? 1)"
            },
            "themeMenuItems": NSApp.mainMenu?.item(withTitle: "Theme")?.submenu?.items.count ?? 0,
            "appMenuTitle": NSApp.mainMenu?.items.first?.submenu?.title ?? "",
            "diskAvailableGB": model.diskAvailableGB ?? -1,
            "tabs": tabs.map { tab -> [String: Any] in
                let s = model.status(for: tab)
                return [
                    "label": model.label(for: tab),
                    "windowTitle": tab.window?.title ?? "",
                    "tabProcessLabel": (tab.window as? TerminalWindow)?.huskProcessText ?? "",
                    "cwd": s.cwd ?? "",
                    "process": s.process ?? "",
                    "memoryMB": s.memoryMB ?? -1,
                    "git": s.git.map { "\($0.repo) ⎇ \($0.branch)" } ?? "",
                    "childPids": tab.surfaceTree.compactMap { $0.surface.map { ghostty_surface_child_pid($0) } },
                    "foregroundPid": tab.focusedSurface?.surface.map { ghostty_surface_foreground_pid($0) } ?? 0,
                ]
            },
        ]
        // Profiles/workspaces round-trip, saved into the out dir (not ~/.husk)
        let profile = HuskProfiles.profile(named: "Self Test", from: tabs.first?.window)
        try? HuskProfiles.save(profile, name: profile.name, in: dir)
        let workspace = HuskProfiles.workspace(named: "Self Test WS")
        try? HuskProfiles.save(workspace, name: workspace.name, in: dir.appendingPathComponent("ws"))
        report["profileRoundTrip"] = HuskProfiles.loadAll(HuskProfiles.Profile.self, from: dir).first?.sessions.map(\.label) ?? []
        report["workspaceWindows"] = HuskProfiles.loadAll(HuskProfiles.Workspace.self, from: dir.appendingPathComponent("ws")).first?.windows.count ?? -1
        report.merge(extra) { _, new in new }
        report["settingsMenuTitle"] = NSApp.mainMenu?.items.first?.submenu?.items.first(where: { $0.keyEquivalent == "," })?.title ?? ""
        report["appMenuItems"] = NSApp.mainMenu?.items.first?.submenu?.items.map(\.title).filter { !$0.isEmpty } ?? []
        report["settingsLayer"] = HuskSettings.shared.configText.split(separator: "\n").count
        report["appMemoryMB"] = Int(HuskProcess.residentBytes(pid: getpid()) / 1_048_576)
        report["viewMenuHasSidebar"] = NSApp.mainMenu?.item(withTitle: "View")?.submenu?.item(withTitle: "Show Sidebar") != nil
        report["fileMenuHasProfiles"] = NSApp.mainMenu?.item(withTitle: "File")?.submenu?.item(withTitle: "Open Profile") != nil

        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: dir.appendingPathComponent("report.json"))
        }
        if let view = tabs.last?.window?.contentView?.superview ?? tabs.last?.window?.contentView,
           let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
            view.cacheDisplay(in: view.bounds, to: rep)
            try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("window.png"))
        }
    }

    @MainActor
    private static func closeAllTerminalWindows() {
        for window in NSApp.windows where window.windowController is TerminalController {
            window.close()
        }
    }

    private static func after(_ seconds: Double, _ block: @escaping @MainActor () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { MainActor.assumeIsolated { block() } }
    }
}
