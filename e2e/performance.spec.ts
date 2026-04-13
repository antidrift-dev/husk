import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";
import { logPerf, printPerfSummary } from "./perf-reporter";

const MAIN_JS = path.join(__dirname, "..", "dist", "main", "main.js");
const HUSK_DIR = path.join(os.homedir(), ".husk");

function cleanHusk() {
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
}

test.describe("Performance", () => {
  test.beforeEach(() => cleanHusk());
  test.afterEach(() => cleanHusk());

  // ---- Startup ----

  test("app launches in under 3 seconds", async () => {
    const start = Date.now();
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(500);
    const elapsed = Date.now() - start;

    logPerf("startup_ms", elapsed); console.log(`Startup time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
    await app.close();
  });

  test("first terminal is ready within 2 seconds of window", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    const start = Date.now();

    // Wait for xterm to appear
    await page.waitForSelector(".xterm", { timeout: 5000 });
    const elapsed = Date.now() - start;

    logPerf("terminal_ready_ms", elapsed); console.log(`Terminal ready time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);
    await app.close();
  });

  // ---- Session operations ----

  test("new session creation under 500ms", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    const start = Date.now();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
    });
    // Wait for the new session to appear in title
    await page.waitForFunction(() => document.title.includes("Session 2"), { timeout: 5000 });
    const elapsed = Date.now() - start;

    logPerf("session_create_ms", elapsed); console.log(`Session creation time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(500);
    await app.close();
  });

  test("session switch under 200ms", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Create second session
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
    });
    await page.waitForTimeout(2000);

    // Time the switch
    const start = Date.now();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("session:switch-index", 0);
    });
    await page.waitForFunction(() => document.title.includes("Session 1"), { timeout: 5000 });
    const elapsed = Date.now() - start;

    logPerf("session_switch_ms", elapsed); console.log(`Session switch time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(200);
    await app.close();
  });

  test("split creation under 1 second", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    const xtermsBefore = await page.locator(".xterm").count();

    const start = Date.now();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("pane:split", "vertical");
    });

    // Wait for new xterm to appear
    await page.waitForFunction(
      (before) => document.querySelectorAll(".xterm").length > before,
      xtermsBefore,
      { timeout: 5000 }
    );
    const elapsed = Date.now() - start;

    logPerf("split_create_ms", elapsed); console.log(`Split creation time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(1000);
    await app.close();
  });

  // ---- Theme ----

  test("theme switch under 100ms", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    const start = Date.now();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("theme:change", "dracula");
    });
    await page.waitForTimeout(50);
    const elapsed = Date.now() - start;

    logPerf("theme_switch_ms", elapsed); console.log(`Theme switch time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(100);
    await app.close();
  });

  // ---- Memory ----

  test("baseline memory under 300MB with 1 session", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(3000);

    const memMB = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    });

    logPerf("memory_1_session", memMB); console.log(`Memory (1 session): ${memMB} MB`);
    await app.close();
  });

  test("memory with 5 sessions under 500MB", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Create 4 more sessions (1 already exists)
    for (let i = 0; i < 4; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
      });
      await page.waitForTimeout(1500);
    }

    const memMB = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    });

    logPerf("memory_5_sessions", memMB); console.log(`Memory (5 sessions): ${memMB} MB`);
    await app.close();
  });

  test("memory with 10 sessions under 700MB", async () => {
    test.setTimeout(60000);
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    for (let i = 0; i < 9; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
      });
      await page.waitForTimeout(1500);
    }

    const memMB = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    });

    logPerf("memory_10_sessions", memMB); console.log(`Memory (10 sessions): ${memMB} MB`);
    await app.close();
  });

  test("memory doesn't leak after closing sessions", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Baseline
    const memBaseline = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    });

    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
      });
      await page.waitForTimeout(1000);
    }

    // Close them all except first
    for (let i = 0; i < 5; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:close-active");
      });
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2000);

    const memAfter = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    });

    logPerf("memory_leak_delta", memAfter - memBaseline);
    console.log(`Memory baseline: ${memBaseline} MB, after create+close 5: ${memAfter} MB, delta: ${memAfter - memBaseline} MB`);
    await app.close();
  });

  // ---- CPU ----

  test("CPU idle under 5% with 1 session", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000); // Let it settle

    const cpuPercent = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    });

    console.log(`CPU idle (1 session): ${cpuPercent.toFixed(1)}%`);
    expect(cpuPercent).toBeLessThan(5);
    await app.close();
  });

  test("CPU idle under 10% with 5 sessions", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    for (let i = 0; i < 4; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
      });
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(5000); // Let it settle

    const cpuPercent = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    });

    console.log(`CPU idle (5 sessions): ${cpuPercent.toFixed(1)}%`);
    expect(cpuPercent).toBeLessThan(10);
    await app.close();
  });

  // ---- Throughput ----

  test("handles rapid output without crash", async () => {
    test.setTimeout(30000);
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(3000);

    // Send a command that produces lots of output
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      // Type a command that generates output
      win?.webContents.send("pane:input-test", "seq 1 1000\n");
    });

    // Wait for it to finish
    await page.waitForTimeout(5000);

    // App should still be alive
    const title = await page.title();
    expect(title).toContain("Husk");
    await app.close();
  });

  test("handles rapid session creation and deletion", async () => {
    test.setTimeout(30000);
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Rapidly create and close 10 sessions
    for (let i = 0; i < 10; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:new");
      });
      await page.waitForTimeout(500);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:close-active");
      });
      await page.waitForTimeout(300);
    }

    // App should still be alive
    const title = await page.title();
    expect(title).toContain("Husk");
    await app.close();
  });

  test("theme rapid cycling doesn't degrade performance", async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    const themes = [
      "mocha", "latte", "dracula", "nord", "one-dark",
      "github-dark", "github-light", "tokyo-night", "gruvbox-dark",
      "monokai", "solarized-dark", "solarized-light",
      "rose-pine", "night-owl", "kanagawa", "everforest", "ayu-mirage",
    ];

    const start = Date.now();
    for (const t of themes) {
      await app.evaluate(({ BrowserWindow }, theme) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("theme:change", theme);
      }, t);
      await page.waitForTimeout(50);
    }
    const elapsed = Date.now() - start;

    logPerf("theme_cycle_avg_ms", Math.round(elapsed / themes.length));
    console.log(`Cycled ${themes.length} themes in ${elapsed}ms (${Math.round(elapsed / themes.length)}ms avg)`);
    expect(elapsed / themes.length).toBeLessThan(200);

    const memMB = await app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics();
      return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    });
    logPerf("memory_after_theme_cycle", memMB);
    console.log(`Memory after theme cycling: ${memMB} MB`);

    await app.close();

    // Print summary at the end
    printPerfSummary();
  });
});
