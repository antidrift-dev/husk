import { useState, useEffect } from "react";
import { useTheme } from "./ThemeContext";
import { themes } from "./themes";

interface SettingsData {
  fontSize: number;
  fontFamily: string;
  fontLigatures: boolean;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  smoothScrolling: boolean;
  inlineImages: boolean;
}

const DEFAULTS: SettingsData = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', monospace",
  fontLigatures: false,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 1000,
  smoothScrolling: true,
  inlineImages: false,
};

interface Props {
  open: boolean;
  onClose: () => void;
  settings: SettingsData;
  onSettingsChange: (settings: SettingsData) => void;
}

export type { SettingsData };
export { DEFAULTS };

export default function Settings({ open, onClose, settings, onSettingsChange }: Props) {
  const { theme, themeId, setThemeId } = useTheme();
  const [local, setLocal] = useState(settings);

  useEffect(() => {
    setLocal(settings);
  }, [settings, open]);

  if (!open) return null;

  const update = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    onSettingsChange(next);
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 24,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: theme.ui.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    fontWeight: 600,
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
          width: 480,
          maxHeight: "80vh",
          overflow: "auto",
          background: theme.ui.bgAlt,
          border: `1px solid ${theme.ui.border}`,
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Settings</span>
          <span
            onClick={onClose}
            style={{ cursor: "pointer", color: theme.ui.textFaint, fontSize: 18 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = theme.ui.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = theme.ui.textFaint)}
          >
            ✕
          </span>
        </div>

        {/* Theme */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Theme</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(themes).map(([id, t]) => (
              <div
                key={id}
                onClick={() => setThemeId(id)}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "center",
                  fontSize: 11,
                  background: id === themeId ? theme.ui.sidebarActive : theme.ui.bg,
                  border: id === themeId ? `2px solid ${theme.ui.accent}` : `2px solid ${theme.ui.border}`,
                  transition: "all 0.15s ease",
                }}
              >
                {/* Mini terminal preview */}
                <div style={{
                  width: "100%",
                  height: 56,
                  borderRadius: 4,
                  marginBottom: 6,
                  background: t.terminal.background,
                  border: `1px solid ${t.ui.border}`,
                  padding: "6px",
                  fontFamily: "monospace",
                  fontSize: 8,
                  textAlign: "left",
                  lineHeight: 1.4,
                  overflow: "hidden",
                }}>
                  <span style={{ color: t.terminal.green }}>$</span>
                  <span style={{ color: t.terminal.foreground }}> npm run</span>
                  <br />
                  <span style={{ color: t.terminal.cyan }}>info</span>
                  <span style={{ color: t.terminal.foreground }}> building...</span>
                  <br />
                  <span style={{ color: t.terminal.red }}>ERR</span>
                  <span style={{ color: t.terminal.yellow }}> warning</span>
                  <br />
                  <span style={{ color: t.terminal.magenta }}>→</span>
                  <span style={{ color: t.terminal.blue }}> done</span>
                </div>
                {t.name}
              </div>
            ))}
          </div>
        </div>

        {/* Font */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Font</div>
          <div style={rowStyle}>
            <span>Size</span>
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
              <span>Ligatures</span>
              <input
                type="checkbox"
                checked={local.fontLigatures}
                onChange={(e) => update("fontLigatures", e.target.checked)}
              />
            </div>
            <span style={{ fontSize: 10, color: theme.ui.textFaint }}>
              Merges characters like {`=>`} into single glyphs. May slow down terminal startup. Requires restart.
            </span>
          </div>
        </div>

        {/* Terminal */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Terminal</div>
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
        </div>

        {/* Experimental */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Experimental</div>
          <div style={rowStyle}>
            <span>Inline images</span>
            <input
              type="checkbox"
              checked={local.inlineImages}
              onChange={(e) => update("inlineImages", e.target.checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
