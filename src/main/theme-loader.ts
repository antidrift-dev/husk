import fs from "fs";
import path from "path";
import YAML from "yaml";

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

export function loadThemes(): Record<string, Theme> {
  const themes: Record<string, Theme> = {};

  // Load built-in themes — check packaged resources first, then dev directory
  const { app } = require("electron");
  const resourcesPath = app?.isPackaged
    ? path.join(process.resourcesPath, "themes")
    : path.join(__dirname, "..", "..", "themes");
  const builtinDir = resourcesPath;
  // Also check for custom themes in ~/.husk/themes/
  const customDir = path.join(require("os").homedir(), ".husk", "themes");

  for (const dir of [builtinDir, customDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const theme = YAML.parse(content) as Theme;
        const id = file.replace(/\.ya?ml$/, "");
        themes[id] = theme;
      } catch (e) {
        console.error(`Failed to load theme ${file}:`, e);
      }
    }
  }

  return themes;
}
