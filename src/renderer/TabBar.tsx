import { useState, useRef, useEffect } from "react";
import { useTheme } from "./ThemeContext";

interface SessionInfo {
  id: string;
  label: string;
}

interface ContextMenu {
  sessionId: string;
  x: number;
  y: number;
}

interface Props {
  sessions: SessionInfo[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onClose: (id: string) => void;
  onPopOut: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  sessionProcesses: Record<string, string>;
  caffeinatedSessions: Record<string, boolean>;
  editingSessionId: string | null;
  onEditingDone: () => void;
  tabSize: "small" | "medium" | "large";
  processColors: Record<string, string>;
  showProcessLabel: boolean;
  notifiedSessions: Record<string, boolean>;
}

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "pwsh", "powershell"]);

// Fallback palette mappings for processes without an explicit color
const PROCESS_COLOR_MAP: Record<string, string> = {
  aider: "cyan", vim: "green", nvim: "green",
  node: "green", python: "blue", python3: "blue", git: "red",
  npm: "red", cargo: "yellow", ruby: "red", go: "cyan", htop: "green",
  top: "green", ssh: "magenta",
};

const TAB_SIZES = {
  small:  { height: 30, padding: "0 14px", fontSize: 11, shortcutSize: 9,  shortcutGap: 6,  minWidth: 140 },
  medium: { height: 36, padding: "0 18px", fontSize: 12, shortcutSize: 11, shortcutGap: 8,  minWidth: 180 },
  large:  { height: 44, padding: "0 22px", fontSize: 14, shortcutSize: 12, shortcutGap: 10, minWidth: 220 },
};

