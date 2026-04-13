import { useState, useEffect, useRef } from "react";
import { useTheme } from "./ThemeContext";

interface SettingsData {
  fontSize: number;
  fontFamily: string;
  fontLigatures: boolean;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  smoothScrolling: boolean;
  inlineImages: boolean;
  tabPosition: "sidebar" | "top";
  tabSize: "small" | "medium" | "large";
  showTabProcessLabel: boolean;
  quakeMode: boolean;
  quakeHotkey: string;
  processColors: Record<string, string>;
}

const DEFAULT_PROCESS_COLORS: Record<string, string> = {
  claude: "#d97757",
  codex: "#5b8def",
  gemini: "#4285f4",
  copilot: "#6e5494",
  docker: "#2496ed",
  zsh: "#94a3b8",
  bash: "#94a3b8",
  fish: "#94a3b8",
  sh: "#94a3b8",
  git: "#f05032",
  vim: "#019733",
  nvim: "#019733",
  node: "#8cc84b",
  python: "#3776ab",
  ssh: "#a855f7",
};

const DEFAULTS: SettingsData = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', monospace",
  fontLigatures: false,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 1000,
  smoothScrolling: true,
  tabPosition: "sidebar",
  tabSize: "medium",
  showTabProcessLabel: true,
  quakeMode: false,
  quakeHotkey: "Control+`",
  inlineImages: false,
  processColors: DEFAULT_PROCESS_COLORS,
};

interface Props {
  open: boolean;
  onClose: () => void;
  settings: SettingsData;
  onSettingsChange: (settings: SettingsData) => void;
}

export type { SettingsData };
export { DEFAULTS, DEFAULT_PROCESS_COLORS };

const TABS = ["Appearance", "Terminal", "Features", "Process Colors"] as const;
type Tab = typeof TABS[number];

