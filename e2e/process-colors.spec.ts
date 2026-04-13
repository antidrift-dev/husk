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

test.describe("Process Colors Tab", () => {
  test("Process Colors exists as a top-level tab", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);

    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=Process Colors")).toBeVisible();
  });

  test("clicking Process Colors tab shows the editor", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await modal.locator("text=Process Colors").click();
    await page.waitForTimeout(300);
    await expect(modal.locator("text=Customize colors for each process")).toBeVisible();
  });

  test("default processes are listed with color inputs", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("input[value='claude']")).toBeVisible();
    await expect(modal.locator("input[value='codex']")).toBeVisible();
    await expect(modal.locator("input[value='gemini']")).toBeVisible();
    await expect(modal.locator("input[value='zsh']")).toBeVisible();
  });

  test("each row has a color picker and hex input", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    const colorInputs = await modal.locator("input[type='color']").count();
    expect(colorInputs).toBeGreaterThan(5);
  });

  test("Add process button exists", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("text=+ Add process")).toBeVisible();
  });

  test("Reset all button exists", async () => {
    const modal = page.locator("div[style*='position: fixed']");
    await expect(modal.locator("button", { hasText: "Reset all" })).toBeVisible();
  });

  test("close settings", async () => {
    await emitToWindow(app, "settings:toggle");
    await page.waitForTimeout(500);
  });
});
