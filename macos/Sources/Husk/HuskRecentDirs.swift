import AppKit
import GhosttyKit
import SwiftUI

/// Directories tabs have been in, most recent first, so a new tab can jump back to one
/// (⌘1–9 in a modal) instead of typing the path again.
enum HuskRecentDirs {
    static let limit = 20
    static let shown = 9

    /// Saved as a JSON array of paths. The self-test points this at its out dir.
    static var storeURL: URL? = HuskConfig.supportDir()?.appendingPathComponent("recent-dirs.json") {
        didSet { cached = nil }
    }

    private static var cached: [String]?

    static var all: [String] {
        if let cached { return cached }
        let loaded = storeURL.flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String] } ?? []
        cached = loaded
        return loaded
    }

    /// A tab arrived in `dir`: move it to the front. Home and / aren't worth a slot.
    static func visit(_ dir: String) {
        guard !dir.isEmpty, dir != "/", dir != NSHomeDirectory() else { return }
        var dirs = all.filter { $0 != dir }
        dirs.insert(dir, at: 0)
        dirs = Array(dirs.prefix(limit))
        guard dirs != all else { return }
        cached = dirs
        guard let storeURL, let data = try? JSONSerialization.data(withJSONObject: dirs) else { return }
        try? FileManager.default.createDirectory(at: storeURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storeURL, options: .atomic)
    }

    /// What the modal lists: the most recent directories that still exist, other than the one
    /// the new tab already starts in.
    static func choices(excluding current: String?) -> [String] {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        return all
            .filter { $0 != current && fm.fileExists(atPath: $0, isDirectory: &isDir) && isDir.boolValue }
            .prefix(shown)
            .map { $0 }
    }

    // MARK: The modal

    /// Hook at the end of TerminalController.newTab: offer the recent directories as a sheet on
    /// the new tab, once it's on screen. Only for a tab you opened yourself (⌘N, the + button),
    /// which starts where its parent is; tabs opened somewhere specific (a profile, a workspace,
    /// AppleScript, a dropped folder) are left alone.
    static func offer(in controller: TerminalController, baseConfig: Ghostty.SurfaceConfiguration?, parentPwd: String?) {
        guard HuskSettings.shared.showRecentDirs else { return }
        let standard = { (path: String?) in path.map { ($0 as NSString).standardizingPath } }
        if let requested = baseConfig?.workingDirectory, standard(requested) != standard(parentPwd) { return }
        show(in: controller, excluding: standard(parentPwd))
    }

    /// Hook where a window you asked for opens (⌘⇧N, File → New Window, the Dock menu). Windows
    /// opened elsewhere (relaunch, profiles, AppleScript) don't come through here.
    static func offer(inNewWindow controller: TerminalController, startingIn current: String?) {
        guard HuskSettings.shared.showRecentDirs else { return }
        show(in: controller, excluding: current.map { ($0 as NSString).standardizingPath })
    }

    private static func show(in controller: TerminalController, excluding current: String?) {
        let dirs = choices(excluding: current)
        guard !dirs.isEmpty else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            MainActor.assumeIsolated { present(dirs, in: controller) }
        }
    }

    @MainActor
    private static func present(_ dirs: [String], in controller: TerminalController) {
        guard let window = controller.window, window.attachedSheet == nil else { return }
        let sheet = NSWindow(contentRect: .zero, styleMask: [.titled], backing: .buffered, defer: true)
        let close: (String?) -> Void = { [weak controller, weak window, weak sheet] dir in
            if let window, let sheet { window.endSheet(sheet) }
            if let dir, let controller { cd(controller, to: dir) }
        }
        sheet.contentViewController = NSHostingController(rootView: HuskRecentDirsView(dirs: dirs, close: close))
        window.beginSheet(sheet)
    }

    /// Types `cd -- '<dir>'` into the tab's shell.
    @MainActor
    static func cd(_ controller: TerminalController, to dir: String) {
        guard let surface = controller.focusedSurface?.surface else { return }
        let quoted = "'" + dir.replacingOccurrences(of: "'", with: "'\\''") + "'"
        // `text:` types raw input. The binding parser reads escapes, so backslashes are doubled
        // and \r is Enter.
        let text = "cd -- \(quoted)".replacingOccurrences(of: "\\", with: "\\\\")
        let action = "text:\(text)\\r"
        _ = ghostty_surface_binding_action(surface, action, UInt(action.lengthOfBytes(using: .utf8)))
    }
}

struct HuskRecentDirsView: View {
    let dirs: [String]
    let close: (String?) -> Void

    @ObservedObject private var settings = HuskSettings.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent directories").font(.headline)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(dirs.enumerated()), id: \.offset) { index, dir in
                    Button(action: { close(dir) }) {
                        HStack(spacing: 12) {
                            Text("⌘\(index + 1)").foregroundStyle(.secondary).frame(width: 28, alignment: .leading)
                            Text((dir as NSString).lastPathComponent).fontWeight(.medium)
                            Text((dir as NSString).abbreviatingWithTildeInPath)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.head)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
                }
            }
            Divider()
            HStack {
                Toggle("Don't show again", isOn: Binding(
                    get: { !settings.showRecentDirs },
                    set: { settings.showRecentDirs = !$0 }
                ))
                Spacer()
                Button("Close") { close(nil) }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .font(.system(size: 13))
        .padding(20)
        .frame(width: 520)
    }
}
