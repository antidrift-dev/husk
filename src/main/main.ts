import { app, BrowserWindow, ipcMain, Menu, Notification, globalShortcut } from "electron";
import path from "path";
import os from "os";
import fs from "fs";
import { SessionManager } from "./sessions";
import { loadThemes } from "./theme-loader";
import { saveProfile, loadProfiles, deleteProfile, Profile } from "./profiles";
import { saveWorkspace, loadWorkspaces, deleteWorkspace, WorkspaceWindow, SavedPaneNode } from "./workspaces";
import { getClaudeContextForCwd } from "./claude-context";
import { getCodexContextForCwd } from "./codex-context";

// Track all windows
const windows = new Map<number, { win: BrowserWindow; sessions: SessionManager; paneListeners: Set<string>; paneBuffers: Map<string, string>; flushTimer: ReturnType<typeof setTimeout> | null }>();

function getWindowContext(webContentsId: number) {
  for (const ctx of windows.values()) {
    if (!ctx.win.isDestroyed() && ctx.win.webContents.id === webContentsId) return ctx;
  }
  return null;
}

function getWindowContextFromSender(sender: Electron.WebContents) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return null;
  return windows.get(win.id) ?? null;
}

// ---- Workspace helpers ----

// Renderer snapshot — pane tree with pane IDs (no CWD), sent from renderer
interface RendererPaneLeaf { type: "leaf"; id: string }
interface RendererPaneSplit { type: "split"; id: string; direction: "horizontal" | "vertical"; ratio: number; children: [RendererPaneNode, RendererPaneNode] }
type RendererPaneNode = RendererPaneLeaf | RendererPaneSplit;

interface RendererWindowSnapshot {
  sessions: { id: string; label: string; paneTree: RendererPaneNode; focusedPaneId: string }[];
  activeSessionId: string | null;
}

function getAllLeafIds(node: RendererPaneNode): string[] {
  if (node.type === "leaf") return [node.id];
  return [...getAllLeafIds(node.children[0]), ...getAllLeafIds(node.children[1])];
}

function annotatePaneTree(sm: SessionManager, sessionId: string, node: RendererPaneNode): SavedPaneNode {
  if (node.type === "leaf") {
    const cwd = sm.getCwdSync(sessionId, node.id) || os.homedir();
    return { type: "leaf", id: node.id, cwd };
  }
  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    ratio: node.ratio,
    children: [
      annotatePaneTree(sm, sessionId, node.children[0]),
      annotatePaneTree(sm, sessionId, node.children[1]),
    ],
  };
}

function buildWorkspaceWindowFromSnapshot(ctx: { win: BrowserWindow; sessions: SessionManager }, snapshot: RendererWindowSnapshot): WorkspaceWindow {
  const bounds = ctx.win.isDestroyed() ? { x: 100, y: 100, width: 960, height: 640 } : ctx.win.getBounds();
  const sessions = snapshot.sessions.map((s, i) => {
    const paneTree = annotatePaneTree(ctx.sessions, s.id, s.paneTree);
    const leaves = getAllLeafIds(s.paneTree);
    const focusedPaneIndex = Math.max(0, leaves.indexOf(s.focusedPaneId));
    return { label: s.label, paneTree, focusedPaneIndex };
  });
  const activeSessionIndex = Math.max(0, snapshot.sessions.findIndex(s => s.id === snapshot.activeSessionId));
  return { bounds, sessions, activeSessionIndex, sidebarWidth: ctx.sessions.getSidebarWidth() };
}

const pendingStateCollectors = new Map<number, (snapshot: RendererWindowSnapshot) => void>();

function collectWindowStateFromRenderer(ctx: { win: BrowserWindow; sessions: SessionManager }): Promise<RendererWindowSnapshot | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingStateCollectors.delete(ctx.win.id);
      resolve(null);
    }, 2000);
    pendingStateCollectors.set(ctx.win.id, (snapshot) => {
      clearTimeout(timer);
      pendingStateCollectors.delete(ctx.win.id);
      resolve(snapshot);
    });
    ctx.win.webContents.send("workspace:collect-state", ctx.win.id);
  });
}

const bufferDir = path.join(os.homedir(), ".husk", "buffers");
if (!fs.existsSync(bufferDir)) fs.mkdirSync(bufferDir, { recursive: true });
const settingsFile = path.join(os.homedir(), ".husk", "settings.json");

