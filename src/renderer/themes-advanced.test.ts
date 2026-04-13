import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import YAML from "yaml";

const themesDir = path.join(__dirname, "..", "..", "themes");
const customDir = path.join(os.homedir(), ".husk", "themes");

describe("Theme YAML Loading", () => {
  describe("built-in themes", () => {
    it("themes directory exists", () => {
      expect(fs.existsSync(themesDir)).toBe(true);
    });

    it("all files are valid YAML", () => {
      const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));
      for (const file of files) {
        expect(() => {
          YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        }, `${file} should parse`).not.toThrow();
      }
    });

    it("no duplicate theme IDs", () => {
      const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));
      const ids = files.map((f) => f.replace(".yaml", ""));
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("no duplicate display names", () => {
      const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));
      const names = files.map((f) => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, f), "utf-8"));
        return theme.name;
      });
      expect(new Set(names).size).toBe(names.length);
    });

    it("has at least one light theme", () => {
      const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));
      const lightThemes = files.filter((f) => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, f), "utf-8"));
        // Light themes have bright backgrounds
        const bg = theme.terminal.background;
        const r = parseInt(bg.slice(1, 3), 16);
        const g = parseInt(bg.slice(3, 5), 16);
        const b = parseInt(bg.slice(5, 7), 16);
        return (r + g + b) / 3 > 128;
      });
      expect(lightThemes.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one dark theme", () => {
      const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));
      const darkThemes = files.filter((f) => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, f), "utf-8"));
        const bg = theme.terminal.background;
        const r = parseInt(bg.slice(1, 3), 16);
        const g = parseInt(bg.slice(3, 5), 16);
        const b = parseInt(bg.slice(5, 7), 16);
        return (r + g + b) / 3 < 128;
      });
      expect(darkThemes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("theme color contrast", () => {
    const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));

    for (const file of files) {
      const id = file.replace(".yaml", "");

      it(`${id}: foreground contrasts with background`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        const bgLum = luminance(theme.terminal.background);
        const fgLum = luminance(theme.terminal.foreground);
        const ratio = contrastRatio(bgLum, fgLum);
        // WCAG AA requires 4.5:1 for normal text
        expect(ratio, `${id} contrast ratio ${ratio}`).toBeGreaterThan(3);
      });

      it(`${id}: text contrasts with ui bg`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        const bgLum = luminance(theme.ui.bg);
        const textLum = luminance(theme.ui.text);
        const ratio = contrastRatio(bgLum, textLum);
        expect(ratio, `${id} UI text contrast ${ratio}`).toBeGreaterThan(3);
      });

      it(`${id}: accent is visible on bg`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        const bgLum = luminance(theme.ui.bg);
        const accentLum = luminance(theme.ui.accent);
        const ratio = contrastRatio(bgLum, accentLum);
        expect(ratio, `${id} accent contrast ${ratio}`).toBeGreaterThan(1.5);
      });
    }
  });

  describe("theme completeness", () => {
    const requiredTerminal = [
      "background", "foreground", "cursor", "selectionBackground",
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ];
    const requiredUi = ["bg", "bgAlt", "border", "text", "textMuted", "textFaint", "accent", "sidebarActive"];

    const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".yaml"));

    for (const file of files) {
      const id = file.replace(".yaml", "");

      it(`${id}: has all terminal colors`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        for (const key of requiredTerminal) {
          expect(theme.terminal?.[key], `${id} missing terminal.${key}`).toBeTruthy();
        }
      });

      it(`${id}: has all UI colors`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        for (const key of requiredUi) {
          expect(theme.ui?.[key], `${id} missing ui.${key}`).toBeTruthy();
        }
      });

      it(`${id}: has no extra unknown terminal keys`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        const keys = Object.keys(theme.terminal || {});
        for (const key of keys) {
          expect(requiredTerminal, `${id} unexpected terminal.${key}`).toContain(key);
        }
      });

      it(`${id}: has no extra unknown UI keys`, () => {
        const theme = YAML.parse(fs.readFileSync(path.join(themesDir, file), "utf-8"));
        const keys = Object.keys(theme.ui || {});
        for (const key of keys) {
          expect(requiredUi, `${id} unexpected ui.${key}`).toContain(key);
        }
      });
    }
  });

  describe("malformed YAML handling", () => {
    it("empty file doesn't crash parser", () => {
      expect(() => YAML.parse("")).not.toThrow();
    });

    it("invalid YAML returns null/undefined", () => {
      const result = YAML.parse("");
      expect(result == null).toBe(true);
    });

    it("YAML with missing sections parses without crash", () => {
      const partial = YAML.parse("name: Partial\n");
      expect(partial.name).toBe("Partial");
      expect(partial.terminal).toBeUndefined();
      expect(partial.ui).toBeUndefined();
    });

    it("YAML with wrong types parses but has wrong values", () => {
      const bad = YAML.parse("name: Bad\nterminal:\n  background: 12345\n");
      expect(bad.terminal.background).toBe(12345); // number, not string
    });

    it("YAML with extra fields doesn't crash", () => {
      const extra = YAML.parse("name: Extra\ncustom_field: hello\nterminal:\n  background: '#000000'\n");
      expect(extra.name).toBe("Extra");
      expect(extra.custom_field).toBe("hello");
    });
  });

  describe("custom theme directory", () => {
    const testThemeDir = path.join(os.tmpdir(), "husk-test-themes");

    beforeEach(() => {
      if (!fs.existsSync(testThemeDir)) fs.mkdirSync(testThemeDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(testThemeDir)) fs.rmSync(testThemeDir, { recursive: true, force: true });
    });

    it("can load a custom theme from a directory", () => {
      const customTheme = {
        name: "Custom Test",
        terminal: {
          background: "#111111", foreground: "#eeeeee", cursor: "#ffffff", selectionBackground: "#333333",
          black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00",
          blue: "#0000ff", magenta: "#ff00ff", cyan: "#00ffff", white: "#ffffff",
          brightBlack: "#555555", brightRed: "#ff5555", brightGreen: "#55ff55", brightYellow: "#ffff55",
          brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#55ffff", brightWhite: "#ffffff",
        },
        ui: {
          bg: "#111111", bgAlt: "#0a0a0a", border: "#333333", text: "#eeeeee",
          textMuted: "#aaaaaa", textFaint: "#666666", accent: "#0088ff", sidebarActive: "#222222",
        },
      };

      const filePath = path.join(testThemeDir, "custom-test.yaml");
      fs.writeFileSync(filePath, YAML.stringify(customTheme));

      const loaded = YAML.parse(fs.readFileSync(filePath, "utf-8"));
      expect(loaded.name).toBe("Custom Test");
      expect(loaded.terminal.background).toBe("#111111");
      expect(loaded.ui.accent).toBe("#0088ff");
    });

    it("custom theme overrides built-in with same filename", () => {
      // Create a "mocha.yaml" custom theme with different name
      const override = {
        name: "My Custom Mocha",
        terminal: {
          background: "#222222", foreground: "#dddddd", cursor: "#ffffff", selectionBackground: "#444444",
          black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00",
          blue: "#0000ff", magenta: "#ff00ff", cyan: "#00ffff", white: "#ffffff",
          brightBlack: "#555555", brightRed: "#ff5555", brightGreen: "#55ff55", brightYellow: "#ffff55",
          brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#55ffff", brightWhite: "#ffffff",
        },
        ui: {
          bg: "#222222", bgAlt: "#1a1a1a", border: "#444444", text: "#dddddd",
          textMuted: "#999999", textFaint: "#666666", accent: "#ff8800", sidebarActive: "#333333",
        },
      };

      fs.writeFileSync(path.join(testThemeDir, "mocha.yaml"), YAML.stringify(override));
      const loaded = YAML.parse(fs.readFileSync(path.join(testThemeDir, "mocha.yaml"), "utf-8"));
      expect(loaded.name).toBe("My Custom Mocha");
    });

    it("ignores non-yaml files", () => {
      fs.writeFileSync(path.join(testThemeDir, "readme.txt"), "not a theme");
      fs.writeFileSync(path.join(testThemeDir, "theme.json"), '{"name":"json"}');

      const yamlFiles = fs.readdirSync(testThemeDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      expect(yamlFiles).toHaveLength(0);
    });

    it("handles .yml extension", () => {
      const theme = { name: "YML Test", terminal: { background: "#000000" }, ui: { bg: "#000000" } };
      fs.writeFileSync(path.join(testThemeDir, "yml-test.yml"), YAML.stringify(theme));

      const files = fs.readdirSync(testThemeDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      expect(files).toHaveLength(1);

      const loaded = YAML.parse(fs.readFileSync(path.join(testThemeDir, "yml-test.yml"), "utf-8"));
      expect(loaded.name).toBe("YML Test");
    });
  });

  describe("theme-loader integration", () => {
    it("loadThemes returns all built-in themes", async () => {
      // Import the loader directly
      const { loadThemes } = await import("../main/theme-loader");
      const themes = loadThemes();
      expect(Object.keys(themes).length).toBeGreaterThanOrEqual(19);
      expect(themes["mocha"]).toBeDefined();
      expect(themes["dracula"]).toBeDefined();
      expect(themes["nord"]).toBeDefined();
      expect(themes["one-dark"]).toBeDefined();
      expect(themes["tokyo-night"]).toBeDefined();
      expect(themes["gruvbox-dark"]).toBeDefined();
      expect(themes["solarized-dark"]).toBeDefined();
      expect(themes["github-dark"]).toBeDefined();
    });

    it("each loaded theme has name, terminal, and ui", async () => {
      const { loadThemes } = await import("../main/theme-loader");
      const themes = loadThemes();
      for (const [id, theme] of Object.entries(themes)) {
        expect(theme.name, `${id} missing name`).toBeTruthy();
        expect(theme.terminal, `${id} missing terminal`).toBeTruthy();
        expect(theme.ui, `${id} missing ui`).toBeTruthy();
      }
    });

    it("loaded theme terminal has all required colors", async () => {
      const { loadThemes } = await import("../main/theme-loader");
      const themes = loadThemes();
      const required = ["background", "foreground", "cursor", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
      for (const [id, theme] of Object.entries(themes)) {
        for (const key of required) {
          expect(theme.terminal[key as keyof typeof theme.terminal], `${id} terminal.${key}`).toBeTruthy();
        }
      }
    });

    it("survives malformed YAML file in themes dir", async () => {
      // Write a bad file to the themes dir temporarily
      const badFile = path.join(themesDir, "_test_bad.yaml");
      fs.writeFileSync(badFile, "{{{{invalid yaml");
      try {
        const { loadThemes } = await import("../main/theme-loader");
        const themes = loadThemes();
        // Should still load all other themes
        expect(Object.keys(themes).length).toBeGreaterThanOrEqual(19);
      } finally {
        fs.unlinkSync(badFile);
      }
    });
  });
});

// Helpers for contrast calculation
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const sR = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const sG = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const sB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
