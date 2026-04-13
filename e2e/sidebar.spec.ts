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

test.describe("Sidebar", () => {
  test("shows first session", async () => {
    await expect(page.locator("text=Session 1")).toBeVisible();
  });

  test("has + button with SVG icon", async () => {
    const svgs = await page.locator("button svg").count();
    expect(svgs).toBeGreaterThan(0);
  });

  test("+ button has tooltip with shortcut", async () => {
    const btn = page.locator("button[title*='New Session']");
    await expect(btn).toBeVisible();
    const title = await btn.getAttribute("title");
    expect(title).toMatch(/[⌘^]/);
  });

  test("shows keyboard shortcut badge", async () => {
    await expect(page.locator("text=/[⌘^]1/")).toBeVisible({ timeout: 3000 });
  });

  test("clicking + creates session", async () => {
    await page.locator("button[title*='New Session']").click();
    await page.waitForTimeout(2000);
    await expect(page.locator("text=Session 2")).toBeVisible();
  });

  test("clicking session switches to it", async () => {
    await page.locator("text=Session 1").click();
    await page.waitForTimeout(500);
    expect(await page.title()).toContain("Session 1");
  });

  test("right-click shows context menu", async () => {
    const session = page.locator("[draggable='true']").first();
    await session.click({ button: "right" });
    await page.waitForTimeout(300);
    await expect(page.locator("text=Rename")).toBeVisible({ timeout: 2000 });
    await expect(page.locator("text=Close Session")).toBeVisible();
    // Dismiss
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await page.waitForTimeout(300);
  });

  test("rename from context menu", async () => {
    const session = page.locator("[draggable='true']").first();
    await session.click({ button: "right" });
    await page.waitForTimeout(300);
    await page.locator("text=Rename").click();
    await page.waitForTimeout(500);

    const input = page.locator("input").first();
    if (await input.isVisible()) {
      await input.fill("TestRename");
      await input.press("Enter");
      await page.waitForTimeout(500);
      await expect(page.locator("text=TestRename")).toBeVisible();
    }
  });

  test("sessions are draggable", async () => {
    const sessions = page.locator("[draggable='true']");
    const count = await sessions.count();
    expect(count).toBeGreaterThanOrEqual(2);
    // Verify draggable attribute
    const draggable = await sessions.first().getAttribute("draggable");
    expect(draggable).toBe("true");
  });

  test("shows time in footer", async () => {
    await expect(page.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible();
  });

  test("shows theme in footer", async () => {
    await expect(
      page.locator("text=mocha").or(page.locator("text=nord")).or(page.locator("text=dracula")).or(page.locator("text=latte"))
    ).toBeVisible();
  });

  test("close from context menu removes session", async () => {
    // Create a throwaway
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);

    const countBefore = await page.locator("[draggable='true']").count();

    // Right-click the last session
    const sessions = page.locator("[draggable='true']");
    await sessions.last().click({ button: "right" });
    await page.waitForTimeout(300);
    await page.locator("text=Close Session").click();
    await page.waitForTimeout(500);

    const countAfter = await page.locator("[draggable='true']").count();
    expect(countAfter).toBe(countBefore - 1);
  });
});
