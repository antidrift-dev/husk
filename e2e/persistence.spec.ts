import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const HUSK_DIR = path.join(os.homedir(), ".husk");
const STATE_FILE = path.join(HUSK_DIR, "sessions.json");
const SETTINGS_FILE = path.join(HUSK_DIR, "settings.json");
const MAIN_JS = path.join(__dirname, "..", "dist", "main", "main.js");

function cleanHusk() {
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
}

test.describe("Persistence", () => {
  test.beforeEach(() => cleanHusk());
  test.afterEach(() => cleanHusk());

  test("creates .husk directory", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    await app.firstWindow();
    await new Promise((r) => setTimeout(r, 3000));
    expect(fs.existsSync(HUSK_DIR)).toBe(true);
    await app.close();
  });

  test("sessions.json has correct structure", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    await app.firstWindow();
    await new Promise((r) => setTimeout(r, 3000));
    expect(fs.existsSync(STATE_FILE)).toBe(true);

    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(state).toHaveProperty("sessions");
    expect(state).toHaveProperty("activeIndex");
    expect(state).toHaveProperty("sidebarWidth");
    expect(state).toHaveProperty("themeId");
    expect(state).toHaveProperty("use24h");
    expect(state).toHaveProperty("windowBounds");
    expect(Array.isArray(state.sessions)).toBe(true);
    expect(state.sessions.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  test("session entry has id, label, cwd", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    await app.firstWindow();
    await new Promise((r) => setTimeout(r, 3000));
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    const s = state.sessions[0];
    expect(s.id).toBeTruthy();
    expect(s.label).toBeTruthy();
    expect(s.cwd).toContain("/");
    await app.close();
  });

  test("windowBounds are saved", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    await app.firstWindow();
    await new Promise((r) => setTimeout(r, 3000));
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(state.windowBounds.width).toBeGreaterThan(0);
    expect(state.windowBounds.height).toBeGreaterThan(0);
    await app.close();
  });

  test("sessions restore on relaunch", async () => {
    // First launch
    const app1 = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page1 = await app1.firstWindow();
    await new Promise((r) => setTimeout(r, 3000));

    // Just let it save the auto-created session
    await app1.close();
    await new Promise((r) => setTimeout(r, 1000));

    // Verify state was saved
    expect(fs.existsSync(STATE_FILE)).toBe(true);
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    expect(state.sessions.length).toBeGreaterThanOrEqual(1);

    // Second launch
    const app2 = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page2 = await app2.firstWindow();
    await new Promise((r) => setTimeout(r, 3000));

    // Should have restored a session
    const title = await page2.title();
    expect(title).toContain("Session");
    await app2.close();
  });

  test("settings persist after change", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await new Promise((r) => setTimeout(r, 2000));

    // Open settings and toggle something
    const win = app.windows()[0];
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("settings:toggle");
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Click a checkbox
    const cb = page.locator("input[type='checkbox']").first();
    if (await cb.isVisible()) {
      await cb.click();
      await new Promise((r) => setTimeout(r, 1000));
      expect(fs.existsSync(SETTINGS_FILE)).toBe(true);
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      expect(settings).toHaveProperty("fontSize");
    }
    await app.close();
  });
});
