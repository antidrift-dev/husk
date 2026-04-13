import fs from "fs";
import path from "path";
import os from "os";

const PERF_FILE = path.join(__dirname, "..", "perf-results.json");

interface PerfResult {
  timestamp: string;
  build: number;
  results: Record<string, string | number>;
}

// Call from performance tests to log a metric
export function logPerf(name: string, value: number | string) {
  const dir = path.dirname(PERF_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data: PerfResult[] = [];
  try {
    data = JSON.parse(fs.readFileSync(PERF_FILE, "utf-8"));
  } catch {}

  // Each call within the same process shares one run entry (keyed by process start time)
  const runId = process.env.__PERF_RUN_ID || (process.env.__PERF_RUN_ID = new Date().toISOString());
  let build = 0;
  try {
    build = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build-number.json"), "utf-8")).build;
  } catch {}

  let entry = data.find((d) => d.timestamp === runId && d.build === build);
  if (!entry) {
    entry = { timestamp: runId, build, results: {} };
    data.push(entry);
  }
  entry.results[name] = value;

  fs.writeFileSync(PERF_FILE, JSON.stringify(data, null, 2));
}

// Print a summary of the latest results
export function printPerfSummary() {
  try {
    const data: PerfResult[] = JSON.parse(fs.readFileSync(PERF_FILE, "utf-8"));
    const latest = data[data.length - 1];
    if (!latest) return;

    console.log(`\n📊 Performance Results — Build ${latest.build} (${latest.timestamp})`);
    console.log("─".repeat(50));
    for (const [name, value] of Object.entries(latest.results)) {
      const formatted = typeof value === "number"
        ? name.includes("memory") || name.includes("Memory") ? `${value} MB` : name.includes("cpu") || name.includes("CPU") ? `${value}%` : `${value}ms`
        : value;
      console.log(`  ${name.padEnd(35)} ${formatted}`);
    }
    console.log("");
  } catch {}
}
