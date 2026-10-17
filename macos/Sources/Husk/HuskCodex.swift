import Foundation
import SQLite3

/// Codex CLI context-window usage for a directory. Port of husk/src/main/codex-context.ts:
/// the newest unarchived thread for the cwd (other than reviewer runs) in ~/.codex/state_5.sqlite, then the last
/// `token_count` event in its rollout jsonl.
/// A running Codex CLI session: its process and the folder it's in.
struct HuskCodexSession: Equatable {
    let pid: pid_t
    let cwd: String
}

enum HuskCodex {
    static var databasePath = NSHomeDirectory() + "/.codex/state_5.sqlite"

    private struct CacheKey: Hashable { let path: String; let mtime: Date; let size: Int }
    private static var cache: [CacheKey: HuskClaudeContext] = [:]
    private static let lock = NSLock()

    /// Codex sessions running in a terminal, found by process: Codex keeps no per-process
    /// session file the way Claude Code does. The native binary is named `codex` (the npm
    /// install runs it under a `node` wrapper); the desktop app's `codex` processes have no
    /// terminal, and the ones under a session are its own helpers, so both are skipped.
    static func liveSessions() -> [HuskCodexSession] {
        let pids = HuskProcess.allPids()
        let codex = Set(pids.filter { HuskProcess.name(pid: $0) == "codex" })
        return codex.compactMap { pid in
            guard HuskProcess.hasTerminal(pid: pid),
                  !codex.contains(HuskProcess.parent(of: pid)),
                  let cwd = HuskProcess.cwd(pid: pid) else { return nil }
            return HuskCodexSession(pid: pid, cwd: cwd)
        }
    }

    /// The session running in a tab: the tab's foreground process (often the `node` wrapper),
    /// or a `codex` under it.
    static func session(foregroundPid: pid_t, among sessions: [HuskCodexSession]) -> HuskCodexSession? {
        guard foregroundPid > 0 else { return nil }
        if let own = sessions.first(where: { $0.pid == foregroundPid }) { return own }
        let below = Set(HuskProcess.descendants(of: foregroundPid))
        return sessions.first { below.contains($0.pid) }
    }

    /// Codex sessions in `cwd` other than `pid`. Codex doesn't say which conversation a process
    /// is on, so each gets the folder's newest one, the same lookup as the status bar.
    static func others(in cwd: String, excluding pid: pid_t, among sessions: [HuskCodexSession]) -> [HuskOtherSession] {
        let matching = sessions.filter { $0.cwd == cwd && $0.pid != pid }.sorted { $0.pid < $1.pid }
        guard !matching.isEmpty else { return [] }
        let ctx = context(for: cwd)
        return matching.map { HuskOtherSession(pid: $0.pid, agent: "codex", context: ctx) }
    }

    static func context(for cwd: String) -> HuskClaudeContext? {
        guard let (rollout, model) = latestThread(cwd: cwd) else { return nil }
        let attrs = try? FileManager.default.attributesOfItem(atPath: rollout)
        let key = CacheKey(path: rollout,
                           mtime: attrs?[.modificationDate] as? Date ?? .distantPast,
                           size: (attrs?[.size] as? NSNumber)?.intValue ?? 0)
        lock.lock()
        let cached = cache[key]
        lock.unlock()
        let parsed = cached ?? parse(URL(fileURLWithPath: rollout), model: model)
        if cached == nil, let parsed {
            lock.lock()
            if cache.count > 200 { cache.removeAll() }
            cache[key] = parsed
            lock.unlock()
        }
        return parsed
    }

    private static func latestThread(cwd: String) -> (String, String)? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(databasePath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            sqlite3_close(db)
            return nil
        }
        defer { sqlite3_close(db) }
        // Codex's reviewer runs are threads in the same folder with no token counts; skip them.
        let sql = """
            SELECT rollout_path, model FROM threads
            WHERE cwd = ? AND archived = 0 AND source NOT LIKE '%"guardian"%'
            ORDER BY updated_at DESC LIMIT 1
            """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt, 1, cwd, -1, transient)
        guard sqlite3_step(stmt) == SQLITE_ROW, let path = sqlite3_column_text(stmt, 0) else { return nil }
        let model = sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? ""
        return (String(cString: path), model)
    }

    static func parse(_ file: URL, model: String) -> HuskClaudeContext? {
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }
        var contextWindow = 200_000
        var last: HuskClaudeContext?
        let marker = Data("\"type\"".utf8)
        for line in data.split(separator: UInt8(ascii: "\n")) where line.range(of: marker) != nil {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  obj["type"] as? String == "event_msg",
                  let payload = obj["payload"] as? [String: Any] else { continue }
            switch payload["type"] as? String {
            case "task_started":
                if let window = payload["model_context_window"] as? Int { contextWindow = window }
            case "token_count":
                guard let info = payload["info"] as? [String: Any],
                      let usage = info["last_token_usage"] as? [String: Any] else { continue }
                let input = usage["input_tokens"] as? Int ?? 0
                guard input > 0 else { continue }
                let cached = usage["cached_input_tokens"] as? Int ?? 0
                last = HuskClaudeContext(tokens: input, inputTokens: input - cached, cacheReadTokens: cached,
                                         cacheCreationTokens: 0, outputTokens: usage["output_tokens"] as? Int ?? 0,
                                         model: model.isEmpty ? nil : model, contextWindow: contextWindow)
            default:
                continue
            }
        }
        guard let last else { return nil }
        return HuskClaudeContext(tokens: last.tokens, inputTokens: last.inputTokens, cacheReadTokens: last.cacheReadTokens,
                                 cacheCreationTokens: 0, outputTokens: last.outputTokens,
                                 model: last.model, contextWindow: contextWindow)
    }
}