export default function Settings({ open, onClose, settings, onSettingsChange }: Props) {
  const { theme, themeId, setThemeId, allThemes } = useTheme();
  const [local, setLocal] = useState(settings);
  const [tab, setTab] = useState<Tab>("Appearance");
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(settings);
  }, [settings, open]);

  if (!open) return null;

  const update = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    onSettingsChange(next);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1500);
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: `1px solid ${theme.ui.border}`,
    fontSize: 13,
  };

  const selectStyle: React.CSSProperties = {
    background: theme.ui.bg,
    color: theme.ui.text,
    border: `1px solid ${theme.ui.border}`,
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 12,
    outline: "none",
  };

  const inputStyle: React.CSSProperties = {
    ...selectStyle,
    width: 60,
    textAlign: "right",
  };

  const noteStyle: React.CSSProperties = {
    fontSize: 11,
    color: theme.ui.textMuted,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          height: 640,
          display: "flex",
          flexDirection: "column",
          background: theme.ui.bgAlt,
          border: `1px solid ${theme.ui.border}`,
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header + tabs */}
        <div style={{ padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>
              Settings
              {saved && (
                <span style={{
                  marginLeft: 12,
                  fontSize: 11,
                  fontWeight: 400,
                  color: theme.terminal.green,
                  transition: "opacity 0.3s ease",
                }}>
                  ✓ Saved
                </span>
              )}
            </span>
            <span
              onClick={onClose}
              style={{ cursor: "pointer", color: theme.ui.textFaint, fontSize: 18 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = theme.ui.text)}
              onMouseLeave={(e) => (e.currentTarget.style.color = theme.ui.textFaint)}
            >
              ✕
            </span>
          </div>
          <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${theme.ui.border}` }}>
            {TABS.map((t) => (
              <div
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? theme.ui.text : theme.ui.textMuted,
                  borderBottom: tab === t ? `2px solid ${theme.ui.accent}` : "2px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>

          {tab === "Appearance" && (
            <>
              {/* Theme */}
              <style>{`
                .theme-list::-webkit-scrollbar { width: 6px; }
                .theme-list::-webkit-scrollbar-track { background: transparent; }
                .theme-list::-webkit-scrollbar-thumb { background: ${theme.ui.border}; border-radius: 4px; }
                .theme-list::-webkit-scrollbar-thumb:hover { background: ${theme.ui.textFaint}; }
              `}</style>
              <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                {/* Theme list */}
                <div className="theme-list" style={{ width: 320, flexShrink: 0, maxHeight: 200, overflow: "auto", borderRadius: 8, border: `1px solid ${theme.ui.border}` }}>
                  {Object.entries(allThemes).map(([id, t]) => (
                    <div
                      key={id}
                      onClick={() => setThemeId(id)}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: id === themeId ? 600 : 400,
                        background: id === themeId ? theme.ui.sidebarActive : "transparent",
                        borderLeft: id === themeId ? `4px solid ${theme.ui.accent}` : "4px solid transparent",
                        borderBottom: `1px solid ${theme.ui.border}`,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {t.name}
                    </div>
                  ))}
                </div>

                {/* Preview of selected theme */}
                {(() => {
                  const t = allThemes[themeId] || Object.values(allThemes)[0];
                  if (!t) return null;
                  return (
                    <div style={{
                      flex: 1,
                      borderRadius: 8,
                      background: t.terminal.background,
                      border: `1px solid ${t.ui.border}`,
                      padding: 16,
                      fontFamily: "monospace",
                      fontSize: 12,
                      lineHeight: 1.6,
                      overflow: "hidden",
                    }}>
                      <div style={{ marginBottom: 8, fontSize: 11, color: t.ui.textMuted }}>{t.name}</div>
                      <span style={{ color: t.terminal.green }}>$</span>
                      <span style={{ color: t.terminal.foreground }}> npm run build</span>
                      <br />
                      <span style={{ color: t.terminal.cyan }}>info</span>
                      <span style={{ color: t.terminal.foreground }}> compiling...</span>
                      <br />
                      <span style={{ color: t.terminal.yellow }}>warn</span>
                      <span style={{ color: t.terminal.foreground }}> unused var</span>
                      <br />
                      <span style={{ color: t.terminal.red }}>ERR!</span>
                      <span style={{ color: t.terminal.foreground }}> missing dep</span>
                      <br />
                      <span style={{ color: t.terminal.magenta }}>→</span>
                      <span style={{ color: t.terminal.blue }}> 42 modules</span>
                      <br />
                      <span style={{ color: t.terminal.green }}>✓</span>
                      <span style={{ color: t.terminal.foreground }}> done in 2.4s</span>
                    </div>
                  );
                })()}
              </div>

              {/* Tab position */}
              <div style={rowStyle}>
                <span>Tab position</span>
                <select
                  value={local.tabPosition}
                  onChange={(e) => update("tabPosition", e.target.value as "sidebar" | "top")}
                  style={selectStyle}
                >
                  <option value="sidebar">Sidebar</option>
                  <option value="top">Top</option>
                </select>
              </div>

              {/* Tab size (only when top tabs) */}
              {local.tabPosition === "top" && (
                <div style={rowStyle}>
                  <span>Tab size</span>
                  <select
                    value={local.tabSize}
                    onChange={(e) => update("tabSize", e.target.value as "small" | "medium" | "large")}
                    style={selectStyle}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
              )}

              {/* Show process label on tabs */}
              {local.tabPosition === "top" && (
                <div style={rowStyle}>
                  <span>Show process label on tabs</span>
                  <input
                    type="checkbox"
                    checked={local.showTabProcessLabel}
                    onChange={(e) => update("showTabProcessLabel", e.target.checked)}
                  />
                </div>
              )}

              {/* Font */}
              <div style={rowStyle}>
                <span>Font size</span>
                <select
                  value={local.fontSize}
                  onChange={(e) => update("fontSize", parseInt(e.target.value, 10))}
                  style={selectStyle}
                >
                  {[10, 12, 14, 16, 18, 20, 22, 24].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Font ligatures</span>
                  <input
                    type="checkbox"
                    checked={local.fontLigatures}
                    onChange={(e) => update("fontLigatures", e.target.checked)}
                  />
                </div>
                <span style={noteStyle}>
                  Merges characters like {`=>`} into single glyphs. May slow down terminal startup. Requires restart.
                </span>
              </div>
            </>
          )}

          {tab === "Terminal" && (
            <>
              <div style={rowStyle}>
                <span>Cursor style</span>
                <select
                  value={local.cursorStyle}
                  onChange={(e) => update("cursorStyle", e.target.value as SettingsData["cursorStyle"])}
                  style={selectStyle}
                >
                  <option value="block">Block</option>
                  <option value="underline">Underline</option>
                  <option value="bar">Bar</option>
                </select>
              </div>
              <div style={rowStyle}>
                <span>Cursor blink</span>
                <input
                  type="checkbox"
                  checked={local.cursorBlink}
                  onChange={(e) => update("cursorBlink", e.target.checked)}
                />
              </div>
              <div style={rowStyle}>
                <span>Scrollback lines</span>
                <input
                  type="number"
                  min={100}
                  max={10000}
                  step={100}
                  value={local.scrollback}
                  onChange={(e) => update("scrollback", parseInt(e.target.value, 10) || 1000)}
                  style={inputStyle}
                />
              </div>
              <div style={rowStyle}>
                <span>Smooth scrolling</span>
                <input
                  type="checkbox"
                  checked={local.smoothScrolling}
                  onChange={(e) => update("smoothScrolling", e.target.checked)}
                />
              </div>
            </>
          )}

          {tab === "Features" && (
            <>
              {/* Quake Mode */}
              <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Quake mode</span>
                  <input
                    type="checkbox"
                    checked={local.quakeMode}
                    onChange={(e) => update("quakeMode", e.target.checked)}
                  />
                </div>
                <span style={noteStyle}>
                  Global hotkey ({local.quakeHotkey}) to summon a dropdown terminal from anywhere.
                </span>
              </div>

              {/* Inline images */}
              <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Inline images</span>
                  <input
                    type="checkbox"
                    checked={local.inlineImages}
                    onChange={(e) => update("inlineImages", e.target.checked)}
                  />
                </div>
                <span style={noteStyle}>
                  Display images directly in terminal output (Sixel/iTerm2 protocol). Requires restart.
                </span>
              </div>
            </>
          )}

          {tab === "Process Colors" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ ...noteStyle, flex: 1 }}>
                  Customize colors for each process detected in your sessions. Applied instantly.
                </span>
                <button
                  onClick={() => update("processColors", { ...DEFAULT_PROCESS_COLORS })}
                  style={{
                    background: "transparent",
                    color: theme.ui.textMuted,
                    border: `1px solid ${theme.ui.border}`,
                    borderRadius: 4,
                    padding: "6px 12px",
                    fontSize: 11,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Reset all
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Object.entries(local.processColors).map(([name, color]) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: theme.ui.bg,
                      border: `1px solid ${theme.ui.border}`,
                      borderRadius: 6,
                      borderLeft: `4px solid ${color}`,
                    }}
                  >
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        const newName = e.target.value.trim().toLowerCase();
                        if (!newName || newName === name) return;
                        const next = { ...local.processColors };
                        delete next[name];
                        next[newName] = color;
                        update("processColors", next);
                      }}
                      placeholder="process name"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: "transparent",
                        color: theme.ui.text,
                        border: "none",
                        padding: "4px 0",
                        fontSize: 13,
                        fontFamily: "monospace",
                        outline: "none",
                      }}
                    />
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => update("processColors", { ...local.processColors, [name]: e.target.value })}
                      style={{
                        width: 40,
                        height: 28,
                        border: `1px solid ${theme.ui.border}`,
                        borderRadius: 4,
                        cursor: "pointer",
                        padding: 0,
                        background: "transparent",
                        flexShrink: 0,
                      }}
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#[0-9a-f]{0,6}$/i.test(v)) {
                          update("processColors", { ...local.processColors, [name]: v });
                        }
                      }}
                      style={{
                        width: 90,
                        background: theme.ui.bgAlt,
                        color: theme.ui.textMuted,
                        border: `1px solid ${theme.ui.border}`,
                        borderRadius: 4,
                        padding: "5px 8px",
                        fontSize: 12,
                        outline: "none",
                        fontFamily: "monospace",
                        flexShrink: 0,
                      }}
                    />
                    <button
                      onClick={() => {
                        const next = { ...local.processColors };
                        delete next[name];
                        update("processColors", next);
                      }}
                      title={`Remove ${name}`}
                      style={{
                        background: "transparent",
                        color: theme.ui.textFaint,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 16,
                        padding: "4px 8px",
                        flexShrink: 0,
                        borderRadius: 4,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = theme.terminal.red;
                        e.currentTarget.style.background = `${theme.terminal.red}15`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = theme.ui.textFaint;
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => {
                  let i = 1;
                  let name = "new-process";
                  while (local.processColors[name]) name = `new-process-${i++}`;
                  update("processColors", { ...local.processColors, [name]: "#888888" });
                }}
                style={{
                  marginTop: 12,
                  background: "transparent",
                  color: theme.ui.textMuted,
                  border: `1.5px dashed ${theme.ui.textFaint}`,
                  borderRadius: 6,
                  padding: "10px",
                  fontSize: 13,
                  cursor: "pointer",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = theme.ui.accent;
                  e.currentTarget.style.color = theme.ui.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = theme.ui.textFaint;
                  e.currentTarget.style.color = theme.ui.textMuted;
                }}
              >
                + Add process
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
