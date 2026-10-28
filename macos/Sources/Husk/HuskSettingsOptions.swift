import AppKit
import SwiftUI

/// A Settings row for one Ghostty option, with the control its type calls for. Used for the picked
/// options on the regular tabs (with a friendly label) and for every row of All Settings.
struct HuskOptionRow: View {
    let option: HuskConfigOption
    /// Shown instead of the option name (regular tabs).
    var label: String?

    init?(_ name: String, label: String? = nil) {
        guard let option = HuskConfigSchema.byName[name] else { return nil }
        self.option = option
        self.label = label
    }

    var body: some View {
        if let label {
            LabeledContent(label) { HuskOptionControl(option: option) }
                .help(option.summary)
        } else {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(option.name).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    Spacer()
                    if let tab = HuskConfigSchema.managed[option.name] {
                        Text("Set in \(tab)").foregroundStyle(.secondary)
                    } else {
                        HuskOptionControl(option: option)
                    }
                }
                Text(option.summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            .padding(.vertical, 2)
        }
    }
}

/// The control for an option, plus reset (when changed) and the full docs.
struct HuskOptionControl: View {
    let option: HuskConfigOption
    @ObservedObject private var settings = HuskSettings.shared
    @State private var showDocs = false

    private var value: String { settings.values(option).first ?? "" }
    private func set(_ value: String) { settings.set(option, [value]) }

    var body: some View {
        HStack(spacing: 6) {
            control
            Button { settings.set(option, option.kind == .list ? [] : option.effectiveDefault) } label: {
                Image(systemName: "arrow.uturn.backward")
            }
            .buttonStyle(.borderless)
            .help("Back to the default")
            .opacity(settings.overrides[option.name] == nil ? 0 : 1)
            .disabled(settings.overrides[option.name] == nil)
            Button { showDocs.toggle() } label: { Image(systemName: "info.circle") }
                .buttonStyle(.borderless)
                .help("About \(option.name)")
                .popover(isPresented: $showDocs, arrowEdge: .trailing) { docs }
        }
    }

    @ViewBuilder private var control: some View {
        switch option.kind {
        case .bool:
            Toggle("", isOn: Binding(get: { value == "true" }, set: { set($0 ? "true" : "false") }))
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)

        case .enum:
            Picker("", selection: Binding(get: { value }, set: { set($0) })) {
                if option.optional == true { Text("Default").tag("") }
                ForEach(option.values ?? [], id: \.self) { Text(title($0)).tag($0) }
            }
            .labelsHidden()
            .fixedSize()

        case .float where Self.unitRange.contains(option.name):
            HStack {
                Slider(value: Binding(get: { Double(value) ?? 1 }, set: { set(String(format: "%.2f", $0)) }), in: 0...1)
                    .frame(width: 140)
                Text(String(format: "%.2f", Double(value) ?? 1)).monospacedDigit().frame(width: 36)
            }

        case .flags:
            HuskFlagsControl(option: option)

        case .color:
            HuskColorControl(option: option)

        case .list:
            HuskListControl(option: option)

        case .int, .float, .string, .text:
            HuskCommitField(text: value, placeholder: option.effectiveDefault.first ?? "", commit: set)
                .frame(width: option.kind == .int || option.kind == .float ? 90 : 200)
        }
    }

    private var docs: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(option.name).font(.system(.headline, design: .monospaced))
                Text(option.doc.isEmpty ? "No description." : option.doc).textSelection(.enabled)
                let defaults = option.effectiveDefault.filter { !$0.isEmpty }
                if !defaults.isEmpty, option.kind != .list || defaults.count <= 20 {
                    Text("Default: \(defaults.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: 440, height: 320)
    }

    private func title(_ value: String) -> String {
        value == option.effectiveDefault.first ? "\(value) (default)" : value
    }

    /// Floats that run from 0 to 1, shown as sliders.
    static let unitRange: Set<String> = ["background-opacity", "unfocused-split-opacity", "faint-opacity",
                                         "background-image-opacity", "cursor-opacity"]
}

/// A text field that applies its value on Return or when it loses focus, so the config doesn't
/// reload on every keystroke.
struct HuskCommitField: View {
    let text: String
    let placeholder: String
    let commit: (String) -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField(placeholder, text: $draft)
            .labelsHidden()
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .onAppear { draft = text }
            .onChange(of: text) { draft = $0 }
            .onSubmit { commit(draft) }
            .onChange(of: focused) { if !$0, draft != text { commit(draft) } }
    }
}

/// Flag sets like `shell-integration-features = cursor,no-sudo,title`: one checkbox per flag.
struct HuskFlagsControl: View {
    let option: HuskConfigOption
    @ObservedObject private var settings = HuskSettings.shared

