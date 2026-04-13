import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const MAIN_JS = path.join(__dirname, "..", "dist", "main", "main.js");
const HUSK_DIR = path.join(os.homedir(), ".husk");
const STATE_FILE = path.join(HUSK_DIR, "sessions.json");

function cleanHusk() {
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
}

function seedSettings() {
  fs.mkdirSync(HUSK_DIR, { recursive: true });
  fs.writeFileSync(path.join(HUSK_DIR, "settings.json"), JSON.stringify({ _onboardingDone: true }));
}

test.describe("Window Bounds Persistence", () => {
  test.beforeEach(() => cleanHusk());
  test.afterEach(() => cleanHusk());

  test("saves window bounds on close", async () => {
    seedSettings();
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Resize window
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 100, y: 100, width: 800, height: 600 });
    });
    await page.waitForTimeout(1000);

    await app.close();
    await new Promise((r) => setTimeout(r, 500));

    // Check saved state
    expect(fs.existsSync(STATE_FILE)).toBe(true);
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(state.windowBounds).toBeDefined();
    expect(state.windowBounds.width).toBe(800);
    expect(state.windowBounds.height).toBe(600);
  });

  test("restores window bounds on relaunch", async () => {
    seedSettings();
    // First launch — resize
    const app1 = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page1 = await app1.firstWindow();
    await page1.waitForTimeout(2000);

    await app1.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 150, y: 150, width: 1000, height: 700 });
    });
    await page1.waitForTimeout(1000);
    await app1.close();
    await new Promise((r) => setTimeout(r, 1000));

    // Second launch — should restore
    const app2 = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    await app2.firstWindow();
    await new Promise((r) => setTimeout(r, 2000));

    const bounds = await app2.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.getBounds();
    });
    expect(bounds.width).toBe(1000);
    expect(bounds.height).toBe(700);
    await app2.close();
  });

  test("saves sidebar width", async () => {
    seedSettings();
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Save sidebar width via IPC
    await page.evaluate(() => {
      (window as any).husk.saveSidebarWidth(200);
    });
    await page.waitForTimeout(500);
    await app.close();
    await new Promise((r) => setTimeout(r, 500));

    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(state.sidebarWidth).toBe(200);
  });

  test("saves theme selection", async () => {
    seedSettings();
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("theme:change", "tokyo-night");
    });
    await page.waitForTimeout(1000);
    await app.close();
    await new Promise((r) => setTimeout(r, 500));

    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(state.themeId).toBe("tokyo-night");
  });
});
