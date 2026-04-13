import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("App Launch", () => {
  test("window opens", async () => {
    expect(app.windows().length).toBeGreaterThanOrEqual(1);
  });

  test("window has Husk in title", async () => {
    const title = await page.title();
    expect(title).toContain("Husk");
  });

  test("window has version in title", async () => {
    const title = await page.title();
    expect(title).toContain("v0.1.0");
  });

  test("window has reasonable size", async () => {
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.getBounds();
    });
    expect(bounds.width).toBeGreaterThan(400);
    expect(bounds.height).toBeGreaterThan(300);
  });

  test("sidebar exists", async () => {
    const svgs = await page.locator("svg").count();
    expect(svgs).toBeGreaterThan(0); // + button SVG
  });

  test("auto-creates first session", async () => {
    const title = await page.title();
    expect(title).toContain("Session");
  });

  test("status bar shows process info", async () => {
    await expect(
      page.locator("text=/current session memory/")
    ).toBeVisible({ timeout: 5000 });
  });

  test("time is displayed in sidebar", async () => {
    await expect(page.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible({ timeout: 3000 });
  });

  test("theme name is displayed in sidebar", async () => {
    await expect(
      page.locator("text=mocha").or(page.locator("text=nord")).or(page.locator("text=dracula")).or(page.locator("text=latte"))
    ).toBeVisible({ timeout: 3000 });
  });
});
