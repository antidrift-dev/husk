import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import YAML from "yaml";

// Test the YAML theme files directly
const themesDir = path.join(__dirname, "..", "..", "themes");

interface Theme {
  name: string;
  terminal: Record<string, string>;
  ui: Record<string, string>;
}

function loadThemeFile(filename: string): Theme {
  return YAML.parse(fs.readFileSync(path.join(themesDir, filename), "utf-8"));
}

const themeFiles = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));

describe("themes (YAML)", () => {
  it("has theme files", () => {
    expect(themeFiles.length).toBeGreaterThanOrEqual(4);
  });

  it("has all expected themes", () => {
    const names = themeFiles.map((f) => f.replace(".yaml", ""));
    expect(names).toContain("mocha");
    expect(names).toContain("latte");
    expect(names).toContain("dracula");
    expect(names).toContain("nord");
  });

  for (const file of themeFiles) {
    const id = file.replace(".yaml", "");

    describe(`theme: ${id}`, () => {
      let theme: Theme;

      it("parses valid YAML", () => {
        theme = loadThemeFile(file);
        expect(theme).toBeTruthy();
      });

      it("has a display name", () => {
        theme = loadThemeFile(file);
        expect(theme.name).toBeTruthy();
        expect(typeof theme.name).toBe("string");
      });

      it("has all terminal colors", () => {
        theme = loadThemeFile(file);
        const required = [
          "background", "foreground", "cursor", "selectionBackground",
          "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
          "brightBlack", "brightRed", "brightGreen", "brightYellow",
          "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
        ];
        for (const key of required) {
          expect(theme.terminal[key], `terminal.${key}`).toBeTruthy();
        }
      });

      it("terminal colors are valid hex", () => {
        theme = loadThemeFile(file);
        for (const [key, val] of Object.entries(theme.terminal)) {
          expect(val, `terminal.${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      });

      it("has all UI colors", () => {
        theme = loadThemeFile(file);
        const required = ["bg", "bgAlt", "border", "text", "textMuted", "textFaint", "accent", "sidebarActive"];
        for (const key of required) {
          expect(theme.ui[key], `ui.${key}`).toBeTruthy();
        }
      });

      it("UI colors are valid hex", () => {
        theme = loadThemeFile(file);
        for (const [key, val] of Object.entries(theme.ui)) {
          expect(val, `ui.${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      });

      it("bg and bgAlt are different", () => {
        theme = loadThemeFile(file);
        expect(theme.ui.bg).not.toBe(theme.ui.bgAlt);
      });

      it("text is different from bg", () => {
        theme = loadThemeFile(file);
        expect(theme.ui.text).not.toBe(theme.ui.bg);
      });
    });
  }
});
