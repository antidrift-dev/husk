import AppKit
import SwiftUI

/// Husk's Settings window (husk/src/renderer/Settings.tsx), as a native window.
/// Values are stored in UserDefaults and written as a config layer that loads
/// after the theme and before ~/.config/husktty/config, then the config reloads live.
final class HuskSettings: ObservableObject {
    static let shared = HuskSettings()

    enum CursorStyle: String, CaseIterable { case block, underline, bar }

    @AppStorage("HuskFontSize") var fontSize: Double = 14 { willSet { objectWillChange.send() } }
    @AppStorage("HuskLigatures") var ligatures = false { willSet { objectWillChange.send() } }
    @AppStorage("HuskCursorStyle") var cursorStyle = CursorStyle.block.rawValue { willSet { objectWillChange.send() } }
    @AppStorage("HuskCursorBlink") var cursorBlink = true { willSet { objectWillChange.send() } }
    @AppStorage("HuskScrollbackMB") var scrollbackMB = 10 { willSet { objectWillChange.send() } }
    /// Ghostty 1.4 changed these two on macOS; husk keeps 1.3's behavior unless they're changed here.
    @AppStorage("HuskCopyOnSelect") var copyOnSelect = true { willSet { objectWillChange.send() } }
    @AppStorage("HuskCmdArrowsScroll") var cmdArrowsScroll = true { willSet { objectWillChange.send() } }
    @AppStorage("HuskQuakeMode") var quakeMode = false { willSet { objectWillChange.send() } }
    @AppStorage("HuskQuakeHotkey") var quakeHotkey = "ctrl+grave_accent" { willSet { objectWillChange.send() } }
    @AppStorage("HuskNotifyOnFinish") var notifyOnFinish = true { willSet { objectWillChange.send() } }
    /// Not part of the config layer: new tabs offer recent directories (HuskRecentDirs).
    @AppStorage("HuskShowRecentDirs") var showRecentDirs = true { willSet { objectWillChange.send() } }
    /// The app specs open in from the Specs drawer; empty until the first one is opened, which asks.
    @AppStorage("HuskSpecsOpenWith") var specsOpenWith = "" { willSet { objectWillChange.send() } }
    /// Not part of the config layer: ⌘⇧S then P toggles the Specs drawer (HuskSpecs). Off by default.
    @AppStorage("HuskSpecsShortcut") var specsShortcut = false { willSet { objectWillChange.send() } }
    /// Every other Ghostty option set in Settings (the rows built from HuskConfigSchema): name → values,
    /// one config line each. An option at its default isn't stored.
    @Published var overrides: [String: [String]] =
        UserDefaults.standard.dictionary(forKey: "HuskConfigOverrides") as? [String: [String]] ?? [:] {
        didSet { UserDefaults.standard.set(overrides, forKey: "HuskConfigOverrides") }
    }

    /// The value an option has in Settings: its override, else the default husk runs with.
    func values(_ option: HuskConfigOption) -> [String] {
        overrides[option.name] ?? option.effectiveDefault
    }

    /// Sets an option; back at its default, the override is dropped. List options store only the
    /// lines added to the defaults.
    func set(_ option: HuskConfigOption, _ values: [String]) {
        let isDefault = option.kind == .list ? values.isEmpty : values == option.effectiveDefault
        overrides[option.name] = isDefault ? nil : values
    }

