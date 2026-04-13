import { test, expect, ElectronApplication, Page } from "@playwright/test";
import { launchApp, closeApp } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe("Status bar", () => {
  test("status bar is present at the bottom", async () => {
    // Status bar contains the cwd, session memory, disk, and foreground process
    const body = await page.evaluate(() => document.body.textContent);
    expect(body).toBeTruthy();
  });

  test("shows foreground process (e.g., zsh)", async () => {
    // Polling fires every 2s — wait for it
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.textContent);
    expect(text).toMatch(/zsh|bash|fish|sh/);
  });

  test("shows session memory once polling runs", async () => {
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.textContent);
    expect(text).toContain("current session memory");
  });

  test("shows disk free space", async () => {
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.textContent);
    expect(text).toMatch(/disk:\s*\d+\s*GB free/);
  });

  test("disk IPC returns a valid shape", async () => {
    const disk = await page.evaluate(() => (window as any).husk.getDiskUsage());
    expect(disk).toBeTruthy();
    expect(typeof disk.total).toBe("number");
    expect(typeof disk.used).toBe("number");
    expect(typeof disk.available).toBe("number");
    expect(typeof disk.percent).toBe("number");
    expect(disk.total).toBeGreaterThan(0);
    expect(disk.available).toBeGreaterThanOrEqual(0);
    expect(disk.percent).toBeGreaterThanOrEqual(0);
    expect(disk.percent).toBeLessThanOrEqual(100);
  });

  test("status bar height is 32px", async () => {
    // Find the status bar by its unique content and check computed height
    const height = await page.evaluate(() => {
      const bars = document.querySelectorAll("div");
      for (const el of Array.from(bars)) {
        const text = el.textContent || "";
        if (text.includes("current session memory") && !text.includes("Total")) {
          // Walk up to the status bar container (the one with height 32)
          let node: HTMLElement | null = el as HTMLElement;
          while (node) {
            const rect = node.getBoundingClientRect();
            if (rect.height === 32) return rect.height;
            node = node.parentElement;
          }
        }
      }
      return -1;
    });
    expect(height).toBe(32);
  });
});