// Quake mode
let quakeWindow: BrowserWindow | null = null;
let quakeRegistered = false;

let isFirstWindow = true;

function createWindow(overrideBounds?: { x: number; y: number; width: number; height: number }) {
  const sessions = new SessionManager();
  const shouldRestore = isFirstWindow;
  isFirstWindow = false;
  sessions.loadUiState();
  const bounds = overrideBounds || sessions.getWindowBounds();
  const offset = overrideBounds ? 0 : windows.size * 24;

  const isTest = process.env.HUSK_TEST === "1";
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: isTest ? -9999 : (bounds.x || 100) + offset,
    y: isTest ? -9999 : (bounds.y || 100) + offset,
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
    paneListeners: new Set<string>(),
    paneBuffers: new Map<string, string>(),
    flushTimer: null as ReturnType<typeof setTimeout> | null,
  };
  windows.set(win.id, ctx);

  const saveBounds = () => {
    if (!win.isDestroyed() && !win.isFullScreen()) sessions.saveWindowBounds(win.getBounds());
  };
  win.on("resized", saveBounds);
  win.on("moved", saveBounds);

  if (process.env.VITE_DEV_SERVER) {
    win.loadURL(process.env.VITE_DEV_SERVER);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // In dev mode, clear subscribedPanes on every page reload so TerminalLeaf
  // gets isFirstTime=true and nudges the shell for a fresh prompt.
  win.webContents.on("did-finish-load", () => {
    subscribedPanes.clear();
  });

  // Batched pane output
  const flushPaneBuffers = () => {
    ctx.flushTimer = null;
    if (win.isDestroyed()) return;
    for (const [key, data] of ctx.paneBuffers) {
      const [sessionId, paneId] = key.split(":");
      win.webContents.send("pane:output", sessionId, paneId, data);
    }
    ctx.paneBuffers.clear();
  };

  // Hold buffer: accumulates output until renderer subscribes
  const holdBuffers = new Map<string, string>();
  const subscribedPanes = new Set<string>();

  const setupPaneListener = (sessionId: string, paneId: string) => {
    const key = `${sessionId}:${paneId}`;
    if (ctx.paneListeners.has(key)) return;
    const p = sessions.getPane(sessionId, paneId);
    if (!p) return;
    ctx.paneListeners.add(key);
    p.onData((data: string) => {
      if (subscribedPanes.has(key)) {
        // Live mode — buffer for 16ms flush
        const existing = ctx.paneBuffers.get(key);
        ctx.paneBuffers.set(key, existing ? existing + data : data);
        if (!ctx.flushTimer) ctx.flushTimer = setTimeout(flushPaneBuffers, 16);
      } else {
        // Hold mode — accumulate until subscribe
        const existing = holdBuffers.get(key) || "";
        holdBuffers.set(key, existing + data);
        console.log(`[husk] HOLD (not subscribed) key=${key} bytes=${data.length}`);
      }
    });
  };

  (ctx as any).subscribPane = (sessionId: string, paneId: string): boolean => {
    const key = `${sessionId}:${paneId}`;
    const isFirstTime = !subscribedPanes.has(key);
    subscribedPanes.add(key);
    // Flush held buffer (only has data on first subscribe)
    const held = holdBuffers.get(key);
    if (held && !win.isDestroyed()) {
      win.webContents.send("pane:output", sessionId, paneId, held);
      holdBuffers.delete(key);
    }
    return isFirstTime;
  };

  sessions.onExit = (id: string) => {
    (ctx as any).cleanupSessionState?.(id);
    if (!win.isDestroyed()) win.webContents.send("session:exited", id);
  };

  sessions.onPaneExit = (sessionId: string, paneId: string) => {
    (ctx as any).cleanupPaneState?.(sessionId, paneId);
    if (!win.isDestroyed()) win.webContents.send("pane:exited", sessionId, paneId);
  };

  // Shortcuts
  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "Escape" && win.isFullScreen()) win.setFullScreen(false);
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
    // Split shortcuts
    if (input.meta && !input.shift && !input.alt && input.key === "d") {
      e.preventDefault();
      win.webContents.send("pane:split", "vertical");
    }
    if (input.meta && input.shift && !input.alt && input.key === "D") {
      e.preventDefault();
      win.webContents.send("pane:split", "horizontal");
    }
    // Focus cycling
    if (input.meta && !input.shift && !input.alt && input.key === "[") {
      e.preventDefault();
      win.webContents.send("pane:focus-prev");
    }
    if (input.meta && !input.shift && !input.alt && input.key === "]") {
      e.preventDefault();
      win.webContents.send("pane:focus-next");
    }
    // Cmd+Left = beginning of line (send Home/Ctrl+A)
    if (input.meta && !input.shift && !input.alt && input.key === "ArrowLeft") {
      e.preventDefault();
      win.webContents.send("terminal:send-bytes", [1]); // Ctrl+A
    }
    // Cmd+Right = end of line (send End/Ctrl+E)
    if (input.meta && !input.shift && !input.alt && input.key === "ArrowRight") {
      e.preventDefault();
      win.webContents.send("terminal:send-bytes", [5]); // Ctrl+E
    }
    // Cmd+Shift+P = pop out active session to new window
    if (input.meta && input.shift && !input.alt && input.key === "P") {
      e.preventDefault();
      win.webContents.send("session:pop-out-active");
    }
  });

  // Cleanup helpers for IPC handlers to call on session/pane close
  const cleanupPaneState = (sessionId: string, paneId: string) => {
    const key = `${sessionId}:${paneId}`;
    ctx.paneListeners.delete(key);
    ctx.paneBuffers.delete(key);
    holdBuffers.delete(key);
    subscribedPanes.delete(key);
  };
  const cleanupSessionState = (sessionId: string) => {
    for (const key of [...ctx.paneListeners]) {
      if (key.startsWith(`${sessionId}:`)) {
        const paneId = key.slice(sessionId.length + 1);
        cleanupPaneState(sessionId, paneId);
      }
    }
  };
  (ctx as any).cleanupPaneState = cleanupPaneState;
  (ctx as any).cleanupSessionState = cleanupSessionState;

  win.on("closed", () => {
    menuSessionLabels.delete(win.id);
    sessions.destroyAll();
    windows.delete(win.id);
  });

  (ctx as any).setupPaneListener = setupPaneListener;
  (ctx as any).shouldRestore = shouldRestore;
  return ctx;
}

