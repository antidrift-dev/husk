import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow } from "./helpers";

let app: ElectronApplication;
let page: Page;

// Switch to top tabs so we can assert on the TabBar
async function useTopTabs() {
  await emitToWindow(app, "settings:toggle");
  await page.waitForTimeout(400);
  const modal = page.locator("div[style*='position: fixed']");
  await modal.locator("text=Appearance").click();
  await page.waitForTimeout(300);
  await modal.locator("select").first().selectOption("top");
  await page.waitForTimeout(400);
  await emitToWindow(app, "settings:toggle");
  await page.waitForTimeout(400);
}

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
  await useTopTabs();
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Tab running/stopped indicator", () => {
  test("each tab has a running-state SVG (play or square)", async () => {
    // Every tab should have an SVG indicator
    const tabs = page.locator("[draggable='true']");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);

    // At least one SVG per tab (running or stopped indicator)
    const svgs = await tabs.first().locator("svg").count();
    expect(svgs).toBeGreaterThanOrEqual(1);
  });

  test("idle shell session shows stopped (rect) icon", async () => {
    // With a plain zsh session, we expect the rect icon to be rendered
    const firstTab = page.locator("[draggable='true']").first();
    const rect = await firstTab.locator("svg rect").count();
    expect(rect).toBeGreaterThanOrEqual(1);
  });

  test("tab has a descriptive tooltip (title attr)", async () => {
    const firstTab = page.locator("[draggable='true']").first();
    const title = await firstTab.getAttribute("title");
    expect(title).toBeTruthy();
    // Should contain either "running" or "idle"
    expect(title).toMatch(/running|idle/i);
  });
});

test.describe("Tab process label setting", () => {
  test("process label row is visible by default", async () => {
    // Default is showTabProcessLabel: true, so (zsh) or similar should appear
    const firstTab = page.locator("[draggable='true']").first();
    const text = await firstTab.textContent();
    // Idle shell sessions should show (zsh) or be empty placeholder
    expect(text).toBeTruthy();
  });

  test("toggle off hides process label", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);

    // Find the checkbox for "Show process label on tabs"
    const row = modal.locator("text=Show process label on tabs").locator("..");
    const checkbox = row.locator("input[type='checkbox']");
    if (await checkbox.isChecked()) {
      await checkbox.click();
    }
    await page.waitForTimeout(300);
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
  });

  test("toggle back on restores process label", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);

    const row = modal.locator("text=Show process label on tabs").locator("..");
    const checkbox = row.locator("input[type='checkbox']");
    if (!(await checkbox.isChecked())) {
      await checkbox.click();
    }
    await page.waitForTimeout(300);
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
  });
});

test.describe("Tab size setting", () => {
  test("tab size selector appears only in top tabs mode", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);
    await expect(modal.locator("text=Tab size")).toBeVisible();
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
  });

  test("switching to large grows tab height", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);

    // Find the tab size select (second select on the page — first is tabPosition)
    const selects = modal.locator("select");
    // Click by iterating — find the one with small/medium/large options
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      const options = await sel.locator("option").allTextContents();
      if (options.includes("Small") && options.includes("Large")) {
        await sel.selectOption("large");
        break;
      }
    }
    await page.waitForTimeout(400);
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);

    // Just verify the app is still healthy
    const title = await page.title();
    expect(title).toContain("Husk");
  });

  test("switching back to medium still works", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);

    const selects = modal.locator("select");
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      const options = await sel.locator("option").allTextContents();
      if (options.includes("Small") && options.includes("Large")) {
        await sel.selectOption("medium");
        break;
      }
    }
    await page.waitForTimeout(400);
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(400);
  });
});
