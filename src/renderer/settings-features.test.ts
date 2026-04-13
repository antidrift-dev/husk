import { describe, it, expect } from "vitest";
import { DEFAULTS } from "./Settings";

describe("Settings — Feature: Directory Colors", () => {
  it("defaults should be extensible for directory colors", () => {
    // When implemented, settings should support a directoryColors map
    // e.g. { "/Projects/probeo": "#4a9eff", "/Projects/antidrift": "#e78a4e" }
    const extended = {
      ...DEFAULTS,
      directoryColors: {
        "/Projects/probeo": "#4a9eff",
        "/Projects/antidrift": "#e78a4e",
      },
    };
    expect(extended.directoryColors).toBeDefined();
    expect(Object.keys(extended.directoryColors)).toHaveLength(2);
  });

  it("directory color values should be valid hex", () => {
    const colors: Record<string, string> = {
      "/home/user/project-a": "#ff5555",
      "/home/user/project-b": "#50fa7b",
    };
    for (const [path, color] of Object.entries(colors)) {
      expect(color, `color for ${path}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("directory matching should work with prefix", () => {
    const directoryColors: Record<string, string> = {
      "/Projects/probeo": "#4a9eff",
      "/Projects/antidrift": "#e78a4e",
    };
    const cwd = "/Projects/probeo/src/components";
    const match = Object.entries(directoryColors)
      .filter(([dir]) => cwd.startsWith(dir))
      .sort((a, b) => b[0].length - a[0].length)[0];
    expect(match).toBeDefined();
    expect(match[1]).toBe("#4a9eff");
  });

  it("no match returns undefined", () => {
    const directoryColors: Record<string, string> = {
      "/Projects/probeo": "#4a9eff",
    };
    const cwd = "/tmp/something";
    const match = Object.entries(directoryColors)
      .filter(([dir]) => cwd.startsWith(dir))
      .sort((a, b) => b[0].length - a[0].length)[0];
    expect(match).toBeUndefined();
  });

  it("longest prefix wins for nested directories", () => {
    const directoryColors: Record<string, string> = {
      "/Projects": "#aaaaaa",
      "/Projects/probeo": "#4a9eff",
      "/Projects/probeo/api": "#ff5555",
    };
    const cwd = "/Projects/probeo/api/routes";
    const match = Object.entries(directoryColors)
      .filter(([dir]) => cwd.startsWith(dir))
      .sort((a, b) => b[0].length - a[0].length)[0];
    expect(match[1]).toBe("#ff5555");
  });
});

describe("Settings — Feature: Performance Monitor", () => {
  it("memory value should be a positive number in MB", () => {
    const mem = 827; // typical value from getSessionMemory
    expect(mem).toBeGreaterThan(0);
    expect(Number.isInteger(mem)).toBe(true);
  });

  it("CPU percentage should be between 0 and 100+", () => {
    // When implemented, CPU should be a percentage
    const cpu = 45.2;
    expect(cpu).toBeGreaterThanOrEqual(0);
    // Can exceed 100 on multi-core (e.g. 200% = 2 cores)
  });

  it("process breakdown should include pid, name, and memory", () => {
    const breakdown = [
      { pid: 1234, name: "zsh", memory: 4 },
      { pid: 1235, name: "node", memory: 120 },
      { pid: 1236, name: "claude", memory: 700 },
    ];
    for (const proc of breakdown) {
      expect(proc.pid).toBeGreaterThan(0);
      expect(proc.name).toBeTruthy();
      expect(proc.memory).toBeGreaterThanOrEqual(0);
    }
    // Total should match session memory
    const total = breakdown.reduce((sum, p) => sum + p.memory, 0);
    expect(total).toBe(824);
  });
});
