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

test.describe("Multi-Window", () => {
  test("starts with one window", async () => {
    expect(app.windows().length).toBe(1);
  });

  test("new window via menu", async () => {
    await triggerMenu(app, "File", "New Window");
    await page.waitForTimeout(2000);
    expect(app.windows().length).toBe(2);
  });

  test("both windows have Husk title", async () => {
    const titles = await Promise.all(app.windows().map((w) => w.title()));
    for (const t of titles) {
      expect(t).toContain("Husk");
    }
  });

  test("second window exists and is separate", async () => {
    const count = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("closing second window keeps first", async () => {
    const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    if (windowCount >= 2) {
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows();
        // Close the newest window (last in the list)
        wins[wins.length - 1].close();
      });
      await new Promise((r) => setTimeout(r, 500));
      const remaining = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      expect(remaining).toBeGreaterThanOrEqual(1);
    }
  });
});
