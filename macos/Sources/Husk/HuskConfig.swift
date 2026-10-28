import CoreText
import Foundation

/// husk's config files. Loaded in place of Ghostty's default files so husk
/// never reads or changes a Ghostty install's config:
///   1. Husk defaults (written by the app on every launch)
///   2. The theme picked in the Theme menu
///   3. Settings window values
///   4. ~/.config/husktty/config (the user's overrides, optional)
enum HuskConfig {
    static let userConfigURL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".config/husktty/config")

    static let defaults = """
    # Husk defaults. Regenerated on every launch; put your own settings in
    # ~/.config/husktty/config (same format as Ghostty's config).

    window-save-state = always
    window-inherit-working-directory = true
    macos-titlebar-style = transparent
    macos-titlebar-proxy-icon = hidden
    auto-update = off

    # Husk: notify when a long command finishes (on/off is in Settings)
    notify-on-command-finish-after = 10s

    # Husk keys: ⌘N new session (tab), ⌘⇧N new window, ⌘D / ⌘⇧D splits
    keybind = super+n=new_tab
    keybind = super+shift+n=new_window
    keybind = super+d=new_split:right
    keybind = super+shift+d=new_split:down
    keybind = super+r=prompt_tab_title

    # Husk: Korean in D2Coding (bundled), a monospaced coding font, instead of
    # the serif system fallback. Hangul compatibility jamo + syllables.
    font-codepoint-map = U+3130-U+318F,U+AC00-U+D7A3=D2Coding
    """

    static let userConfigTemplate = """
    # husk config — overrides the Husk defaults. Same format as Ghostty's config:
    # https://ghostty.org/docs/config/reference
    # Save, then reload with ⌘⇧, (Reload Configuration).
    #
    # font-size = 14
    # cursor-style = bar
    # scrollback-limit-bytes = 10000000
    #
    # Quake-style drop-down terminal (needs Accessibility permission):
    # keybind = global:ctrl+grave_accent=toggle_quick_terminal
    #
    # Themes: pick one from the Theme menu, or set any Ghostty theme here:
    # theme = Dracula

    """

    /// The user's config path, created from the template if missing (for "Open Configuration").
    static func ensureUserConfig() -> String? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: userConfigURL.path) {
            do {
                try fm.createDirectory(at: userConfigURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try userConfigTemplate.write(to: userConfigURL, atomically: true, encoding: .utf8)
            } catch {
                return nil
            }
        }
        return userConfigURL.path
    }

    /// Files to load, in order. Later files override earlier ones.
    static func files() -> [String] {
        _ = registerBundledFonts
        var files: [String] = []
        if let defaults = writeDefaults() { files.append(defaults) }
        if let dir = supportDir(), let theme = HuskThemes.writeSelected(in: dir) { files.append(theme) }
        if let dir = supportDir(), let settings = HuskSettings.shared.write(in: dir) { files.append(settings) }
        if FileManager.default.fileExists(atPath: userConfigURL.path) { files.append(userConfigURL.path) }
        return files
    }

    /// Fonts shipped in the app (D2Coding), registered for this process so Ghostty's
    /// font discovery finds them. Runs once, before the first config load.
    private static let registerBundledFonts: Void = {
        let urls = Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
        for url in urls where url.lastPathComponent.hasPrefix("D2Coding") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    static func supportDir() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            // Still "Husktty" from before the rename to husk, so existing settings carry over.
            .appendingPathComponent("Husktty", isDirectory: true)
    }

    private static func writeDefaults() -> String? {
        let fm = FileManager.default
        guard let dir = supportDir() else { return nil }
        let file = dir.appendingPathComponent("husk-defaults.ghostty")
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try defaults.write(to: file, atomically: true, encoding: .utf8)
            return file.path
        } catch {
            return nil
        }
    }
}
