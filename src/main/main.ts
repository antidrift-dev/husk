import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "path";
import os from "os";
import fs from "fs";
import { SessionManager } from "./sessions";

// Track all windows and their session managers
const windows = new Map<number, { win: BrowserWindow; sessions: SessionManager; ptyListeners: Set<string>; subPtyListeners: Set<string>; ptyBuffers: Map<string, string>; flushTimer: ReturnType<typeof setTimeout> | null }>();

function getWindowContext(webContentsId: number) {
  for (const ctx of windows.values()) {
    if (ctx.win.webContents.id === webContentsId) return ctx;
  }
  return null;
}

const bufferDir = path.join(os.homedir(), ".husk", "buffers");
if (!fs.existsSync(bufferDir)) fs.mkdirSync(bufferDir, { recursive: true });
const settingsFile = path.join(os.homedir(), ".husk", "settings.json");

function createWindow() {
  const sessions = new SessionManager();
  sessions.loadUiState();
  const bounds = sessions.getWindowBounds();
  const offset = (windows.size) * 24;

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: (bounds.x || 100) + offset,
    y: (bounds.y || 100) + offset,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#11111b",
  });

  const ctx = {
    win,
    sessions,
    ptyListeners: new Set<string>(),
    subPtyListeners: new Set<string>(),
    ptyBuffers: new Map<string, string>(),
    flushTimer: null as ReturnType<typeof setTimeout> | null,
  };
  windows.set(win.id, ctx);

  const saveBounds = () => {
    if (!win.isDestroyed() && !win.isFullScreen()) {
      sessions.saveWindowBounds(win.getBounds());
    }
  };
  win.on("resized", saveBounds);
  win.on("moved", saveBounds);

  if (process.env.VITE_DEV_SERVER) {
    win.loadURL(process.env.VITE_DEV_SERVER);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  const flushPtyBuffers = () => {
    ctx.flushTimer = null;
    if (win.isDestroyed()) return;
    for (const [id, data] of ctx.ptyBuffers) {
      win.webContents.send("pty:output", id, data);
    }
    ctx.ptyBuffers.clear();
  };

  const setupPtyListener = (sessionId: string) => {
    if (ctx.ptyListeners.has(sessionId)) return;
    const session = sessions.getSession(sessionId);
    if (!session) return;
    ctx.ptyListeners.add(sessionId);
    session.pty.onData((data: string) => {
      const existing = ctx.ptyBuffers.get(sessionId);
      ctx.ptyBuffers.set(sessionId, existing ? existing + data : data);
      if (!ctx.flushTimer) {
        ctx.flushTimer = setTimeout(flushPtyBuffers, 16);
      }
    });
  };

  sessions.onExit = (id: string) => {
    if (!win.isDestroyed()) win.webContents.send("session:exited", id);
  };

  sessions.onSubPtyExit = (id: string) => {
    if (!win.isDestroyed()) win.webContents.send("session:sub-exited", id);
  };

  // Intercept shortcuts before xterm swallows them
  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "Escape" && win.isFullScreen()) {
      win.setFullScreen(false);
    }
    if (input.meta && !input.shift && !input.alt && /^[1-9]$/.test(input.key)) {
      e.preventDefault();
      win.webContents.send("session:switch-index", parseInt(input.key, 10) - 1);
    }
    if (input.meta && !input.shift && !input.alt && input.key === ",") {
      e.preventDefault();
      win.webContents.send("settings:toggle");
    }
    if (input.meta && !input.shift && !input.alt && input.key === "f") {
      e.preventDefault();
      win.webContents.send("terminal:search");
    }
  });

  win.on("closed", () => {
    sessions.destroyAll();
    windows.delete(win.id);
  });

  // Store setupPtyListener for IPC access
  (ctx as any).setupPtyListener = setupPtyListener;

  return ctx;
}

// ---- IPC Handlers (registered once, route by sender) ----

