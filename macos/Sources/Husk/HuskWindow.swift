import AppKit

/// Husk's additions to a terminal window (each native tab is its own window): the centered
/// title, the process label in the native tab, and the tab's own name. Ghostty's
/// `TerminalWindow` holds one of these as `husk` and calls in from `// Husk:` hooks.
final class HuskWindowChrome: NSObject {
    private weak var window: TerminalWindow?

    /// The tab's own label (directory name or rename), separate from the window title,
    /// which shows the husk version.
    fileprivate(set) var tabTitle: String?

    /// The system draws the title left-aligned next to the traffic lights; husk centers it.
    private lazy var titleLabel: NSTextField = {
        let label = NSTextField(labelWithString: "")
        label.font = .titleBarFont(ofSize: NSFont.systemFontSize)
        label.alignment = .center
        label.lineBreakMode = .byTruncatingMiddle
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    /// What's running in this tab ("claude", "vim", "zsh"), shown in the native tab next to
    /// the ⌘N label.
    private(set) lazy var processLabel: NSTextField = {
        let label = NSTextField(labelWithAttributedString: NSAttributedString())
        label.setContentCompressionResistancePriority(.windowSizeStayPut, for: .horizontal)
        return label
    }()

    // MARK: Hooks called from TerminalWindow

    /// End of TerminalWindow.awakeFromNib: hide the system title and draw our own, level
    /// with the traffic lights.
    func install(in window: TerminalWindow) {
        self.window = window
        // Styles that already hide or replace the title keep their own behaviour.
        guard window.styleMask.contains(.titled),
              !(window is HiddenTitlebarTerminalWindow),
              !(window is TitlebarTabsTahoeTerminalWindow),
              !(window is TitlebarTabsVenturaTerminalWindow),
              let titlebarView = window.titlebarContainer?.firstDescendant(withClassName: "NSTitlebarView"),
              let closeButton = window.standardWindowButton(.closeButton) else { return }
        window.titleVisibility = .hidden
        titleLabel.stringValue = window.title
        // Double-click the title to label the window, instead of the title bar's zoom.
        let doubleClick = NSClickGestureRecognizer(target: self, action: #selector(titleDoubleClicked))
        doubleClick.numberOfClicksRequired = 2
        titleLabel.addGestureRecognizer(doubleClick)
        titleLabel.textColor = window.isKeyWindow ? .labelColor : .secondaryLabelColor
        titlebarView.addSubview(titleLabel)
        NSLayoutConstraint.activate([
            titleLabel.centerXAnchor.constraint(equalTo: titlebarView.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
        ])
    }

    /// becomeKey / resignKey.
    func keyDidChange(isKey: Bool) {
        titleLabel.textColor = isKey ? .labelColor : .secondaryLabelColor
    }

    /// TerminalWindow.title didSet, before Ghostty sets the tab's attributed title.
    func titleDidChange() {
        guard let window else { return }
        if let tabTitle { window.tab.title = tabTitle }
        titleLabel.stringValue = window.title
    }

    /// A native tab bar was added to the window.
    func tabBarDidAppear(_ tabBar: NSTitlebarAccessoryViewController) {
        // The sidebar replaces the native tab bar.
        tabBar.isHidden = HuskModel.shared.showSidebar
        // Tint the new bar's tabs now rather than on the next poll.
        DispatchQueue.main.async { MainActor.assumeIsolated { HuskModel.shared.updateTabProcessLabels() } }
    }

    @objc private func titleDoubleClicked() {
        (window?.windowController as? BaseTerminalController)?.promptWindowLabel()
    }
}

extension TerminalWindow {
    /// The tab's own label, shown in the native tab instead of the window title.
    var huskTabTitle: String? {
        get { husk.tabTitle }
        set {
            husk.tabTitle = newValue
            tab.title = newValue ?? title
            tab.attributedTitle = attributedTitle
        }
    }

    var huskProcessText: String { husk.processLabel.stringValue }

    func huskSetProcess(_ name: String?, color: NSColor?) {
        guard let name, !name.isEmpty else {
            husk.processLabel.attributedStringValue = NSAttributedString()
            return
        }
        // The whole tab carries the process colour (HuskModel.updateTabProcessLabels);
        // the label itself stays plain secondary text.
        _ = color
        let text = NSAttributedString(string: name, attributes: [
            .font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize),
            .foregroundColor: NSColor.secondaryLabelColor,
        ])
        if husk.processLabel.attributedStringValue != text {
            husk.processLabel.attributedStringValue = text
        }
    }
}
