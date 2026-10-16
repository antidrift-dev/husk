import Foundation

/// Claude Code context-window usage for one session: the last assistant `message.usage` in its
/// transcript. Parsing is ported from husk/src/main/claude-context.ts; the session is found from
/// the tab's `claude` process rather than guessed from the directory.
struct HuskClaudeContext: Equatable {
    let tokens: Int
    let inputTokens: Int
    let cacheReadTokens: Int
    let cacheCreationTokens: Int
    let outputTokens: Int
    let model: String?
    let contextWindow: Int
}

/// A running Claude Code session, from ~/.claude/sessions/<pid>.json.
struct HuskClaudeSession: Equatable {
    let pid: pid_t
    let sessionId: String
    let cwd: String
}

/// Another session running in the same folder as a tab's own, with its context if known.
struct HuskOtherSession: Equatable {
    let pid: pid_t
    let context: HuskClaudeContext?
}

enum HuskClaude {
    static var projectsRoot = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude/projects")
    static var sessionsRoot = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude/sessions")
    static var configPath = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude.json")

    private struct CacheKey: Hashable { let path: String; let mtime: Date; let size: Int }
    private static var cache: [CacheKey: HuskClaudeContext] = [:]
    private static var sessionFiles: [String: URL] = [:]
    private static let lock = NSLock()

    /// Claude Code writes ~/.claude/sessions/<pid>.json for each running session (undocumented;
    /// seen in v2.1.302). Only sessions whose process is still a live `claude` count, so files
    /// left behind by a crash, or a pid reused by something else, are skipped.
    static func liveSessions() -> [HuskClaudeSession] {
        guard let files = try? FileManager.default.contentsOfDirectory(at: sessionsRoot, includingPropertiesForKeys: nil)
        else { return [] }
        return files.compactMap { file in
            guard file.pathExtension == "json",
                  let data = try? Data(contentsOf: file),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = (obj["pid"] as? NSNumber).map({ pid_t(truncating: $0) }),
                  let sessionId = obj["sessionId"] as? String,
                  let cwd = obj["cwd"] as? String,
                  HuskProcess.displayName(pid: pid) == "claude" else { return nil }
            return HuskClaudeSession(pid: pid, sessionId: sessionId, cwd: cwd)
        }
    }

    /// The session running in a tab: the tab's foreground process, or a `claude` started under it
    /// (e.g. through a wrapper script).
    static func session(foregroundPid: pid_t, among sessions: [HuskClaudeSession]) -> HuskClaudeSession? {
        guard foregroundPid > 0 else { return nil }
        if let own = sessions.first(where: { $0.pid == foregroundPid }) { return own }
        let below = Set(HuskProcess.descendants(of: foregroundPid))
        return sessions.first { below.contains($0.pid) }
    }

    /// Other live sessions in the same folder as `session`, in any terminal.
    static func others(of session: HuskClaudeSession, among sessions: [HuskClaudeSession]) -> [HuskOtherSession] {
        sessions
            .filter { $0.cwd == session.cwd && $0.pid != session.pid }
            .sorted { $0.pid < $1.pid }
            .map { HuskOtherSession(pid: $0.pid, context: context(for: $0)) }
    }

    /// Context usage of one session, from its own transcript: ~/.claude/projects/*/<sessionId>.jsonl.
    static func context(for session: HuskClaudeSession) -> HuskClaudeContext? {
        guard let file = transcript(sessionId: session.sessionId) else { return nil }
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
        if let tier = contextWindowFromConfig(projectCwd: session.cwd, model: info.model), tier != info.contextWindow {
            return HuskClaudeContext(tokens: info.tokens, inputTokens: info.inputTokens,
                                     cacheReadTokens: info.cacheReadTokens, cacheCreationTokens: info.cacheCreationTokens,
                                     outputTokens: info.outputTokens, model: info.model, contextWindow: tier)
        }
        return info
    }

    /// Finds the transcript by name across all project folders, so the folder's name (Claude's
    /// encoding of the path) never has to be worked out.
    private static func transcript(sessionId: String) -> URL? {
        lock.lock()
        let known = sessionFiles[sessionId]
        lock.unlock()
        if let known, FileManager.default.fileExists(atPath: known.path) { return known }

        let name = "\(sessionId).jsonl"
        let folders = (try? FileManager.default.contentsOfDirectory(at: projectsRoot, includingPropertiesForKeys: nil)) ?? []
        guard let found = folders.lazy.map({ $0.appendingPathComponent(name) })
            .first(where: { FileManager.default.fileExists(atPath: $0.path) }) else { return nil }
        lock.lock()
        sessionFiles[sessionId] = found
        lock.unlock()
        return found
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
