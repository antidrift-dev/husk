// Reads Codex CLI session data to report current context-window token usage.
//
// Codex stores sessions in ~/.codex/state_5.sqlite (threads table) and writes
// rollout JSONL files to ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl.
//
// The threads table gives us: cwd, model, and rollout_path.
// The rollout JSONL gives us:
//   - task_started.model_context_window  → denominator (e.g. 258400)
//   - token_count.last_token_usage       → per-turn input tokens (current context size)
//
// The returned shape is intentionally compatible with ClaudeContextInfo so the
// same status-bar display component works for both agents.

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";

const CODEX_DB = path.join(os.homedir(), ".codex", "state_5.sqlite");

export interface CodexContextInfo {
  tokens: number;          // last_token_usage.input_tokens (current context load)
  inputTokens: number;     // uncached input = input - cached
  cacheReadTokens: number; // last_token_usage.cached_input_tokens
  cacheCreationTokens: number; // always 0 for OpenAI (no creation distinction)
  outputTokens: number;    // last_token_usage.output_tokens
  model: string;
  contextWindow: number;   // from task_started.model_context_window
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  info: Omit<CodexContextInfo, "model" | "contextWindow">;
  contextWindow: number;
}

const cache = new Map<string, CacheEntry>();

function queryThread(cwd: string): { rolloutPath: string; model: string } | null {
  try {
    const db = new Database(CODEX_DB, { readonly: true, fileMustExist: true });
    const row = db.prepare(
      "SELECT rollout_path, model FROM threads WHERE cwd = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1"
    ).get(cwd) as { rollout_path: string; model: string } | undefined;
    db.close();
    if (!row?.rollout_path) return null;
    return { rolloutPath: row.rollout_path, model: row.model ?? "" };
  } catch {
    return null;
  }
}

// Walk the rollout JSONL once for both context-window size and the last
// token_count event. Returns partial info (no model / contextWindow).
function parseRollout(filePath: string): {
  info: Omit<CodexContextInfo, "model" | "contextWindow">;
  contextWindow: number;
} | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  let contextWindow = 200_000;
  let lastInfo: Omit<CodexContextInfo, "model" | "contextWindow"> | null = null;

  for (const line of lines) {
    if (!line || !line.includes('"type"')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.type !== "event_msg") continue;
      const payload = obj.payload;
      if (!payload?.type) continue;

      if (payload.type === "task_started" && typeof payload.model_context_window === "number") {
        contextWindow = payload.model_context_window;
      }

      if (payload.type === "token_count" && payload.info?.last_token_usage) {
        const last = payload.info.last_token_usage;
        const inputTokens: number = last.input_tokens ?? 0;
        if (inputTokens === 0) continue;
        const cachedTokens: number = last.cached_input_tokens ?? 0;
        lastInfo = {
          tokens: inputTokens,
          inputTokens: inputTokens - cachedTokens,
          cacheReadTokens: cachedTokens,
          cacheCreationTokens: 0,
          outputTokens: last.output_tokens ?? 0,
        };
      }
    } catch {}
  }

  if (!lastInfo) return null;
  return { info: lastInfo, contextWindow };
}

export function getCodexContextForCwd(cwd: string): CodexContextInfo | null {
  if (!cwd) return null;
  if (!fs.existsSync(CODEX_DB)) return null;

  const thread = queryThread(cwd);
  if (!thread) return null;

  const { rolloutPath, model } = thread;
  if (!rolloutPath || !fs.existsSync(rolloutPath)) return null;

  let stat: fs.Stats;
  try { stat = fs.statSync(rolloutPath); } catch { return null; }

  const cached = cache.get(rolloutPath);
  let info: Omit<CodexContextInfo, "model" | "contextWindow">;
  let contextWindow: number;

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    info = cached.info;
    contextWindow = cached.contextWindow;
  } else {
    const parsed = parseRollout(rolloutPath);
    if (!parsed) return null;
    info = parsed.info;
    contextWindow = parsed.contextWindow;
    cache.set(rolloutPath, { mtimeMs: stat.mtimeMs, size: stat.size, info, contextWindow });
  }

  return { ...info, model, contextWindow };
}
