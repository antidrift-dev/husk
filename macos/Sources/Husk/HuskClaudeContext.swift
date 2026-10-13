import Foundation

/// Claude Code context-window usage for a directory.
/// Port of husk/src/main/claude-context.ts: the newest top-level
/// ~/.claude/projects/<cwd with / → ->/*.jsonl, last assistant `message.usage`.
struct HuskClaudeContext: Equatable {
    let tokens: Int
    let inputTokens: Int
    let cacheReadTokens: Int
    let cacheCreationTokens: Int
    let outputTokens: Int
    let model: String?
    let contextWindow: Int
}

enum HuskClaude {
    static var projectsRoot = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude/projects")
    static var configPath = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude.json")

    private struct CacheKey: Hashable { let path: String; let mtime: Date; let size: Int }
    private static var cache: [CacheKey: HuskClaudeContext] = [:]
    private static let lock = NSLock()

    static func encode(_ cwd: String) -> String { cwd.replacingOccurrences(of: "/", with: "-") }

    static func context(for cwd: String) -> HuskClaudeContext? {
        guard !cwd.isEmpty, let (projectCwd, file) = resolve(cwd) else { return nil }
        let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
        let key = CacheKey(path: file.path,
                           mtime: attrs?[.modificationDate] as? Date ?? .distantPast,
                           size: (attrs?[.size] as? NSNumber)?.intValue ?? 0)

        lock.lock()
        var info = cache[key]
        lock.unlock()
        if info == nil {
            guard let parsed = parse(file) else { return nil }
            lock.lock()
            if cache.count > 200 { cache.removeAll() }
            cache[key] = parsed
            lock.unlock()
            info = parsed
        }
        guard let info else { return nil }
        if let tier = contextWindowFromConfig(projectCwd: projectCwd, model: info.model), tier != info.contextWindow {
            return HuskClaudeContext(tokens: info.tokens, inputTokens: info.inputTokens,
                                     cacheReadTokens: info.cacheReadTokens, cacheCreationTokens: info.cacheCreationTokens,
                                     outputTokens: info.outputTokens, model: info.model, contextWindow: tier)
        }
        return info
    }

    /// Claude roots a project at the repo root, which may be above the shell's cwd: walk up.
    private static func resolve(_ cwd: String) -> (String, URL)? {
        var dir = cwd
        while true {
            if let latest = latestSession(in: projectsRoot.appendingPathComponent(encode(dir))) {
                return (dir, latest)
            }
            let parent = (dir as NSString).deletingLastPathComponent
            if parent == dir || parent.isEmpty { return nil }
            dir = parent
        }
    }

    private static func latestSession(in dir: URL) -> URL? {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]) else { return nil }
        return entries
            .filter { $0.pathExtension == "jsonl" && ((try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false) }
            .max { a, b in
                let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return da < db
            }
    }

    static func parse(_ file: URL) -> HuskClaudeContext? {
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }
        var last: HuskClaudeContext?
        var maxObserved = 0
        let usageMarker = Data("\"usage\"".utf8)
        for line in data.split(separator: UInt8(ascii: "\n")) where line.range(of: usageMarker) != nil {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let message = obj["message"] as? [String: Any],
                  let usage = message["usage"] as? [String: Any] else { continue }
            let input = usage["input_tokens"] as? Int ?? 0
            let cacheRead = usage["cache_read_input_tokens"] as? Int ?? 0
            let cacheCreation = usage["cache_creation_input_tokens"] as? Int ?? 0
            let tokens = input + cacheRead + cacheCreation
            guard tokens > 0 else { continue }
            maxObserved = max(maxObserved, tokens)
            last = HuskClaudeContext(tokens: tokens, inputTokens: input, cacheReadTokens: cacheRead,
                                     cacheCreationTokens: cacheCreation, outputTokens: usage["output_tokens"] as? Int ?? 0,
                                     model: message["model"] as? String, contextWindow: 200_000)
        }
        guard let last else { return nil }
        return HuskClaudeContext(tokens: last.tokens, inputTokens: last.inputTokens, cacheReadTokens: last.cacheReadTokens,
                                 cacheCreationTokens: last.cacheCreationTokens, outputTokens: last.outputTokens,
                                 model: last.model, contextWindow: maxObserved > 200_000 ? 1_000_000 : 200_000)
    }

    /// Opus has a 1M tier that the jsonl doesn't record; ~/.claude.json's lastModelUsage keeps the `[1m]` suffix.
    private static func contextWindowFromConfig(projectCwd: String, model: String?) -> Int? {
        guard let model else { return nil }
        let base = model.hasSuffix("[1m]") ? String(model.dropLast(4)) : model
        if base.range(of: "claude-(haiku|sonnet)", options: [.regularExpression, .caseInsensitive]) != nil { return 200_000 }
        guard base.range(of: "claude-opus", options: [.caseInsensitive]) != nil,
              let data = try? Data(contentsOf: configPath),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let projects = config["projects"] as? [String: Any],
              let project = projects[projectCwd] as? [String: Any],
              let usage = project["lastModelUsage"] as? [String: Any] else { return nil }
        let has1m = usage["\(base)[1m]"] != nil
        let hasStd = usage[base] != nil
        if has1m && !hasStd { return 1_000_000 }
        if hasStd && !has1m { return 200_000 }
        return nil
    }

    static func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return "\(n / 1_000)k" }
        return "\(n)"
    }
}
