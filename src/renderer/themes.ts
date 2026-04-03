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

export const themes: Record<string, Theme> = {
  mocha: {
    name: "Mocha",
    terminal: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      selectionBackground: "#45475a",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
    ui: {
      bg: "#1e1e2e",
      bgAlt: "#11111b",
      border: "#313244",
      text: "#cdd6f4",
      textMuted: "#9399b2",
      textFaint: "#6c7086",
      accent: "#89b4fa",
      sidebarActive: "#262637",
    },
  },
  latte: {
    name: "Latte",
    terminal: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      cursor: "#dc8a78",
      selectionBackground: "#acb0be",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#ea76cb",
      brightCyan: "#179299",
      brightWhite: "#bcc0cc",
    },
    ui: {
      bg: "#eff1f5",
      bgAlt: "#dce0e8",
      border: "#ccd0da",
      text: "#4c4f69",
      textMuted: "#6c6f85",
      textFaint: "#9ca0b0",
      accent: "#1e66f5",
      sidebarActive: "#bcc0cc",
    },
  },
  dracula: {
    name: "Dracula",
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
    ui: {
      bg: "#282a36",
      bgAlt: "#1e1f29",
      border: "#44475a",
      text: "#f8f8f2",
      textMuted: "#8394bf",
      textFaint: "#6272a4",
      accent: "#bd93f9",
      sidebarActive: "#353849",
    },
  },
  nord: {
    name: "Nord",
    terminal: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
    ui: {
      bg: "#2e3440",
      bgAlt: "#242933",
      border: "#3b4252",
      text: "#d8dee9",
      textMuted: "#9bb3cd",
      textFaint: "#6b7d96",
      accent: "#88c0d0",
      sidebarActive: "#353c4a",
    },
  },
};

export const defaultTheme = "mocha";