// ---- IPC Handlers ----

ipcMain.handle("session:create", (e, label: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return null;
  const { session, paneId } = ctx.sessions.create(label);
  (ctx as any).setupPaneListener(session.id, paneId);
  ctx.win.webContents.send("session:created", session.id, paneId);
  return { id: session.id, label: session.label, paneId };
});

ipcMain.handle("session:restore", (e) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return { sessions: [], activeIndex: -1, sidebarWidth: 120, themeId: "mocha", use24h: true };

  // Check for pending workspace window (opened via workspace:open)
  const pendingWorkspace = (ctx as any).pendingWorkspaceWindow as WorkspaceWindow | undefined;
  if (pendingWorkspace) {
    delete (ctx as any).pendingWorkspaceWindow;
    const restored: { id: string; label: string; paneId: string; paneTree: any; focusedPaneId: string }[] = [];
    for (let i = 0; i < pendingWorkspace.sessions.length; i++) {
      const ws = pendingWorkspace.sessions[i];
      const { session, paneTree, allPaneIds, focusedPaneId } = ctx.sessions.createWithPaneTree(ws.label, ws.paneTree);
      const focusedActual = allPaneIds[ws.focusedPaneIndex] || focusedPaneId;
      for (const paneId of allPaneIds) {
        (ctx as any).setupPaneListener(session.id, paneId);
        ctx.win.webContents.send("session:created", session.id, paneId);
      }
      restored.push({ id: session.id, label: session.label, paneId: allPaneIds[0], paneTree, focusedPaneId: focusedActual });
    }
    return {
      sessions: restored,
      activeIndex: pendingWorkspace.activeSessionIndex,
      sidebarWidth: pendingWorkspace.sidebarWidth,
      themeId: ctx.sessions.getThemeId(),
      use24h: ctx.sessions.getUse24h(),
    };
  }

  // Check for pending profile (opened via profile:open)
  const pendingProfile = (ctx as any).pendingProfile as Profile | undefined;
  if (pendingProfile) {
    delete (ctx as any).pendingProfile;
    const restored: { id: string; label: string; paneId: string }[] = [];
    for (const s of pendingProfile.sessions) {
      const { session, paneId } = ctx.sessions.create(s.label, s.cwd);
      (ctx as any).setupPaneListener(session.id, paneId);
      ctx.win.webContents.send("session:created", session.id, paneId);
      restored.push({ id: session.id, label: session.label, paneId });
    }
    return { sessions: restored, activeIndex: 0, sidebarWidth: 120, themeId: ctx.sessions.getThemeId(), use24h: ctx.sessions.getUse24h() };
  }

  // Only first window restores sessions — new windows get a single fresh session
  if (!(ctx as any).shouldRestore) {
    const { session, paneId } = ctx.sessions.create("Session 1");
    (ctx as any).setupPaneListener(session.id, paneId);
    ctx.win.webContents.send("session:created", session.id, paneId);
    return { sessions: [{ id: session.id, label: session.label, paneId }], activeIndex: 0, sidebarWidth: ctx.sessions.getSidebarWidth(), themeId: ctx.sessions.getThemeId(), use24h: ctx.sessions.getUse24h() };
  }

  const result = ctx.sessions.restore();
  for (const s of result.sessions) {
    (ctx as any).setupPaneListener(s.id, s.paneId);
    ctx.win.webContents.send("session:created", s.id, s.paneId);
  }
  return result;
});

