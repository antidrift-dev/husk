#!/usr/bin/env tsx
import { SessionManager } from "../src/main/sessions";
import { gzipSync } from "zlib";
import fs from "fs";
import path from "path";
import os from "os";

interface BenchStats {
  p50: number; p95: number; p99: number;
  min: number; max: number; stddev: number;
  hz: number; iterations: number;
  samples: number[];
}

interface LatencyRun {
  type: "latency";
  timestamp: string;
  build: number;
  platform: string;
  arch: string;
  results: Record<string, BenchStats>;
}

function pct(sorted: number[], p: number): number {
  return +sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(3);
}

function calcStddev(samples: number[], mean: number): number {
  return +Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length).toFixed(3);
}

async function measure(fn: () => Promise<unknown>, { iterations = 500, warmup = 20 } = {}): Promise<BenchStats> {
  for (let i = 0; i < warmup; i++) await fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  return {
    p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99),
    min: +times[0].toFixed(3), max: +times[times.length - 1].toFixed(3),
    stddev: calcStddev(times, mean),
    hz: +(1000 / mean).toFixed(1),
    iterations: times.length,
    samples: times.map((t) => +t.toFixed(3)),
  };
}

function fmtMs(ms: number) { return `${ms.toFixed(1)}ms`.padStart(9); }

function getBuildNumber(): number {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build-number.json"), "utf-8")).build; } catch { return 0; }
}

function saveArchive(run: LatencyRun): string {
  const dir = path.join(__dirname, "..", "bench-runs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = run.timestamp.replace(/[:.]/g, "-");
  const filename = `latency-b${run.build}-${run.platform}-${run.arch}-${ts}.json.gz`;
  fs.writeFileSync(path.join(dir, filename), gzipSync(Buffer.from(JSON.stringify(run))));
  return filename;
}

async function main() {
  const build = getBuildNumber();
  const results: Record<string, BenchStats> = {};

  // ── Query ops ──────────────────────────────────────────────────────────────
  console.log("  Latency — query ops  (500 iterations)");
  const mgr = new SessionManager();
  const { session, paneId } = mgr.create("bench");
  await new Promise((r) => setTimeout(r, 1500));

  for (const [name, fn] of [
    ["getSessionMemory",           () => mgr.getSessionMemory(session.id)],
    ["getForegroundProcess",       () => mgr.getForegroundProcess(session.id, paneId)],
    ["getSessionProcessBreakdown", () => mgr.getSessionProcessBreakdown(session.id)],
    ["getCwd",                     () => mgr.getCwd(session.id, paneId)],
  ] as [string, () => Promise<unknown>][]) {
    process.stdout.write(`    ${name.padEnd(32)}`);
    results[name] = await measure(fn, { iterations: 500, warmup: 20 });
    console.log(`p50=${fmtMs(results[name].p50)}  p99=${fmtMs(results[name].p99)}`);
  }
  mgr.destroyAll();
  await new Promise((r) => setTimeout(r, 300));

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  console.log("  Latency — lifecycle");
  const mgr2 = new SessionManager();

  {
    const name = "session create+close";
    process.stdout.write(`    ${name.padEnd(32)}`);
    results[name] = await measure(async () => {
      const { session: s } = mgr2.create("bench");
      await new Promise((r) => setTimeout(r, 80));
      mgr2.close(s.id);
    }, { iterations: 30, warmup: 3 });
    console.log(`p50=${fmtMs(results[name].p50)}  p99=${fmtMs(results[name].p99)}`);
  }
  {
    const name = "createPane";
    process.stdout.write(`    ${name.padEnd(32)}`);
    const { session: host } = mgr2.create("bench-pane");
    await new Promise((r) => setTimeout(r, 300));
    results[name] = await measure(async () => {
      const pid = mgr2.createPane(host.id);
      await new Promise((r) => setTimeout(r, 80));
      if (pid) mgr2.closePane(host.id, pid);
    }, { iterations: 20, warmup: 2 });
    console.log(`p50=${fmtMs(results[name].p50)}  p99=${fmtMs(results[name].p99)}`);
    mgr2.close(host.id);
  }
  {
    const name = "save (via rename)";
    process.stdout.write(`    ${name.padEnd(32)}`);
    const { session: s } = mgr2.create("bench-save");
    await new Promise((r) => setTimeout(r, 200));
    let n = 0;
    results[name] = await measure(() => { mgr2.rename(s.id, `bench-${n++}`); return Promise.resolve(); }, { iterations: 500, warmup: 20 });
    console.log(`p50=${fmtMs(results[name].p50)}  p99=${fmtMs(results[name].p99)}`);
    mgr2.close(s.id);
  }
  mgr2.destroyAll();

  const archive = saveArchive({ type: "latency", timestamp: new Date().toISOString(), build, platform: os.platform(), arch: os.arch(), results });
  console.log(`  → bench-runs/${archive}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
