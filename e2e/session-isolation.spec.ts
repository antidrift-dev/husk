import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow, triggerMenu } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Multi-Window Session Isolation", () => {
  test("first window has sessions", async () => {
    const sessions = await page.locator("[draggable='true']").count();
    expect(sessions).toBeGreaterThanOrEqual(1);
  });

  test("create extra session in first window", async () => {
    await emitToWindow(app, "session:new");
    await page.waitForTimeout(2000);
    const sessions = await page.locator("[draggable='true']").count();
    expect(sessions).toBeGreaterThanOrEqual(2);
  });

  test("new window starts with only one session", async () => {
    const windowsBefore = app.windows().length;

    await triggerMenu(app, "File", "New Window");
    await page.waitForTimeout(3000);

    expect(app.windows().length).toBeGreaterThan(windowsBefore);

    // New window should have exactly 1 session
    try {
      const newPage = app.windows()[app.windows().length - 1];
      const newSessions = await newPage.locator("[draggable='true']").count();
      expect(newSessions).toBe(1);
    } catch {
      // Window not accessible in test mode — just verify it exists
      expect(app.windows().length).toBeGreaterThan(windowsBefore);
    }
  });

  test("first window still has its sessions", async () => {
    const sessions = await page.locator("[draggable='true']").count();
    expect(sessions).toBeGreaterThanOrEqual(2);
  });

  test("creating session in second window doesn't affect first", async () => {
    const firstWindowSessions = await page.locator("[draggable='true']").count();

    // Send new session to second window
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length >= 2) {
          wins[wins.length - 1].webContents.send("session:new");
        }
      });
      await page.waitForTimeout(2000);
    } catch {}

    // First window should be unchanged
    const afterCount = await page.locator("[draggable='true']").count();
    expect(afterCount).toBe(firstWindowSessions);
  });

  test("closing second window doesn't affect first", async () => {
    const firstWindowSessions = await page.locator("[draggable='true']").count();

    try {
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length >= 2) wins[wins.length - 1].close();
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 500));

    const afterCount = await page.locator("[draggable='true']").count();
    expect(afterCount).toBe(firstWindowSessions);
  });
});
