import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("husk", {
  createSession: (label: string) =>
    ipcRenderer.invoke("session:create", label),

  switchSession: (id: string) =>
    ipcRenderer.invoke("session:switch", id),

  restoreSessions: () =>
    ipcRenderer.invoke("session:restore") as Promise<{ id: string; label: string }[]>,

  renameSession: (id: string, label: string) =>
    ipcRenderer.invoke("session:rename", id, label),

  saveTerminalBuffer: (id: string, data: string) =>
    ipcRenderer.send("session:save-buffer", id, data),

  loadTerminalBuffer: (id: string) =>
    ipcRenderer.invoke("session:load-buffer", id) as Promise<string | null>,

  inputSession: (id: string, data: string) =>
    ipcRenderer.send("session:input", id, data),

  closeSession: (id: string) =>
    ipcRenderer.invoke("session:close", id),

  resizeSession: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke("session:resize", id, cols, rows),

  onPtyOutput: (callback: (id: string, data: string) => void) => {
    const listener = (_event: any, id: string, data: string) => callback(id, data);
    ipcRenderer.on("pty:output", listener);
    return () => ipcRenderer.removeListener("pty:output", listener);
  },

  getCwd: (id: string) => ipcRenderer.invoke("session:cwd", id) as Promise<string | null>,
  getForegroundProcess: (id: string) => ipcRenderer.invoke("session:foreground", id) as Promise<string | null>,
  getSessionMemory: (id: string) => ipcRenderer.invoke("session:memory", id) as Promise<number | null>,

  saveSidebarWidth: (width: number) =>
    ipcRenderer.invoke("ui:save-sidebar-width", width),

  saveUse24h: (val: boolean) =>
    ipcRenderer.invoke("ui:save-use24h", val),

  createSubPty: (id: string) => ipcRenderer.invoke("session:create-sub", id) as Promise<boolean>,
  closeSubPty: (id: string) => ipcRenderer.invoke("session:close-sub", id),
  inputSubPty: (id: string, data: string) => ipcRenderer.send("session:input-sub", id, data),
  resizeSubPty: (id: string, cols: number, rows: number) => ipcRenderer.invoke("session:resize-sub", id, cols, rows),

  onSubPtyOutput: (callback: (id: string, data: string) => void) => {
    const listener = (_event: any, id: string, data: string) => callback(id, data);
    ipcRenderer.on("pty:sub-output", listener);
    return () => ipcRenderer.removeListener("pty:sub-output", listener);
  },

  onSessionCreated: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on("session:created", listener);
    return () => ipcRenderer.removeListener("session:created", listener);
  },

  onSubPtyExited: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on("session:sub-exited", listener);
    return () => ipcRenderer.removeListener("session:sub-exited", listener);
  },

  onSwitchIndex: (callback: (index: number) => void) => {
    const listener = (_event: any, index: number) => callback(index);
    ipcRenderer.on("session:switch-index", listener);
    return () => ipcRenderer.removeListener("session:switch-index", listener);
  },

  onSettingsToggle: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("settings:toggle", listener);
    return () => ipcRenderer.removeListener("settings:toggle", listener);
  },

  saveSettings: (data: string) =>
    ipcRenderer.invoke("settings:save", data),

  loadSettings: () =>
    ipcRenderer.invoke("settings:load") as Promise<string | null>,

  onSearchTerminal: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("terminal:search", listener);
    return () => ipcRenderer.removeListener("terminal:search", listener);
  },

  onToggleSub: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:toggle-sub", listener);
    return () => ipcRenderer.removeListener("session:toggle-sub", listener);
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

  onCloseActiveSession: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:close-active", listener);
    return () => ipcRenderer.removeListener("session:close-active", listener);
  },

  onSessionExited: (callback: (id: string) => void) => {
    const listener = (_event: any, id: string) => callback(id);
    ipcRenderer.on("session:exited", listener);
    return () => ipcRenderer.removeListener("session:exited", listener);
  },
});
