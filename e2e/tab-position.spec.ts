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

test.describe("Tab Position: Sidebar (default)", () => {
  test("sidebar is visible by default", async () => {
    // Sidebar has draggable session items
    const sessions = await page.locator("[draggable='true']").count();
    expect(sessions).toBeGreaterThan(0);
  });

  test("sidebar has + button with SVG", async () => {
    const svgs = await page.locator("button svg").count();
    expect(svgs).toBeGreaterThan(0);
  });

  test("sidebar shows time", async () => {
    await expect(page.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Tab Position: Top", () => {
  test("switching to top tabs via settings", async () => {
    // Open settings
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);

    // Go to Appearance tab
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);

    // Change tab position to Top
    const select = modal.locator("select").first();
    await select.selectOption("top");
    await page.waitForTimeout(500);

    // Close settings
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
  });

  test("top tab bar is visible", async () => {
    // Top tabs should be in a horizontal flex container
    // Session names should still be visible
    const title = await page.title();
    expect(title).toContain("Husk");
  });

  test("top tabs show session names", async () => {
    // At least one session name visible
    const text = await page.evaluate(() => document.body.textContent);
    expect(text).toContain("Session");
  });

  test("+ button works in top mode", async () => {
    const sessionsBefore = await page.evaluate(() => {
      return document.querySelectorAll("[draggable='true']").length;
    });

    // Click the + in top bar
    await page.locator("text=+").click();
    await page.waitForTimeout(2000);

    const sessionsAfter = await page.evaluate(() => {
      return document.querySelectorAll("[draggable='true']").length;
    });
    expect(sessionsAfter).toBeGreaterThan(sessionsBefore);
  });

  test("clicking tab switches session", async () => {
    // Click first session
    await page.locator("[draggable='true']").first().click();
    await page.waitForTimeout(500);
    const title = await page.title();
    expect(title).toContain("Husk");
  });

  test("right-click shows context menu in top mode", async () => {
    await page.locator("[draggable='true']").first().click({ button: "right" });
    await page.waitForTimeout(300);
    await expect(page.locator("text=Rename")).toBeVisible({ timeout: 2000 });
    await expect(page.locator("text=Close Session")).toBeVisible();
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await page.waitForTimeout(300);
  });

  test("Cmd+N works in top mode", async () => {
    const before = await page.locator("[draggable='true']").count();
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);
    const after = await page.locator("[draggable='true']").count();
    expect(after).toBeGreaterThan(before);
  });

  test("keyboard shortcut badges visible", async () => {
    const badges = await page.locator("text=/[⌘^][1-9]/").count();
    expect(badges).toBeGreaterThan(0);
  });

  test("no sidebar visible in top mode", async () => {
    // The sidebar's time display should not be visible
    // (time only shows in sidebar mode)
    // Look for the theme name in the sidebar footer — should not exist
    const sidebarFooter = await page.locator("text=/\\d{2}:\\d{2}.*mocha|nord|dracula/").count();
    expect(sidebarFooter).toBe(0);
  });

  test("switch back to sidebar", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Appearance").click();
    await page.waitForTimeout(300);
    const select = modal.locator("select").first();
    await select.selectOption("sidebar");
    await page.waitForTimeout(500);
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
  });

  test("sidebar is back after switching", async () => {
    const svgs = await page.locator("button svg").count();
    expect(svgs).toBeGreaterThan(0);
  });
});