ipcMain.handle("session:create", (e, label: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return null;
  const session = ctx.sessions.create(label);
  (ctx as any).setupPtyListener(session.id);
  ctx.win.webContents.send("session:created", session.id);
  return { id: session.id, label: session.label };
});

ipcMain.handle("session:restore", (e) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return { sessions: [], activeIndex: -1, sidebarWidth: 120, themeId: "mocha", use24h: true };
  const result = ctx.sessions.restore();
  for (const s of result.sessions) {
    (ctx as any).setupPtyListener(s.id);
    ctx.win.webContents.send("session:created", s.id);
  }
  return result;
});

ipcMain.handle("session:close", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (ctx) {
    ctx.sessions.close(id);
    try { fs.unlinkSync(path.join(bufferDir, `${id}.txt`)); } catch {}
  }
});

ipcMain.on("session:input", (e, id: string, data: string) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.write(id, data);
});

ipcMain.handle("session:resize", (e, id: string, cols: number, rows: number) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.resize(id, cols, rows);
});

ipcMain.handle("session:switch", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  return ctx?.sessions.switch(id) || null;
});

ipcMain.handle("session:rename", (e, id: string, label: string) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.rename(id, label);
});

ipcMain.handle("session:cwd", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  return ctx?.sessions.getCwd(id) || null;
});

ipcMain.handle("session:foreground", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  return ctx?.sessions.getForegroundProcess(id) || null;
});

ipcMain.handle("session:memory", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  return ctx?.sessions.getSessionMemory(id) || null;
});

ipcMain.handle("session:create-sub", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return false;
  const subPty = ctx.sessions.createSubPty(id);
  if (!subPty) return false;
  if (!ctx.subPtyListeners.has(id)) {
    ctx.subPtyListeners.add(id);
    subPty.onData((data: string) => {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send("pty:sub-output", id, data);
    });
  }
  return true;
});

ipcMain.handle("session:close-sub", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (ctx) {
    ctx.sessions.closeSubPty(id);
    ctx.subPtyListeners.delete(id);
  }
});

ipcMain.on("session:input-sub", (e, id: string, data: string) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.writeSubPty(id, data);
});

ipcMain.handle("session:resize-sub", (e, id: string, cols: number, rows: number) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.resizeSubPty(id, cols, rows);
});

ipcMain.handle("ui:save-sidebar-width", (e, width: number) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.saveSidebarWidth(width);
});

ipcMain.handle("ui:save-use24h", (e, val: boolean) => {
  const ctx = getWindowContext(e.sender.id);
  ctx?.sessions.setUse24h(val);
});

ipcMain.handle("settings:save", (_e, data: string) => {
  try { fs.writeFileSync(settingsFile, data); } catch {}
});

ipcMain.handle("settings:load", () => {
  try { return fs.readFileSync(settingsFile, "utf-8"); } catch { return null; }
});

ipcMain.on("session:save-buffer", (_e, id: string, data: string) => {
  try { fs.writeFileSync(path.join(bufferDir, `${id}.txt`), data); } catch {}
});

ipcMain.handle("session:load-buffer", (_e, id: string) => {
  try { return fs.readFileSync(path.join(bufferDir, `${id}.txt`), "utf-8"); } catch { return null; }
});

// ---- Menu (updates to target focused window) ----

