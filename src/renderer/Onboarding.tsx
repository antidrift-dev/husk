import { useState } from "react";
import { useTheme } from "./ThemeContext";

interface Props {
  onDone: () => void;
}

const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";

const steps = [
  {
    title: "Welcome to Husk",
    content: [
      { keys: `${mod}N`, desc: "New session" },
      { keys: `${mod}W`, desc: "Close session" },
      { keys: `${mod}1-9`, desc: "Switch sessions" },
      { keys: `${mod}R`, desc: "Rename session" },
      { keys: "Right-click", desc: "Session context menu" },
      { keys: "Drag", desc: "Reorder sessions" },
    ],
    subtitle: "Manage multiple terminal sessions from the sidebar.",
  },
  {
    title: "Split & Navigate",
    content: [
      { keys: `${mod}D`, desc: "Split right" },
      { keys: `${mod}Shift+D`, desc: "Split down" },
      { keys: `${mod}[  ${mod}]`, desc: "Cycle between panes" },
      { keys: `${mod}←  ${mod}→`, desc: "Beginning / end of line" },
      { keys: `${mod}F`, desc: "Search terminal" },
      { keys: `${mod}Shift+N`, desc: "New window" },
    ],
    subtitle: "Split panes and navigate like a pro.",
  },
  {
    title: "Make it yours",
    content: [
      { keys: `${mod},`, desc: "Settings — themes, font, cursor" },
      { keys: "19 themes", desc: "From Mocha to Tokyo Night" },
      { keys: "Profiles", desc: "File → Save as Profile" },
      { keys: "Quake mode", desc: "Global hotkey dropdown terminal" },
      { keys: "Notifications", desc: "Alerts when commands finish" },
      { keys: "Custom themes", desc: "Drop YAML in ~/.husk/themes/" },
    ],
    subtitle: "Customize everything to fit your workflow.",
  },
];

export default function Onboarding({ onDone }: Props) {
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const current = steps[step];

  return (
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
    >
      <div
        style={{
          width: 480,
          background: theme.ui.bgAlt,
          border: `1px solid ${theme.ui.border}`,
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Title */}
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 12, color: theme.ui.textMuted, marginBottom: 24 }}>
          {current.subtitle}
        </div>

        {/* Shortcuts list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
          {current.content.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{
                minWidth: 120,
                padding: "4px 8px",
                background: theme.ui.bg,
                border: `1px solid ${theme.ui.border}`,
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "monospace",
                textAlign: "center",
                color: theme.ui.text,
              }}>
                {item.keys}
              </span>
              <span style={{ fontSize: 13, color: theme.ui.textMuted }}>{item.desc}</span>
            </div>
          ))}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Dots */}
          <div style={{ display: "flex", gap: 8 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: i === step ? theme.ui.accent : theme.ui.border,
                  transition: "background 0.2s ease",
                }}
              />
            ))}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
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
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step < steps.length - 1) setStep(step + 1);
                else onDone();
              }}
              style={{
                padding: "8px 24px",
                background: theme.ui.accent,
                color: theme.ui.bg,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {step < steps.length - 1 ? "Next" : "Get Started"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
