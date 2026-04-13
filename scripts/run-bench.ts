#!/usr/bin/env tsx
/**
 * Husk benchmark runner — latency P50/P95/P99, memory per session, idle CPU.
 * Appends to bench-history.json and prints a grid across builds.
 *
 * Usage:
 *   npx tsx scripts/run-bench.ts
 *   ./scripts/run-perf-docker.sh   (Docker)
 */
import { SessionManager } from "../src/main/sessions";
import { gzipSync } from "zlib";
import fs from "fs";
import path from "path";
import os from "os";

// ── Types ─────────────────────────────────────────────────────────────────────

// Summary stats stored in bench-history.json (no samples — fast to parse)
interface BenchSummary {
  p50: number; p95: number; p99: number;
  min: number; max: number; stddev: number;
  hz: number; iterations: number;
}

// Full stats stored in bench-runs/*.json.gz (includes raw samples for drill-down)
interface BenchStats extends BenchSummary {
  samples: number[]; // raw timings in ms, sorted ascending
}

interface BenchRun<S extends BenchSummary = BenchSummary> {
  timestamp: string;
  build: number;
  platform: string;
  arch: string;
  latency: Record<string, S>;
  memory: Record<string, number>;
  cpu: Record<string, number>;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function pct(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return +sorted[idx].toFixed(3);
}

function calcStddev(samples: number[], mean: number): number {
  return +Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length).toFixed(3);
}

async function measure(
  fn: () => Promise<unknown>,
  { iterations = 100, warmup = 10 } = {},
): Promise<BenchStats> {
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
    p50:        pct(times, 50),
    p95:        pct(times, 95),
    p99:        pct(times, 99),
    min:        +times[0].toFixed(3),
    max:        +times[times.length - 1].toFixed(3),
    stddev:     calcStddev(times, mean),
    hz:         +(1000 / mean).toFixed(1),
    iterations: times.length,
    samples:    times.map((t) => +t.toFixed(3)),
  };
}

function mb(): number {
  return +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);
}

function gc() {
  // Available when node is run with --expose-gc; silently skipped otherwise
  if (typeof global.gc === "function") global.gc();
}

// ── Latency benchmarks ────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return `${ms.toFixed(1)}ms`.padStart(9);
}

async function runLatency(): Promise<Record<string, BenchStats>> {
  const results: Record<string, BenchStats> = {};

  // Query ops — one shared session, 500 iterations each (5 tail samples for P99)
  console.log("\n  Latency — query ops  (status-bar hot path, 500 iterations)");
  console.log("  " + "─".repeat(62));

  const mgr = new SessionManager();
  const { session, paneId } = mgr.create("bench");
  await new Promise((r) => setTimeout(r, 1500)); // shell settle + env cache warmup

  const queryOps: [string, () => Promise<unknown>][] = [
    ["getSessionMemory",           () => mgr.getSessionMemory(session.id)],
    ["getForegroundProcess",       () => mgr.getForegroundProcess(session.id, paneId)],
    ["getSessionProcessBreakdown", () => mgr.getSessionProcessBreakdown(session.id)],
    ["getCwd",                     () => mgr.getCwd(session.id, paneId)],
  ];

  for (const [name, fn] of queryOps) {
    process.stdout.write(`  ${name.padEnd(32)}`);
    const s = await measure(fn, { iterations: 500, warmup: 20 });
    results[name] = s;
    console.log(`p50=${fmtMs(s.p50)}  p99=${fmtMs(s.p99)}  σ=${s.stddev.toFixed(1)}ms  ${s.hz} ops/s`);
  }

  mgr.destroyAll();
  await new Promise((r) => setTimeout(r, 500));

  // Lifecycle ops — PTY spawn cost, fewer iterations (each spawns a real shell)
  console.log("\n  Latency — lifecycle  (PTY spawn cost)");
  console.log("  " + "─".repeat(62));

  const mgr2 = new SessionManager();

  {
    const name = "session create+close";
    process.stdout.write(`  ${name.padEnd(32)}`);
    const s = await measure(async () => {
      const { session: sess } = mgr2.create("bench");
      await new Promise((r) => setTimeout(r, 80));
      mgr2.close(sess.id);
    }, { iterations: 30, warmup: 3 });
    results[name] = s;
    console.log(`p50=${fmtMs(s.p50)}  p99=${fmtMs(s.p99)}  σ=${s.stddev.toFixed(1)}ms  ${s.hz} ops/s`);
  }

  {
    const name = "createPane";
    process.stdout.write(`  ${name.padEnd(32)}`);
    const { session: host } = mgr2.create("bench-pane");
    await new Promise((r) => setTimeout(r, 500));
    const s = await measure(async () => {
      const pid = mgr2.createPane(host.id);
      await new Promise((r) => setTimeout(r, 80));
      if (pid) mgr2.closePane(host.id, pid);
    }, { iterations: 20, warmup: 2 });
    results[name] = s;
    console.log(`p50=${fmtMs(s.p50)}  p99=${fmtMs(s.p99)}  σ=${s.stddev.toFixed(1)}ms  ${s.hz} ops/s`);
    mgr2.close(host.id);
  }

  // save() — called on every session mutation (rename proxies it with minimal overhead)
  {
    const name = "save (via rename)";
    process.stdout.write(`  ${name.padEnd(32)}`);
    const { session: host } = mgr2.create("bench-save");
    await new Promise((r) => setTimeout(r, 300));
    let n = 0;
    const s = await measure(() => {
      mgr2.rename(host.id, `bench-${n++}`);
      return Promise.resolve();
    }, { iterations: 500, warmup: 20 });
    results[name] = s;
    console.log(`p50=${fmtMs(s.p50)}  p99=${fmtMs(s.p99)}  σ=${s.stddev.toFixed(1)}ms  ${s.hz} ops/s`);
    mgr2.close(host.id);
  }

  mgr2.destroyAll();
  return results;
}

