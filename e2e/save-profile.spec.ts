import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow } from "./helpers";
import fs from "fs";
import path from "path";
import os from "os";

let app: ElectronApplication;
let page: Page;

const PROFILES_DIR = path.join(os.homedir(), ".husk", "profiles");

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Save Profile modal", () => {
  test("triggering save profile opens a modal (not window.prompt)", async () => {
    await emitToWindow(app, "profile:save-prompt");
    await page.waitForTimeout(500);
    // Modal should be visible
    await expect(page.locator("text=Save as Profile")).toBeVisible({ timeout: 2000 });
  });

  test("modal has input, Cancel, and Save buttons", async () => {
    await expect(page.locator("input[placeholder='Profile name']")).toBeVisible();
    await expect(page.locator("button", { hasText: "Cancel" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Save" })).toBeVisible();
  });

  test("Save button is disabled when name is empty", async () => {
    const saveButton = page.locator("button", { hasText: "Save" });
    // Confirm cursor style or disabled state
    const isDisabled = await saveButton.evaluate((el) => (el as HTMLButtonElement).disabled);
    expect(isDisabled).toBe(true);
  });

  test("typing a name enables Save", async () => {
    await page.locator("input[placeholder='Profile name']").fill("test-profile");
    await page.waitForTimeout(200);
    const saveButton = page.locator("button", { hasText: "Save" });
    const isDisabled = await saveButton.evaluate((el) => (el as HTMLButtonElement).disabled);
    expect(isDisabled).toBe(false);
  });

  test("Save button persists the profile to disk", async () => {
    await page.locator("button", { hasText: "Save" }).click();
    await page.waitForTimeout(800);

    // Modal should close
    await expect(page.locator("text=Save as Profile")).not.toBeVisible({ timeout: 2000 });

    // Profile file should exist
    const files = fs.existsSync(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR) : [];
    expect(files.some((f) => f.startsWith("test-profile"))).toBe(true);
  });

  test("Escape dismisses the modal", async () => {
    await emitToWindow(app, "profile:save-prompt");
    await page.waitForTimeout(400);
    await expect(page.locator("text=Save as Profile")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(page.locator("text=Save as Profile")).not.toBeVisible({ timeout: 2000 });
  });

  test("Cancel button dismisses the modal", async () => {
    await emitToWindow(app, "profile:save-prompt");
    await page.waitForTimeout(400);
    await expect(page.locator("text=Save as Profile")).toBeVisible();
    await page.locator("button", { hasText: "Cancel" }).click();
    await page.waitForTimeout(400);
    await expect(page.locator("text=Save as Profile")).not.toBeVisible({ timeout: 2000 });
  });
});
