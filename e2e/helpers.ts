import { _electron as electron, ElectronApplication, Page } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const HUSK_DIR = path.join(os.homedir(), ".husk");

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });

  // Pre-seed settings to skip onboarding
  fs.mkdirSync(HUSK_DIR, { recursive: true });
  fs.writeFileSync(path.join(HUSK_DIR, "settings.json"), JSON.stringify({ _onboardingDone: true }));

  const app = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main", "main.js")],
    env: { ...process.env, NODE_ENV: "test", HUSK_TEST: "1" },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  return { app, page };
}

export async function closeApp(app: ElectronApplication) {
  await app.close();
  if (fs.existsSync(HUSK_DIR)) fs.rmSync(HUSK_DIR, { recursive: true, force: true });
}

// Trigger IPC events directly — bypasses keyboard shortcut issues
export async function sendToRenderer(page: Page, channel: string, ...args: any[]) {
  await page.evaluate(({ channel, args }) => {
    (window as any).husk._ipcTrigger?.(channel, ...args);
  }, { channel, args });
}

// Use Electron menu to trigger actions reliably
export async function triggerMenu(app: ElectronApplication, menuLabel: string, itemLabel: string) {
  await app.evaluate(async ({ Menu, BrowserWindow }, { menuLabel, itemLabel }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    const topItem = menu.items.find((i) => i.label === menuLabel);
    if (!topItem?.submenu) return;
    const item = topItem.submenu.items.find((i) => i.label === itemLabel);
    if (item?.click) {
      // Menu click handlers use getFocusedWindow — force focus first
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.focus();
      item.click(item as any, win, {} as any);
    }
  }, { menuLabel, itemLabel });
}

// Send IPC from main to renderer (simulates menu shortcut)
export async function emitToWindow(app: ElectronApplication, channel: string, ...args: any[]) {
  await app.evaluate(async ({ BrowserWindow }, { channel, args }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send(channel, ...args);
  }, { channel, args });
}
