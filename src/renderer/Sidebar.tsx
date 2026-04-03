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

const PROCESS_COLORS: Record<string, string> = {
  claude: "#e78a4e",
  codex: "#4a9eff",
  vim: "#019833",
  nvim: "#019833",
  node: "#68a063",
  python: "#3776ab",
  python3: "#3776ab",
  git: "#f05032",
  docker: "#2496ed",
  npm: "#cb3837",
  cargo: "#dea584",
  ruby: "#cc342d",
  go: "#00add8",
  htop: "#8bc34a",
  top: "#8bc34a",
  ssh: "#9c27b0",
};

const DEFAULT_ACTIVE = "#313244";

function getSessionColor(process: string | undefined, isActive: boolean, defaultActive: string = DEFAULT_ACTIVE): string {
  const color = process ? PROCESS_COLORS[process.toLowerCase()] : null;
  if (!color) return isActive ? defaultActive : "rgba(255,255,255,0.03)";
  return color + (isActive ? "40" : "20");
}

function getSessionBorder(process: string | undefined, isActive: boolean): string {
  const color = process ? PROCESS_COLORS[process.toLowerCase()] : null;
  if (!color) return isActive ? `2px solid #585b70` : "2px solid transparent";
  return `2px solid ${color}${isActive ? "" : "80"}`; // full opacity active, 50% inactive
}

interface Props {
  sessions: SessionInfo[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onClose: (id: string) => void;
  width: number;
  sessionProcesses: Record<string, string>;
  editingSessionId: string | null;
  onEditingDone: () => void;
  initialUse24h: boolean;
}

export default function Sidebar({ sessions, activeId, onNew, onSelect, onRename, onClose, width, sessionProcesses, editingSessionId, onEditingDone, initialUse24h }: Props) {
  const { theme } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [use24h, setUse24h] = useState(initialUse24h);
  const formatTime = (h24: boolean) => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !h24 });
  const [time, setTime] = useState(() => formatTime(true));
  const [editValue, setEditValue] = useState("");
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      setTimeout(() => inputRef.current?.focus(), 50);
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
          onClick={() => onSelect(s.id)}
          onContextMenu={(e) => handleContextMenu(e, s)}
          style={{
            padding: "16px 8px",
            borderRadius: 6,
            cursor: "pointer",
            background: getSessionColor(sessionProcesses[s.id], s.id === activeId, theme.ui.sidebarActive),
            borderLeft: getSessionBorder(sessionProcesses[s.id], s.id === activeId),
            boxShadow: s.id === activeId
              ? `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)`
              : `0 1px 3px rgba(0,0,0,0.15)`,
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
                padding: "2px 4px",
                textAlign: "center",
                outline: "none",
              }}
            />
          ) : (
            s.label
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
          height: 26,
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
              padding: "6px 12px",
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
            onClick={handleMenuClose}
            style={{
              padding: "6px 12px",
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
