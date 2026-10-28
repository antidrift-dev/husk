import Foundation

/// One Ghostty config option, as the Settings window edits it. The list is generated from
/// Ghostty's Config.zig (husk/gen-settings-schema.sh → HuskConfigSchema+Data.swift).
struct HuskConfigOption: Decodable, Identifiable {
    enum Kind: String, Decodable { case bool, int, float, `enum`, flags, string, text, color, list }

    let name: String
    let kind: Kind
    let category: String
    let doc: String
    /// Ghostty's default, one value per config line.
    let `default`: [String]
    /// Allowed values (enum) or flag names (flags).
    let values: [String]?
    /// An enum that can also be left unset.
    let optional: Bool?

    var id: String { name }

    /// The first paragraph of the docs, for a one-line hint.
    var summary: String {
        let first = doc.components(separatedBy: "\n\n").first ?? doc
        return first.replacingOccurrences(of: "\n", with: " ")
    }

    /// The default husk runs with: husk's own (HuskConfig.defaults) where it sets one, else Ghostty's.
    var effectiveDefault: [String] {
        guard let husk = HuskConfigSchema.huskDefaults[name] else { return self.default }
        return kind == .list ? self.default + husk : husk
    }
}

enum HuskConfigSchema {
    static let options: [HuskConfigOption] = {
        guard let data = json.data(using: .utf8),
              let options = try? JSONDecoder().decode([HuskConfigOption].self, from: data) else { return [] }
        return options
    }()

    static let byName: [String: HuskConfigOption] = Dictionary(uniqueKeysWithValues: options.map { ($0.name, $0) })

    /// Groups for the All Settings tab, in display order.
    static let categories = ["Font", "Colors", "Cursor", "Mouse", "Keyboard", "Clipboard & Selection",
                             "Windows & Tabs", "Quick Terminal", "Shell & Commands", "Notifications", "macOS", "Other"]

    /// Options the Settings window sets with its own controls, so All Settings points there instead.
    static let managed: [String: String] = [
        "theme": "the Theme menu",
        "font-size": "Appearance",
        "cursor-style": "Terminal",
        "cursor-style-blink": "Terminal",
        "scrollback-limit-bytes": "Terminal",
        "copy-on-select": "Terminal",
        "notify-on-command-finish": "Features",
    ]

    /// `name = value` lines in HuskConfig.defaults, grouped by name.
    static let huskDefaults: [String: [String]] = {
        var result: [String: [String]] = [:]
        for line in HuskConfig.defaults.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.hasPrefix("#"), let eq = trimmed.range(of: "=") else { continue }
            let name = trimmed[..<eq.lowerBound].trimmingCharacters(in: .whitespaces)
            let value = trimmed[eq.upperBound...].trimmingCharacters(in: .whitespaces)
            result[name, default: []].append(value)
        }
        return result
    }()
}
