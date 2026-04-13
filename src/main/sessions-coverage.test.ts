import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./sessions";
import fs from "fs";
import path from "path";
import os from "os";

const STATE_FILE = path.join(os.homedir(), ".husk", "sessions.json");

let mgr: SessionManager;

function cleanState() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

beforeEach(() => {
  cleanState();
  mgr = new SessionManager();
});

afterEach(() => {
  mgr.destroyAll();
  cleanState();
});

describe("SessionManager — coverage gaps", () => {
  describe("loadUiState", () => {
    it("loads without state file (no-op)", () => {
      expect(() => mgr.loadUiState()).not.toThrow();
    });

    it("loads with valid state file", () => {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        sessions: [],
        activeIndex: -1,
        sidebarWidth: 200,
        themeId: "dracula",
        use24h: false,
        windowBounds: { width: 1200, height: 800, x: 50, y: 50 },
      }));
      mgr.loadUiState();
      expect(mgr.getThemeId()).toBe("dracula");
      expect(mgr.getUse24h()).toBe(false);
      expect(mgr.getWindowBounds()).toEqual({ width: 1200, height: 800, x: 50, y: 50 });
    });

    it("handles malformed state file", () => {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, "not json");
      expect(() => mgr.loadUiState()).not.toThrow();
    });

    it("handles partial state file", () => {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ themeId: "nord" }));
      mgr.loadUiState();
      expect(mgr.getThemeId()).toBe("nord");
    });
  });

  describe("restore", () => {
    it("returns empty with no state file", () => {
      const result = mgr.restore();
      expect(result.sessions).toEqual([]);
      expect(result.activeIndex).toBe(-1);
    });

    it("restores sessions from state file", () => {
      // Create and save a session first
      mgr.create("test-session");
      // Destroy manager (saves state)
      mgr.destroyAll();

      // New manager should restore
      const mgr2 = new SessionManager();
      mgr2.loadUiState();
      const result = mgr2.restore();
      expect(result.sessions.length).toBeGreaterThanOrEqual(1);
      expect(result.sessions[0].label).toBe("test-session");
      mgr2.destroyAll();
    });

    it("restores sidebarWidth and themeId", () => {
      mgr.saveSidebarWidth(250);
      mgr.setThemeId("tokyo-night");
      mgr.create("s1");
      mgr.destroyAll();

      const mgr2 = new SessionManager();
      mgr2.loadUiState();
      const result = mgr2.restore();
      expect(result.sidebarWidth).toBe(250);
      expect(result.themeId).toBe("tokyo-night");
      mgr2.destroyAll();
    });

    it("second call returns current sessions (guard)", () => {
      mgr.create("s1");
      const first = mgr.restore();
      const second = mgr.restore();
      // Second call should return current sessions, not re-create
      expect(second.sessions.length).toBe(first.sessions.length + 1); // +1 from create before restore
    });

    it("handles corrupted state file", () => {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, "{ broken json");
      const result = mgr.restore();
      expect(result.sessions).toEqual([]);
    });

    it("restores activeIndex", () => {
      mgr.create("s1");
      mgr.create("s2");
      mgr.destroyAll();

      const mgr2 = new SessionManager();
      const result = mgr2.restore();
      expect(result.activeIndex).toBeGreaterThanOrEqual(0);
      mgr2.destroyAll();
    });

    it("restores use24h", () => {
      mgr.setUse24h(false);
      mgr.create("s1");
      mgr.destroyAll();

      const mgr2 = new SessionManager();
      mgr2.loadUiState();
      const result = mgr2.restore();
      expect(result.use24h).toBe(false);
      mgr2.destroyAll();
    });
  });

  describe("save + restore round trip", () => {
    it("preserves session labels", () => {
      mgr.create("Alpha");
      mgr.create("Beta");
      mgr.destroyAll();

      const mgr2 = new SessionManager();
      const result = mgr2.restore();
      const labels = result.sessions.map((s) => s.label);
      expect(labels).toContain("Alpha");
      expect(labels).toContain("Beta");
      mgr2.destroyAll();
    });

    it("preserves window bounds", () => {
      mgr.saveWindowBounds({ width: 999, height: 777, x: 10, y: 20 });
      mgr.create("s1");
      mgr.destroyAll();

      const mgr2 = new SessionManager();
      mgr2.loadUiState();
      expect(mgr2.getWindowBounds()).toEqual({ width: 999, height: 777, x: 10, y: 20 });
      mgr2.destroyAll();
    });
  });
});