export default function TabBar({ sessions, activeId, onNew, onSelect, onRename, onClose, onPopOut, onReorder, sessionProcesses, caffeinatedSessions, editingSessionId, onEditingDone, tabSize, processColors, showProcessLabel, notifiedSessions }: Props) {
  const { theme } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 50);
  }, [editingId]);

  useEffect(() => {
    if (editingSessionId) {
      const s = sessions.find((s) => s.id === editingSessionId);
      if (s) { setEditingId(s.id); setEditValue(s.label); }
      onEditingDone();
    }
  }, [editingSessionId]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const commitRename = () => {
    if (editingId && editValue.trim()) onRename(editingId, editValue.trim());
    setEditingId(null);
  };

  const getTabColor = (process: string | undefined): string | null => {
    if (!process) return null;
    const lower = process.toLowerCase();
    if (processColors[lower]) return processColors[lower];
    const key = PROCESS_COLOR_MAP[lower];
    return key ? (theme.terminal as any)[key] : null;
  };

  const mod = navigator.platform.includes("Mac") ? "⌘" : "^";
  const baseSz = TAB_SIZES[tabSize];
  // Grow tab height when process label row is shown
  const sz = showProcessLabel ? { ...baseSz, height: baseSz.height + 14 } : baseSz;

  return (
    <>
      <div style={{
        display: "flex",
        alignItems: "center",
        background: theme.ui.bgAlt,
        borderBottom: `1px solid ${theme.ui.border}`,
        height: sz.height,
        overflow: "hidden",
        flexShrink: 0,
      }}>
        {/* Tabs */}
        <div style={{ display: "flex", flex: 1, overflow: "auto", height: "100%" }}>
          {sessions.map((s, i) => {
            const proc = sessionProcesses[s.id];
            const color = getTabColor(proc);
            const isActive = s.id === activeId;
            const isRunning = proc && !SHELLS.has(proc.toLowerCase());
            const tooltip = isRunning ? `${s.label} — running ${proc}` : `${s.label} — idle`;
            return (
              <div
                key={s.id}
                title={tooltip}
                draggable={editingId !== s.id}
                onClick={() => onSelect(s.id)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }); }}
                onDragStart={() => setDragId(s.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(s.id); }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== s.id) {
                    const from = sessions.findIndex((x) => x.id === dragId);
                    const to = sessions.findIndex((x) => x.id === s.id);
                    if (from !== -1 && to !== -1) onReorder(from, to);
                  }
                  setDragId(null); setDragOverId(null);
                }}
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  padding: sz.padding,
                  height: "100%",
                  minWidth: sz.minWidth,
                  cursor: dragId ? "grabbing" : "pointer",
                  background: color
                    ? `${color}${isActive ? "55" : "35"}`
                    : isActive ? theme.ui.bg : "transparent",
                  borderBottom: isActive && color ? `2px solid ${color}` : isActive ? `2px solid ${theme.ui.accent}` : "2px solid transparent",
                  borderRight: `1px solid ${theme.ui.border}`,
                  borderLeft: dragOverId === s.id && dragId !== s.id ? `2px solid ${theme.ui.accent}` : "2px solid transparent",
                  opacity: dragId === s.id ? 0.4 : 1,
                  fontSize: sz.fontSize,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive || color ? theme.ui.text : theme.ui.textMuted,
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 4, width: "100%", minWidth: 0 }}>
                  {editingId === s.id ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: theme.ui.bg,
                        color: theme.ui.text,
                        border: `1px solid ${theme.ui.accent}`,
                        borderRadius: 4,
                        fontSize: 12,
                        padding: "2px 4px",
                        outline: "none",
                        width: 80,
                      }}
                    />
                  ) : (
                    <>
                      <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                        {isRunning ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill={color || theme.terminal.green}
                            stroke={color || theme.terminal.green}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ flexShrink: 0 }}
                          >
                            <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={theme.ui.textFaint}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ flexShrink: 0 }}
                          >
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                          </svg>
                        )}
                      </span>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, textAlign: "center" }}>{s.label}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        {notifiedSessions[s.id] && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={theme.terminal.yellow}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ flexShrink: 0 }}
                          >
                            <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                            <path d="M11.68 2.009A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673c-.824-.85-1.678-1.731-2.21-3.348" />
                            <circle cx="18" cy="5" r="3" fill={theme.terminal.yellow} />
                          </svg>
                        )}
                        {caffeinatedSessions[s.id] && <span style={{ fontSize: 8, color: theme.ui.textFaint }}>☕</span>}
                        {i < 9 && <span style={{ fontSize: sz.shortcutSize, color: theme.ui.textFaint }}>{mod}{i + 1}</span>}
                      </span>
                    </>
                  )}
                </div>
                {showProcessLabel && editingId !== s.id && (
                  <div style={{
                    fontSize: 10,
                    fontWeight: 400,
                    color: color || theme.ui.textFaint,
                    marginTop: 2,
                    opacity: 0.85,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textAlign: "center",
                    width: "100%",
                  }}>
                    {sessionProcesses[s.id] ? `(${sessionProcesses[s.id]})` : "\u00a0"}
                  </div>
                )}
              </div>
            );
          })}

          {/* + button */}
          <div
            onClick={onNew}
            title={`New Session (${mod}N)`}
            style={{
              margin: "5px 8px",
              padding: "0 10px",
              height: sz.height - 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: theme.ui.textMuted,
              fontSize: 14,
              flexShrink: 0,
              border: `1.5px dotted ${theme.ui.textFaint}`,
              borderRadius: 4,
            }}
          >
            +
          </div>
        </div>
      </div>

      {/* Context menu */}
      {menu && (
        <div style={{
          position: "fixed",
          left: menu.x,
          top: menu.y,
          background: theme.ui.sidebarActive,
          border: `1px solid ${theme.ui.border}`,
          borderRadius: 8,
          padding: 4,
          zIndex: 100,
          minWidth: 120,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>
          <div
            onClick={() => {
              const s = sessions.find((s) => s.id === menu.sessionId);
              if (s) { setEditingId(s.id); setEditValue(s.label); }
              setMenu(null);
            }}
            style={{ padding: "8px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, color: theme.ui.text }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Rename
          </div>
          <div
            onClick={() => { onPopOut(menu.sessionId); setMenu(null); }}
            style={{ padding: "8px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, color: theme.ui.text }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Pop Out to Window
          </div>
          <div
            onClick={() => { onClose(menu.sessionId); setMenu(null); }}
            style={{ padding: "8px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, color: theme.terminal.red }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Close Session
          </div>
        </div>
      )}
    </>
  );
}