function buildMenu() {
  const getFocusedCtx = () => {
    const focused = BrowserWindow.getFocusedWindow();
    return focused ? windows.get(focused.id) : null;
  };

  const sendToFocused = (channel: string, ...args: any[]) => {
    const ctx = getFocusedCtx();
    if (ctx && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, ...args);
  };

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        {
          label: "About Husk",
          click: () => {
            const ctx = getFocusedCtx();
            if (ctx) showAbout(ctx.win);
          },
        },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => sendToFocused("settings:toggle"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => createWindow(),
        },
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+N",
          click: () => sendToFocused("session:new"),
        },
        {
          label: "Rename Session",
          accelerator: "CmdOrCtrl+R",
          click: () => sendToFocused("session:rename-active"),
        },
        { type: "separator" },
        {
          label: "Split Terminal",
          accelerator: "CmdOrCtrl+D",
          click: () => sendToFocused("session:toggle-sub"),
        },
        { type: "separator" },
        {
          label: "Close Session",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToFocused("session:close-active"),
        },
      ],
    },
    {
      label: "Sessions",
      submenu: Array.from({ length: 9 }, (_, i) => ({
        label: `Session ${i + 1}`,
        accelerator: `CmdOrCtrl+${i + 1}`,
        click: () => sendToFocused("session:switch-index", i),
      })),
    },
    {
      label: "Edit",
      submenu: [
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Theme",
      submenu: [
        { label: "Mocha", type: "radio" as const, click: () => applyThemeToAll("mocha") },
        { label: "Latte", type: "radio" as const, click: () => applyThemeToAll("latte") },
        { label: "Dracula", type: "radio" as const, click: () => applyThemeToAll("dracula") },
        { label: "Nord", type: "radio" as const, click: () => applyThemeToAll("nord") },
      ],
    },
    ...(process.env.VITE_DEV_SERVER ? [{
      label: "Dev",
      submenu: [
        {
          label: "Toggle DevTools",
          accelerator: "CmdOrCtrl+Alt+I",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused) focused.webContents.toggleDevTools();
          },
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused) focused.webContents.reload();
          },
        },
      ],
    }] : []),
  ]);
  Menu.setApplicationMenu(menu);
}

function applyThemeToAll(id: string) {
  for (const ctx of windows.values()) {
    ctx.sessions.setThemeId(id);
    if (!ctx.win.isDestroyed()) ctx.win.webContents.send("theme:change", id);
  }
}

function showAbout(parent: BrowserWindow) {
  const about = new BrowserWindow({
    width: 360,
    height: 400,
    parent,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: "#1e1e2e",
    titleBarStyle: "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const version = app.getVersion();
  const electronVersion = process.versions.electron;
  const nodeVersion = process.versions.node;
  const metrics = app.getAppMetrics();
  const totalMemMB = Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
  const memBreakdown = metrics.map(m => `${m.type}${m.name ? ` (${m.name})` : ""}: ${Math.round(m.memory.workingSetSize / 1024)} MB`).join("<br>");

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: -apple-system, BlinkMacSystemFont, monospace;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
  }
  .logo { font-size: 48px; margin-bottom: 8px; }
  .name { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
  .version { font-size: 13px; color: #7f849c; margin-bottom: 16px; }
  .info { font-size: 11px; color: #7f849c; text-align: center; line-height: 1.6; }
  .close {
    position: absolute; top: 12px; right: 12px;
    background: none; border: none; color: #585b70;
    font-size: 16px; cursor: pointer; -webkit-app-region: no-drag;
  }
  .close:hover { color: #cdd6f4; }
  a { color: #89b4fa; text-decoration: none; -webkit-app-region: no-drag; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <button class="close" onclick="window.close()">&#x2715;</button>
  <div class="logo">&#x1f41a;</div>
  <div class="name">Husk</div>
  <div class="version">v${version}</div>
  <div class="info">
    A terminal for builders.<br>
    Electron ${electronVersion} &middot; Node ${nodeVersion}<br>
    <br>
    <strong>${totalMemMB} MB total</strong><br>
    ${memBreakdown}<br>
    <br>
    <a href="https://antidrift.io/husk" target="_blank">antidrift.io/husk</a><br>
    &copy; ${new Date().getFullYear()} Antidrift
  </div>
</body>
</html>`;

  about.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  about.once("ready-to-show", () => about.show());
}

app.whenReady().then(() => {
  createWindow();
  buildMenu();
});

app.on("window-all-closed", () => {
  app.quit();
});
