import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The spec files for the focused tab's project, listed in a drawer that slides up from the bottom
/// (View → Show Specs, or ⌘⇧S then P when it is on in Settings). husk only reads them: the list is whatever files are there.
///
/// Where each project's specs live is kept in ~/.husk/config/specs, one line per folder, added with
/// the drawer's folder+ button (nobody edits the file by hand):
///
///     ~/Projects/probeo.io/dashboard = ~/Projects/probeo.io/dashboard/specs
///
/// A project can have several lines. The right-hand side can be a folder (its .md files, grouped
/// by subfolder) or a single file.
enum HuskSpecs {
    static var configURL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".husk/config/specs")

    struct Spec: Identifiable, Equatable {
        let url: URL
        let title: String
        let modified: Date
        var id: URL { url }
    }

    struct Group: Identifiable, Equatable {
        /// The specs folder's name for its top level, else the subfolder relative to it (prefixed
        /// with the specs folder's name when the project has more than one).
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

    /// The specs locations for a directory: the lines for the project folder that contains it,
    /// the deepest one if several do.
    static func location(for dir: String?) -> (project: String, specs: [String])? {
        guard let dir else { return nil }
        let path = (dir as NSString).standardizingPath
        let all = mappings()
        guard let project = all.map(\.project)
            .filter({ path == $0 || path.hasPrefix($0 + "/") })
            .max(by: { $0.count < $1.count }) else { return nil }
        var seen = Set<String>()
        return (project, all.filter { $0.project == project && seen.insert($0.specs).inserted }.map(\.specs))
    }

    /// The specs in each location, one after another.
    static func scan(_ paths: [String]) -> [Group] {
        paths.flatMap { path in
            let root = (path as NSString).lastPathComponent
            return scan(path).map { group in
                let name = group.name.isEmpty ? root : (paths.count > 1 ? "\(root)/\(group.name)" : group.name)
                return Group(name: name, specs: group.specs)
            }
        }
    }

    /// The .md files at `path`, grouped by subfolder ("" for the top level, which comes first),
    /// newest first in each group. A file path lists just that file.
    private static func scan(_ path: String) -> [Group] {
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

    /// Creates the config file with a comment explaining it, if it isn't there yet.
    private static func ensureConfig() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: configURL.path) else { return }
        try? fm.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let example = """
            # Where each project's specs live, for the Specs drawer (View → Show Specs).
            # husk adds a line here each time you add a folder with the drawer's folder+ button.
            # project folder = specs folder (or a single file)

            """
        try? example.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Adds a `project = specs` line to the config, unless it's already there.
    static func add(project: String, specs: String) {
        let specs = (specs as NSString).standardizingPath
        guard !mappings().contains(where: { $0.project == project && $0.specs == specs }) else { return }
        ensureConfig()
        let tilde = { (path: String) in (path as NSString).abbreviatingWithTildeInPath }
        var text = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        if !text.isEmpty && !text.hasSuffix("\n") { text += "\n" }
        text += "\(tilde(project)) = \(tilde(specs))\n"
        try? text.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// The project a directory belongs to, for a new config line: its git repo, or else the
    /// directory itself.
    static func project(for dir: String) -> String {
        HuskGit.info(for: dir)?.root ?? (dir as NSString).standardizingPath
    }

    /// Asks for the specs folder (or file) of the project `dir` is in, and adds it to the config.
    @MainActor
    static func promptToAdd(for dir: String, in window: NSWindow?, then done: @escaping () -> Void) {
        let project = project(for: dir)
        let panel = NSOpenPanel()
        panel.message = "Choose the specs folder (or file) for \((project as NSString).lastPathComponent)"
        panel.prompt = "Add"
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: project)
        let finish = { (response: NSApplication.ModalResponse) in
            guard response == .OK, let url = panel.url else { return }
            add(project: project, specs: url.path)
            done()
        }
        if let window { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
    }

    // MARK: Opening specs

    /// Apps registered to edit .md files, by name. (Every app that can merely open one includes
    /// browsers and the like; the editor role is the short list.)
    static func editors() -> [URL] {
        let md = (UTType(filenameExtension: "md") ?? .plainText).identifier as CFString
        let ids = (LSCopyAllRoleHandlersForContentType(md, .editor)?.takeRetainedValue() as? [String]) ?? []
        var seen = Set<String>()
        return ids.compactMap { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }
            .filter { seen.insert($0.path).inserted }
            .sorted { appName($0).localizedCaseInsensitiveCompare(appName($1)) == .orderedAscending }
    }

    static func appName(_ app: URL) -> String {
        FileManager.default.displayName(atPath: app.path).replacingOccurrences(of: ".app", with: "")
    }

    /// Opens a spec in `app`, or else the app saved in Settings (Features → Open specs with). With
    /// none saved yet, asks which app to use and saves it: the Mac's default for .md is often
    /// something odd (calibre, here).
    @MainActor
    static func open(_ spec: URL, with app: URL? = nil, in window: NSWindow? = nil) {
        if let app { launch(spec, in: app); return }
        let chosen = HuskSettings.shared.specsOpenWith
        if !chosen.isEmpty, FileManager.default.fileExists(atPath: chosen) {
            launch(spec, in: URL(fileURLWithPath: chosen))
            return
        }
        askForApp(in: window) { app in
            HuskSettings.shared.specsOpenWith = app.path
            launch(spec, in: app)
        }
    }

    private static func launch(_ spec: URL, in app: URL) {
        NSWorkspace.shared.open([spec], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
    }

    /// "Open specs with": the .md editors, or Other… to pick any app.
    @MainActor
    private static func askForApp(in window: NSWindow?, then done: @escaping (URL) -> Void) {
        let apps = editors()
        let alert = NSAlert()
        alert.messageText = "Open specs with"
        alert.informativeText = "husk will remember this. You can change it in Settings → Features."
        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 240, height: 26), pullsDown: false)
        for app in apps {
            popup.addItem(withTitle: appName(app))
            let icon = NSWorkspace.shared.icon(forFile: app.path)
            icon.size = NSSize(width: 16, height: 16)
            popup.lastItem?.image = icon
        }
        if !apps.isEmpty { popup.menu?.addItem(.separator()) }
        popup.addItem(withTitle: "Other…")
        if let textEdit = apps.firstIndex(where: { $0.lastPathComponent == "TextEdit.app" }) {
            popup.selectItem(at: textEdit)
        }
        alert.accessoryView = popup
        alert.addButton(withTitle: "Open")
        alert.addButton(withTitle: "Cancel")

        let finish = { (response: NSApplication.ModalResponse) in
            guard response == .alertFirstButtonReturn else { return }
            let index = popup.indexOfSelectedItem
            if index < apps.count {
                done(apps[index])
                return
            }
            let panel = NSOpenPanel()
            panel.directoryURL = URL(fileURLWithPath: "/Applications")
            panel.allowedContentTypes = [.application]
            panel.prompt = "Choose"
            guard panel.runModal() == .OK, let url = panel.url else { return }
            done(url)
        }
        if let window { alert.beginSheetModal(for: window, completionHandler: finish) } else { finish(alert.runModal()) }
    }

    // MARK: Menu and shortcut

    /// View → Show Specs, and the ⌘⇧S P chord. A menu item can't show a two-key shortcut, so the
    /// chord is in its tooltip.
    @MainActor
    static func installMenu() {
        guard let view = NSApp.mainMenu?.item(withTitle: "View")?.submenu,
              view.item(withTitle: "Show Specs") == nil else { return }
        let item = NSMenuItem(title: "Show Specs", action: #selector(MenuToggle.toggle(_:)), keyEquivalent: "")
        item.target = MenuToggle.shared
        item.toolTip = chordEnabled ? "⌘⇧S then P" : nil
        let after = view.items.firstIndex { $0.title == "Show Sidebar" }.map { $0 + 1 } ?? 0
        view.insertItem(item, at: after)
        installChord()
    }

    /// How long after ⌘⇧S the second key counts.
    static let chordWindow: TimeInterval = 1.5
    @MainActor private static var chordStarted: Date?
    @MainActor private static var monitor: Any?
    /// The self-test turns the chord on without saving the setting.
    @MainActor static var chordForced = false
    @MainActor static var chordEnabled: Bool { chordForced || HuskSettings.shared.specsShortcut }

    /// ⌘⇧S then P toggles the focused tab's panel, with ⌘ and ⇧ still held or not, when it's turned
    /// on in Settings → Features. ⌘⇧S on its own does nothing (nothing else uses it); Escape cancels;
    /// any other key after it goes through as usual. Escape also closes an open drawer, either way.
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
                if key == "p" && mods.subtracting([.command, .shift]).isEmpty {
                    controller.husk.specs.isOpen.toggle()
                    return nil
                }
                if event.keyCode == 53 { return nil }  // Escape
            }
        }
        if chordEnabled && key == "s" && mods == [.command, .shift] && !event.isARepeat {
            chordStarted = Date()
            return nil
        }
        // Escape closes an open drawer (and doesn't reach the terminal).
        if event.keyCode == 53 && mods.isEmpty && controller.husk.specs.isOpen {
            controller.husk.specs.isOpen = false
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
                item.toolTip = HuskSpecs.chordEnabled ? "⌘⇧S then P" : nil
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
                            // The arrow, not the terminal's text cursor.
                            .backport.pointerStyle(.default)
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

/// The panel itself: the project's specs in one list, a heading per subfolder; a click opens one.
struct HuskSpecsPanel: View {
    @ObservedObject private var model = HuskModel.shared
    weak var controller: TerminalController?

    @State private var location: (project: String, specs: [String])?
    @State private var groups: [HuskSpecs.Group] = []

    private let refresh = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if location == nil {
                missing
            } else if groups.isEmpty {
                empty
            } else {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(groups) { group in
                            section(group)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
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
            Button(action: addFolder) {
                Image(systemName: "folder.badge.plus").font(.system(size: 12))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(controller?.focusedSurface?.pwd == nil)
            .help("Add Specs Folder…")
            Button(action: { controller?.husk.specs.isOpen = false }) {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help(HuskSpecs.chordEnabled ? "Hide Specs (Escape, or ⌘⇧S P)" : "Hide Specs (Escape)")
        }
        .padding(.horizontal, 12)
        .frame(height: 28)
    }

    private func addFolder() {
        guard let dir = controller?.focusedSurface?.pwd else { return }
        HuskSpecs.promptToAdd(for: dir, in: controller?.window, then: reload)
    }

    /// One subfolder in the list: its name and count, then its specs.
    private func section(_ group: HuskSpecs.Group) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text(group.name).font(.system(size: 11, weight: .semibold))
                Text("\(group.specs.count)").foregroundStyle(.tertiary)
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
            .padding(.top, 8)
            .padding(.bottom, 2)
            ForEach(group.specs) { row($0) }
        }
    }

    private func row(_ spec: HuskSpecs.Spec) -> some View {
        Button(action: { HuskSpecs.open(spec.url, in: controller?.window) }) {
            HStack {
                Text(spec.title).lineLimit(1)
                Spacer(minLength: 12)
                Text(spec.modified, format: .relative(presentation: .named))
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 3)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(spec.url.path)
        .contextMenu {
            Menu("Open With") {
                ForEach(HuskSpecs.editors(), id: \.self) { app in
                    Button(HuskSpecs.appName(app)) { HuskSpecs.open(spec.url, with: app) }
                }
            }
        }
    }

    /// No specs location for this tab's project yet.
    private var missing: some View {
        message(Text("No specifications directory found."))
    }

    private var empty: some View {
        let places = (location?.specs ?? []).map { ($0 as NSString).abbreviatingWithTildeInPath }
        return message(Text("No .md files in \(places.joined(separator: ", "))."))
    }

    private func message(_ text: Text) -> some View {
        VStack(alignment: .leading) {
            text.foregroundStyle(.secondary)
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
