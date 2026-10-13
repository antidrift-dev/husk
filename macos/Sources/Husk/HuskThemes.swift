import AppKit

/// Husk's themes (generated into HuskThemes+Data.swift) and the Theme menu.
/// The selected theme is written as a small config file loaded between the
/// Husk defaults and the user's config, then the config is reloaded live.
enum HuskThemes {
    struct Theme {
        let id: String
        let name: String
        let config: String
    }

    static let defaultID = "mocha"
    private static let defaultsKey = "HuskThemeID"

    static var selectedID: String {
        get { UserDefaults.standard.string(forKey: defaultsKey) ?? defaultID }
        set { UserDefaults.standard.set(newValue, forKey: defaultsKey) }
    }

    static var selected: Theme? { themes.first { $0.id == selectedID } }

    /// Writes the selected theme as a Ghostty theme file plus a one-line config that
    /// points at it. Returns the config's path, for HuskConfig to load.
    static func writeSelected(in dir: URL) -> String? {
        guard let theme = selected else { return nil }
        let themesDir = dir.appendingPathComponent("themes", isDirectory: true)
        let themeFile = themesDir.appendingPathComponent(theme.id)
        let configFile = dir.appendingPathComponent("husk-theme.ghostty")
        do {
            try FileManager.default.createDirectory(at: themesDir, withIntermediateDirectories: true)
            try theme.config.write(to: themeFile, atomically: true, encoding: .utf8)
            try "theme = \(themeFile.path)\n".write(to: configFile, atomically: true, encoding: .utf8)
            return configFile.path
        } catch {
            return nil
        }
    }

    // MARK: Menu

    /// Adds a "Theme" menu before "Window", like Husk's.
    @MainActor
    static func installMenu() {
        guard let mainMenu = NSApp.mainMenu, mainMenu.item(withTitle: "Theme") == nil else { return }
        let menu = NSMenu(title: "Theme")
        for theme in themes {
            let item = NSMenuItem(title: theme.name, action: #selector(MenuTarget.selectTheme(_:)), keyEquivalent: "")
            item.target = MenuTarget.shared
            item.representedObject = theme.id
            item.state = theme.id == selectedID ? .on : .off
            menu.addItem(item)
        }
        let top = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
        top.submenu = menu
        let index = mainMenu.indexOfItem(withTitle: "Window")
        mainMenu.insertItem(top, at: index >= 0 ? index : mainMenu.numberOfItems)
    }

    @MainActor
    static func select(_ id: String) {
        selectedID = id
        if let menu = NSApp.mainMenu?.item(withTitle: "Theme")?.submenu {
            for item in menu.items { item.state = (item.representedObject as? String) == id ? .on : .off }
        }
        (NSApp.delegate as? AppDelegate)?.ghostty.reloadConfig()
    }

    private final class MenuTarget: NSObject {
        static let shared = MenuTarget()
        @MainActor @objc func selectTheme(_ sender: NSMenuItem) {
            guard let id = sender.representedObject as? String else { return }
            HuskThemes.select(id)
        }
    }
}