ipcMain.handle("session:close", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (ctx) {
    (ctx as any).cleanupSessionState(id);
    ctx.sessions.close(id);
    try { fs.unlinkSync(path.join(bufferDir, `${id}.txt`)); } catch {}
  }
});

ipcMain.handle("session:pop-out", (e, id: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return;
  const session = ctx.sessions.getSession(id);
  if (!session) return;
  const cwd = ctx.sessions.getCwdSync(id) || os.homedir();
  const label = session.label;
  // Close in current window
  ctx.sessions.close(id);
  // Open in new window
  const newCtx = createWindow();
  (newCtx as any).pendingProfile = { name: label, sessions: [{ label, cwd }] };
});

ipcMain.handle("session:switch", (e, id: string) => {
  return getWindowContext(e.sender.id)?.sessions.switch(id) || null;
});

ipcMain.handle("session:rename", (e, id: string, label: string) => {
  getWindowContext(e.sender.id)?.sessions.rename(id, label);
});

ipcMain.handle("session:cwd", (e, sessionId: string, paneId?: string) => {
  return getWindowContext(e.sender.id)?.sessions.getCwd(sessionId, paneId) || null;
});

ipcMain.handle("session:foreground", (e, sessionId: string, paneId?: string) => {
  return getWindowContext(e.sender.id)?.sessions.getForegroundProcess(sessionId, paneId) || null;
});

ipcMain.handle("session:memory", (e, id: string) => {
  return getWindowContext(e.sender.id)?.sessions.getSessionMemory(id) || null;
});

ipcMain.handle("session:claude-context", async (e, sessionId: string, paneId?: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return null;
  const cwd = await ctx.sessions.getCwd(sessionId, paneId);
  if (!cwd) return null;
  return getClaudeContextForCwd(cwd);
});

ipcMain.handle("session:codex-context", async (e, sessionId: string, paneId?: string) => {
  const ctx = getWindowContextFromSender(e.sender) ?? getWindowContext(e.sender.id);
  if (!ctx) return null;
  const cwd = await ctx.sessions.getCwd(sessionId, paneId);
  if (!cwd) return null;
  return getCodexContextForCwd(cwd);
});

// Pane IPC
ipcMain.handle("pane:create", (e, sessionId: string, cwd?: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx) return null;
  const paneId = ctx.sessions.createPane(sessionId, cwd || undefined);
  if (paneId) (ctx as any).setupPaneListener(sessionId, paneId);
  return paneId;
});

ipcMain.handle("pane:close", (e, sessionId: string, paneId: string) => {
  const ctx = getWindowContext(e.sender.id);
  if (ctx) {
    (ctx as any).cleanupPaneState(sessionId, paneId);
    ctx.sessions.closePane(sessionId, paneId);
  }
});

ipcMain.on("pane:input", (e, sessionId: string, paneId: string, data: string) => {
  getWindowContext(e.sender.id)?.sessions.writePane(sessionId, paneId, data);
});

