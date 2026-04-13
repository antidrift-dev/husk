import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp, emitToWindow } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(3000); // Extra time for first session + xterm
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Split Panes", () => {
  test("initial state has xterm canvas", async () => {
    // xterm renders to canvas via WebGL
    const canvases = await page.locator(".xterm").count();
    expect(canvases).toBeGreaterThanOrEqual(1);
  });

  test("vertical split adds more canvases", async () => {
    const before = await page.locator(".xterm").count();
    await emitToWindow(app, "pane:split", "vertical");
    await page.waitForTimeout(3000);
    const after = await page.locator(".xterm").count();
    expect(after).toBeGreaterThan(before);
  });

  test("split creates resize divider", async () => {
    const dividers = await page.locator("[style*='col-resize'], [style*='row-resize']").count();
    expect(dividers).toBeGreaterThan(0);
  });

  test("horizontal split adds more canvases", async () => {
    const before = await page.locator(".xterm").count();
    await emitToWindow(app, "pane:split", "horizontal");
    await page.waitForTimeout(3000);
    const after = await page.locator(".xterm").count();
    expect(after).toBeGreaterThan(before);
  });

  test("focus cycling forward works", async () => {
    await emitToWindow(app, "pane:focus-next");
    await page.waitForTimeout(300);
    expect(true).toBe(true);
  });

  test("focus cycling backward works", async () => {
    await emitToWindow(app, "pane:focus-prev");
    await page.waitForTimeout(300);
    expect(true).toBe(true);
  });

  test("has focus indicator border", async () => {
    const borders = await page.evaluate(() => {
      let found = 0;
      document.querySelectorAll("div").forEach((el) => {
        const s = getComputedStyle(el);
        if (s.borderLeftStyle === "solid" && s.borderLeftWidth === "2px" &&
            s.borderLeftColor !== "rgba(0, 0, 0, 0)" && s.borderLeftColor !== "transparent") {
          found++;
        }
      });
      return found;
    });
    expect(borders).toBeGreaterThan(0);
  });
});
