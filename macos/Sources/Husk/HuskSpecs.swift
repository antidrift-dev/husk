import AppKit
import SwiftUI

/// The spec files for the focused tab's project, listed in a drawer that slides up from the bottom
/// (View → Show Specs, or ⌘S then ⌘P). husk only reads them: the list is whatever files are there.
///
/// Where each project's specs live is set in ~/.husk/config/specs, one line per project:
///
///     ~/Projects/probeo.io/dashboard = ~/Projects/probeo.io/dashboard/specs
///
/// The right-hand side can be a folder (its .md files, grouped by subfolder) or a single file.
enum HuskSpecs {
    static var configURL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".husk/config/specs")

    struct Spec: Identifiable, Equatable {
        let url: URL
        let title: String
        let modified: Date
        var id: URL { url }
    }

    struct Group: Identifiable, Equatable {
        /// The subfolder the specs are in, relative to the specs folder; "" for its top level.
        let name: String
        let specs: [Spec]
        var id: String { name }
    }

    /// Project folder → specs location, from the config file. Lines starting with # are comments.
    static func mappings() -> [(project: String, specs: String)] {
        guard let text = try? String(contentsOf: configURL, encoding: .utf8) else { return [] }
        return text.split(whereSeparator: \.isNewline).compactMap { line in
            let line = line.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty, !line.hasPrefix("#"), let eq = line.firstIndex(of: "=") else { return nil }
            let project = expand(line[..<eq]), specs = expand(line[line.index(after: eq)...])
            guard !project.isEmpty, !specs.isEmpty else { return nil }
            return (project, specs)
        }
    }

    private static func expand(_ path: Substring) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "" : ((trimmed as NSString).expandingTildeInPath as NSString).standardizingPath
    }

    /// The specs location for a directory: the mapping whose project folder contains it, the
    /// deepest one if several do.
    static func location(for dir: String?) -> (project: String, specs: String)? {
        guard let dir else { return nil }
        let path = (dir as NSString).standardizingPath
        return mappings()
            .filter { path == $0.project || path.hasPrefix($0.project + "/") }
            .max { $0.project.count < $1.project.count }
    }

    /// The .md files at `path`, grouped by subfolder (top level first, then by name), newest
    /// first in each group. A file path lists just that file.
    static func scan(_ path: String) -> [Group] {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isDir) else { return [] }
        let root = URL(fileURLWithPath: path)
        guard isDir.boolValue else { return spec(root).map { [Group(name: "", specs: [$0])] } ?? [] }

        // Relative paths, so the group names don't depend on how the folder's path is spelled
        // (/tmp vs /private/tmp).
        var byFolder: [String: [Spec]] = [:]
        let files = fm.enumerator(atPath: path)
        while let relative = files?.nextObject() as? String {
            let parts = relative.split(separator: "/")
            guard !parts.contains(where: { $0.hasPrefix(".") }),
                  (relative as NSString).pathExtension.lowercased() == "md",
                  let spec = spec(root.appendingPathComponent(relative)) else { continue }
            byFolder[parts.dropLast().joined(separator: "/"), default: []].append(spec)
        }
        return byFolder.keys.sorted { ($0.isEmpty ? 0 : 1, $0) < ($1.isEmpty ? 0 : 1, $1) }.map { name in
            Group(name: name, specs: byFolder[name]!.sorted { $0.modified > $1.modified })
        }
    }

    /// A spec's title is its first `# ` heading, or else its file name.
    private static func spec(_ url: URL) -> Spec? {
        let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
        var title = url.deletingPathExtension().lastPathComponent
        if let handle = try? FileHandle(forReadingFrom: url) {
            defer { try? handle.close() }
            let head = String(decoding: (try? handle.read(upToCount: 4096)) ?? Data(), as: UTF8.self)
            if let heading = head.split(whereSeparator: \.isNewline).first(where: { $0.hasPrefix("# ") }) {
                title = heading.dropFirst(2).trimmingCharacters(in: .whitespaces)
            }
        }
        return Spec(url: url, title: title, modified: modified)
    }

    /// Opens the config file, creating it with an example first.
    static func openConfig() {
        let fm = FileManager.default
        if !fm.fileExists(atPath: configURL.path) {
            try? fm.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let example = """
                # Where each project's specs live, for the Specs panel (View → Show Specs, or ⌘S then ⌘P).
                # project folder = specs folder (or a single file)
                # ~/Projects/myapp = ~/Projects/myapp/specs

                """
            try? example.write(to: configURL, atomically: true, encoding: .utf8)
        }
        NSWorkspace.shared.open([configURL], withApplicationAt: URL(fileURLWithPath: "/System/Applications/TextEdit.app"),
                                configuration: NSWorkspace.OpenConfiguration())
    }

    // MARK: Menu and shortcut

    /// View → Show Specs, and the ⌘S ⌘P chord. A menu item can't show a two-key shortcut, so the
    /// chord is in the title.
    @MainActor
    static func installMenu() {
        guard let view = NSApp.mainMenu?.item(withTitle: "View")?.submenu,
              view.item(withTitle: "Show Specs") == nil else { return }
        let item = NSMenuItem(title: "Show Specs", action: #selector(MenuToggle.toggle(_:)), keyEquivalent: "")
        item.target = MenuToggle.shared
        item.toolTip = "⌘S then ⌘P (or P)"
        let after = view.items.firstIndex { $0.title == "Show Sidebar" }.map { $0 + 1 } ?? 0
        view.insertItem(item, at: after)
        installChord()
    }

    /// How long after ⌘S the second key counts.
    static let chordWindow: TimeInterval = 1.5
    @MainActor private static var chordStarted: Date?
    @MainActor private static var monitor: Any?

    /// ⌘S then ⌘P (or P) toggles the focused tab's panel. ⌘S on its own does nothing (nothing else
    /// uses it); Escape cancels; any other key after ⌘S goes through as usual.
    @MainActor
    private static func installChord() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            MainActor.assumeIsolated { handleChord(event) }
        }
    }

    @MainActor
    private static func handleChord(_ event: NSEvent) -> NSEvent? {
        // The window the key went to; the key window when there is none.
        guard let controller = (event.window ?? NSApp.keyWindow)?.windowController as? TerminalController else {
            chordStarted = nil
            return event
        }
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        let key = event.charactersIgnoringModifiers?.lowercased()
        if let started = chordStarted {
            chordStarted = nil
            if Date().timeIntervalSince(started) <= chordWindow {
                if key == "p" && (mods == .command || mods.isEmpty) {
                    controller.husk.specs.isOpen.toggle()
                    return nil
                }
                if event.keyCode == 53 { return nil }  // Escape
            }
        }
        if key == "s" && mods == .command && !event.isARepeat {
            chordStarted = Date()
            return nil
        }
        return event
    }

    private final class MenuToggle: NSObject, NSMenuItemValidation {
        static let shared = MenuToggle()

        @MainActor @objc func toggle(_ sender: NSMenuItem) {
            guard let controller = NSApp.keyWindow?.windowController as? TerminalController else { return }
            controller.husk.specs.isOpen.toggle()
        }

        func validateMenuItem(_ item: NSMenuItem) -> Bool {
            MainActor.assumeIsolated {
                let controller = NSApp.keyWindow?.windowController as? TerminalController
                item.state = controller?.husk.specs.isOpen == true ? .on : .off
                return controller != nil
            }
        }
    }
}

