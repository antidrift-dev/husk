import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Husk's vertical session list (husk/src/renderer/Sidebar.tsx): one row per tab,
/// named after its directory, tinted by what's running, ⌘N badges, + to add.
struct HuskSidebar: View {
    @ObservedObject private var model = HuskModel.shared
    weak var controller: TerminalController?

    @State private var editing: ObjectIdentifier?
    @State private var dropTarget: ObjectIdentifier?
    @State private var editText = ""
    @FocusState private var editFocused: Bool

    var body: some View {
        let _ = model.tabsVersion
        let tabs = HuskModel.tabs(of: controller?.window)
        VStack(spacing: 6) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 6) {
                    ForEach(Array(tabs.enumerated()), id: \.element.huskID) { index, tab in
                        row(tab, index: index, active: tab === controller)
                    }
                    Button(action: { controller?.newTab(nil) }) {
                        Image(systemName: "plus")
                            .font(.system(size: 15, weight: .light))
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundStyle(.tertiary))
                    .help("New Session (⌘N)")
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
            }
            Spacer(minLength: 0)
            HuskSidebarFooter()
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func row(_ tab: TerminalController, index: Int, active: Bool) -> some View {
        let status = model.status(for: tab)
        let tint = HuskProcessColors.color(for: status.process)
        ZStack(alignment: .topTrailing) {
            VStack(spacing: 2) {
                if editing == tab.huskID {
                    TextField("", text: $editText, onCommit: { commitRename(tab) })
                        .textFieldStyle(.plain)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 12))
                        .focused($editFocused)
                        .onExitCommand { editing = nil }
                } else {
                    Text(model.label(for: tab))
                        .font(.system(size: 12, weight: active ? .semibold : .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                if status.caffeinated {
                    Text("caffeinated").font(.system(size: 9)).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .padding(.horizontal, 8)

            if index < 9 {
                Text("⌘\(index + 1)")
                    .font(.system(size: 9, weight: .medium))
                    .opacity(0.5)
                    .padding(.top, 3)
                    .padding(.trailing, 5)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(tint.map { $0.opacity(active ? 0.35 : 0.18) } ?? Color.primary.opacity(active ? 0.12 : 0.04))
        )
        .overlay(alignment: .leading) {
            if active {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(tint ?? Color.accentColor)
                    .frame(width: 3)
                    .padding(.vertical, 4)
            }
        }
        .shadow(color: .black.opacity(active ? 0.3 : 0.15), radius: active ? 4 : 1.5, y: active ? 2 : 1)
        .overlay(alignment: .top) {
            if dropTarget == tab.huskID {
                Rectangle().fill(Color.accentColor).frame(height: 2).offset(y: -4)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 6))
        .onDrag { NSItemProvider(object: tab.huskDragID as NSString) }
        .onDrop(of: [UTType.text], isTargeted: Binding(
            get: { dropTarget == tab.huskID },
            set: { dropTarget = $0 ? tab.huskID : (dropTarget == tab.huskID ? nil : dropTarget) }
        )) { providers in
            drop(providers, onto: index)
        }
        .onTapGesture(count: 2) { startRename(tab) }
        .onTapGesture { select(tab) }
        .contextMenu {
            Button("Rename") { startRename(tab) }
            Button("Pop Out to Window") { model.popOut(tab) }
            Divider()
            Button("Close Session") { tab.window?.performClose(nil) }
        }
        .help(status.cwd ?? "")
    }

    /// Reorder: the dragged tab takes the drop target's position.
    private func drop(_ providers: [NSItemProvider], onto index: Int) -> Bool {
        guard let provider = providers.first else { return false }
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let id = object as? String else { return }
            DispatchQueue.main.async {
                let tabs = HuskModel.tabs(of: controller?.window)
                guard let dragged = tabs.first(where: { $0.huskDragID == id }) else { return }
                model.moveTab(dragged, to: index)
            }
        }
        return true
    }

    private func select(_ tab: TerminalController) {
        tab.window?.makeKeyAndOrderFront(nil)
        model.tabsChanged()
    }

    private func startRename(_ tab: TerminalController) {
        editText = tab.titleOverride ?? model.label(for: tab)
        editing = tab.huskID
        DispatchQueue.main.async { editFocused = true }
    }

    /// Empty name = follow the directory again (husk handleRename).
    private func commitRename(_ tab: TerminalController) {
        let name = editText.trimmingCharacters(in: .whitespaces)
        tab.titleOverride = name.isEmpty ? nil : name
        editing = nil
        model.tabsChanged()
    }
}

/// Clock at the bottom of the sidebar, as in Husk.
private struct HuskSidebarFooter: View {
    var body: some View {
        TimelineView(.everyMinute) { context in
            Text(context.date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 8)
        }
    }
}

extension TerminalController {
    var huskID: ObjectIdentifier { ObjectIdentifier(self) }
    /// Drag payload identifying a tab within this process.
    var huskDragID: String { "husktty-tab-\(UInt(bitPattern: ObjectIdentifier(self).hashValue))" }
}
