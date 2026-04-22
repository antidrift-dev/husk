// Reads Claude Code session JSONL files to report current context-window token usage.
//
// Claude Code stores each conversation as ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// where encoded-cwd is the absolute path with `/` replaced by `-`. Each assistant entry
// includes a `message.usage` block; the *last* assistant entry's
// input_tokens + cache_creation_input_tokens + cache_read_input_tokens is the full
// context the model saw on its last turn — same number `/context` reports inside Claude.
//
// The session jsonl stores `message.model` as the *base* model name (e.g.
// "claude-opus-4-6"), with no marker for the 1M context tier. To detect the tier
// for a brand-new session that hasn't yet crossed 200k tokens, we read
// ~/.claude.json — its `projects[<cwd>].lastModelUsage` map is keyed by the
// *runtime* model ID, which preserves the `[1m]` suffix.

import fs from "fs";
import readline from "readline";
import path from "path";
import os from "os";

export interface ClaudeContextInfo {
  tokens: number;          // total input context: input + cache_read + cache_creation
  inputTokens: number;     // new (uncached) input this turn
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  model: string | null;
  contextWindow: number;   // auto-detected: 200k or 1M
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  info: ClaudeContextInfo;
}

// Cache by file path; invalidate when mtime or size changes. FIFO eviction at 200 entries.
const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 200;

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const CLAUDE_CONFIG_PATH = path.join(os.homedir(), ".claude.json");

function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

// Resolves the context-window size for the given model string.
//
// Sonnet and Haiku are always 200k. Opus is the only family with a 1M tier;
// for that case we consult ~/.claude.json since the session jsonl strips the
// [1m] suffix. Returns null when the answer is indeterminate.
function resolveContextWindow(
  cwd: string,
  baseModel: string | null,
): 1_000_000 | 200_000 | null {
  if (!baseModel) return null;
  const base = baseModel.replace(/\[1m\]$/, "");
  // Non-opus families are always 200k — no config lookup needed.
  if (/claude-(haiku|sonnet)/i.test(base)) return 200_000;
  if (!/claude-opus/i.test(base)) return null; // unknown family
  // Opus: check ~/.claude.json → projects[cwd].lastModelUsage for [1m] key.
  let raw: string;
  try {
    raw = fs.readFileSync(CLAUDE_CONFIG_PATH, "utf8");
  } catch {
    return null;
  }
  let config: any;
  try {
    config = JSON.parse(raw);
  } catch {
    return null;
  }
  const usage = config?.projects?.[cwd]?.lastModelUsage;
  if (!usage || typeof usage !== "object") return null;
  const has1m = Object.prototype.hasOwnProperty.call(usage, `${base}[1m]`);
  const hasStd = Object.prototype.hasOwnProperty.call(usage, base);
  if (has1m && !hasStd) return 1_000_000;
  if (hasStd && !has1m) return 200_000;
  // Both or neither — let the in-session heuristic decide.
  return null;
}

// Find the most recently modified top-level .jsonl file in the project dir
// (skip the subagents/ subdirectory — those are spawned subagent transcripts).
function findLatestSessionFile(projectDir: string): { path: string; mtimeMs: number; size: number } | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }

  let best: { path: string; mtimeMs: number; size: number } | null = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const full = path.join(projectDir, entry.name);
    try {
      const stat = fs.statSync(full);
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { path: full, mtimeMs: stat.mtimeMs, size: stat.size };
      }
    } catch {}
  }
  return best;
}

// Stream the JSONL file line-by-line, tracking the last usage entry and the
// max tokens seen (used to detect the 1M-context tier). Single forward pass —
// no need to buffer the whole file in memory.
function parseLatestUsage(filePath: string): Promise<ClaudeContextInfo | null> {
  return new Promise((resolve) => {
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(filePath, { encoding: "utf8" });
    } catch {
      resolve(null);
      return;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let maxObserved = 0;
    let last: ClaudeContextInfo | null = null;
    rl.on("line", (line) => {
      if (!line || !line.includes('"usage"')) return;
      try {
        const obj = JSON.parse(line);
        const usage = obj?.message?.usage;
        if (!usage) return;
        const inputTokens = usage.input_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
        const tokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        if (tokens === 0) return;
        if (tokens > maxObserved) maxObserved = tokens;
        last = {
          tokens,
          inputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          outputTokens: usage.output_tokens || 0,
          model: obj?.message?.model || null,
          contextWindow: 200_000,
        };
      } catch {}
    });
    rl.on("close", () => {
      if (!last) { resolve(null); return; }
      resolve({ ...last, contextWindow: maxObserved > 200_000 ? 1_000_000 : 200_000 });
    });
    rl.on("error", () => resolve(null));
  });
}

// Resolve the Claude project root for a given shell CWD.
//
// Claude Code roots its project at the git/project root, which may be a parent
// of the directory the shell is actually sitting in. Walk up the tree from `cwd`
// until we find a matching entry under PROJECTS_ROOT, stopping at the fs root.
function resolveProjectDir(cwd: string): { projectDir: string; projectCwd: string } | null {
  let dir = cwd;
  while (true) {
    const projectDir = path.join(PROJECTS_ROOT, encodeCwd(dir));
    const latest = findLatestSessionFile(projectDir);
    if (latest) return { projectDir, projectCwd: dir };
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached fs root
    dir = parent;
  }
}

export async function getClaudeContextForCwd(cwd: string): Promise<ClaudeContextInfo | null> {
  if (!cwd) return null;
  const resolved = resolveProjectDir(cwd);
  if (!resolved) return null;
  const { projectDir, projectCwd } = resolved;

  const latest = findLatestSessionFile(projectDir);
  if (!latest) return null;

  let info: ClaudeContextInfo | null;
  const cached = cache.get(latest.path);
  if (cached && cached.mtimeMs === latest.mtimeMs && cached.size === latest.size) {
    info = cached.info;
  } else {
    info = await parseLatestUsage(latest.path);
    if (!info) return null;
    cache.set(latest.path, { mtimeMs: latest.mtimeMs, size: latest.size, info });
    if (cache.size > MAX_CACHE) cache.clear();
  }

  // Resolve the context window every call: ~/.claude.json can change
  // independently of the session jsonl (e.g. user flips to the 1M tier on
  // turn 1), so we don't bake it into the cached entry. The in-session
  // maxObserved heuristic stays as a fallback when the config is silent.
  const tierFromConfig = resolveContextWindow(projectCwd, info.model);
  if (tierFromConfig !== null && tierFromConfig !== info.contextWindow) {
    return { ...info, contextWindow: tierFromConfig };
  }
  return info;
}
