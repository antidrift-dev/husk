interface HuskAPI {
  createSession: (label: string) => Promise<{ id: string; label: string }>;
  switchSession: (id: string) => Promise<{ id: string; label: string } | null>;
  restoreSessions: () => Promise<{ sessions: { id: string; label: string }[]; activeIndex: number; sidebarWidth: number; themeId: string; use24h: boolean }>;
  saveSidebarWidth: (width: number) => Promise<void>;
  saveUse24h: (val: boolean) => Promise<void>;
  renameSession: (id: string, label: string) => Promise<void>;
  saveTerminalBuffer: (id: string, data: string) => void;
  loadTerminalBuffer: (id: string) => Promise<string | null>;
  inputSession: (id: string, data: string) => void;
  closeSession: (id: string) => Promise<void>;
  resizeSession: (id: string, cols: number, rows: number) => Promise<void>;
  getCwd: (id: string) => Promise<string | null>;
  getForegroundProcess: (id: string) => Promise<string | null>;
  getSessionMemory: (id: string) => Promise<number | null>;
  createSubPty: (id: string) => Promise<boolean>;
  closeSubPty: (id: string) => Promise<void>;
  inputSubPty: (id: string, data: string) => void;
  resizeSubPty: (id: string, cols: number, rows: number) => Promise<void>;
  onSubPtyOutput: (callback: (id: string, data: string) => void) => () => void;
  onSessionCreated: (callback: (id: string) => void) => () => void;
  onSubPtyExited: (callback: (id: string) => void) => () => void;
  onSwitchIndex: (callback: (index: number) => void) => () => void;
  onSettingsToggle: (callback: () => void) => () => void;
  saveSettings: (data: string) => Promise<void>;
  loadSettings: () => Promise<string | null>;
  onSearchTerminal: (callback: () => void) => () => void;
  onToggleSub: (callback: () => void) => () => void;
  onThemeChange: (callback: (id: string) => void) => () => void;
  onNewSession: (callback: () => void) => () => void;
  onRenameActiveSession: (callback: () => void) => () => void;
  onCloseActiveSession: (callback: () => void) => () => void;
  onPtyOutput: (callback: (id: string, data: string) => void) => () => void;
  onSessionExited: (callback: (id: string) => void) => () => void;
}

declare global {
  interface Window {
    husk: HuskAPI;
  }
}

export {};