    /// The config layer these settings produce.
    var configText: String {
        var lines = ["# Written by husk Settings. Edit there, not here."]
        lines.append("font-size = \(Int(fontSize))")
        if !ligatures {
            // Husk default: ligatures off
            lines.append(contentsOf: ["font-feature = -calt", "font-feature = -liga", "font-feature = -dlig"])
        }
        lines.append("cursor-style = \(cursorStyle)")
        lines.append("cursor-style-blink = \(cursorBlink)")
        lines.append("scrollback-limit-bytes = \(scrollbackMB * 1_000_000)")
        // Selecting copies for middle-click paste (primary), as in Ghostty 1.3
        lines.append("copy-on-select = \(copyOnSelect ? "primary" : "none")")
        let (up, down) = cmdArrowsScroll ? ("scroll_to_top", "scroll_to_bottom") : ("jump_to_prompt:-1", "jump_to_prompt:1")
        lines.append(contentsOf: ["keybind = super+arrow_up=\(up)", "keybind = super+arrow_down=\(down)"])
        lines.append("notify-on-command-finish = \(notifyOnFinish ? "unfocused" : "never")")
        if quakeMode, !quakeHotkey.isEmpty {
            lines.append("keybind = global:\(quakeHotkey)=toggle_quick_terminal")
        }
        for name in overrides.keys.sorted() {
            lines.append(contentsOf: (overrides[name] ?? []).map { "\(name) = \($0)" })
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// Write the layer; returns its path for HuskConfig.
    func write(in dir: URL) -> String? {
        let file = dir.appendingPathComponent("husk-settings.ghostty")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try configText.write(to: file, atomically: true, encoding: .utf8)
            return file.path
        } catch {
            return nil
        }
    }

    @MainActor
    func apply() {
        (NSApp.delegate as? AppDelegate)?.ghostty.reloadConfig()
    }

    // MARK: Window

    @MainActor private static var window: NSWindow?

    static let defaultSize = NSSize(width: 640, height: 440)

    @MainActor
    static func show() {
        if window == nil {
            let w = NSWindow(contentViewController: NSHostingController(rootView: HuskSettingsView()))
            w.title = "husk Settings"
            w.styleMask = [.titled, .closable, .resizable]
            w.isReleasedWhenClosed = false
            w.setContentSize(defaultSize)
            window = w
        }
        guard let window else { return }
        // Every time it opens: over the terminal window in focus, or mid-screen without one.
        if let terminal = NSApp.orderedWindows.first(where: { $0.windowController is TerminalController && $0.isVisible }) {
            window.setFrameOrigin(centered(window.frame.size, over: terminal))
        } else {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// The origin that centers `size` over `target`, kept on the target's screen.
    @MainActor
    private static func centered(_ size: NSSize, over target: NSWindow) -> NSPoint {
        let t = target.frame
        var origin = NSPoint(x: t.midX - size.width / 2, y: t.midY - size.height / 2)
        if let screen = (target.screen ?? NSScreen.main)?.visibleFrame {
            origin.x = min(max(origin.x, screen.minX), screen.maxX - size.width)
            origin.y = min(max(origin.y, screen.minY), screen.maxY - size.height)
        }
        return origin
    }

    /// Point ⌘, at this window; keep the raw config file one item below it.
    @MainActor
    static func installMenu() {
        guard let appMenu = NSApp.mainMenu?.items.first?.submenu,
              let prefs = appMenu.items.first(where: { $0.keyEquivalent == "," }) else { return }
        prefs.title = "Settings…"
        prefs.target = MenuTarget.shared
        prefs.action = #selector(MenuTarget.showSettings(_:))
        // No husk update feed yet (Sparkle is disabled), so drop "Check for Updates…"
        for item in appMenu.items where item.title.hasPrefix("Check for Updates") {
            appMenu.removeItem(item)
        }
        let index = appMenu.index(of: prefs)
        if appMenu.item(withTitle: "Open Config File…") == nil {
            let raw = NSMenuItem(title: "Open Config File…", action: #selector(AppDelegate.openConfig(_:)), keyEquivalent: "")
            appMenu.insertItem(raw, at: index + 1)
        }
    }

    private final class MenuTarget: NSObject {
        static let shared = MenuTarget()
        @MainActor @objc func showSettings(_ sender: Any?) { HuskSettings.show() }
    }
}

struct HuskSettingsView: View {
    @ObservedObject private var settings = HuskSettings.shared
    @ObservedObject private var model = HuskModel.shared
    @State private var themeID = HuskThemes.selectedID

    var body: some View {
        TabView {
            Form {
                Picker("Theme", selection: $themeID) {
                    ForEach(HuskThemes.themes, id: \.id) { Text($0.name).tag($0.id) }
                }
                .onChange(of: themeID) { HuskThemes.select($0) }
                LabeledContent("Font") { HuskFontFamilyPicker() }
                Stepper("Font size: \(Int(settings.fontSize))", value: $settings.fontSize, in: 9...32, step: 1)
                Toggle("Font ligatures", isOn: $settings.ligatures)
                Text("Ligatures can slow rendering of very busy output.").font(.caption).foregroundStyle(.secondary)
                HuskOptionRow("background-opacity", label: "Background opacity")
                HuskOptionRow("background-blur", label: "Background blur")
                HuskOptionRow("unfocused-split-opacity", label: "Unfocused split opacity")
                HuskOptionRow("window-padding-x", label: "Horizontal padding")
                HuskOptionRow("window-padding-y", label: "Vertical padding")
                Toggle("Session sidebar instead of top tabs", isOn: $model.showSidebar)
            }
            .formStyle(.grouped)
            .tabItem { Text("Appearance") }

            Form {
                Picker("Cursor style", selection: $settings.cursorStyle) {
                    ForEach(HuskSettings.CursorStyle.allCases, id: \.rawValue) { Text($0.rawValue.capitalized).tag($0.rawValue) }
                }
                Toggle("Blinking cursor", isOn: $settings.cursorBlink)
                Picker("Scrollback", selection: $settings.scrollbackMB) {
                    ForEach([10, 25, 50, 100], id: \.self) { Text("\($0) MB").tag($0) }
                }
                Toggle("Copy on select (middle-click pastes it)", isOn: $settings.copyOnSelect)
                Picker("⌘↑ / ⌘↓", selection: $settings.cmdArrowsScroll) {
                    Text("Scroll to top / bottom").tag(true)
                    Text("Jump to previous / next prompt").tag(false)
                }
                HuskOptionRow("macos-option-as-alt", label: "Option key acts as Alt")
                HuskOptionRow("mouse-hide-while-typing", label: "Hide mouse while typing")
                HuskOptionRow("cursor-click-to-move", label: "Click to move the cursor")
                HuskOptionRow("shell-integration", label: "Shell integration")
                HuskOptionRow("clipboard-paste-protection", label: "Warn before pasting risky text")
                HuskOptionRow("clipboard-read", label: "Programs can read the clipboard")
                HuskOptionRow("clipboard-write", label: "Programs can write the clipboard")
            }
            .formStyle(.grouped)
            .tabItem { Text("Terminal") }

            Form {
                HuskOptionRow("window-save-state", label: "Restore windows on launch")
                HuskOptionRow("window-inherit-working-directory", label: "New windows start in the current folder")
                HuskOptionRow("window-new-tab-position", label: "New tabs open")
                HuskOptionRow("confirm-close-surface", label: "Confirm closing a running process")
                HuskOptionRow("quit-after-last-window-closed", label: "Quit when the last window closes")
                HuskOptionRow("macos-window-shadow", label: "Window shadow")
            }
            .formStyle(.grouped)
            .tabItem { Text("Windows") }

            Form {
                Toggle("Quake mode (drop-down terminal)", isOn: $settings.quakeMode)
                TextField("Hotkey", text: $settings.quakeHotkey)
                    .disabled(!settings.quakeMode)
                Text("Uses Ghostty key names, e.g. ctrl+grave_accent. Needs Accessibility permission.")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("Notify when a long command finishes", isOn: $settings.notifyOnFinish)
                Toggle("Show recent directories in new tabs", isOn: $settings.showRecentDirs)
                Toggle("⌘⇧S then P shows Specs", isOn: $settings.specsShortcut)
                Picker("Open specs with", selection: $settings.specsOpenWith) {
                    Text("Ask").tag("")
                    // The .md editors, plus the saved app if it was picked with Other….
                    let saved = settings.specsOpenWith.isEmpty ? [] : [URL(fileURLWithPath: settings.specsOpenWith)]
                    ForEach(HuskSpecs.editors() + saved.filter { !HuskSpecs.editors().contains($0) }, id: \.self) { app in
                        Text(HuskSpecs.appName(app)).tag(app.path)
                    }
                }
            }
            .formStyle(.grouped)
            .tabItem { Text("Features") }

            HuskAllSettingsView()
                .tabItem { Text("All Settings") }
        }
        .padding(20)
        .frame(minWidth: HuskSettings.defaultSize.width, maxWidth: .infinity,
               minHeight: HuskSettings.defaultSize.height, maxHeight: .infinity)
        .onChange(of: settings.configText) { _ in settings.apply() }
    }
}
