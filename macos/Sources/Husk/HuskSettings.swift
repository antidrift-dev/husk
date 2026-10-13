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
    @AppStorage("HuskQuakeMode") var quakeMode = false { willSet { objectWillChange.send() } }
    @AppStorage("HuskQuakeHotkey") var quakeHotkey = "ctrl+grave_accent" { willSet { objectWillChange.send() } }
    @AppStorage("HuskNotifyOnFinish") var notifyOnFinish = true { willSet { objectWillChange.send() } }

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
        lines.append("scrollback-limit = \(scrollbackMB * 1_000_000)")
        lines.append("notify-on-command-finish = \(notifyOnFinish ? "unfocused" : "never")")
        if quakeMode, !quakeHotkey.isEmpty {
            lines.append("keybind = global:\(quakeHotkey)=toggle_quick_terminal")
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

    @MainActor
    static func show() {
        if window == nil {
            let w = NSWindow(contentViewController: NSHostingController(rootView: HuskSettingsView()))
            w.title = "husk Settings"
            w.styleMask = [.titled, .closable]
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
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
                Stepper("Font size: \(Int(settings.fontSize))", value: $settings.fontSize, in: 9...32, step: 1)
                Toggle("Font ligatures", isOn: $settings.ligatures)
                Text("Ligatures can slow rendering of very busy output.").font(.caption).foregroundStyle(.secondary)
                Toggle("Session sidebar instead of top tabs", isOn: $model.showSidebar)
            }
            .tabItem { Text("Appearance") }

            Form {
                Picker("Cursor style", selection: $settings.cursorStyle) {
                    ForEach(HuskSettings.CursorStyle.allCases, id: \.rawValue) { Text($0.rawValue.capitalized).tag($0.rawValue) }
                }
                Toggle("Blinking cursor", isOn: $settings.cursorBlink)
                Picker("Scrollback", selection: $settings.scrollbackMB) {
                    ForEach([10, 25, 50, 100], id: \.self) { Text("\($0) MB").tag($0) }
                }
            }
            .tabItem { Text("Terminal") }

            Form {
                Toggle("Quake mode (drop-down terminal)", isOn: $settings.quakeMode)
                TextField("Hotkey", text: $settings.quakeHotkey)
                    .disabled(!settings.quakeMode)
                Text("Uses Ghostty key names, e.g. ctrl+grave_accent. Needs Accessibility permission.")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("Notify when a long command finishes", isOn: $settings.notifyOnFinish)
            }
            .tabItem { Text("Features") }
        }
        .padding(20)
        .frame(width: 460, height: 280)
        .onChange(of: settings.configText) { _ in settings.apply() }
    }
}
