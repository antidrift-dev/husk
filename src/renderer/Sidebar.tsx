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

// Fallback palette mappings for processes without an explicit color
const PROCESS_COLOR_MAP: Record<string, string> = {
  aider: "cyan",
  vim: "green",
  nvim: "green",
  node: "green",
  python: "blue",
  python3: "blue",
  git: "red",
  npm: "red",
  cargo: "yellow",
  ruby: "red",
  go: "cyan",
  htop: "green",
  top: "green",
  ssh: "magenta",
};

function getProcessColor(process: string | undefined, theme: any, processColors: Record<string, string>): string | null {
  if (!process) return null;
  const lower = process.toLowerCase();
  if (processColors[lower]) return processColors[lower];
  const colorKey = PROCESS_COLOR_MAP[lower];
  if (!colorKey) return null;
  return theme.terminal[colorKey] || null;
}

function getSessionColor(process: string | undefined, isActive: boolean, defaultActive: string, theme: any, processColors: Record<string, string>): string {
  const color = getProcessColor(process, theme, processColors);
  if (!color) return isActive ? defaultActive : "rgba(255,255,255,0.03)";
  return color + (isActive ? "40" : "20");
}

function getSessionBorder(process: string | undefined, isActive: boolean, theme: any, processColors: Record<string, string>): string {
  const color = getProcessColor(process, theme, processColors);
  if (!color) return isActive ? `2px solid ${theme.ui.textFaint}` : "2px solid transparent";
  return `2px solid ${color}${isActive ? "" : "80"}`;
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
  width: number;
  sessionProcesses: Record<string, string>;
  caffeinatedSessions: Record<string, boolean>;
  editingSessionId: string | null;
  onEditingDone: () => void;
  initialUse24h: boolean;
  processColors: Record<string, string>;
}

export default function Sidebar({ sessions, activeId, onNew, onSelect, onRename, onClose, onPopOut, onReorder, width, sessionProcesses, caffeinatedSessions, editingSessionId, onEditingDone, initialUse24h, processColors }: Props) {
  const { theme } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [use24h, setUse24h] = useState(initialUse24h);
  const formatTime = (h24: boolean) => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !h24 });
  const [time, setTime] = useState(() => formatTime(true));
  const [editValue, setEditValue] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 50);
    }
  }, [editingId]);

  useEffect(() => {
    const tick = () => setTime(formatTime(use24h));
    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, [use24h]);

  // External rename trigger (Cmd+R)
  useEffect(() => {
    if (editingSessionId) {
      const s = sessions.find((s) => s.id === editingSessionId);
      if (s) {
        setEditingId(s.id);
        setEditValue(s.label);
      }
      onEditingDone();
    }
  }, [editingSessionId]);

  // Close menu on any click
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const handleContextMenu = (e: React.MouseEvent, s: SessionInfo) => {
    e.preventDefault();
    setMenu({ sessionId: s.id, x: e.clientX, y: e.clientY });
  };

  const handleMenuRename = () => {
    if (!menu) return;
    const s = sessions.find((s) => s.id === menu.sessionId);
    if (s) {
      setEditingId(s.id);
      setEditValue(s.label);
    }
    setMenu(null);
  };

  const handleMenuClose = () => {
    if (!menu) return;
    onClose(menu.sessionId);
    setMenu(null);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div
      style={{
        width,
        minWidth: 48,
        flexShrink: 0,
        padding: "8px 8px 0 8px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflow: "hidden",
        background: theme.ui.bgAlt,
      }}
    >
      {sessions.map((s, i) => (
        <div
          key={s.id}
          draggable={editingId !== s.id}
          onClick={() => onSelect(s.id)}
          onContextMenu={(e) => handleContextMenu(e, s)}
          onDragStart={(e) => {
            setDragId(s.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverId(s.id);
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== s.id) {
              const fromIdx = sessions.findIndex((x) => x.id === dragId);
              const toIdx = sessions.findIndex((x) => x.id === s.id);
              if (fromIdx !== -1 && toIdx !== -1) onReorder(fromIdx, toIdx);
            }
            setDragId(null);
            setDragOverId(null);
          }}
          onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          style={{
            padding: "16px 8px",
            borderRadius: 6,
            cursor: dragId ? "grabbing" : "pointer",
            background: getSessionColor(sessionProcesses[s.id], s.id === activeId, theme.ui.sidebarActive, theme, processColors),
            borderLeft: getSessionBorder(sessionProcesses[s.id], s.id === activeId, theme, processColors),
            borderTop: dragOverId === s.id && dragId !== s.id ? `2px solid ${theme.ui.accent}` : "2px solid transparent",
            boxShadow: s.id === activeId
              ? `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)`
              : `0 1px 3px rgba(0,0,0,0.15)`,
            opacity: dragId === s.id ? 0.4 : 1,
            transition: "all 0.15s ease",
            fontSize: 13,
            fontWeight: s.id === activeId ? 600 : 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "center",
            position: "relative",
          }}
        >
          {i < 9 && (
            <span style={{
              position: "absolute",
              top: 4,
              right: 6,
              fontSize: 12,
              color: theme.ui.text,
              fontWeight: 500,
              opacity: 0.5,
            }}>
              {navigator.platform.includes("Mac") ? "⌘" : "^"}{i + 1}
            </span>
          )}
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
                width: "100%",
                background: theme.ui.bg,
                color: theme.ui.text,
                border: `1px solid ${theme.ui.accent}`,
                borderRadius: 2,
                fontSize: 11,
                padding: "4px",
                textAlign: "center",
                outline: "none",
              }}
            />
          ) : (
            <>
              {s.label}
              {caffeinatedSessions[s.id] && (
                <div style={{ fontSize: 9, color: theme.ui.textMuted, marginTop: 4 }}>
                  caffeinated
                </div>
              )}
            </>
          )}
        </div>
      ))}

      <button
        onClick={onNew}
        title={`New Session (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}N)`}
        style={{
          padding: "8px",
          background: "transparent",
          color: theme.ui.textMuted,
          border: `1.5px dashed ${theme.ui.textFaint}`,
          borderRadius: 6,
          cursor: "pointer",
          transition: "all 0.15s ease",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>

      <div style={{ flex: 1 }} />

      <div
        style={{
          height: 24,
          fontSize: 11,
          color: theme.ui.textMuted,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          borderTop: `1px solid ${theme.ui.border}`,
          background: theme.ui.bgAlt,
        }}
      >
        <span style={{ cursor: "pointer" }} onClick={() => setUse24h((v) => { const next = !v; window.husk.saveUse24h(next); return next; })}>{time}</span>
        <span>{theme.name.toLowerCase()}</span>
      </div>

      {menu && (
        <div
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            background: theme.ui.sidebarActive,
            border: `1px solid ${theme.ui.border}`,
            borderRadius: 6,
            padding: 4,
            zIndex: 100,
            minWidth: 120,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <div
            onClick={handleMenuRename}
            style={{
              padding: "8px 12px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
              color: theme.ui.text,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Rename
          </div>
          <div
            onClick={() => { if (menu) { onPopOut(menu.sessionId); setMenu(null); } }}
            style={{
              padding: "8px 12px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
              color: theme.ui.text,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Pop Out to Window
          </div>
          <div
            onClick={handleMenuClose}
            style={{
              padding: "8px 12px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
              color: theme.terminal.red,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.border)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Close Session
          </div>
        </div>
      )}
    </div>
  );
}
