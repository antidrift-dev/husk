export interface Theme {
  name: string;
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
  ui: {
    bg: string;
    bgAlt: string;
    border: string;
    text: string;
    textMuted: string;
    textFaint: string;
    accent: string;
    sidebarActive: string;
  };
}

// Mutable — populated from YAML via IPC on app start
export let themes: Record<string, Theme> = {};
export const defaultTheme = "mocha";

// Fallback theme in case YAML loading fails
const FALLBACK: Theme = {
  name: "Mocha",
  terminal: {
    background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", selectionBackground: "#45475a",
    black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
    blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
    brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af",
    brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8",
  },
  ui: {
    bg: "#1e1e2e", bgAlt: "#11111b", border: "#313244", text: "#cdd6f4",
    textMuted: "#9399b2", textFaint: "#6c7086", accent: "#89b4fa", sidebarActive: "#262637",
  },
};

export async function initThemes(): Promise<void> {
  try {
    const loaded = await window.husk.loadThemes();
    if (loaded && Object.keys(loaded).length > 0) {
      themes = loaded as Record<string, Theme>;
    } else {
      themes = { mocha: FALLBACK };
    }
  } catch {
    themes = { mocha: FALLBACK };
  }
}

export function getTheme(id: string): Theme {
  return themes[id] || themes[defaultTheme] || FALLBACK;
}
