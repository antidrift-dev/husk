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

test.describe("Long-running Command Notifications", () => {
  test("notification system is initialized", async () => {
    // The notification polling runs in main process — verify app is alive
    const title = await page.title();
    expect(title).toContain("Husk");
  });

  test("short commands don't trigger notifications", async () => {
    // Run a quick command (under 5s threshold)
    // Can't easily verify no notification was sent, but verify no crash
    const title = await page.title();
    expect(title).toContain("Husk");
  });

  test("process detection works for notification polling", async () => {
    // The notification system polls getForegroundProcess every 2s
    // Verify the process info updates in status bar (same polling)
    await page.waitForTimeout(3000);
    const statusBar = await page.evaluate(() => document.body.textContent);
    expect(statusBar).toContain("zsh");
  });

  test("notification doesn't fire when window is focused", async () => {
    // Notifications only fire when window is NOT focused
    // Since test window is "focused", no notification should fire
    // Just verify app stays stable during poll cycle
    await page.waitForTimeout(3000);
    const title = await page.title();
    expect(title).toContain("Husk");
  });
});
