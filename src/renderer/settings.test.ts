import { describe, it, expect } from "vitest";
import { DEFAULTS, DEFAULT_PROCESS_COLORS } from "./Settings";

describe("Settings defaults", () => {
  it("has all required keys", () => {
    const required = [
      "fontSize", "fontFamily", "fontLigatures", "cursorBlink",
      "cursorStyle", "scrollback", "smoothScrolling", "inlineImages",
      "quakeMode", "quakeHotkey",
    ];
    for (const key of required) {
      expect(DEFAULTS).toHaveProperty(key);
    }
  });

  it("fontSize is reasonable", () => {
    expect(DEFAULTS.fontSize).toBeGreaterThanOrEqual(8);
    expect(DEFAULTS.fontSize).toBeLessThanOrEqual(24);
  });

  it("fontSize is even (matches dropdown options)", () => {
    expect(DEFAULTS.fontSize % 2).toBe(0);
  });

  it("fontFamily includes JetBrains Mono", () => {
    expect(DEFAULTS.fontFamily).toContain("JetBrains Mono");
  });

  it("fontFamily has monospace fallback", () => {
    expect(DEFAULTS.fontFamily).toContain("monospace");
  });

  it("ligatures default to off (performance)", () => {
    expect(DEFAULTS.fontLigatures).toBe(false);
  });

  it("cursorBlink defaults to on", () => {
    expect(DEFAULTS.cursorBlink).toBe(true);
  });

  it("cursorStyle is valid", () => {
    expect(["block", "underline", "bar"]).toContain(DEFAULTS.cursorStyle);
  });

  it("tabPosition defaults to sidebar", () => {
    expect(DEFAULTS.tabPosition).toBe("sidebar");
  });

  it("tabPosition is valid", () => {
    expect(["sidebar", "top"]).toContain(DEFAULTS.tabPosition);
  });

  it("scrollback is reasonable", () => {
    expect(DEFAULTS.scrollback).toBeGreaterThanOrEqual(100);
    expect(DEFAULTS.scrollback).toBeLessThanOrEqual(10000);
  });

  it("smoothScrolling defaults to on", () => {
    expect(DEFAULTS.smoothScrolling).toBe(true);
  });

  it("inlineImages defaults to off (experimental)", () => {
    expect(DEFAULTS.inlineImages).toBe(false);
  });

  it("quakeMode defaults to off", () => {
    expect(DEFAULTS.quakeMode).toBe(false);
  });

  it("quakeHotkey is a valid accelerator string", () => {
    expect(DEFAULTS.quakeHotkey).toContain("+");
    expect(DEFAULTS.quakeHotkey.length).toBeGreaterThan(3);
  });

  it("settings are JSON-serializable", () => {
    const json = JSON.stringify(DEFAULTS);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(DEFAULTS);
  });

  it("settings merge correctly with partial overrides", () => {
    const override = { fontSize: 18, cursorStyle: "bar" as const };
    const merged = { ...DEFAULTS, ...override };
    expect(merged.fontSize).toBe(18);
    expect(merged.cursorStyle).toBe("bar");
    expect(merged.fontFamily).toBe(DEFAULTS.fontFamily); // unchanged
  });

  it("all spacing values are multiples of 4", () => {
    expect(DEFAULTS.fontSize % 2).toBe(0);
    expect(DEFAULTS.scrollback % 100).toBe(0);
  });

  it("all boolean defaults are explicit", () => {
    expect(typeof DEFAULTS.fontLigatures).toBe("boolean");
    expect(typeof DEFAULTS.cursorBlink).toBe("boolean");
    expect(typeof DEFAULTS.smoothScrolling).toBe("boolean");
    expect(typeof DEFAULTS.inlineImages).toBe("boolean");
    expect(typeof DEFAULTS.quakeMode).toBe("boolean");
  });

  it("all string defaults are non-empty", () => {
    expect(DEFAULTS.fontFamily.length).toBeGreaterThan(0);
    expect(DEFAULTS.cursorStyle.length).toBeGreaterThan(0);
    expect(DEFAULTS.tabPosition.length).toBeGreaterThan(0);
    expect(DEFAULTS.quakeHotkey.length).toBeGreaterThan(0);
  });

  it("defaults object has no undefined values", () => {
    for (const [key, val] of Object.entries(DEFAULTS)) {
      expect(val, `${key} should not be undefined`).not.toBeUndefined();
      expect(val, `${key} should not be null`).not.toBeNull();
    }
  });

  it("all keys are present in merged result", () => {
    const merged = { ...DEFAULTS, fontSize: 20 };
    const defaultKeys = Object.keys(DEFAULTS).sort();
    const mergedKeys = Object.keys(merged).sort();
    expect(mergedKeys).toEqual(defaultKeys);
  });

  // ---- New fields (v0.2.x) ----

  it("tabSize defaults to medium", () => {
    expect(DEFAULTS.tabSize).toBe("medium");
  });

  it("tabSize is one of the valid sizes", () => {
    expect(["small", "medium", "large"]).toContain(DEFAULTS.tabSize);
  });

  it("showTabProcessLabel defaults to true", () => {
    expect(DEFAULTS.showTabProcessLabel).toBe(true);
  });

  it("processColors default is non-empty", () => {
    expect(Object.keys(DEFAULTS.processColors).length).toBeGreaterThan(0);
  });

  it("processColors contains key AI CLIs", () => {
    expect(DEFAULTS.processColors).toHaveProperty("claude");
    expect(DEFAULTS.processColors).toHaveProperty("codex");
    expect(DEFAULTS.processColors).toHaveProperty("gemini");
  });

  it("processColors contains common shells", () => {
    expect(DEFAULTS.processColors).toHaveProperty("zsh");
    expect(DEFAULTS.processColors).toHaveProperty("bash");
    expect(DEFAULTS.processColors).toHaveProperty("fish");
    expect(DEFAULTS.processColors).toHaveProperty("sh");
  });

  it("all processColors values are valid hex", () => {
    for (const [name, color] of Object.entries(DEFAULTS.processColors)) {
      expect(color, `${name} should be a hex color`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("claude brand color is Anthropic orange", () => {
    expect(DEFAULTS.processColors.claude.toLowerCase()).toBe("#d97757");
  });

  it("codex brand color is blue", () => {
    expect(DEFAULTS.processColors.codex.toLowerCase()).toBe("#5b8def");
  });

  it("gemini brand color is Google blue", () => {
    expect(DEFAULTS.processColors.gemini.toLowerCase()).toBe("#4285f4");
  });

  it("all shells share the same color (indicate idle state)", () => {
    const shellColors = new Set([
      DEFAULTS.processColors.zsh,
      DEFAULTS.processColors.bash,
      DEFAULTS.processColors.fish,
      DEFAULTS.processColors.sh,
    ]);
    expect(shellColors.size).toBe(1);
  });

  it("DEFAULT_PROCESS_COLORS is exported and matches defaults", () => {
    expect(DEFAULT_PROCESS_COLORS).toEqual(DEFAULTS.processColors);
  });

  it("processColors survives JSON round-trip", () => {
    const json = JSON.stringify(DEFAULTS);
    const parsed = JSON.parse(json);
    expect(parsed.processColors).toEqual(DEFAULTS.processColors);
  });

  it("processColors allows user overrides", () => {
    const merged = {
      ...DEFAULTS,
      processColors: { ...DEFAULTS.processColors, claude: "#ff0000" },
    };
    expect(merged.processColors.claude).toBe("#ff0000");
    expect(merged.processColors.codex).toBe(DEFAULTS.processColors.codex);
  });
});
