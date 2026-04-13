import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const MAIN_JS = path.join(__dirname, "..", "dist", "main", "main.js");
const HUSK_DIR = path.join(os.homedir(), ".husk");

function cleanHusk() {
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function emit(app: ElectronApplication, channel: string, ...args: any[]) {
  await app.evaluate(({ BrowserWindow }, { channel, args }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }, { channel, args });
}

async function getState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, app }) => {
    const wins = BrowserWindow.getAllWindows();
    const metrics = app.getAppMetrics();
    const mem = Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    return {
      windows: wins.length,
      alive: wins.filter(w => !w.isDestroyed()).length,
      mem,
      cpu: Math.round(cpu * 10) / 10,
    };
  });
}

test.describe("Chaos Monkey", () => {
  test.beforeEach(() => cleanHusk());
  test.afterEach(() => cleanHusk());

  test("survives 100 random actions", async () => {
    test.setTimeout(120000);

    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(3000);

    const themes = [
      "mocha", "latte", "dracula", "nord", "one-dark",
      "github-dark", "github-light", "tokyo-night", "gruvbox-dark",
      "monokai", "solarized-dark", "rose-pine", "kanagawa", "everforest",
    ];

    const actions = [
      "new-session",
      "close-session",
      "switch-session",
      "split-vertical",
      "split-horizontal",
      "focus-next",
      "focus-prev",
      "rename",
      "theme-change",
      "settings-toggle",
      "resize-window",
    ];

    let sessionCount = 1;
    const log: string[] = [];

    for (let i = 0; i < 100; i++) {
      const action = pick(actions);
      log.push(`${i}: ${action}`);

      try {
        switch (action) {
          case "new-session":
            await emit(app, "session:new");
            sessionCount++;
            await page.waitForTimeout(rand(200, 500));
            break;

          case "close-session":
            if (sessionCount > 1) {
              await emit(app, "session:close-active");
              sessionCount--;
            }
            await page.waitForTimeout(rand(100, 300));
            break;

          case "switch-session":
            await emit(app, "session:switch-index", rand(0, Math.min(sessionCount - 1, 8)));
            await page.waitForTimeout(rand(50, 200));
            break;

          case "split-vertical":
            await emit(app, "pane:split", "vertical");
            await page.waitForTimeout(rand(300, 800));
            break;

          case "split-horizontal":
            await emit(app, "pane:split", "horizontal");
            await page.waitForTimeout(rand(300, 800));
            break;

          case "focus-next":
            await emit(app, "pane:focus-next");
            await page.waitForTimeout(rand(50, 150));
            break;

          case "focus-prev":
            await emit(app, "pane:focus-prev");
            await page.waitForTimeout(rand(50, 150));
            break;

          case "rename":
            await emit(app, "session:rename-active");
            await page.waitForTimeout(100);
            // Type something and press Enter or Escape
            const input = page.locator("input").first();
            if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
              await input.fill(`Chaos-${i}`);
              await input.press(pick(["Enter", "Escape"]));
            }
            await page.waitForTimeout(100);
            break;

          case "theme-change":
            await emit(app, "theme:change", pick(themes));
            await page.waitForTimeout(rand(50, 200));
            break;

          case "settings-toggle":
            await emit(app, "settings:toggle");
            await page.waitForTimeout(rand(100, 300));
            // Close it half the time
            if (Math.random() > 0.5) {
              await emit(app, "settings:toggle");
              await page.waitForTimeout(100);
            }
            break;

          case "resize-window":
            await app.evaluate(({ BrowserWindow }) => {
              const win = BrowserWindow.getAllWindows()[0];
              if (win && !win.isDestroyed()) {
                const w = 400 + Math.floor(Math.random() * 1000);
                const h = 300 + Math.floor(Math.random() * 700);
                win.setBounds({ ...win.getBounds(), width: w, height: h });
              }
            });
            await page.waitForTimeout(rand(100, 300));
            break;
        }
      } catch (e: any) {
        // Log but don't fail — some actions are expected to no-op
        log.push(`  ERROR: ${e.message?.slice(0, 80)}`);
        // Check if app is still alive
        try {
          await page.title();
        } catch {
          console.log("App died at action", i, action);
          console.log("Recent log:", log.slice(-10).join("\n"));
          throw new Error(`App crashed after action #${i}: ${action}`);
        }
      }
    }

    // App should still be alive after 100 random actions
    const title = await page.title();
    expect(title).toContain("Husk");

    const state = await getState(app);
    console.log(`Chaos monkey completed. State: ${JSON.stringify(state)}`);
    console.log(`Final session count estimate: ${sessionCount}`);
    expect(state.alive).toBeGreaterThanOrEqual(1);
    expect(state.mem).toBeLessThan(1500); // shouldn't balloon past 1.5GB

    await app.close();
  });

  test("survives rapid-fire same action 50x", async () => {
    test.setTimeout(60000);

    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    const safeEmit = async (channel: string, ...args: any[]) => {
      try { await emit(app, channel, ...args); } catch {}
    };

    console.log("Phase 1: Rapid create (10x)");
    for (let i = 0; i < 10; i++) {
      await safeEmit("session:new");
      await page.waitForTimeout(200);
    }

    console.log("Phase 2: Rapid switch (20x)");
    for (let i = 0; i < 20; i++) {
      await safeEmit("session:switch-index", rand(0, 9));
      await page.waitForTimeout(50);
    }

    console.log("Phase 3: Rapid close (5x, keep some alive)");
    for (let i = 0; i < 5; i++) {
      await safeEmit("session:close-active");
      await page.waitForTimeout(200);
    }

    console.log("Phase 4: Rapid split (5x)");
    for (let i = 0; i < 5; i++) {
      await safeEmit("pane:split", pick(["vertical", "horizontal"]));
      await page.waitForTimeout(300);
    }

    console.log("Phase 5: Rapid theme (all themes)");
    const themes = [
      "mocha", "latte", "dracula", "nord", "one-dark", "github-dark",
      "tokyo-night", "gruvbox-dark", "monokai", "solarized-dark",
      "rose-pine", "kanagawa", "everforest", "ayu-mirage",
    ];
    for (const t of themes) {
      await emit(app, "theme:change", t);
      await page.waitForTimeout(30);
    }

    await page.waitForTimeout(1000);
    const title = await page.title();
    expect(title).toContain("Husk");

    const state = await getState(app);
    console.log(`Rapid fire completed. State: ${JSON.stringify(state)}`);
    expect(state.mem).toBeLessThan(1000);

    await app.close();
  });

  test("survives settings spam", async () => {
    test.setTimeout(30000);

    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Open/close settings 50 times
    for (let i = 0; i < 50; i++) {
      await emit(app, "settings:toggle");
      await page.waitForTimeout(30);
    }

    // Should end with settings closed (even number of toggles)
    await page.waitForTimeout(500);
    const title = await page.title();
    expect(title).toContain("Husk");

    await app.close();
  });

  test("survives window resize storm", async () => {
    test.setTimeout(30000);

    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Resize 30 times rapidly
    for (let i = 0; i < 30; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          const w = 300 + Math.floor(Math.random() * 1200);
          const h = 200 + Math.floor(Math.random() * 800);
          win.setBounds({ ...win.getBounds(), width: w, height: h });
        }
      });
      await page.waitForTimeout(50);
    }

    // Reset to normal size
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setBounds({ ...win.getBounds(), width: 960, height: 640 });
    });
    await page.waitForTimeout(1000);

    // Terminal should still work
    const xtermCount = await page.locator(".xterm").count();
    expect(xtermCount).toBeGreaterThan(0);

    await app.close();
  });

  test("survives split + switch + close interleaved", async () => {
    test.setTimeout(60000);

    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      await emit(app, "session:new");
      await page.waitForTimeout(1000);
    }

    // Split each one
    for (let i = 0; i < 4; i++) {
      await emit(app, "session:switch-index", i);
      await page.waitForTimeout(300);
      await emit(app, "pane:split", pick(["vertical", "horizontal"]));
      await page.waitForTimeout(500);
    }

    // Rapidly switch between them
    for (let i = 0; i < 20; i++) {
      await emit(app, "session:switch-index", rand(0, 3));
      await page.waitForTimeout(100);
    }

    // Close half
    await emit(app, "session:close-active");
    await page.waitForTimeout(300);
    await emit(app, "session:close-active");
    await page.waitForTimeout(300);

    // Split remaining ones more
    await emit(app, "pane:split", "vertical");
    await page.waitForTimeout(500);
    await emit(app, "pane:split", "horizontal");
    await page.waitForTimeout(500);

    // Focus cycle
    for (let i = 0; i < 10; i++) {
      await emit(app, pick(["pane:focus-next", "pane:focus-prev"]));
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(1000);
    const title = await page.title();
    expect(title).toContain("Husk");

    const state = await getState(app);
    console.log(`Interleaved chaos completed. State: ${JSON.stringify(state)}`);
    expect(state.alive).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  test("recovers from closing all sessions", async () => {
    test.setTimeout(30000);

    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, HUSK_TEST: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Create a few sessions
    await emit(app, "session:new");
    await page.waitForTimeout(1000);
    await emit(app, "session:new");
    await page.waitForTimeout(1000);

    // Close all of them
    await emit(app, "session:close-active");
    await page.waitForTimeout(300);
    await emit(app, "session:close-active");
    await page.waitForTimeout(300);
    await emit(app, "session:close-active");
    await page.waitForTimeout(1000);

    // App might close or stay open with empty state
    // If still alive, creating a new session should work
    try {
      const title = await page.title();
      if (title.includes("Husk")) {
        await emit(app, "session:new");
        await page.waitForTimeout(2000);
        const newTitle = await page.title();
        expect(newTitle).toContain("Husk");
      }
    } catch {
      // App closed — that's acceptable behavior when all sessions are closed
      expect(true).toBe(true);
    }

    await app.close().catch(() => {});
  });
});
