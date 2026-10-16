import AppKit

/// husk's launch-time setup, called once from the start of
/// AppDelegate.applicationDidFinishLaunching.
@MainActor
enum HuskApp {
    /// Returns true when this launch is the headless self-test, which needs AppDelegate to
    /// treat the app as already active.
    static func didFinishLaunching(_ app: AppDelegate) -> Bool {
        // Theme menu, profiles/workspaces in File, View → Show Sidebar, Settings
        HuskThemes.installMenu()
        HuskProfiles.installMenu()
        HuskModel.shared.installMenu()
        HuskSettings.installMenu()
        renameMenus()
        installLabelWindowItem()

        // Headless smoke test (see HuskSelfTest)
        guard HuskSelfTest.outDir != nil else { return false }
        DispatchQueue.main.async { HuskSelfTest.run(ghostty: app.ghostty) }
        return true
    }

    /// MainMenu.xib is Ghostty's, so "About Ghostty", "Quit Ghostty" and the rest are renamed here.
    private static func renameMenus() {
        func rename(_ menu: NSMenu) {
            for item in menu.items {
                if item.title.contains("Ghostty") {
                    item.title = item.title.replacingOccurrences(of: "Ghostty", with: HuskVersion.appName)
                }
                if let submenu = item.submenu { rename(submenu) }
            }
        }
        if let main = NSApp.mainMenu { rename(main) }
    }

    /// Window → Label Window…, after "Show/Hide All Terminals".
    private static func installLabelWindowItem() {
        guard let menu = NSApp.windowsMenu ?? NSApp.mainMenu?.item(withTitle: "Window")?.submenu,
              menu.items.first(where: { $0.action == #selector(BaseTerminalController.labelWindow(_:)) }) == nil
        else { return }
        let item = NSMenuItem(title: "Label Window...", action: #selector(BaseTerminalController.labelWindow(_:)), keyEquivalent: "")
        let after = menu.items.firstIndex(where: { $0.title == "Show/Hide All Terminals" })
        menu.insertItem(item, at: after.map { $0 + 1 } ?? menu.items.count)
    }
}