ipcMain.handle("pane:resize", (e, sessionId: string, paneId: string, cols: number, rows: number) => {
  getWindowContext(e.sender.id)?.sessions.resizePane(sessionId, paneId, cols, rows);
});

ipcMain.handle("pane:subscribe", (e, sessionId: string, paneId: string): boolean => {
  const ctx = getWindowContext(e.sender.id);
  if (ctx) return (ctx as any).subscribPane(sessionId, paneId);
  return true;
});

ipcMain.handle("pane:cwd", (e, sessionId: string, paneId: string) => {
  return getWindowContext(e.sender.id)?.sessions.getCwd(sessionId, paneId) || null;
});

// UI state
ipcMain.on("session:proc-notify", (e, sessionId: string, label: string, procName: string, duration: number) => {
  const ctx = getWindowContext(e.sender.id);
  if (!ctx || ctx.win.isFocused() || !ctx.win.isVisible()) return;
  if (duration > 5) {
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    new Notification({ title: `${label} — completed`, body: `${procName} finished (${timeStr})` }).show();
    if (!ctx.win.isDestroyed()) ctx.win.webContents.send("session:notified", sessionId);
  }
});

ipcMain.handle("ui:save-sidebar-width", (e, width: number) => {
  getWindowContext(e.sender.id)?.sessions.saveSidebarWidth(width);
});

ipcMain.handle("ui:save-use24h", (e, val: boolean) => {
  getWindowContext(e.sender.id)?.sessions.setUse24h(val);
});

ipcMain.handle("session:process-breakdown", (e, id: string) => {
  return getWindowContext(e.sender.id)?.sessions.getSessionProcessBreakdown(id) || null;
});

ipcMain.handle("session:caffeinated", (e, id: string) => {
  return getWindowContext(e.sender.id)?.sessions.isCaffeinated(id) || false;
});

// Profiles
ipcMain.handle("profile:list", () => loadProfiles());

ipcMain.handle("profile:save", (e, name: string) => {
  const ctx = getWindowContextFromSender(e.sender) ?? getWindowContext(e.sender.id);
  if (!ctx) {
    console.error("[profile:save] no window context for sender", e.sender.id);
    return;
  }
  try {
    const sessions: { label: string; cwd: string }[] = [];
    for (const [id, session] of (ctx.sessions as any).sessions as Map<string, any>) {
      const cwd = ctx.sessions.getCwdSync(id) || os.homedir();
      sessions.push({ label: session.label, cwd });
    }
    saveProfile({ name, sessions });
    try { buildMenu(); } catch (menuErr) { console.error("[profile:save] buildMenu error:", menuErr); }
  } catch (err) {
    console.error("[profile:save] error:", err);
  }
});

ipcMain.handle("profile:delete", (_e, name: string) => {
  deleteProfile(name);
  buildMenu();
});

ipcMain.handle("profile:open", (_e, name: string) => {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) return;
  // Open a new window and send the profile sessions to it
  const ctx = createWindow();
  (ctx as any).pendingProfile = profile;
});

// Workspaces
ipcMain.handle("workspace:list", () => loadWorkspaces().map((w) => ({ name: w.name, windowCount: w.windows.length })));

ipcMain.handle("workspace:save", async (e, name: string, snapshot: RendererWindowSnapshot) => {
  const ctx = getWindowContextFromSender(e.sender) ?? getWindowContext(e.sender.id);
  if (!ctx) return;

  const allWindowData = [buildWorkspaceWindowFromSnapshot(ctx, snapshot)];

  // Collect state from all other non-quake windows
  const otherCtxs = [...windows.values()].filter(
    (c) => !c.win.isDestroyed() && c.win.id !== ctx.win.id && c.win !== quakeWindow
  );
  for (const other of otherCtxs) {
    const otherSnapshot = await collectWindowStateFromRenderer(other);
    if (otherSnapshot) allWindowData.push(buildWorkspaceWindowFromSnapshot(other, otherSnapshot));
  }

  saveWorkspace({ name, windows: allWindowData });
  buildMenu();
});

ipcMain.handle("workspace:delete", (_e, name: string) => {
  deleteWorkspace(name);
  buildMenu();
});