// ── Memory benchmarks ─────────────────────────────────────────────────────────

async function runMemory(): Promise<Record<string, number>> {
  console.log("\n  Memory");
  console.log("  " + "─".repeat(62));

  gc();
  await new Promise((r) => setTimeout(r, 200));
  const baseline = mb();

  const mgr = new SessionManager();

  const { session: s1 } = mgr.create("mem-1");
  await new Promise((r) => setTimeout(r, 300));
  const mem1 = mb();
  console.log(`  1 session                        ${mem1} MB  (+${(mem1 - baseline).toFixed(1)} MB)`);

  for (let i = 2; i <= 3; i++) mgr.create(`mem-${i}`);
  await new Promise((r) => setTimeout(r, 300));
  const mem3 = mb();
  console.log(`  3 sessions                       ${mem3} MB  (+${(mem3 - baseline).toFixed(1)} MB)`);

  for (let i = 4; i <= 5; i++) mgr.create(`mem-${i}`);
  await new Promise((r) => setTimeout(r, 300));
  const mem5 = mb();
  console.log(`  5 sessions                       ${mem5} MB  (+${(mem5 - baseline).toFixed(1)} MB)`);

  mgr.destroyAll();
  await new Promise((r) => setTimeout(r, 500));
  gc();
  await new Promise((r) => setTimeout(r, 500));
  const memAfter = mb();
  const leak = Math.max(0, memAfter - mem1);
  console.log(`  after close                      ${memAfter} MB  (leak: ${leak.toFixed(1)} MB)`);

  return {
    baseline_mb:       baseline,
    one_session_mb:    mem1,
    three_sessions_mb: mem3,
    five_sessions_mb:  mem5,
    after_close_mb:    memAfter,
    per_session_mb:    +((mem5 - mem1) / 4).toFixed(1),
    leak_mb:           +leak.toFixed(1),
  };
}

// ── CPU benchmarks ────────────────────────────────────────────────────────────

async function runCpu(): Promise<Record<string, number>> {
  console.log("\n  CPU  (idle, 5-second windows)");
  console.log("  " + "─".repeat(62));

  const WINDOW = 2000;

  const mgr = new SessionManager();
  mgr.create("cpu-1");
  await new Promise((r) => setTimeout(r, 500)); // let shell fully settle

  const start1 = process.cpuUsage();
  await new Promise((r) => setTimeout(r, WINDOW));
  const u1 = process.cpuUsage(start1);
  const cpu1 = +((u1.user + u1.system) / (WINDOW * 1000) * 100).toFixed(2);
  console.log(`  idle 1 session                   ${cpu1}%`);

  for (let i = 2; i <= 5; i++) mgr.create(`cpu-${i}`);
  await new Promise((r) => setTimeout(r, 500));

  const start5 = process.cpuUsage();
  await new Promise((r) => setTimeout(r, WINDOW));
  const u5 = process.cpuUsage(start5);
  const cpu5 = +((u5.user + u5.system) / (WINDOW * 1000) * 100).toFixed(2);
  console.log(`  idle 5 sessions                  ${cpu5}%`);

  mgr.destroyAll();

  return {
    idle_1_session_pct:  cpu1,
    idle_5_sessions_pct: cpu5,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

const ROOT     = path.join(__dirname, "..");
const RUNS_DIR = path.join(ROOT, "bench-runs");

function saveRunArchive(run: BenchRun<BenchStats>): string {
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
  const ts = run.timestamp.replace(/[:.]/g, "-");
  const filename = `b${run.build}-${run.platform}-${run.arch}-${ts}.json.gz`;
  fs.writeFileSync(
    path.join(RUNS_DIR, filename),
    gzipSync(Buffer.from(JSON.stringify(run))),
  );
  return filename;
}

function getBuildNumber(): number {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "build-number.json"), "utf-8"),
    ).build;
  } catch { return 0; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const build = getBuildNumber();
  console.log(`\nHusk Benchmark Runner — ${os.platform()}/${os.arch()} — b${build}`);

  const latency = await runLatency();
  const memory  = await runMemory();
  const cpu     = await runCpu();

  const run: BenchRun<BenchStats> = {
    timestamp: new Date().toISOString(),
    build,
    platform: os.platform(),
    arch: os.arch(),
    latency,
    memory,
    cpu,
  };

  const archive = saveRunArchive(run);
  console.log(`\n  → bench-runs/${archive}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
