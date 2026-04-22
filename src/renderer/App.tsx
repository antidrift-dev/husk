import { useState, useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import SplitPaneContainer from "./SplitPaneContainer";
import Settings, { SettingsData, DEFAULTS } from "./Settings";
import { useTheme } from "./ThemeContext";
import { disposeCachedTerminal } from "./TerminalLeaf";
import { PaneNode, createLeaf, splitLeaf, removeLeaf, getAllLeafIds, updateRatio } from "./pane-tree";
import TabBar from "./TabBar";
import Onboarding from "./Onboarding";

interface SessionInfo {
  id: string;
  label: string;
}

interface SessionStatus {
  cwd: string | null;
  fgProcess: string | null;
  mem: number | null;
  claudeCtx: {
    tokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    model: string | null;
    contextWindow: number;
  } | null;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
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
  const focusedPanesRef = useRef<Record<string, string>>({});
  const prevProcessRef = useRef<Record<string, string>>({});
  const processStartTimeRef = useRef<Record<string, number>>({});

  // Pane tree per session
  const [paneTrees, setPaneTrees] = useState<Record<string, PaneNode>>({});
  const [focusedPanes, setFocusedPanes] = useState<Record<string, string>>({});
  focusedPanesRef.current = focusedPanes;

  const [appInfo, setAppInfo] = useState({ version: "0.2.0", build: 0 });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [caffeinatedSessions, setCaffeinatedSessions] = useState<Record<string, boolean>>({});

  // Status bar state — per-session so switching is instant
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [showCtxDetail, setShowCtxDetail] = useState(false);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [processBreakdown, setProcessBreakdown] = useState<{ pid: number; name: string; memory: number; cpu: number }[]>([]);
  const [diskUsage, setDiskUsage] = useState<{ total: number; used: number; available: number; percent: number } | null>(null);
  const [profilePrompt, setProfilePrompt] = useState<string | null>(null);
  const [workspacePrompt, setWorkspacePrompt] = useState<string | null>(null);
  const [notifiedSessions, setNotifiedSessions] = useState<Record<string, boolean>>({});

  const handleNew = async () => {
    const info = await window.husk.createSession(`Session ${sessions.length + 1}`);
    setSessions((prev) => [...prev, info]);
    setActiveId(info.id);
    setPaneTrees((prev) => ({ ...prev, [info.id]: createLeaf(info.paneId) }));
    setFocusedPanes((prev) => ({ ...prev, [info.id]: info.paneId }));
  };

  const handleSelect = async (id: string) => {
    await window.husk.switchSession(id);
    setActiveId(id);
    setNotifiedSessions((prev) => { const { [id]: _, ...rest } = prev; return rest; });
  };

  const handleRename = (id: string, label: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
    window.husk.renameSession(id, label);
  };

  const handleReorder = (fromIndex: number, toIndex: number) => {
    setSessions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleClose = async (id: string) => {
    delete prevProcessRef.current[id];
    delete processStartTimeRef.current[id];
    await window.husk.closeSession(id);
    // Dispose all cached terminals for this session
    const tree = paneTrees[id];
    if (tree) getAllLeafIds(tree).forEach(disposeCachedTerminal);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (id === activeId && remaining.length > 0) {
        const oldIndex = prev.findIndex((s) => s.id === id);
        const newIndex = Math.min(oldIndex, remaining.length - 1);
        setActiveId(remaining[newIndex].id);
      } else if (remaining.length === 0) {
        setActiveId(null);
      }
      return remaining;
    });
    setPaneTrees((prev) => { const { [id]: _, ...rest } = prev; return rest; });
    setFocusedPanes((prev) => { const { [id]: _, ...rest } = prev; return rest; });
    setSessionStatuses((prev) => { const { [id]: _, ...rest } = prev; return rest; });
  };

  const handlePopOut = async (id: string) => {
    const tree = paneTrees[id];
    if (tree) getAllLeafIds(tree).forEach(disposeCachedTerminal);
    await window.husk.popOutSession(id);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (id === activeId && remaining.length > 0) {
        const oldIndex = prev.findIndex((s) => s.id === id);
        setActiveId(remaining[Math.min(oldIndex, remaining.length - 1)].id);
      } else if (remaining.length === 0) {
        setActiveId(null);
      }
      return remaining;
    });
    setPaneTrees((prev) => { const { [id]: _, ...rest } = prev; return rest; });
    setFocusedPanes((prev) => { const { [id]: _, ...rest } = prev; return rest; });
  };

  // Split pane
  const handleSplit = async (direction: "horizontal" | "vertical") => {
    if (!activeId) return;
    const focusedPaneId = focusedPanes[activeId];
    if (!focusedPaneId) return;

    // Get cwd of focused pane
    const cwdVal = await window.husk.paneCwd(activeId, focusedPaneId);
    const newPaneId = await window.husk.createPane(activeId, cwdVal || undefined);
    if (!newPaneId) return;

    setPaneTrees((prev) => ({
      ...prev,
      [activeId]: splitLeaf(prev[activeId], focusedPaneId, direction, newPaneId),
    }));
    setFocusedPanes((prev) => ({ ...prev, [activeId]: newPaneId }));
  };

  // Close individual pane
  const handleClosePane = async (sessionId: string, paneId: string) => {
    const tree = paneTrees[sessionId];
    if (!tree) return;
    const leafIds = getAllLeafIds(tree);
    if (leafIds.length <= 1) {
      handleClose(sessionId);
      return;
    }
    await window.husk.closePane(sessionId, paneId);
    disposeCachedTerminal(paneId);
    const newTree = removeLeaf(tree, paneId);
    if (!newTree) {
      handleClose(sessionId);
      return;
    }
    setPaneTrees((prev) => ({ ...prev, [sessionId]: newTree }));
    if (focusedPanes[sessionId] === paneId) {
      const remaining = getAllLeafIds(newTree);
      setFocusedPanes((prev) => ({ ...prev, [sessionId]: remaining[0] }));
    }
  };

  const handleRatioChange = (splitId: string, ratio: number) => {
    if (!activeId) return;
    setPaneTrees((prev) => ({
      ...prev,
      [activeId]: updateRatio(prev[activeId], splitId, ratio),
    }));
  };

  const handlePaneFocus = (paneId: string) => {
    if (!activeId) return;
    setFocusedPanes((prev) => ({ ...prev, [activeId]: paneId }));
  };

  // Load app info
  useEffect(() => {
    window.husk.getAppInfo().then(setAppInfo);
  }, []);

  // Poll disk usage
  useEffect(() => {
    const poll = () => window.husk.getDiskUsage().then(setDiskUsage);
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load settings + check onboarding
  useEffect(() => {
    window.husk.loadSettings().then((json) => {
      if (json) {
        try {
          const parsed = JSON.parse(json);
          setSettings({ ...DEFAULTS, ...parsed });
          if (!parsed._onboardingDone) setShowOnboarding(true);
        } catch {}
      } else {
        // No settings file = first launch
        setShowOnboarding(true);
      }
    });
  }, []);

  // Save profile prompt
  useEffect(() => {
    return window.husk.onSaveProfilePrompt(() => {
      setProfilePrompt("");
    });
  }, []);

  // Save workspace prompt (from menu)
  useEffect(() => {
    return window.husk.onSaveWorkspacePrompt(() => {
      setWorkspacePrompt("");
    });
  }, []);

  // Respond to workspace:collect-state requests from main (for multi-window save)
  useEffect(() => {
    return window.husk.onCollectWorkspaceState((winId) => {
      const snapshot = {
        sessions: sessions.map((s) => ({
          id: s.id,
          label: s.label,
          paneTree: paneTrees[s.id] || createLeaf(),
          focusedPaneId: focusedPanes[s.id] || "",
        })),
        activeSessionId: activeId,
      };
      window.husk.respondWorkspaceState(winId, snapshot);
    });
  }, [sessions, paneTrees, focusedPanes, activeId]);

  const handleOnboardingDone = () => {
    setShowOnboarding(false);
    const withFlag = { ...settings, _onboardingDone: true };
    window.husk.saveSettings(JSON.stringify(withFlag));
  };

  const handleSettingsChange = (next: SettingsData) => {
    setSettings(next);
    window.husk.saveSettings(JSON.stringify(next));
  };

  useEffect(() => {
    return window.husk.onSettingsToggle(() => setSettingsOpen((v) => !v));
  }, []);

  // Restore sessions
  useEffect(() => {
    window.husk.restoreSessions().then((data) => {
      if (data.sessions.length > 0) {
        setSessions(data.sessions);
        const trees: Record<string, PaneNode> = {};
        const focused: Record<string, string> = {};
        for (const s of data.sessions) {
          trees[s.id] = s.paneTree ? (s.paneTree as PaneNode) : createLeaf(s.paneId);
          focused[s.id] = s.focusedPaneId || s.paneId;
        }
        setPaneTrees(trees);
        setFocusedPanes(focused);
        const idx = data.activeIndex >= 0 && data.activeIndex < data.sessions.length
          ? data.activeIndex : data.sessions.length - 1;
        setActiveId(data.sessions[idx].id);
      } else {
        // Fresh install — create first session
        handleNew();
      }
      if (data.sidebarWidth) setSidebarWidth(data.sidebarWidth);
      if (data.themeId) setThemeId(data.themeId);
      if (typeof data.use24h === "boolean") setUse24h(data.use24h);
    });
  }, []);

  // Sync session menu
  useEffect(() => {
    window.husk.syncSessionMenu(sessions.map((s) => ({ id: s.id, label: s.label })));
  }, [sessions]);

  // Sidebar resize
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const maxWidth = Math.min(300, window.innerWidth * 0.4);
      setSidebarWidth(Math.max(48, Math.min(maxWidth, e.clientX)));
    };
    const onMouseUp = () => {
      if (dragging.current) { dragging.current = false; window.husk.saveSidebarWidth(sidebarWidthRef.current); }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, []);

  // Title
  useEffect(() => {
    const active = sessions.find((s) => s.id === activeId);
    const v = `v${appInfo.version}`;
    document.title = active ? `Husk - ${active.label}  ·  ${v}` : `Husk  ·  ${v}`;
  }, [activeId, sessions]);

  // Menu shortcuts
  useEffect(() => {
    const cleanupNew = window.husk.onNewSession(() => handleNew());
    const cleanupRename = window.husk.onRenameActiveSession(() => { if (activeId) setEditingSessionId(activeId); });
    const cleanupPopOut = window.husk.onPopOutActiveSession(() => { if (activeId) handlePopOut(activeId); });
    const cleanupClose = window.husk.onCloseActiveSession(() => { if (activeId) handleClose(activeId); });
    const cleanupSwitch = window.husk.onSwitchIndex((index) => { if (index < sessions.length) handleSelect(sessions[index].id); });
    const cleanupSendBytes = window.husk.onSendBytes((bytes) => {
      if (activeId && focusedPanes[activeId]) {
        const data = String.fromCharCode(...bytes);
        window.husk.inputPane(activeId, focusedPanes[activeId], data);
      }
    });
    return () => { cleanupNew(); cleanupRename(); cleanupPopOut(); cleanupClose(); cleanupSwitch(); cleanupSendBytes(); };
  }, [activeId, sessions, focusedPanes]);

  // Pane split/focus shortcuts
  useEffect(() => {
    const cleanupSplit = window.husk.onPaneSplit((dir) => handleSplit(dir));
    const cleanupFocusPrev = window.husk.onPaneFocusPrev(() => {
      if (!activeId) return;
      const tree = paneTrees[activeId];
      if (!tree) return;
      const ids = getAllLeafIds(tree);
      const idx = ids.indexOf(focusedPanes[activeId]);
      const next = ids[(idx - 1 + ids.length) % ids.length];
      setFocusedPanes((prev) => ({ ...prev, [activeId]: next }));
    });
    const cleanupFocusNext = window.husk.onPaneFocusNext(() => {
      if (!activeId) return;
      const tree = paneTrees[activeId];
      if (!tree) return;
      const ids = getAllLeafIds(tree);
      const idx = ids.indexOf(focusedPanes[activeId]);
      const next = ids[(idx + 1) % ids.length];
      setFocusedPanes((prev) => ({ ...prev, [activeId]: next }));
    });
    return () => { cleanupSplit(); cleanupFocusPrev(); cleanupFocusNext(); };
  }, [activeId, paneTrees, focusedPanes]);

  // Handle pane exit (from PTY dying)
  // Don't call handleClosePane here — it would re-call closeSession/closePane on main,
  // causing cascading kills. Just clean up renderer state; session:exited handles the rest.
  useEffect(() => {
    const cleanup = window.husk.onPaneExited((sessionId, paneId) => {
      disposeCachedTerminal(paneId);
      setPaneTrees((prev) => {
        const tree = prev[sessionId];
        if (!tree) return prev;
        const leafIds = getAllLeafIds(tree);
        if (leafIds.length <= 1) {
          // Last pane — session:exited will remove the session shortly
          return prev;
        }
        const newTree = removeLeaf(tree, paneId);
        if (!newTree) return prev;
        return { ...prev, [sessionId]: newTree };
      });
      setFocusedPanes((prev) => {
        if (prev[sessionId] !== paneId) return prev;
        const tree = paneTrees[sessionId];
        if (!tree) return prev;
        const remaining = getAllLeafIds(tree).filter((id) => id !== paneId);
        if (remaining.length === 0) return prev;
        return { ...prev, [sessionId]: remaining[0] };
      });
    });
    return cleanup;
  }, [paneTrees]);

  // Session exit
  useEffect(() => {
    return window.husk.onSessionExited((id) => {
      delete prevProcessRef.current[id];
      delete processStartTimeRef.current[id];
      // Dispose cached terminals for this session's panes
      setPaneTrees((prev) => {
        const tree = prev[id];
        if (tree) getAllLeafIds(tree).forEach(disposeCachedTerminal);
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      setFocusedPanes((prev) => { const { [id]: _, ...rest } = prev; return rest; });
      setSessionStatuses((prev) => { const { [id]: _, ...rest } = prev; return rest; });
      setSessions((prev) => {
        const oldIndex = prev.findIndex((s) => s.id === id);
        if (oldIndex === -1) return prev; // already removed
        const remaining = prev.filter((s) => s.id !== id);
        if (remaining.length > 0) {
          const newIndex = Math.min(oldIndex, remaining.length - 1);
          setActiveId((cur) => cur === id ? remaining[newIndex].id : cur);
        } else {
          setActiveId(null);
        }
        return remaining;
      });
    });
  }, []);

  // Session notification (long-running command completed)
  useEffect(() => {
    return window.husk.onSessionNotified((id) => {
      // Don't flag the currently active session — user is already looking at it
      setNotifiedSessions((prev) => id === activeId ? prev : { ...prev, [id]: true });
    });
  }, [activeId]);

  // Poll all sessions for status bar + sidebar colors
  useEffect(() => {
    if (sessions.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const procs: Record<string, string> = {};
      const caff: Record<string, boolean> = {};
      await Promise.all(sessions.map(async (s) => {
        const focusedPaneId = focusedPanesRef.current[s.id];
        const [dir, proc, mem, caffeinated] = await Promise.all([
          window.husk.getCwd(s.id, focusedPaneId),
          window.husk.getForegroundProcess(s.id, focusedPaneId),
          window.husk.getSessionMemory(s.id),
          window.husk.isCaffeinated(s.id),
        ]);
        if (cancelled) return;
        if (proc) procs[s.id] = proc;
        if (caffeinated) caff[s.id] = true;

        if (proc) {
          const shells = ["zsh", "bash", "fish", "sh", "pwsh", "powershell"];
          const prev = prevProcessRef.current[s.id];
          if (prev && !shells.includes(prev) && shells.includes(proc)) {
            const started = processStartTimeRef.current[s.id];
            const duration = started ? Math.round((Date.now() - started) / 1000) : 0;
            window.husk.notifyProcessComplete(s.id, s.label, prev, duration);
          }
          if (proc !== prev) {
            if (!shells.includes(proc)) processStartTimeRef.current[s.id] = Date.now();
            prevProcessRef.current[s.id] = proc;
          }
        }
        setSessionStatuses(prev => ({
          ...prev,
          [s.id]: { cwd: dir, fgProcess: proc, mem, claudeCtx: prev[s.id]?.claudeCtx ?? null },
        }));
        if (proc === "claude") {
          const ctx = await window.husk.getClaudeContext(s.id, focusedPaneId);
          if (cancelled) return;
          setSessionStatuses(prev => ({ ...prev, [s.id]: { ...prev[s.id], claudeCtx: ctx } }));
        } else if (proc === "codex") {
          const ctx = await window.husk.getCodexContext(s.id, focusedPaneId);
          if (cancelled) return;
          setSessionStatuses(prev => ({ ...prev, [s.id]: { ...prev[s.id], claudeCtx: ctx } }));
        } else {
          if (!cancelled) setSessionStatuses(prev => ({ ...prev, [s.id]: { ...prev[s.id], claudeCtx: null } }));
        }
      }));
      if (!cancelled) {
        setSessionProcesses(procs);
        setCaffeinatedSessions(caff);
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessions]);

  const activeTree = activeId ? paneTrees[activeId] : null;
  const activeFocusedPane = activeId ? focusedPanes[activeId] : null;

  // Derive status bar values from per-session cache — instant on session switch
  const activeStatus = activeId ? sessionStatuses[activeId] : null;
  const cwd = activeStatus?.cwd ?? null;
  const fgProcess = activeStatus?.fgProcess ?? null;
  const sessionMem = activeStatus?.mem ?? null;
  const claudeCtx = activeStatus?.claudeCtx ?? null;

  const isTopTabs = settings.tabPosition === "top";

  return (
    <div style={{ display: "flex", flexDirection: isTopTabs ? "column" : "row", height: "100vh", background: theme.ui.bg, color: theme.ui.text, userSelect: dragging.current ? "none" : "auto" }}>
      {isTopTabs ? (
        <TabBar
          sessions={sessions}
          activeId={activeId}
          onNew={handleNew}
          onSelect={handleSelect}
          onRename={handleRename}
          onClose={handleClose}
          onPopOut={handlePopOut}
          onReorder={handleReorder}
          sessionProcesses={sessionProcesses}
          caffeinatedSessions={caffeinatedSessions}
          editingSessionId={editingSessionId}
          onEditingDone={() => setEditingSessionId(null)}
          tabSize={settings.tabSize}
          processColors={settings.processColors}
          showProcessLabel={settings.showTabProcessLabel}
          notifiedSessions={notifiedSessions}
        />
      ) : (
        <>
          <Sidebar
            sessions={sessions}
            activeId={activeId}
            onNew={handleNew}
            onSelect={handleSelect}
            onRename={handleRename}
            onClose={handleClose}
            onReorder={handleReorder}
            width={sidebarWidth}
            sessionProcesses={sessionProcesses}
            caffeinatedSessions={caffeinatedSessions}
            editingSessionId={editingSessionId}
            onEditingDone={() => setEditingSessionId(null)}
            initialUse24h={use24h}
            processColors={settings.processColors}
          />
          <div
            onMouseDown={() => { dragging.current = true; }}
            style={{
              width: 4,
              cursor: "col-resize",
              flexShrink: 0,
              borderLeft: `1px solid ${theme.ui.border}`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderLeftColor = theme.ui.textFaint)}
            onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.borderLeftColor = theme.ui.border; }}
          />
        </>
      )}
      <div onClick={() => setShowPerfMonitor(false)} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: theme.ui.bg, overflow: "hidden" }}>
        {/* Split pane area */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", background: theme.terminal.background }}>
          {activeTree && activeId && activeFocusedPane ? (
            <SplitPaneContainer
              node={activeTree}
              sessionId={activeId}
              focusedPaneId={activeFocusedPane}
              settings={settings}
              onFocus={handlePaneFocus}
              onRatioChange={handleRatioChange}
            />
          ) : (
            <div style={{ flex: 1 }} />
          )}
        </div>

        {/* Status bar */}
        <div style={{
          height: 32,
          padding: "0 14px",
          borderTop: `1px solid ${theme.ui.textMuted}bf`,
          background: theme.ui.bg,
          color: theme.ui.textMuted,
          fontSize: 13,
          fontFamily: "monospace",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <span title={cwd || undefined}>
            {cwd ? (cwd.length > 60 ? `\u2026${cwd.slice(-(60))}` : cwd) : "\u00a0"}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
            {sessionMem != null && (
              <span
                style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                onClick={async () => {
                  if (activeId) {
                    const breakdown = await window.husk.getProcessBreakdown(activeId);
                    if (breakdown) setProcessBreakdown(breakdown);
                    setShowPerfMonitor(!showPerfMonitor);
                  }
                }}
              >
                memory used: {sessionMem} MB
              </span>
            )}
            {sessionMem != null && <span style={{ width: 1, height: 16, background: theme.ui.textMuted }} />}
            {diskUsage && (
              <span style={{ color: diskUsage.percent > 90 ? theme.terminal.red : diskUsage.percent > 75 ? theme.terminal.yellow : theme.ui.textMuted }}>
                disk: {diskUsage.available} GB (avail)
              </span>
            )}
            <span style={{ width: 1, height: 16, background: theme.ui.textMuted }} />
            {claudeCtx && (fgProcess === "claude" || fgProcess === "codex") ? (
              <span
                style={{
                  cursor: "pointer",
                  textDecoration: "underline dotted",
                  color: claudeCtx.tokens / claudeCtx.contextWindow > 0.9
                    ? theme.terminal.red
                    : claudeCtx.tokens / claudeCtx.contextWindow > 0.75
                      ? theme.terminal.yellow
                      : theme.ui.textMuted,
                }}
                onClick={() => setShowCtxDetail((v) => !v)}
              >
                {fgProcess} (ctx: {formatTokens(claudeCtx.tokens)})
              </span>
            ) : (
              fgProcess || "terminal"
            )}

            {/* Agent context detail popup */}
            {showCtxDetail && claudeCtx && (
              <div
                style={{
                  position: "absolute",
                  bottom: 28,
                  right: 0,
                  width: 280,
                  background: theme.ui.bgAlt,
                  border: `1px solid ${theme.ui.border}`,
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  padding: 12,
                  fontSize: 11,
                  fontFamily: "monospace",
                  zIndex: 50,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{fgProcess === "codex" ? "Codex" : "Claude"} Context</span>
                  <span style={{ cursor: "pointer", color: theme.ui.textFaint }} onClick={() => setShowCtxDetail(false)}>✕</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                  <span style={{ color: theme.ui.textMuted }}>model</span>
                  <span>{claudeCtx.model || "unknown"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                  <span style={{ color: theme.ui.textMuted }}>context window</span>
                  <span>{claudeCtx.contextWindow.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                  <span style={{ color: theme.ui.textMuted }}>used</span>
                  <span>{claudeCtx.tokens.toLocaleString()} ({((claudeCtx.tokens / claudeCtx.contextWindow) * 100).toFixed(1)}%)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                  <span style={{ color: theme.ui.textMuted }}>cache read</span>
                  <span>{claudeCtx.cacheReadTokens.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                  <span style={{ color: theme.ui.textMuted }}>cache write</span>
                  <span>{claudeCtx.cacheCreationTokens.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                  <span style={{ color: theme.ui.textMuted }}>new input</span>
                  <span>{claudeCtx.inputTokens.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span style={{ color: theme.ui.textMuted }}>output (last turn)</span>
                  <span>{claudeCtx.outputTokens.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Performance monitor popup */}
            {showPerfMonitor && processBreakdown.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  bottom: 28,
                  right: 0,
                  width: 360,
                  maxHeight: 320,
                  overflow: "auto",
                  background: theme.ui.bgAlt,
                  border: `1px solid ${theme.ui.border}`,
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  padding: 12,
                  fontSize: 11,
                  fontFamily: "monospace",
                  zIndex: 50,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>Session Performance</span>
                  <span style={{ cursor: "pointer", color: theme.ui.textFaint }} onClick={() => setShowPerfMonitor(false)}>✕</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}`, fontWeight: 600, color: theme.ui.textMuted }}>
                  <span style={{ flex: 2 }}>Process</span>
                  <span style={{ flex: 1, textAlign: "right" }}>PID</span>
                  <span style={{ flex: 1, textAlign: "right" }}>Memory</span>
                  <span style={{ flex: 1, textAlign: "right" }}>CPU</span>
                </div>
                {processBreakdown.map((p) => (
                  <div key={p.pid} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.ui.border}` }}>
                    <span style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ flex: 1, textAlign: "right", color: theme.ui.textFaint }}>{p.pid}</span>
                    <span style={{ flex: 1, textAlign: "right" }}>{p.memory} MB</span>
                    <span style={{ flex: 1, textAlign: "right", color: p.cpu > 50 ? theme.terminal.red : p.cpu > 10 ? theme.terminal.yellow : theme.ui.textMuted }}>{p.cpu.toFixed(1)}%</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontWeight: 600 }}>
                  <span>Total</span>
                  <span />
                  <span style={{ textAlign: "right" }}>{processBreakdown.reduce((s, p) => s + p.memory, 0)} MB</span>
                  <span style={{ textAlign: "right" }}>{processBreakdown.reduce((s, p) => s + p.cpu, 0).toFixed(1)}%</span>
                </div>
              </div>
            )}
          </span>
        </div>
      </div>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
      {showOnboarding && <Onboarding onDone={handleOnboardingDone} />}

      {workspacePrompt !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setWorkspacePrompt(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              background: theme.ui.bgAlt,
              border: `1px solid ${theme.ui.border}`,
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: theme.ui.text }}>
              Save Workspace
            </div>
            <div style={{ fontSize: 12, color: theme.ui.textMuted, marginBottom: 16 }}>
              Saves all open windows, sessions, and split layouts.
            </div>
            <input
              autoFocus
              value={workspacePrompt}
              onChange={(e) => setWorkspacePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && workspacePrompt.trim()) {
                  const name = workspacePrompt.trim();
                  const snapshot = {
                    sessions: sessions.map((s) => ({
                      id: s.id,
                      label: s.label,
                      paneTree: paneTrees[s.id] || createLeaf(),
                      focusedPaneId: focusedPanes[s.id] || "",
                    })),
                    activeSessionId: activeId,
                  };
                  window.husk.saveWorkspace(name, snapshot);
                  setWorkspacePrompt(null);
                }
                if (e.key === "Escape") setWorkspacePrompt(null);
              }}
              placeholder="Workspace name"
              style={{
                width: "100%",
                background: theme.ui.bg,
                color: theme.ui.text,
                border: `1px solid ${theme.ui.border}`,
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 13,
                outline: "none",
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setWorkspacePrompt(null)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: theme.ui.textMuted,
                  border: `1px solid ${theme.ui.border}`,
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                disabled={!workspacePrompt.trim()}
                onClick={() => {
                  if (workspacePrompt.trim()) {
                    const name = workspacePrompt.trim();
                    const snapshot = {
                      sessions: sessions.map((s) => ({
                        id: s.id,
                        label: s.label,
                        paneTree: paneTrees[s.id] || createLeaf(),
                        focusedPaneId: focusedPanes[s.id] || "",
                      })),
                      activeSessionId: activeId,
                    };
                    window.husk.saveWorkspace(name, snapshot);
                    setWorkspacePrompt(null);
                  }
                }}
                style={{
                  padding: "8px 20px",
                  background: theme.ui.accent,
                  color: theme.ui.bg,
                  border: "none",
                  borderRadius: 4,
                  cursor: workspacePrompt.trim() ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: workspacePrompt.trim() ? 1 : 0.5,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {profilePrompt !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setProfilePrompt(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              background: theme.ui.bgAlt,
              border: `1px solid ${theme.ui.border}`,
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: theme.ui.text }}>
              Save as Profile
            </div>
            <input
              autoFocus
              value={profilePrompt}
              onChange={(e) => setProfilePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && profilePrompt.trim()) {
                  window.husk.saveProfile(profilePrompt.trim());
                  setProfilePrompt(null);
                }
                if (e.key === "Escape") setProfilePrompt(null);
              }}
              placeholder="Profile name"
              style={{
                width: "100%",
                background: theme.ui.bg,
                color: theme.ui.text,
                border: `1px solid ${theme.ui.border}`,
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 13,
                outline: "none",
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setProfilePrompt(null)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: theme.ui.textMuted,
                  border: `1px solid ${theme.ui.border}`,
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                disabled={!profilePrompt.trim()}
                onClick={() => {
                  if (profilePrompt.trim()) {
                    window.husk.saveProfile(profilePrompt.trim());
                    setProfilePrompt(null);
                  }
                }}
                style={{
                  padding: "8px 20px",
                  background: theme.ui.accent,
                  color: theme.ui.bg,
                  border: "none",
                  borderRadius: 4,
                  cursor: profilePrompt.trim() ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: profilePrompt.trim() ? 1 : 0.5,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
