import { describe, it, expect, beforeEach, vi } from "vitest";

// We need to test initThemes and getTheme which depend on window.husk
// Mock window.husk before importing the module

const mockLoadThemes = vi.fn();

vi.stubGlobal("window", {
  husk: {
    loadThemes: mockLoadThemes,
  },
});

// Import after mocking
import { initThemes, getTheme, themes, defaultTheme } from "./themes";

const FAKE_THEME = {
  name: "Fake",
  terminal: {
    background: "#000000", foreground: "#ffffff", cursor: "#ffffff", selectionBackground: "#333333",
    black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00",
    blue: "#0000ff", magenta: "#ff00ff", cyan: "#00ffff", white: "#ffffff",
    brightBlack: "#555555", brightRed: "#ff5555", brightGreen: "#55ff55", brightYellow: "#ffff55",
    brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#55ffff", brightWhite: "#ffffff",
  },
  ui: {
    bg: "#000000", bgAlt: "#111111", border: "#333333", text: "#ffffff",
    textMuted: "#aaaaaa", textFaint: "#666666", accent: "#0088ff", sidebarActive: "#222222",
  },
};

describe("themes runtime", () => {
  beforeEach(() => {
    mockLoadThemes.mockReset();
    // Reset themes to empty
    Object.keys(themes).forEach((k) => delete themes[k]);
  });

  describe("defaultTheme", () => {
    it("is mocha", () => {
      expect(defaultTheme).toBe("mocha");
    });
  });

  describe("initThemes", () => {
    it("loads themes from IPC", async () => {
      mockLoadThemes.mockResolvedValue({ fake: FAKE_THEME, another: { ...FAKE_THEME, name: "Another" } });
      await initThemes();
      expect(themes["fake"]).toBeDefined();
      expect(themes["fake"].name).toBe("Fake");
      expect(themes["another"]).toBeDefined();
    });

    it("falls back to FALLBACK when IPC returns empty", async () => {
      mockLoadThemes.mockResolvedValue({});
      await initThemes();
      expect(themes["mocha"]).toBeDefined();
      expect(themes["mocha"].name).toBe("Mocha");
    });

    it("falls back to FALLBACK when IPC returns null", async () => {
      mockLoadThemes.mockResolvedValue(null);
      await initThemes();
      expect(themes["mocha"]).toBeDefined();
    });

    it("falls back to FALLBACK when IPC throws", async () => {
      mockLoadThemes.mockRejectedValue(new Error("IPC failed"));
      await initThemes();
      expect(themes["mocha"]).toBeDefined();
      expect(themes["mocha"].name).toBe("Mocha");
    });

    it("overwrites existing themes on reload", async () => {
      mockLoadThemes.mockResolvedValue({ fake: FAKE_THEME });
      await initThemes();
      expect(themes["fake"]).toBeDefined();

      mockLoadThemes.mockResolvedValue({ other: { ...FAKE_THEME, name: "Other" } });
      await initThemes();
      expect(themes["other"]).toBeDefined();
      expect(themes["fake"]).toBeUndefined(); // replaced
    });
  });

  describe("getTheme", () => {
    it("returns theme by id", async () => {
      mockLoadThemes.mockResolvedValue({ fake: FAKE_THEME });
      await initThemes();
      const t = getTheme("fake");
      expect(t.name).toBe("Fake");
    });

    it("falls back to default theme for unknown id", async () => {
      mockLoadThemes.mockResolvedValue({ mocha: { ...FAKE_THEME, name: "Mocha Loaded" } });
      await initThemes();
      const t = getTheme("nonexistent");
      expect(t.name).toBe("Mocha Loaded");
    });

    it("falls back to FALLBACK when no themes loaded", () => {
      const t = getTheme("anything");
      expect(t.name).toBe("Mocha"); // FALLBACK
      expect(t.terminal.background).toBe("#1e1e2e");
    });

    it("FALLBACK has all required terminal colors", () => {
      const t = getTheme("nonexistent");
      const required = [
        "background", "foreground", "cursor", "selectionBackground",
        "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
        "brightBlack", "brightRed", "brightGreen", "brightYellow",
        "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
      ];
      for (const key of required) {
        expect(t.terminal[key as keyof typeof t.terminal], `terminal.${key}`).toBeTruthy();
      }
    });

    it("FALLBACK has all required UI colors", () => {
      const t = getTheme("nonexistent");
      const required = ["bg", "bgAlt", "border", "text", "textMuted", "textFaint", "accent", "sidebarActive"];
      for (const key of required) {
        expect(t.ui[key as keyof typeof t.ui], `ui.${key}`).toBeTruthy();
      }
    });

    it("returns correct theme when multiple are loaded", async () => {
      mockLoadThemes.mockResolvedValue({
        alpha: { ...FAKE_THEME, name: "Alpha" },
        beta: { ...FAKE_THEME, name: "Beta" },
        gamma: { ...FAKE_THEME, name: "Gamma" },
      });
      await initThemes();
      expect(getTheme("alpha").name).toBe("Alpha");
      expect(getTheme("beta").name).toBe("Beta");
      expect(getTheme("gamma").name).toBe("Gamma");
    });
  });
});
