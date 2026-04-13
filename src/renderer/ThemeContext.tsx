import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { themes, defaultTheme, getTheme, initThemes, Theme } from "./themes";

interface ThemeContextValue {
  theme: Theme;
  themeId: string;
  setThemeId: (id: string) => void;
  allThemes: Record<string, Theme>;
}

const ThemeContext = createContext<ThemeContextValue>(null!);

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(defaultTheme);
  const [ready, setReady] = useState(false);

  // Load themes from YAML on startup
  useEffect(() => {
    initThemes().then(() => setReady(true));
  }, []);

  useEffect(() => {
    const cleanup = window.husk.onThemeChange((id: string) => {
      if (themes[id]) setThemeId(id);
    });
    return cleanup;
  }, []);

  // Apply CSS variables to document
  useEffect(() => {
    const t = getTheme(themeId);
    const root = document.documentElement;
    root.style.setProperty("--bg", t.ui.bg);
    root.style.setProperty("--bg-alt", t.ui.bgAlt);
    root.style.setProperty("--border", t.ui.border);
    root.style.setProperty("--text", t.ui.text);
    root.style.setProperty("--text-muted", t.ui.textMuted);
    root.style.setProperty("--text-faint", t.ui.textFaint);
    root.style.setProperty("--accent", t.ui.accent);
    root.style.setProperty("--sidebar-active", t.ui.sidebarActive);
    document.body.style.background = t.ui.bg;
    document.body.style.color = t.ui.text;
  }, [themeId, ready]);

  const theme = getTheme(themeId);

  return (
    <ThemeContext.Provider value={{ theme, themeId, setThemeId, allThemes: themes }}>
      {children}
    </ThemeContext.Provider>
  );
}