/// Whether a tab's Specs panel is open. Each tab has its own, since tabs in one window can be in
/// different projects; a new tab starts with it closed.
final class HuskSpecsState: ObservableObject {
    @Published var isOpen = false
}

/// Hosts the panel as a drawer over the bottom of the terminal, sliding up and down. The
/// terminal keeps its size.
struct HuskSpecsOverlay: View {
    weak var controller: TerminalController?
    @ObservedObject var state: HuskSpecsState
    let background: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                if state.isOpen {
                    VStack(spacing: 0) {
                        Divider()
                        HuskSpecsPanel(controller: controller)
                            .frame(maxWidth: .infinity)
                            .frame(height: max(180, geo.size.height / 3))
                            .background(background)
                    }
                    .shadow(color: .black.opacity(0.25), radius: 8)
                    .transition(.move(edge: .bottom))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
        .clipped()
        .animation(.easeInOut(duration: 0.2), value: state.isOpen)
    }
}

/// The panel itself: the project's specs, one column per subfolder; a click opens one.
struct HuskSpecsPanel: View {
    @ObservedObject private var model = HuskModel.shared
    weak var controller: TerminalController?

    @State private var location: (project: String, specs: String)?
    @State private var groups: [HuskSpecs.Group] = []

    private let refresh = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if location == nil {
                empty("No specs folder for this project.", button: "Edit ~/.husk/config/specs")
            } else if groups.isEmpty {
                empty("No .md files in \((location!.specs as NSString).abbreviatingWithTildeInPath).", button: nil)
            } else {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(groups) { group in
                            column(group)
                            Divider()
                        }
                    }
                }
            }
        }
        .font(.system(size: 12))
        .onAppear(perform: reload)
        .onReceive(refresh) { _ in reload() }
        .onChange(of: model.statuses) { _ in reload() }
    }

    private var header: some View {
        HStack {
            Text("Specs").font(.system(size: 12, weight: .semibold))
            if let location {
                Text((location.project as NSString).lastPathComponent).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button(action: { controller?.husk.specs.isOpen = false }) {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .backport.pointerStyle(.link)
            .help("Hide Specs (⌘S ⌘P)")
        }
        .padding(.horizontal, 12)
        .frame(height: 28)
    }

    /// One subfolder: its name and count, then its specs, scrolling on their own.
    private func column(_ group: HuskSpecs.Group) -> some View {
        let name = group.name.isEmpty ? ((location?.specs ?? "") as NSString).lastPathComponent : group.name
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text(name).font(.system(size: 11, weight: .semibold))
                Text("\(group.specs.count)").foregroundStyle(.tertiary)
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 4)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(group.specs) { row($0) }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
            }
        }
        .frame(width: 260)
    }

    private func row(_ spec: HuskSpecs.Spec) -> some View {
        Button(action: { NSWorkspace.shared.open(spec.url) }) {
            VStack(alignment: .leading, spacing: 1) {
                Text(spec.title).lineLimit(2)
                Text(spec.modified, format: .relative(presentation: .named))
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(spec.url.path)
    }

    private func empty(_ text: String, button: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text).foregroundStyle(.secondary)
            if let button {
                Button(button) { HuskSpecs.openConfig() }
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    private func reload() {
        let dir = controller?.focusedSurface?.pwd
        DispatchQueue.global(qos: .utility).async {
            let found = HuskSpecs.location(for: dir)
            let scanned = found.map { HuskSpecs.scan($0.specs) } ?? []
            DispatchQueue.main.async {
                if location?.project != found?.project || location?.specs != found?.specs { location = found }
                if groups != scanned { groups = scanned }
            }
        }
    }
}
