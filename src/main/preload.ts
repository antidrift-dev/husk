import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("husk", {
  // Session management
  createSession: (label: string) =>
    ipcRenderer.invoke("session:create", label) as Promise<{ id: string; label: string; paneId: string }>,

  switchSession: (id: string) =>
    ipcRenderer.invoke("session:switch", id),

  restoreSessions: () =>
    ipcRenderer.invoke("session:restore"),

  renameSession: (id: string, label: string) =>
    ipcRenderer.invoke("session:rename", id, label),

  closeSession: (id: string) =>
    ipcRenderer.invoke("session:close", id),

  popOutSession: (id: string) =>
    ipcRenderer.invoke("session:pop-out", id),

  // Pane management
  createPane: (sessionId: string, cwd?: string) =>
    ipcRenderer.invoke("pane:create", sessionId, cwd) as Promise<string | null>,

  closePane: (sessionId: string, paneId: string) =>
    ipcRenderer.invoke("pane:close", sessionId, paneId),

  subscribePane: (sessionId: string, paneId: string) =>
    ipcRenderer.invoke("pane:subscribe", sessionId, paneId) as Promise<boolean>,

  inputPane: (sessionId: string, paneId: string, data: string) =>
    ipcRenderer.send("pane:input", sessionId, paneId, data),

  resizePane: (sessionId: string, paneId: string, cols: number, rows: number) =>
    ipcRenderer.invoke("pane:resize", sessionId, paneId, cols, rows),

  paneCwd: (sessionId: string, paneId: string) =>
    ipcRenderer.invoke("pane:cwd", sessionId, paneId) as Promise<string | null>,

  // Status
  getCwd: (sessionId: string, paneId?: string) =>
    ipcRenderer.invoke("session:cwd", sessionId, paneId) as Promise<string | null>,

  getForegroundProcess: (sessionId: string, paneId?: string) =>
    ipcRenderer.invoke("session:foreground", sessionId, paneId) as Promise<string | null>,

  getSessionMemory: (id: string) =>
    ipcRenderer.invoke("session:memory", id) as Promise<number | null>,

  getClaudeContext: (sessionId: string, paneId?: string) =>
    ipcRenderer.invoke("session:claude-context", sessionId, paneId) as Promise<{
      tokens: number;
      inputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      outputTokens: number;
      model: string | null;
      contextWindow: number;
    } | null>,

  getCodexContext: (sessionId: string, paneId?: string) =>
    ipcRenderer.invoke("session:codex-context", sessionId, paneId) as Promise<{
      tokens: number;
      inputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      outputTokens: number;
      model: string;
      contextWindow: number;
    } | null>,

  getProcessBreakdown: (id: string) =>
    ipcRenderer.invoke("session:process-breakdown", id) as Promise<{ pid: number; name: string; memory: number; cpu: number }[] | null>,

  isCaffeinated: (id: string) =>
    ipcRenderer.invoke("session:caffeinated", id) as Promise<boolean>,

  notifyProcessComplete: (sessionId: string, label: string, procName: string, duration: number) =>
    ipcRenderer.send("session:proc-notify", sessionId, label, procName, duration),

  // UI state
  saveSidebarWidth: (width: number) =>
    ipcRenderer.invoke("ui:save-sidebar-width", width),

  saveUse24h: (val: boolean) =>
    ipcRenderer.invoke("ui:save-use24h", val),

  syncSessionMenu: (sessions: { id: string; label: string }[]) =>
    ipcRenderer.send("session:sync-menu", sessions),

  // Settings
  saveSettings: (data: string) =>
    ipcRenderer.invoke("settings:save", data),

  getAppInfo: () =>
    ipcRenderer.invoke("app:info") as Promise<{ version: string; build: number }>,

  getDiskUsage: () =>
    ipcRenderer.invoke("system:disk") as Promise<{ total: number; used: number; available: number; percent: number } | null>,

  listProfiles: () =>
    ipcRenderer.invoke("profile:list") as Promise<{ name: string; sessions: { label: string; cwd: string }[] }[]>,

  saveProfile: (name: string) =>
    ipcRenderer.invoke("profile:save", name),

  deleteProfile: (name: string) =>
    ipcRenderer.invoke("profile:delete", name),

  openProfile: (name: string) =>
    ipcRenderer.invoke("profile:open", name),

  loadSettings: () =>
    ipcRenderer.invoke("settings:load") as Promise<string | null>,

  loadThemes: () =>
    ipcRenderer.invoke("themes:load") as Promise<Record<string, any>>,

  // Workspaces
  listWorkspaces: () =>
    ipcRenderer.invoke("workspace:list") as Promise<{ name: string; windowCount: number }[]>,

  saveWorkspace: (name: string, snapshot: object) =>
    ipcRenderer.invoke("workspace:save", name, snapshot),

  deleteWorkspace: (name: string) =>
    ipcRenderer.invoke("workspace:delete", name),

  openWorkspace: (name: string) =>
    ipcRenderer.invoke("workspace:open", name),

  respondWorkspaceState: (winId: number, snapshot: object) =>
    ipcRenderer.send("workspace:state-response", winId, snapshot),

  saveTerminalBuffer: (id: string, data: string) =>
    ipcRenderer.send("session:save-buffer", id, data),

  loadTerminalBuffer: (id: string) =>
    ipcRenderer.invoke("session:load-buffer", id) as Promise<string | null>,

  // Events
  onSettingsToggle: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("settings:toggle", listener);
    return () => ipcRenderer.removeListener("settings:toggle", listener);
  },

  onSaveProfilePrompt: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("profile:save-prompt", listener);
    return () => ipcRenderer.removeListener("profile:save-prompt", listener);
  },

  onSaveWorkspacePrompt: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("workspace:save-prompt", listener);
    return () => ipcRenderer.removeListener("workspace:save-prompt", listener);
  },

  onCollectWorkspaceState: (callback: (winId: number) => void) => {
    const listener = (_event: any, winId: number) => callback(winId);
    ipcRenderer.on("workspace:collect-state", listener);
    return () => ipcRenderer.removeListener("workspace:collect-state", listener);
  },

  onSendBytes: (callback: (bytes: number[]) => void) => {
    const listener = (_event: any, bytes: number[]) => callback(bytes);
    ipcRenderer.on("terminal:send-bytes", listener);
    return () => ipcRenderer.removeListener("terminal:send-bytes", listener);
  },

  onSearchTerminal: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("terminal:search", listener);
    return () => ipcRenderer.removeListener("terminal:search", listener);
  },

  onThemeChange: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on("theme:change", listener);
    return () => ipcRenderer.removeListener("theme:change", listener);
  },

  onNewSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:new", listener);
    return () => ipcRenderer.removeListener("session:new", listener);
  },

  onRenameActiveSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:rename-active", listener);
    return () => ipcRenderer.removeListener("session:rename-active", listener);
  },

  onPopOutActiveSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:pop-out-active", listener);
    return () => ipcRenderer.removeListener("session:pop-out-active", listener);
  },

  onCloseActiveSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:close-active", listener);
    return () => ipcRenderer.removeListener("session:close-active", listener);
  },

  onSwitchIndex: (callback: (index: number) => void) => {
    const listener = (_event: any, index: number) => callback(index);
    ipcRenderer.on("session:switch-index", listener);
    return () => ipcRenderer.removeListener("session:switch-index", listener);
  },

  onSessionCreated: (callback: (sessionId: string, paneId: string) => void) => {
    const listener = (_event: any, sessionId: string, paneId: string) => callback(sessionId, paneId);
    ipcRenderer.on("session:created", listener);
    return () => ipcRenderer.removeListener("session:created", listener);
  },

  onSessionExited: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on("session:exited", listener);
    return () => ipcRenderer.removeListener("session:exited", listener);
  },

  onSessionNotified: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on("session:notified", listener);
    return () => ipcRenderer.removeListener("session:notified", listener);
  },

  onPaneOutput: (callback: (sessionId: string, paneId: string, data: string) => void) => {
    const listener = (_event: any, sessionId: string, paneId: string, data: string) => callback(sessionId, paneId, data);
    ipcRenderer.on("pane:output", listener);
    return () => ipcRenderer.removeListener("pane:output", listener);
  },

  onPaneExited: (callback: (sessionId: string, paneId: string) => void) => {
    const listener = (_event: any, sessionId: string, paneId: string) => callback(sessionId, paneId);
    ipcRenderer.on("pane:exited", listener);
    return () => ipcRenderer.removeListener("pane:exited", listener);
  },

  onPaneSplit: (callback: (direction: "horizontal" | "vertical") => void) => {
    const listener = (_event: any, direction: "horizontal" | "vertical") => callback(direction);
    ipcRenderer.on("pane:split", listener);
    return () => ipcRenderer.removeListener("pane:split", listener);
  },

  onPaneFocusPrev: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("pane:focus-prev", listener);
    return () => ipcRenderer.removeListener("pane:focus-prev", listener);
  },

  onPaneFocusNext: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("pane:focus-next", listener);
    return () => ipcRenderer.removeListener("pane:focus-next", listener);
  },
});
