import AppKit

/// Husk state that lives on each terminal window controller (one per native tab).
/// Ghostty's `BaseTerminalController` holds one of these as `husk`.
final class HuskControllerState {
    /// A name for the whole window (one project per window); every tab in it carries the same one.
    fileprivate var windowLabel: String?
    /// The inputs of the last title update, kept so a label change can redo it.
    fileprivate var lastOverride: String?
    fileprivate var lastComputed = ""
    /// The last directory recorded in HuskRecentDirs for this tab.
    fileprivate var lastVisited: String?
    /// Whether the window's Specs panel is open (HuskSpecs).
    let specs = HuskSpecsState()
}

// MARK: Titles and the window label

extension BaseTerminalController {
    /// Set via Window → Label Window… or a double-click on the title.
    var windowLabel: String? {
        get { husk.windowLabel }
        set {
            husk.windowLabel = newValue
            _ = huskApplyTitle(override: husk.lastOverride, computed: husk.lastComputed)
        }
    }

    /// Hook in applyTitleToWindow, which it replaces (always returns true). The title bar shows
    /// "husk v0.3.<build>", plus "(label)" when the window is labeled; each tab is named after
    /// the focused pane's directory, or the user's rename.
    func huskApplyTitle(override: String?, computed: String) -> Bool {
        husk.lastOverride = override
        husk.lastComputed = computed
        guard let window else { return true }

        let label: String
        if let override {
            label = override
        } else if let pwd = focusedSurface?.pwd, !pwd.isEmpty {
            label = HuskDirLabel.label(for: pwd)
            if husk.lastVisited != pwd {
                husk.lastVisited = pwd
                HuskRecentDirs.visit(pwd)
            }
        } else {
            label = computed
        }

        window.title = HuskVersion.windowTitle + (windowLabel.map { " (\($0))" } ?? "")
        (window as? TerminalWindow)?.huskTabTitle = label
        // changeWindowsItem adds an entry if there isn't one, so leave hidden tabs alone.
        if !window.isExcludedFromWindowsMenu {
            NSApp.changeWindowsItem(window, title: windowsMenuTitle, filename: false)
        }
        return true
    }

    /// This window's Window-menu entry: its label, or else the tab's name.
    var windowsMenuTitle: String {
        windowLabel ?? (window as? TerminalWindow)?.huskTabTitle ?? window?.title ?? ""
    }

    @IBAction func labelWindow(_ sender: Any) {
        promptWindowLabel()
    }

    /// Prompt for the window label and apply it to every tab in the window.
    func promptWindowLabel() {
        guard let window else { return }

        let alert = NSAlert()
        alert.messageText = "Label Window"
        alert.informativeText = "Shown in the title bar and the Window menu. Leave blank to remove it."
        alert.alertStyle = .informational

        let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 250, height: 24))
        textField.stringValue = windowLabel ?? ""
        alert.accessoryView = textField

        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")

        alert.window.initialFirstResponder = textField

        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn else { return }

            let label = textField.stringValue.trimmingCharacters(in: .whitespaces)
            for tab in window.tabbedWindows ?? [window] {
                (tab.windowController as? BaseTerminalController)?.windowLabel = label.isEmpty ? nil : label
            }
        }
    }
}

// MARK: Tabs and the Window menu

extension TerminalController {
    /// Hook in newTab: a new tab joins its window's project, with its label and Specs panel.
    func huskJoinWindow(of parent: TerminalController) {
        windowLabel = parent.windowLabel
        husk.specs.isOpen = parent.husk.specs.isOpen
    }

    /// Hook at the end of relabelTabs, which runs when the key window changes, a tab closes
    /// or tabs are reordered.
    func huskTabsDidChange() {
        // A tab dragged in from another window takes this window's label (or none).
        if let window, let other = window.tabbedWindows?.first(where: { $0 != window }),
           let otherController = other.windowController as? BaseTerminalController,
           windowLabel != otherController.windowLabel {
            windowLabel = otherController.windowLabel
        }

        Self.syncWindowsMenu()
    }

    /// List each window once in the Window menu, not every tab. Each macOS tab is its own
    /// NSWindow, so only the selected tab of each tab group stays in the menu. All windows
    /// are synced because a tab dragged out of one group, or closed in it, changes which tab
    /// that group has selected.
    static func syncWindowsMenu() {
        for controller in all {
            guard let window = controller.window else { continue }
            let group = window.tabGroup
            let hidden = (group?.windows.count ?? 1) > 1 && group?.selectedWindow != window
            window.isExcludedFromWindowsMenu = hidden
            // The flag alone doesn't drop an entry that already exists, or bring one back.
            if hidden {
                NSApp.removeWindowsItem(window)
            } else {
                NSApp.changeWindowsItem(window, title: controller.windowsMenuTitle, filename: false)
            }
        }
    }
}

// MARK: Window restoration

/// The window label is saved next to Ghostty's restorable state rather than inside it.
enum HuskRestore {
    private static let windowLabelKey = "huskWindowLabel"

    /// Hook in TerminalController.window(_:willEncodeRestorableState:).
    static func encode(_ controller: BaseTerminalController, to coder: NSCoder) {
        coder.encode(controller.windowLabel as NSString?, forKey: windowLabelKey)
    }

    /// Hook in TerminalWindowRestoration.restoreWindow, read before Ghostty's state is decoded.
    static func windowLabel(from coder: NSCoder) -> String? {
        coder.decodeObject(of: NSString.self, forKey: windowLabelKey) as String?
    }
}
