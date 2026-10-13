import AppKit

/// Husk profiles (a named set of tabs + their directories) and workspaces (every window,
/// with its tabs and split layout). Same JSON files as Husk — ~/.husk/profiles and
/// ~/.husk/workspaces — so either app can open what the other saved.
/// Ports husk/src/main/profiles.ts and workspaces.ts.
enum HuskProfiles {
    // MARK: Formats (husk/src/main/profiles.ts, workspaces.ts)

    struct Session: Codable {
        var label: String
        var cwd: String
        var autoLabel: Bool?
    }

    struct Profile: Codable {
        var name: String
        var sessions: [Session]
    }

    indirect enum PaneNode: Codable {
        case leaf(id: String, cwd: String)
        /// Husk directions: "vertical" = side by side (⌘D), "horizontal" = stacked (⌘⇧D).
        case split(id: String, direction: String, ratio: Double, children: [PaneNode])

        private enum CodingKeys: String, CodingKey { case type, id, cwd, direction, ratio, children }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
            if try c.decode(String.self, forKey: .type) == "split" {
                self = .split(id: id,
                              direction: try c.decode(String.self, forKey: .direction),
                              ratio: (try? c.decode(Double.self, forKey: .ratio)) ?? 0.5,
                              children: try c.decode([PaneNode].self, forKey: .children))
            } else {
                self = .leaf(id: id, cwd: (try? c.decode(String.self, forKey: .cwd)) ?? NSHomeDirectory())
            }
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case let .leaf(id, cwd):
                try c.encode("leaf", forKey: .type)
                try c.encode(id, forKey: .id)
                try c.encode(cwd, forKey: .cwd)
            case let .split(id, direction, ratio, children):
                try c.encode("split", forKey: .type)
                try c.encode(id, forKey: .id)
                try c.encode(direction, forKey: .direction)
                try c.encode(ratio, forKey: .ratio)
                try c.encode(children, forKey: .children)
            }
        }

        var firstCwd: String {
            switch self {
            case let .leaf(_, cwd): return cwd
            case let .split(_, _, _, children): return children.first?.firstCwd ?? NSHomeDirectory()
            }
        }
    }

    struct WorkspaceSession: Codable {
        var label: String
        var autoLabel: Bool?
        var paneTree: PaneNode
        var focusedPaneIndex: Int
    }

    struct Bounds: Codable {
        var x: Double, y: Double, width: Double, height: Double
    }

    struct WorkspaceWindow: Codable {
        var bounds: Bounds
        var sessions: [WorkspaceSession]
        var activeSessionIndex: Int
        var sidebarWidth: Double
    }

    struct Workspace: Codable {
        var name: String
        var windows: [WorkspaceWindow]
    }

    // MARK: Storage

    static let profilesDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".husk/profiles")
    static let workspacesDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".husk/workspaces")

    /// Husk's filename rule: lowercase, runs of non-alphanumerics → "-".
    static func filename(for name: String) -> String {
        let slug = name.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        return slug + ".json"
    }

    static func loadAll<T: Decodable>(_ type: T.Type, from dir: URL) -> [T] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(T.self, from: Data(contentsOf: $0)) }
    }

    static func profiles() -> [Profile] {
        loadAll(Profile.self, from: profilesDir).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    static func workspaces() -> [Workspace] {
        loadAll(Workspace.self, from: workspacesDir).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    static func save<T: Encodable>(_ value: T, name: String, in dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(value).write(to: dir.appendingPathComponent(filename(for: name)))
    }

    // MARK: Capture

    @MainActor
    static func cwd(of tab: TerminalController) -> String {
        tab.focusedSurface?.pwd ?? HuskModel.shared.status(for: tab).cwd ?? NSHomeDirectory()
    }

    @MainActor
    static func profile(named name: String, from window: NSWindow?) -> Profile {
        let sessions = HuskModel.tabs(of: window).map { tab in
            Session(label: HuskModel.shared.label(for: tab), cwd: cwd(of: tab), autoLabel: tab.titleOverride == nil)
        }
        return Profile(name: name, sessions: sessions)
    }

    @MainActor
    static func workspace(named name: String) -> Workspace {
        var seen = Set<ObjectIdentifier>()
        var windows: [WorkspaceWindow] = []
        for window in NSApp.windows where window.windowController is TerminalController && window.isVisible {
            let tabs = HuskModel.tabs(of: window)
            guard let first = tabs.first, seen.insert(ObjectIdentifier(first)).inserted else { continue }
            let frame = window.frame
            var sessions: [WorkspaceSession] = []
            for tab in tabs {
                let leaves: [Ghostty.SurfaceView] = Array(tab.surfaceTree)
                var focused = 0
                if let f = tab.focusedSurface, let i = leaves.firstIndex(where: { $0 === f }) { focused = i }
                var tree = PaneNode.leaf(id: UUID().uuidString, cwd: cwd(of: tab))
                if let root = tab.surfaceTree.root { tree = paneNode(root) }
                sessions.append(WorkspaceSession(label: HuskModel.shared.label(for: tab),
                                                 autoLabel: tab.titleOverride == nil,
                                                 paneTree: tree,
                                                 focusedPaneIndex: focused))
            }
            let active = tabs.firstIndex { $0.window?.isKeyWindow == true || $0.window == window.tabGroup?.selectedWindow } ?? 0
            windows.append(WorkspaceWindow(bounds: Bounds(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height),
                                           sessions: sessions, activeSessionIndex: active, sidebarWidth: 130))
        }
        return Workspace(name: name, windows: windows)
    }

    @MainActor
    private static func paneNode(_ node: SplitTree<Ghostty.SurfaceView>.Node) -> PaneNode {
        switch node {
        case let .leaf(view):
            return .leaf(id: UUID().uuidString, cwd: view.pwd ?? NSHomeDirectory())
        case let .split(split):
            // Ghostty .horizontal = left|right = Husk "vertical"
            return .split(id: UUID().uuidString,
                          direction: split.direction == .horizontal ? "vertical" : "horizontal",
                          ratio: split.ratio,
                          children: [paneNode(split.left), paneNode(split.right)])
        }
    }

    // MARK: Open

    private static func config(cwd: String) -> Ghostty.SurfaceConfiguration {
        var c = Ghostty.SurfaceConfiguration()
        c.workingDirectory = cwd
        return c
    }

    @MainActor
    static func open(_ profile: Profile, ghostty: Ghostty.App) {
        guard let first = profile.sessions.first else { return }
        let window = TerminalController.newWindow(ghostty, withBaseConfig: config(cwd: first.cwd))
        if first.autoLabel == false { window.titleOverride = first.label }
        for session in profile.sessions.dropFirst() {
            let tab = TerminalController.newTab(ghostty, from: window.window, withBaseConfig: config(cwd: session.cwd))
            if session.autoLabel == false { tab?.titleOverride = session.label }
        }
        HuskModel.shared.tabsChanged()
    }

    @MainActor
    static func open(_ workspace: Workspace, ghostty: Ghostty.App) {
        for spec in workspace.windows {
            guard let first = spec.sessions.first else { continue }
            let window = TerminalController.newWindow(ghostty, withBaseConfig: config(cwd: first.paneTree.firstCwd))
            window.window?.setFrame(NSRect(x: spec.bounds.x, y: spec.bounds.y, width: spec.bounds.width, height: spec.bounds.height), display: true)
            apply(first, to: window)
            var tabs = [window]
            for session in spec.sessions.dropFirst() {
                guard let tab = TerminalController.newTab(ghostty, from: window.window, withBaseConfig: config(cwd: session.paneTree.firstCwd)) else { continue }
                apply(session, to: tab)
                tabs.append(tab)
            }
            if tabs.indices.contains(spec.activeSessionIndex) {
                tabs[spec.activeSessionIndex].window?.makeKeyAndOrderFront(nil)
            }
        }
        HuskModel.shared.tabsChanged()
    }

    /// Rebuild a tab's split layout: the tab's first surface becomes the tree's first leaf.
    @MainActor
    private static func apply(_ session: WorkspaceSession, to tab: TerminalController) {
        if session.autoLabel == false { tab.titleOverride = session.label }
        guard let root = tab.surfaceTree.first else { return }
        build(session.paneTree, at: root, in: tab)
    }

    @MainActor
    private static func build(_ node: PaneNode, at view: Ghostty.SurfaceView, in tab: TerminalController) {
        guard case let .split(_, direction, _, children) = node, children.count == 2 else { return }
        let dir: SplitTree<Ghostty.SurfaceView>.NewDirection = direction == "vertical" ? .right : .down
        guard let second = tab.newSplit(at: view, direction: dir, baseConfig: config(cwd: children[1].firstCwd)) else { return }
        build(children[0], at: view, in: tab)
        build(children[1], at: second, in: tab)
    }

    // MARK: Menu

    /// File menu items: Save as Profile…, Open Profile ▸, Save Workspace…, Open Workspace ▸
    @MainActor
    static func installMenu() {
        guard let fileMenu = NSApp.mainMenu?.item(withTitle: "File")?.submenu,
              fileMenu.item(withTitle: "Save as Profile…") == nil else { return }
        let target = MenuTarget.shared
        var index = fileMenu.numberOfItems
        if let close = fileMenu.items.firstIndex(where: { $0.title.hasPrefix("Close") }) { index = close }

        let items: [NSMenuItem] = [
            .separator(),
            item("Save as Profile…", #selector(MenuTarget.saveProfile(_:)), target),
            submenu("Open Profile", delegate: target, tag: 1),
            item("Save Workspace…", #selector(MenuTarget.saveWorkspace(_:)), target),
            submenu("Open Workspace", delegate: target, tag: 2),
            .separator(),
        ]
        for (offset, item) in items.enumerated() { fileMenu.insertItem(item, at: index + offset) }
    }

    private static func item(_ title: String, _ action: Selector, _ target: AnyObject) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = target
        return item
    }

    private static func submenu(_ title: String, delegate: NSMenuDelegate, tag: Int) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        menu.delegate = delegate
        item.submenu = menu
        item.tag = tag
        return item
    }

    @MainActor
    static func promptName(_ message: String) -> String? {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let name = field.stringValue.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? nil : name
    }

    private final class MenuTarget: NSObject, NSMenuDelegate {
        static let shared = MenuTarget()

        private var ghostty: Ghostty.App? { (NSApp.delegate as? AppDelegate)?.ghostty }

        @MainActor @objc func saveProfile(_ sender: Any?) {
            guard let name = HuskProfiles.promptName("Save these tabs as a profile") else { return }
            try? HuskProfiles.save(HuskProfiles.profile(named: name, from: NSApp.keyWindow ?? NSApp.mainWindow),
                                   name: name, in: HuskProfiles.profilesDir)
        }

        @MainActor @objc func saveWorkspace(_ sender: Any?) {
            guard let name = HuskProfiles.promptName("Save all windows as a workspace") else { return }
            try? HuskProfiles.save(HuskProfiles.workspace(named: name), name: name, in: HuskProfiles.workspacesDir)
        }

        @MainActor @objc func openProfile(_ sender: NSMenuItem) {
            guard let profile = sender.representedObject as? HuskProfiles.Profile, let ghostty else { return }
            HuskProfiles.open(profile, ghostty: ghostty)
        }

        @MainActor @objc func openWorkspace(_ sender: NSMenuItem) {
            guard let workspace = sender.representedObject as? HuskProfiles.Workspace, let ghostty else { return }
            HuskProfiles.open(workspace, ghostty: ghostty)
        }

        /// Fill the Open Profile / Open Workspace submenus from disk each time they open.
        func menuNeedsUpdate(_ menu: NSMenu) {
            menu.removeAllItems()
            if menu.title == "Open Profile" {
                let profiles = HuskProfiles.profiles()
                if profiles.isEmpty { menu.addItem(withTitle: "No profiles", action: nil, keyEquivalent: "").isEnabled = false }
                for p in profiles {
                    let item = NSMenuItem(title: p.name, action: #selector(openProfile(_:)), keyEquivalent: "")
                    item.target = self
                    item.representedObject = p
                    menu.addItem(item)
                }
            } else {
                let workspaces = HuskProfiles.workspaces()
                if workspaces.isEmpty { menu.addItem(withTitle: "No workspaces", action: nil, keyEquivalent: "").isEnabled = false }
                for w in workspaces {
                    let count = w.windows.count
                    let item = NSMenuItem(title: "\(w.name)  (\(count) window\(count == 1 ? "" : "s"))",
                                          action: #selector(openWorkspace(_:)), keyEquivalent: "")
                    item.target = self
                    item.representedObject = w
                    menu.addItem(item)
                }
            }
        }
    }
}
