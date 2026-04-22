interface HuskAPI {
  // Sessions
  createSession: (label: string) => Promise<{ id: string; label: string; paneId: string }>;
  switchSession: (id: string) => Promise<{ id: string; label: string } | null>;
  restoreSessions: () => Promise<{ sessions: { id: string; label: string; paneId: string; paneTree?: any; focusedPaneId?: string }[]; activeIndex: number; sidebarWidth: number; themeId: string; use24h: boolean }>;
  renameSession: (id: string, label: string) => Promise<void>;
  closeSession: (id: string) => Promise<void>;
  popOutSession: (id: string) => Promise<void>;

  // Panes
  createPane: (sessionId: string, cwd?: string) => Promise<string | null>;
  closePane: (sessionId: string, paneId: string) => Promise<void>;
  subscribePane: (sessionId: string, paneId: string) => Promise<boolean>;
  inputPane: (sessionId: string, paneId: string, data: string) => void;
  resizePane: (sessionId: string, paneId: string, cols: number, rows: number) => Promise<void>;
  paneCwd: (sessionId: string, paneId: string) => Promise<string | null>;

  // Status
  getCwd: (sessionId: string, paneId?: string) => Promise<string | null>;
  getForegroundProcess: (sessionId: string, paneId?: string) => Promise<string | null>;
  getSessionMemory: (id: string) => Promise<number | null>;
  getClaudeContext: (sessionId: string, paneId?: string) => Promise<{
    tokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    model: string | null;
    contextWindow: number;
  } | null>;
  getCodexContext: (sessionId: string, paneId?: string) => Promise<{
    tokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    model: string;
    contextWindow: number;
  } | null>;
  getProcessBreakdown: (id: string) => Promise<{ pid: number; name: string; memory: number; cpu: number }[] | null>;
  isCaffeinated: (id: string) => Promise<boolean>;
  notifyProcessComplete: (sessionId: string, label: string, procName: string, duration: number) => void;

  // UI
  saveSidebarWidth: (width: number) => Promise<void>;
  saveUse24h: (val: boolean) => Promise<void>;
  syncSessionMenu: (sessions: { id: string; label: string }[]) => void;
  saveSettings: (data: string) => Promise<void>;
  getAppInfo: () => Promise<{ version: string; build: number }>;
  getDiskUsage: () => Promise<{ total: number; used: number; available: number; percent: number } | null>;
  listProfiles: () => Promise<{ name: string; sessions: { label: string; cwd: string }[] }[]>;
  saveProfile: (name: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  openProfile: (name: string) => Promise<void>;
  loadSettings: () => Promise<string | null>;
  loadThemes: () => Promise<Record<string, any>>;
  saveTerminalBuffer: (id: string, data: string) => void;
  loadTerminalBuffer: (id: string) => Promise<string | null>;

  // Workspaces
  listWorkspaces: () => Promise<{ name: string; windowCount: number }[]>;
  saveWorkspace: (name: string, snapshot: object) => Promise<void>;
  deleteWorkspace: (name: string) => Promise<void>;
  openWorkspace: (name: string) => Promise<void>;
  respondWorkspaceState: (winId: number, snapshot: object) => void;

  // Events
  onSettingsToggle: (callback: () => void) => () => void;
  onSaveProfilePrompt: (callback: () => void) => () => void;
  onSaveWorkspacePrompt: (callback: () => void) => () => void;
  onCollectWorkspaceState: (callback: (winId: number) => void) => () => void;
  onSendBytes: (callback: (bytes: number[]) => void) => () => void;
  onSearchTerminal: (callback: () => void) => () => void;
  onThemeChange: (callback: (id: string) => void) => () => void;
  onNewSession: (callback: () => void) => () => void;
  onRenameActiveSession: (callback: () => void) => () => void;
  onPopOutActiveSession: (callback: () => void) => () => void;
  onCloseActiveSession: (callback: () => void) => () => void;
  onSwitchIndex: (callback: (index: number) => void) => () => void;
  onSessionCreated: (callback: (sessionId: string, paneId: string) => void) => () => void;
  onSessionExited: (callback: (id: string) => void) => () => void;
  onSessionNotified: (callback: (id: string) => void) => () => void;
  onPaneOutput: (callback: (sessionId: string, paneId: string, data: string) => void) => () => void;
  onPaneExited: (callback: (sessionId: string, paneId: string) => void) => () => void;
  onPaneSplit: (callback: (direction: "horizontal" | "vertical") => void) => () => void;
  onPaneFocusPrev: (callback: () => void) => () => void;
  onPaneFocusNext: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    husk: HuskAPI;
  }
}

export {};
