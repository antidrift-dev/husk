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

// Helper to find settings tab by text within the settings modal
function settingsTab(page: Page, name: string) {
  // Settings modal is the overlay div — tabs are inside it
  return page.locator(`div[style*="position: fixed"] >> text="${name}"`).first();
}

test.describe("Settings", () => {
  test("settings opens via IPC", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
    await expect(page.locator("text=Settings").first()).toBeVisible({ timeout: 3000 });
  });

  test("has Appearance tab", async () => {
    await expect(settingsTab(page, "Appearance")).toBeVisible();
  });

  test("has Terminal tab", async () => {
    await expect(settingsTab(page, "Terminal")).toBeVisible();
  });

  test("has Features tab", async () => {
    await expect(settingsTab(page, "Features")).toBeVisible();
  });

  test("Appearance shows theme picker", async () => {
    await settingsTab(page, "Appearance").click();
    await page.waitForTimeout(300);
    // Theme names inside the modal
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=Mocha")).toBeVisible();
    await expect(modal.locator("text=Nord")).toBeVisible();
  });

  test("Appearance shows font size", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=Font size")).toBeVisible();
  });

  test("Appearance shows ligatures", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=Font ligatures")).toBeVisible();
  });

  test("ligatures has performance warning", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=/slow down/")).toBeVisible();
  });

  test("Terminal tab shows cursor options", async () => {
    await settingsTab(page, "Terminal").click();
    await page.waitForTimeout(300);
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=Cursor style")).toBeVisible();
    await expect(modal.locator("text=Cursor blink")).toBeVisible();
    await expect(modal.locator("text=Scrollback lines")).toBeVisible();
  });

  test("cursor style dropdown has three options", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    const select = modal.locator("select").first();
    const options = await select.locator("option").count();
    expect(options).toBe(3);
  });

  test("Features tab shows quake and images", async () => {
    await settingsTab(page, "Features").click();
    await page.waitForTimeout(300);
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=Quake mode")).toBeVisible();
    await expect(modal.locator("text=Inline images")).toBeVisible();
  });

  test("inline images has Sixel note", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=/Sixel/")).toBeVisible();
  });

  test("changing setting shows Saved", async () => {
    await settingsTab(page, "Appearance").click();
    await page.waitForTimeout(300);
    const modal = page.locator("div[style*='position: fixed']");
    const checkbox = modal.locator("input[type='checkbox']").first();
    await checkbox.click();
    await page.waitForTimeout(500);
    await expect(modal.locator("text=Saved")).toBeVisible({ timeout: 2000 });
  });

  test("clicking theme doesn't crash", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Nord").click();
    await page.waitForTimeout(500);
    expect(true).toBe(true);
  });

  test("close settings with X", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=✕").click();
    await page.waitForTimeout(300);
    const visible = await page.locator("div[style*='position: fixed'] >> text=Font size").isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test("settings toggles open and closed", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
    await expect(page.locator("text=Settings").first()).toBeVisible();
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
    const visible = await page.locator("div[style*='position: fixed'] >> text=Font size").isVisible().catch(() => false);
    expect(visible).toBe(false);
  });
});
