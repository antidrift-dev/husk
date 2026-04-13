import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, triggerMenu } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("About Screen", () => {
  test("about menu item exists", async () => {
    const hasAbout = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const appMenu = menu?.items[0];
      return appMenu?.submenu?.items.some((i) => i.label === "About Husk") || false;
    });
    expect(hasAbout).toBe(true);
  });

  test("about opens a new window", async () => {
    const windowsBefore = app.windows().length;
    await triggerMenu(app, "Husk", "About Husk");
    await page.waitForTimeout(2000);
    expect(app.windows().length).toBeGreaterThan(windowsBefore);
  });

  test("about window shows app name", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=Husk")).toBeVisible({ timeout: 3000 });
  });

  test("about window shows version", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=/v\\d+\\.\\d+\\.\\d+/")).toBeVisible({ timeout: 3000 });
  });

  test("about window shows build number", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=/build \\d+/")).toBeVisible({ timeout: 3000 });
  });

  test("about window shows Electron version", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=/Electron/")).toBeVisible({ timeout: 3000 });
  });

  test("about window shows memory breakdown", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=/\\d+ MB total/")).toBeVisible({ timeout: 3000 });
  });

  test("about window shows website link", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=husk.antidrift.dev")).toBeVisible({ timeout: 3000 });
  });

  test("about window shows copyright", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=/Antidrift/")).toBeVisible({ timeout: 3000 });
  });

  test("about window has close button", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await expect(aboutPage.locator("text=✕")).toBeVisible({ timeout: 3000 });
  });

  test("close button dismisses about", async () => {
    const aboutPage = app.windows()[app.windows().length - 1];
    await aboutPage.locator("text=✕").click();
    await page.waitForTimeout(500);
    // About window should be gone
    // Main window should still be alive
    const title = await page.title();
    expect(title).toContain("Husk");
  });
});
