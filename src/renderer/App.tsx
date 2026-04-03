import { useState, useCallback, useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import TerminalPane from "./TerminalPane";
import Settings, { SettingsData, DEFAULTS } from "./Settings";
import { useTheme } from "./ThemeContext";

interface SessionInfo {
  id: string;
  label: string;
}

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(120);
  const [sessionProcesses, setSessionProcesses] = useState<Record<string, string>>({});
  const [use24h, setUse24h] = useState(true);
  const { theme, setThemeId } = useTheme();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const dragging = useRef(false);

  const handleNew = async () => {
    const info = await window.husk.createSession(`Session ${sessions.length + 1}`);
    setSessions((prev) => [...prev, info]);
    setActiveId(info.id);
  };

  const handleSelect = async (id: string) => {
    await window.husk.switchSession(id);
    setActiveId(id);
  };

  const handleRename = (id: string, label: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
    window.husk.renameSession(id, label);
  };

  const handleClose = async (id: string) => {
    await window.husk.closeSession(id);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (id === activeId && remaining.length > 0) {
        // Switch to the next session, or the previous if closing the last one
        const oldIndex = prev.findIndex((s) => s.id === id);
        const newIndex = Math.min(oldIndex, remaining.length - 1);
        setActiveId(remaining[newIndex].id);
      } else if (remaining.length === 0) {
        setActiveId(null);
      }
      return remaining;
    });
  };

  // Load settings
  useEffect(() => {
    window.husk.loadSettings().then((json) => {
      if (json) {
        try { setSettings({ ...DEFAULTS, ...JSON.parse(json) }); } catch {}
      }
    });
  }, []);

  const handleSettingsChange = (next: SettingsData) => {
    setSettings(next);
    window.husk.saveSettings(JSON.stringify(next));
  };

  // Settings toggle
  useEffect(() => {
    return window.husk.onSettingsToggle(() => setSettingsOpen((v) => !v));
  }, []);

  // Restore sessions and UI state from previous run
  useEffect(() => {
    window.husk.restoreSessions().then((data) => {
      if (data.sessions.length > 0) {
        setSessions(data.sessions);
        const idx = data.activeIndex >= 0 && data.activeIndex < data.sessions.length
          ? data.activeIndex : data.sessions.length - 1;
        setActiveId(data.sessions[idx].id);
      }
      if (data.sidebarWidth) setSidebarWidth(data.sidebarWidth);
      if (data.themeId) setThemeId(data.themeId);
      if (typeof data.use24h === "boolean") setUse24h(data.use24h);
    });
  }, []);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.max(48, Math.min(300, e.clientX));
      setSidebarWidth(w);
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        window.husk.saveSidebarWidth(sidebarWidthRef.current);
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Update window title
  useEffect(() => {
    const active = sessions.find((s) => s.id === activeId);
    const v = "v0.1.0";
    document.title = active ? `Husk - ${active.label}  ·  ${v}` : `Husk  ·  ${v}`;
  }, [activeId, sessions]);

  // Menu shortcuts
  useEffect(() => {
    const cleanupNew = window.husk.onNewSession(() => handleNew());
    const cleanupRename = window.husk.onRenameActiveSession(() => {
      if (activeId) setEditingSessionId(activeId);
    });
    const cleanupClose = window.husk.onCloseActiveSession(() => {
      if (activeId) handleClose(activeId);
    });
    const cleanupSwitch = window.husk.onSwitchIndex((index) => {
      if (index < sessions.length) {
        handleSelect(sessions[index].id);
      }
    });
    return () => { cleanupNew(); cleanupRename(); cleanupClose(); cleanupSwitch(); };
  }, [activeId, sessions]);

  // Poll foreground process for all sessions
  useEffect(() => {
    if (sessions.length === 0) return;
    const poll = async () => {
      const procs: Record<string, string> = {};
      await Promise.all(
        sessions.map(async (s) => {
          const proc = await window.husk.getForegroundProcess(s.id);
          if (proc) procs[s.id] = proc;
        }),
      );
      setSessionProcesses(procs);
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [sessions]);

  useEffect(() => {
    return window.husk.onSessionExited((id) => {
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        const oldIndex = prev.findIndex((s) => s.id === id);
        if (remaining.length > 0) {
          setActiveId((cur) => cur === id ? remaining[Math.min(oldIndex, remaining.length - 1)].id : cur);
        } else {
          setActiveId(null);
        }
        return remaining;
      });
    });
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", background: theme.ui.bg, color: theme.ui.text, userSelect: dragging.current ? "none" : "auto" }}>
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onNew={handleNew}
        onSelect={handleSelect}
        onRename={handleRename}
        onClose={handleClose}
        width={sidebarWidth}
        sessionProcesses={sessionProcesses}
        editingSessionId={editingSessionId}
        onEditingDone={() => setEditingSessionId(null)}
        initialUse24h={use24h}
      />
      <div
        onMouseDown={() => { dragging.current = true; }}
        style={{
          width: 5,
          cursor: "col-resize",
          flexShrink: 0,
          borderLeft: `1px solid ${theme.ui.border}`,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderLeftColor = theme.ui.textFaint)}
        onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.borderLeftColor = theme.ui.border; }}
      />
      <TerminalPane sessionId={activeId} settings={settings} />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  );
}
