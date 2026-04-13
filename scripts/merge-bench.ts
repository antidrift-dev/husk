#!/usr/bin/env tsx
/**
 * Merges per-platform bench-history.json files downloaded from CI artifacts
 * into the single bench-history.json at the repo root.
 *
 * Expected layout after actions/download-artifact:
 *   bench-artifacts/
 *     bench-ubuntu-latest/bench-history.json
 *     bench-macos-latest/bench-history.json
 *     bench-windows-latest/bench-history.json
 */
import fs from "fs";
import path from "path";

interface BenchRun {
  timestamp: string;
  build: number;
  platform: string;
  arch: string;
  latency: Record<string, unknown>;
  memory: Record<string, number>;
  cpu: Record<string, number>;
}

const ROOT = path.join(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT, "bench-artifacts");
const OUTPUT = path.join(ROOT, "bench-history.json");

// Load existing history from the repo
let history: BenchRun[] = [];
try { history = JSON.parse(fs.readFileSync(OUTPUT, "utf-8")); } catch {}

// Pull in every artifact
for (const dir of fs.readdirSync(ARTIFACTS_DIR)) {
  const file = path.join(ARTIFACTS_DIR, dir, "bench-history.json");
  if (!fs.existsSync(file)) continue;
  try {
    const runs: BenchRun[] = JSON.parse(fs.readFileSync(file, "utf-8"));
    history.push(...runs);
  } catch (e) {
    console.warn(`Skipping ${file}: ${e}`);
  }
}

// Dedupe by timestamp + platform + build
const seen = new Set<string>();
const merged = history
  .filter((r) => {
    const key = `${r.timestamp}|${r.platform}|${r.build}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2));

const byPlatform: Record<string, number> = {};
for (const r of merged) byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1;
const summary = Object.entries(byPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");
console.log(`Merged ${merged.length} runs (${summary}) → bench-history.json`);
