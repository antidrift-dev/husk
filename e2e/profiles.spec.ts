import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow } from "./helpers";
import fs from "fs";
import path from "path";
import os from "os";

const PROFILES_DIR = path.join(os.homedir(), ".husk", "profiles");

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Profiles", () => {
  test("save profile creates file", async () => {
    // Create a second session so the profile has content
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);

    // Save profile via IPC
    await page.evaluate(() => {
      (window as any).husk.saveProfile("TestProfile");
    });
    await page.waitForTimeout(1000);

    // Profile file should exist
    const files = fs.existsSync(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR) : [];
    expect(files.some((f) => f.includes("testprofile"))).toBe(true);
  });

  test("profile file has sessions", async () => {
    const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, files[0]), "utf-8"));
    expect(data.name).toBeTruthy();
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
  });

  test("profile sessions have label and cwd", async () => {
    const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));
    const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, files[0]), "utf-8"));
    for (const s of data.sessions) {
      expect(s.label).toBeTruthy();
      expect(s.cwd).toBeTruthy();
      expect(s.cwd).toContain("/");
    }
  });

  test("profile menu has saved profiles", async () => {
    const profileCount = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const fileMenu = menu?.items.find((i) => i.label === "File");
      const openProfile = fileMenu?.submenu?.items.find((i) => i.label === "Open Profile");
      return openProfile?.submenu?.items.length || 0;
    });
    expect(profileCount).toBeGreaterThan(0);
  });

  test("opening profile creates new window", async () => {
    const windowsBefore = app.windows().length;
    await page.evaluate(() => {
      (window as any).husk.openProfile("TestProfile");
    });
    await page.waitForTimeout(3000);
    expect(app.windows().length).toBeGreaterThan(windowsBefore);

    // Clean up
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 1) wins[wins.length - 1].close();
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  });

  test("deleting profile removes file", async () => {
    await page.evaluate(() => {
      (window as any).husk.deleteProfile("TestProfile");
    });
    await page.waitForTimeout(500);
    const files = fs.existsSync(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json")) : [];
    expect(files.some((f) => f.includes("testprofile"))).toBe(false);
  });
});
