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

// Cache by file path; invalidate when mtime or size changes.
const cache = new Map<string, CacheEntry>();

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

// Scan the file for the latest assistant usage entry, plus track the max input
// context ever observed in this session (used to pick the denominator: a session
// that ever crossed 200k must be on the 1M-context tier).
//
// We read the whole file (typical sessions are a few MB at most) and split
// rather than doing true reverse streaming — negligible benefit at this size.
function parseLatestUsage(filePath: string): ClaudeContextInfo | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const lines = content.split("\n");

  // First pass: scan all lines to find the max input-side token count.
  let maxObserved = 0;
  for (const line of lines) {
    if (!line || !line.includes('"usage"')) continue;
    try {
      const obj = JSON.parse(line);
      const usage = obj?.message?.usage;
      if (!usage) continue;
      const total =
        (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      if (total > maxObserved) maxObserved = total;
    } catch {}
  }

  // Second pass: find the most recent assistant entry with usage.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    try {
      const obj = JSON.parse(line);
      const usage = obj?.message?.usage;
      if (!usage) continue;
      const inputTokens = usage.input_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const tokens = inputTokens + cacheReadTokens + cacheCreationTokens;
      if (tokens === 0) continue;
      const contextWindow = maxObserved > 200_000 ? 1_000_000 : 200_000;
      return {
        tokens,
        inputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        outputTokens,
        model: obj?.message?.model || null,
        contextWindow,
      };
    } catch {}
  }
  return null;
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

export function getClaudeContextForCwd(cwd: string): ClaudeContextInfo | null {
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
    info = parseLatestUsage(latest.path);
    if (!info) return null;
    cache.set(latest.path, { mtimeMs: latest.mtimeMs, size: latest.size, info });
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
