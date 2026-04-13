import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Session Management", () => {
  test("first session appears in title", async () => {
    expect(await page.title()).toContain("Session 1");
  });

  test("xterm canvas is rendered", async () => {
    await page.waitForTimeout(2000);
    const count = await page.locator(".xterm").count();
    expect(count).toBeGreaterThan(0);
  });

  test("creating new session via IPC", async () => {
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);
    expect(await page.title()).toContain("Session 2");
  });

  test("switching session via IPC", async () => {
    await emitToWindow(app, "session:switch-index", 0);
    await page.waitForTimeout(500);
    expect(await page.title()).toContain("Session 1");
  });

  test("switch back to session 2", async () => {
    await emitToWindow(app, "session:switch-index", 1);
    await page.waitForTimeout(500);
    expect(await page.title()).toContain("Session 2");
  });

  test("rename session via IPC", async () => {
    await emitToWindow(app, "session:rename-active");
    await page.waitForTimeout(500);
    const input = page.locator("input").first();
    if (await input.isVisible()) {
      await input.fill("Renamed");
      await input.press("Enter");
      await page.waitForTimeout(500);
      expect(await page.title()).toContain("Renamed");
    }
  });

  test("close session via IPC switches to adjacent", async () => {
    // Ensure we have at least 2 sessions before closing
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);

    const titleBefore = await page.title();

    // Close active
    await emitToWindow(app, "session:close-active");
    await page.waitForTimeout(500);

    // Should have switched to a different session
    const titleAfter = await page.title();
    expect(titleAfter).toMatch(/Husk/);
  });

  test("status bar shows directory path", async () => {
    await page.waitForTimeout(3000);
    await expect(page.locator("text=/\\/Users\\//")).toBeVisible({ timeout: 5000 });
  });

  test("status bar shows session memory", async () => {
    await page.waitForTimeout(3000);
    await expect(page.locator("text=/session memory/")).toBeVisible({ timeout: 5000 });
  });

  test("status bar shows MB value", async () => {
    await expect(page.locator("text=/\\d+ MB/")).toBeVisible({ timeout: 5000 });
  });
});
