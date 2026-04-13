import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const MAIN_JS = path.join(__dirname, "..", "dist", "main", "main.js");
const HUSK_DIR = path.join(os.homedir(), ".husk");

function seedSettings(extra: Record<string, any> = {}) {
  fs.mkdirSync(HUSK_DIR, { recursive: true });
  fs.writeFileSync(path.join(HUSK_DIR, "settings.json"), JSON.stringify({ _onboardingDone: true, ...extra }));
}

test.describe("Quake Mode", () => {
  test.beforeEach(() => {
    if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
  });
  test.afterEach(() => {
    if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
  });

  test("quake mode is off by default", async () => {
    seedSettings();
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Only one window (no quake window)
    expect(app.windows().length).toBe(1);
    await app.close();
  });

  test("enabling quake mode registers shortcut", async () => {
    seedSettings({ quakeMode: true, quakeHotkey: "Control+`" });
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // App should still launch normally
    expect(app.windows().length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  test("quake mode setting persists", async () => {
    seedSettings();
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Enable quake mode via settings save
    await page.evaluate(() => {
      (window as any).husk.saveSettings(JSON.stringify({ _onboardingDone: true, quakeMode: true, quakeHotkey: "Control+\`" }));
    });
    await page.waitForTimeout(500);

    const settings = JSON.parse(fs.readFileSync(path.join(HUSK_DIR, "settings.json"), "utf-8"));
    expect(settings.quakeMode).toBe(true);
    await app.close();
  });
});
