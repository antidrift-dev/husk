import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const MAIN_JS = path.join(__dirname, "..", "dist", "main", "main.js");
const HUSK_DIR = path.join(os.homedir(), ".husk");
const SETTINGS_FILE = path.join(HUSK_DIR, "settings.json");

function cleanHusk() {
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
}

test.describe("Onboarding", () => {
  test.beforeEach(() => cleanHusk());
  test.afterEach(() => cleanHusk());

  test("shows on first launch", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    await expect(page.locator("text=Welcome to Husk")).toBeVisible({ timeout: 3000 });
    await app.close();
  });

  test("has 3 steps", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Step 1
    await expect(page.locator("text=Welcome to Husk")).toBeVisible();

    // 3 dots visible
    const dots = await page.evaluate(() => {
      return document.querySelectorAll("div[style*='border-radius: 50%']").length;
    });
    expect(dots).toBe(3);

    await app.close();
  });

  test("Next button advances steps", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Step 1
    await expect(page.locator("text=Welcome to Husk")).toBeVisible();

    // Click Next
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(300);

    // Step 2
    await expect(page.locator("text=Split & Navigate")).toBeVisible();

    // Click Next
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(300);

    // Step 3
    await expect(page.locator("text=Make it yours")).toBeVisible();

    await app.close();
  });

  test("Back button goes to previous step", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Go to step 2
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("text=Split & Navigate")).toBeVisible();

    // Go back
    await page.locator("button", { hasText: "Back" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("text=Welcome to Husk")).toBeVisible();

    await app.close();
  });

  test("no Back button on first step", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    const backVisible = await page.locator("button", { hasText: "Back" }).isVisible().catch(() => false);
    expect(backVisible).toBe(false);

    await app.close();
  });

  test("Get Started button on last step", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Go to step 3
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);

    await expect(page.locator("button", { hasText: "Get Started" })).toBeVisible();

    await app.close();
  });

  test("Get Started dismisses onboarding", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Click through to end
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "Get Started" }).click();
    await page.waitForTimeout(500);

    // Onboarding should be gone
    const visible = await page.locator("text=Welcome to Husk").isVisible().catch(() => false);
    expect(visible).toBe(false);

    await app.close();
  });

  test("persists onboarding done flag", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Dismiss onboarding
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "Get Started" }).click();
    await page.waitForTimeout(1000);

    // Settings file should have the flag
    expect(fs.existsSync(SETTINGS_FILE)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    expect(settings._onboardingDone).toBe(true);

    await app.close();
  });

  test("doesn't show on second launch", async () => {
    // First launch — dismiss onboarding
    const app1 = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page1 = await app1.firstWindow();
    await page1.waitForTimeout(2000);
    await page1.locator("button", { hasText: "Next" }).click();
    await page1.waitForTimeout(200);
    await page1.locator("button", { hasText: "Next" }).click();
    await page1.waitForTimeout(200);
    await page1.locator("button", { hasText: "Get Started" }).click();
    await page1.waitForTimeout(500);
    await app1.close();
    await new Promise((r) => setTimeout(r, 1000));

    // Second launch — should NOT show onboarding
    const app2 = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page2 = await app2.firstWindow();
    await page2.waitForTimeout(2000);

    const visible = await page2.locator("text=Welcome to Husk").isVisible().catch(() => false);
    expect(visible).toBe(false);

    await app2.close();
  });

  test("shows keyboard shortcuts", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    // Step 1 should show session shortcuts
    await expect(page.locator("text=New session")).toBeVisible();
    await expect(page.locator("text=Close session")).toBeVisible();
    await expect(page.locator("text=Switch sessions")).toBeVisible();

    await app.close();
  });

  test("shows split shortcuts on step 2", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(300);

    await expect(page.locator("text=Split right")).toBeVisible();
    await expect(page.locator("text=Split down")).toBeVisible();

    await app.close();
  });

  test("shows customization on step 3", async () => {
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, HUSK_TEST: "1" } });
    const page = await app.firstWindow();
    await page.waitForTimeout(2000);

    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "Next" }).click();
    await page.waitForTimeout(300);

    await expect(page.locator("text=19 themes")).toBeVisible();
    await expect(page.locator("text=Profiles")).toBeVisible();
    await expect(page.locator("text=Quake mode")).toBeVisible();

    await app.close();
  });
});
