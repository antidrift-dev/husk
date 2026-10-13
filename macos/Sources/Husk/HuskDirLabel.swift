import Foundation

/// Tab name for a directory: last path segment, "~" for home, "/" for root.
/// Port of husk/src/renderer/dir-label.ts.
enum HuskDirLabel {
    static func label(for cwd: String, home: String = NSHomeDirectory()) -> String {
        let trimmed = cwd.count > 1 ? stripTrailingSlashes(cwd) : cwd
        if !home.isEmpty && trimmed == stripTrailingSlashes(home) { return "~" }
        let parts = trimmed.split(whereSeparator: { $0 == "/" || $0 == "\\" })
        return parts.last.map(String.init) ?? "/"
    }

    private static func stripTrailingSlashes(_ s: String) -> String {
        var s = s
        while s.count > 1, let last = s.last, last == "/" || last == "\\" { s.removeLast() }
        return s
    }
}