ipcMain.handle("workspace:open", (_e, name: string) => {
  const workspaces = loadWorkspaces();
  const workspace = workspaces.find((w) => w.name === name);
  if (!workspace) return;
  for (const windowSpec of workspace.windows) {
    const ctx = createWindow(windowSpec.bounds);
    (ctx as any).pendingWorkspaceWindow = windowSpec;
  }
});

// Renderer responds to workspace:collect-state by sending its snapshot back
ipcMain.on("workspace:state-response", (_e, winId: number, snapshot: RendererWindowSnapshot) => {
  pendingStateCollectors.get(winId)?.(snapshot);
});

ipcMain.handle("app:info", () => {
  const pkg = require(path.join(__dirname, "..", "..", "package.json"));
  let build = 0;
  try {
    const bn = require(path.join(__dirname, "..", "..", "build-number.json"));
    build = bn.build || 0;
  } catch {}
  return { version: pkg.version, build };
});

ipcMain.handle("system:disk", async () => {
  try {
    const { execFile } = require("child_process");
    const { promisify } = require("util");
    const exec = promisify(execFile);
    const { stdout } = await exec("df", ["-k", "/"], { timeout: 2000 });
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return null;
    const parts = lines[1].split(/\s+/);
    const totalKB = parseInt(parts[1], 10);
    const usedKB = parseInt(parts[2], 10);
    const availKB = parseInt(parts[3], 10);
    return {
      total: Math.round(totalKB / 1024 / 1024),  // GB
      used: Math.round(usedKB / 1024 / 1024),
      available: Math.round(availKB / 1024 / 1024),
      percent: Math.round((usedKB / totalKB) * 100),
    };
  } catch { return null; }
});

ipcMain.handle("settings:load", () => {
  try { return fs.readFileSync(settingsFile, "utf-8"); } catch { return null; }
});

ipcMain.handle("themes:load", () => {
  return loadThemes();
});

ipcMain.on("session:save-buffer", (_e, id: string, data: string) => {
  try { fs.writeFileSync(path.join(bufferDir, `${id}.txt`), data); } catch {}
});

ipcMain.handle("session:load-buffer", (_e, id: string) => {
  try { return fs.readFileSync(path.join(bufferDir, `${id}.txt`), "utf-8"); } catch { return null; }
});

// Session menu sync
const menuSessionLabels = new Map<number, { id: string; label: string }[]>();

ipcMain.on("session:sync-menu", (e, sessions: { id: string; label: string }[]) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) { menuSessionLabels.set(win.id, sessions); buildMenu(); }
});

function getSessionMenuItems(sendToFocused: (channel: string, ...args: any[]) => void) {
  const focused = BrowserWindow.getFocusedWindow();
  const sessions = focused ? menuSessionLabels.get(focused.id) || [] : [];
  if (sessions.length === 0) return [{ label: "No sessions", enabled: false }] as any[];
  return sessions.map((s, i) => ({
    label: s.label,
    accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
    click: () => sendToFocused("session:switch-index", i),
  }));
}

// ---- Menu ----

