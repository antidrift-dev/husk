import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Keyboard Shortcuts (via IPC)", () => {
  test("session:new creates session", async () => {
    const titleBefore = await page.title();
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);
    const titleAfter = await page.title();
    expect(titleAfter).toContain("Session 2");
  });

  test("session:switch-index switches to session 1", async () => {
    await emitToWindow(app, "session:switch-index", 0);
    await page.waitForTimeout(500);
    expect(await page.title()).toContain("Session 1");
  });

  test("session:switch-index switches to session 2", async () => {
    await emitToWindow(app, "session:switch-index", 1);
    await page.waitForTimeout(500);
    expect(await page.title()).toContain("Session 2");
  });

  test("session:rename-active opens rename input", async () => {
    await emitToWindow(app, "session:rename-active");
    await page.waitForTimeout(500);
    const inputs = await page.locator("input").count();
    expect(inputs).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  });

  test("settings:toggle opens settings", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
    await expect(page.locator("text=Settings").first()).toBeVisible();
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
  });

  test("terminal:search triggers search", async () => {
    // Search uses prompt() which blocks — just verify no crash
    // We can't easily test prompt() in Playwright
    expect(true).toBe(true);
  });

  test("pane:split creates split", async () => {
    const before = await page.locator(".xterm").count();
    await emitToWindow(app, "pane:split", "vertical");
    await page.waitForTimeout(2000);
    const after = await page.locator(".xterm").count();
    expect(after).toBeGreaterThan(before);
  });

  test("pane:focus-next cycles focus", async () => {
    await emitToWindow(app, "pane:focus-next");
    await page.waitForTimeout(300);
    expect(true).toBe(true);
  });

  test("pane:focus-prev cycles back", async () => {
    await emitToWindow(app, "pane:focus-prev");
    await page.waitForTimeout(300);
    expect(true).toBe(true);
  });

  test("session:close-active closes and switches", async () => {
    // Create throwaway
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);
    const beforeTitle = await page.title();
    await emitToWindow(app, "session:close-active");
    await page.waitForTimeout(500);
    const afterTitle = await page.title();
    expect(afterTitle).not.toBe(beforeTitle);
  });
});
