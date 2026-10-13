import Foundation
import SQLite3

/// Codex CLI context-window usage for a directory. Port of husk/src/main/codex-context.ts:
/// the newest unarchived thread for the cwd in ~/.codex/state_5.sqlite, then the last
/// `token_count` event in its rollout jsonl.
enum HuskCodex {
    static var databasePath = NSHomeDirectory() + "/.codex/state_5.sqlite"

    private struct CacheKey: Hashable { let path: String; let mtime: Date; let size: Int }
    private static var cache: [CacheKey: HuskClaudeContext] = [:]
    private static let lock = NSLock()

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
        let sql = "SELECT rollout_path, model FROM threads WHERE cwd = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1"
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
