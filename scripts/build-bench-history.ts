#!/usr/bin/env tsx
/**
 * Reads all bench-runs/*.json.gz archives and builds bench-history.json.
 * Run after a batch of benchmark runs completes.
 *
 * Usage: npx tsx scripts/build-bench-history.ts
 */
import { gunzipSync } from "zlib";
import fs from "fs";
import path from "path";

const ROOT         = path.join(__dirname, "..");
const RUNS_DIR     = path.join(ROOT, "bench-runs");
const HISTORY_FILE = path.join(ROOT, "bench-history.json");

interface BenchSummary {
  p50: number; p95: number; p99: number;
  min: number; max: number; stddev: number;
  hz: number; iterations: number;
}

interface BenchRun {
  timestamp: string;
  build: number;
  platform: string;
  arch: string;
  latency: Record<string, BenchSummary>;
  memory: Record<string, number>;
  cpu: Record<string, number>;
}

const files = fs.readdirSync(RUNS_DIR)
  .filter((f) => f.endsWith(".json.gz"))
  .sort();

console.log(`Reading ${files.length} archives from bench-runs/...`);

const runs: BenchRun[] = [];

for (const file of files) {
  try {
    const raw = gunzipSync(fs.readFileSync(path.join(RUNS_DIR, file)));
    const full = JSON.parse(raw.toString());

    // Strip samples — store summary only
    const latency: Record<string, BenchSummary> = {};
    for (const [k, v] of Object.entries(full.latency as Record<string, BenchSummary & { samples?: number[] }>)) {
      const { samples: _, ...summary } = v;
      latency[k] = summary;
    }

    runs.push({ ...full, latency });
  } catch (e) {
    console.warn(`  Skipping ${file}: ${e}`);
  }
}

// Sort by timestamp
runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

fs.writeFileSync(HISTORY_FILE, JSON.stringify(runs, null, 2));

const byPlatform: Record<string, number> = {};
for (const r of runs) byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1;
const summary = Object.entries(byPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");
console.log(`Written ${runs.length} runs to bench-history.json (${summary})`);