    private var enabled: Set<String> {
        let parts = (settings.values(option).first ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        return Set(parts.filter { !$0.hasPrefix("no-") })
    }

    var body: some View {
        Menu {
            ForEach(option.values ?? [], id: \.self) { flag in
                Toggle(flag, isOn: Binding(get: { enabled.contains(flag) }, set: { on in
                    var flags = enabled
                    if on { flags.insert(flag) } else { flags.remove(flag) }
                    let value = (option.values ?? []).map { flags.contains($0) ? $0 : "no-\($0)" }.joined(separator: ",")
                    settings.set(option, [value])
                }))
            }
        } label: {
            Text(enabled.isEmpty ? "None" : (option.values ?? []).filter(enabled.contains).joined(separator: ", "))
                .lineLimit(1)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }
}

/// A color well plus the value as text (hex, an X11 name, or a special value like cell-foreground).
struct HuskColorControl: View {
    let option: HuskConfigOption
    @ObservedObject private var settings = HuskSettings.shared

    private var value: String { settings.values(option).first ?? "" }

    var body: some View {
        HStack(spacing: 6) {
            ColorPicker("", selection: Binding(get: { Self.color(value) ?? .clear }, set: { settings.set(option, [Self.hex($0)]) }),
                        supportsOpacity: false)
                .labelsHidden()
            HuskCommitField(text: value, placeholder: "default", commit: { settings.set(option, [$0]) })
                .frame(width: 110)
        }
    }

    static func color(_ value: String) -> Color? {
        var hex = value.trimmingCharacters(in: .whitespaces)
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return nil }
        return Color(red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
    }

    static func hex(_ color: Color) -> String {
        guard let c = NSColor(color).usingColorSpace(.sRGB) else { return "" }
        return String(format: "#%02x%02x%02x", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)),
                      Int(round(c.blueComponent * 255)))
    }
}

/// Options that take one entry per line (keybind, font-family, palette, …). The lines here are
/// added after Ghostty's and husk's defaults.
struct HuskListControl: View {
    let option: HuskConfigOption
    @ObservedObject private var settings = HuskSettings.shared
    @State private var editing = false
    @State private var draft = ""

    private var added: [String] { settings.overrides[option.name] ?? [] }

    var body: some View {
        Button(added.isEmpty ? "Add…" : "\(added.count) added…") {
            draft = added.joined(separator: "\n")
            editing = true
        }
        .popover(isPresented: $editing, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 8) {
                Text(option.name).font(.system(.headline, design: .monospaced))
                Text("One per line. These are added to the defaults.").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $draft)
                    .font(.system(.body, design: .monospaced))
                    .frame(width: 420, height: 160)
                    .border(Color.secondary.opacity(0.3))
                HStack {
                    Spacer()
                    Button("Cancel") { editing = false }
                    Button("Apply") {
                        let lines = draft.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        settings.set(option, lines)
                        editing = false
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(14)
        }
    }
}

/// Every Ghostty option husk runs with on macOS, searchable, grouped like Ghostty's docs.
struct HuskAllSettingsView: View {
    @State private var query = ""

    private func matches(_ option: HuskConfigOption) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || option.name.contains(q) || option.doc.lowercased().contains(q)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Search \(HuskConfigSchema.options.count) settings", text: $query)
                .textFieldStyle(.roundedBorder)
            List {
                ForEach(HuskConfigSchema.categories, id: \.self) { category in
                    let options = HuskConfigSchema.options.filter { $0.category == category && matches($0) }
                    if !options.isEmpty {
                        Section(category) {
                            ForEach(options) { HuskOptionRow($0.name) }
                        }
                    }
                }
            }
            Text("Changes apply right away. Anything in ~/.config/husktty/config still overrides these.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// The terminal font: Ghostty's built-in default, or any installed monospaced family. Sets the first
/// `font-family` line; others added in All Settings stay as fallbacks.
struct HuskFontFamilyPicker: View {
    @ObservedObject private var settings = HuskSettings.shared

    var body: some View {
        let current = settings.overrides["font-family"] ?? []
        Picker("", selection: Binding(get: { current.first ?? "" }, set: { family in
            guard let option = HuskConfigSchema.byName["font-family"] else { return }
            let rest = Array(current.dropFirst())
            settings.set(option, family.isEmpty ? rest : [family] + rest)
        })) {
            Text("Default (JetBrains Mono)").tag("")
            ForEach(Self.families, id: \.self) { Text($0).tag($0) }
        }
        .labelsHidden()
        .fixedSize()
    }

    /// Installed families whose regular face is fixed-pitch.
    static let families: [String] = NSFontManager.shared.availableFontFamilies.filter { family in
        guard let face = NSFontManager.shared.availableMembers(ofFontFamily: family)?.first,
              let name = face.first as? String else { return false }
        return NSFont(name: name, size: 12)?.isFixedPitch == true
    }
}