function buildMenu() {
  const getFocusedCtx = () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      const ctx = windows.get(focused.id);
      if (ctx) return ctx;
    }
    // Fall back to most recently active window
    for (const ctx of windows.values()) {
      if (!ctx.win.isDestroyed()) return ctx;
    }
    return null;
  };

  const sendToFocused = (channel: string, ...args: any[]) => {
    const ctx = getFocusedCtx();
    if (ctx && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, ...args);
  };

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: "About Husk", click: () => { const ctx = getFocusedCtx(); if (ctx) showAbout(ctx.win); } },
        { label: "Settings...", accelerator: "CmdOrCtrl+,", click: () => sendToFocused("settings:toggle") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() },
        { type: "separator" },
        {
          label: "Save as Profile...",
          click: () => sendToFocused("profile:save-prompt"),
        },
        {
          label: "Open Profile",
          submenu: (() => {
            const profiles = loadProfiles();
            if (profiles.length === 0) return [{ label: "No profiles", enabled: false }] as any[];
            return profiles.map((p) => ({
              label: p.name,
              click: () => {
                const ctx = createWindow();
                (ctx as any).pendingProfile = p;
              },
            }));
          })(),
        },
        { type: "separator" },
        {
          label: "Save Workspace...",
          click: () => sendToFocused("workspace:save-prompt"),
        },
        {
          label: "Open Workspace",
          submenu: (() => {
            const workspaces = loadWorkspaces();
            if (workspaces.length === 0) return [{ label: "No workspaces", enabled: false }] as any[];
            return workspaces.map((w) => ({
              label: `${w.name}  (${w.windows.length} window${w.windows.length !== 1 ? "s" : ""})`,
              click: () => {
                for (const windowSpec of w.windows) {
                  const ctx = createWindow(windowSpec.bounds);
                  (ctx as any).pendingWorkspaceWindow = windowSpec;
                }
              },
            }));
          })(),
        },
        { type: "separator" },
        { label: "Split Right", accelerator: "CmdOrCtrl+D", click: () => sendToFocused("pane:split", "vertical") },
        { label: "Split Down", accelerator: "CmdOrCtrl+Shift+D", click: () => sendToFocused("pane:split", "horizontal") },
      ],
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
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "front" },
        { type: "separator" },
        { role: "window" },
      ],
    } as any,
    {
      label: "Session",
      submenu: [
        { label: "New Session", accelerator: "CmdOrCtrl+N", click: () => sendToFocused("session:new") },
        { label: "Rename Session", accelerator: "CmdOrCtrl+R", click: () => sendToFocused("session:rename-active") },
        { label: "Pop Out to Window", accelerator: "CmdOrCtrl+Shift+P", click: () => sendToFocused("session:pop-out-active") },
        { label: "Close Session", accelerator: "CmdOrCtrl+W", click: () => sendToFocused("session:close-active") },
        { type: "separator" },
        ...getSessionMenuItems(sendToFocused),
      ],
    },
    {
      label: "Theme",
      submenu: Object.entries(loadThemes()).map(([id, t]) => ({
        label: t.name,
        type: "radio" as const,
        click: () => applyThemeToAll(id),
      })),
    },
    {
      label: "Dev",
      submenu: [
        { label: "Toggle DevTools", accelerator: "CmdOrCtrl+Alt+I", click: () => { BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(); } },
        { label: "Reload", accelerator: "CmdOrCtrl+Shift+R", click: () => { BrowserWindow.getFocusedWindow()?.webContents.reload(); } },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function applyThemeToAll(id: string) {
  for (const ctx of windows.values()) {
    ctx.sessions.setThemeId(id);
    if (!ctx.win.isDestroyed()) ctx.win.webContents.send("theme:change", id);
  }
}

// ---- About ----

function showAbout(parent: BrowserWindow) {
  const about = new BrowserWindow({
    width: 360, height: 400, parent, modal: true, resizable: false,
    minimizable: false, maximizable: false, show: false,
    backgroundColor: "#1e1e2e", titleBarStyle: "hidden",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const version = app.getVersion();
  let buildNum = 0;
  try { buildNum = require(path.join(__dirname, "..", "..", "build-number.json")).build; } catch {}
  const electronVersion = process.versions.electron;
  const nodeVersion = process.versions.node;
  const metrics = app.getAppMetrics();
  const totalMemMB = Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
  const memBreakdown = metrics.map(m => `${m.type}${m.name ? ` (${m.name})` : ""}: ${Math.round(m.memory.workingSetSize / 1024)} MB`).join("<br>");

  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1e1e2e; color: #cdd6f4; font-family: -apple-system, BlinkMacSystemFont, monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; -webkit-app-region: drag; user-select: none; }
  .logo { font-size: 48px; margin-bottom: 8px; }
  .name { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
  .version { font-size: 13px; color: #7f849c; margin-bottom: 16px; }
  .info { font-size: 11px; color: #7f849c; text-align: center; line-height: 1.6; }
  .close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #585b70; font-size: 16px; cursor: pointer; -webkit-app-region: no-drag; }
  .close:hover { color: #cdd6f4; }
  a { color: #89b4fa; text-decoration: none; -webkit-app-region: no-drag; }
  a:hover { text-decoration: underline; }
</style></head><body>
  <button class="close" onclick="window.close()">&#x2715;</button>
  <div class="logo">&#x1f41a;</div>
  <div class="name">Husk</div>
  <div class="version">v${version}</div>
  <div class="info">
    A terminal for builders.<br>
    Electron ${electronVersion} &middot; Node ${nodeVersion}<br><br>
    <strong>${totalMemMB} MB total</strong><br>${memBreakdown}<br><br>
    <a href="https://husk.antidrift.dev" target="_blank">husk.antidrift.dev</a><br>
    &copy; ${new Date().getFullYear()} Antidrift
  </div>
</body></html>`;
  about.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  about.once("ready-to-show", () => about.show());
}

// ---- Quake Mode ----

function createQuakeWindow() {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay();
  const { width: screenW } = display.workAreaSize;
  const quakeH = Math.round(display.workAreaSize.height * 0.4);

  quakeWindow = new BrowserWindow({
    width: screenW, height: quakeH, x: 0, y: 0,
    frame: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    backgroundColor: "#11111b",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });

  if (process.env.VITE_DEV_SERVER) {
    quakeWindow.loadURL(process.env.VITE_DEV_SERVER);
  } else {
    quakeWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  const sessions = new SessionManager();
  const ctx = {
    win: quakeWindow, sessions,
    paneListeners: new Set<string>(),
    paneBuffers: new Map<string, string>(),
    flushTimer: null as ReturnType<typeof setTimeout> | null,
  };
  windows.set(quakeWindow.id, ctx);

  const flushPaneBuffers = () => {
    ctx.flushTimer = null;
    if (quakeWindow?.isDestroyed()) return;
    for (const [key, data] of ctx.paneBuffers) {
      const [sessionId, paneId] = key.split(":");
      quakeWindow?.webContents.send("pane:output", sessionId, paneId, data);
    }
    ctx.paneBuffers.clear();
  };

  (ctx as any).setupPaneListener = (sessionId: string, paneId: string) => {
    const key = `${sessionId}:${paneId}`;
    if (ctx.paneListeners.has(key)) return;
    const p = sessions.getPane(sessionId, paneId);
    if (!p) return;
    ctx.paneListeners.add(key);
    p.onData((data: string) => {
      const existing = ctx.paneBuffers.get(key);
      ctx.paneBuffers.set(key, existing ? existing + data : data);
      if (!ctx.flushTimer) ctx.flushTimer = setTimeout(flushPaneBuffers, 16);
    });
  };

  sessions.onExit = (id: string) => { if (!quakeWindow?.isDestroyed()) quakeWindow?.webContents.send("session:exited", id); };
  sessions.onPaneExit = (sessionId: string, paneId: string) => { if (!quakeWindow?.isDestroyed()) quakeWindow?.webContents.send("pane:exited", sessionId, paneId); };

  quakeWindow.on("blur", () => quakeWindow?.hide());
  quakeWindow.on("closed", () => { sessions.destroyAll(); if (quakeWindow) windows.delete(quakeWindow.id); quakeWindow = null; });
}

function toggleQuake() {
  if (!quakeWindow || quakeWindow.isDestroyed()) { createQuakeWindow(); quakeWindow?.show(); quakeWindow?.focus(); }
  else if (quakeWindow.isVisible()) { quakeWindow.hide(); }
  else { quakeWindow.show(); quakeWindow.focus(); }
}

function enableQuakeMode(hotkey: string) {
  if (quakeRegistered) { globalShortcut.unregisterAll(); quakeRegistered = false; }
  try { globalShortcut.register(hotkey, toggleQuake); quakeRegistered = true; } catch (e) { console.error("Failed to register quake hotkey:", e); }
}

function disableQuakeMode() {
  if (quakeRegistered) { globalShortcut.unregisterAll(); quakeRegistered = false; }
  if (quakeWindow && !quakeWindow.isDestroyed()) { quakeWindow.close(); quakeWindow = null; }
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  createWindow();
  buildMenu();
  try {
    const data = fs.readFileSync(settingsFile, "utf-8");
    const s = JSON.parse(data);
    if (s.quakeMode) enableQuakeMode(s.quakeHotkey || "Control+`");
  } catch {}
});

ipcMain.handle("settings:save", (_e, data: string) => {
  try {
    fs.writeFileSync(settingsFile, data);
    const s = JSON.parse(data);
    if (s.quakeMode) enableQuakeMode(s.quakeHotkey || "Control+`");
    else disableQuakeMode();
  } catch {}
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => {
  if (quakeWindow && !quakeWindow.isDestroyed()) return;
  app.quit();
});
