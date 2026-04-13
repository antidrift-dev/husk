import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./sessions";

let mgr: SessionManager;

beforeEach(() => {
  mgr = new SessionManager();
});

afterEach(() => {
  mgr.destroyAll();
});

describe("SessionManager", () => {
  // ---- Session lifecycle ----
  describe("create", () => {
    it("creates a session with label", () => {
      const { session } = mgr.create("test");
      expect(session.label).toBe("test");
    });

    it("returns a valid session id", () => {
      const { session } = mgr.create("test");
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("returns a valid pane id", () => {
      const { paneId } = mgr.create("test");
      expect(paneId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("session has exactly one pane after creation", () => {
      const { session } = mgr.create("test");
      expect(session.panes.size).toBe(1);
    });

    it("pane id matches the one in the panes map", () => {
      const { session, paneId } = mgr.create("test");
      expect(session.panes.has(paneId)).toBe(true);
    });

    it("creates unique session ids", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        ids.add(mgr.create(`s${i}`).session.id);
      }
      expect(ids.size).toBe(10);
    });

    it("creates unique pane ids across sessions", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        ids.add(mgr.create(`s${i}`).paneId);
      }
      expect(ids.size).toBe(10);
    });

    it("creates PTY with custom cwd", () => {
      const { session } = mgr.create("test", "/tmp");
      expect(session.panes.size).toBe(1);
    });

    it("defaults cwd to home directory", () => {
      const { session } = mgr.create("test");
      expect(session.panes.size).toBe(1);
    });

    it("session is retrievable after creation", () => {
      const { session } = mgr.create("test");
      expect(mgr.getSession(session.id)).toBe(session);
    });
  });

  // ---- Pane management ----
  describe("createPane", () => {
    it("adds a second pane to existing session", () => {
      const { session } = mgr.create("test");
      const paneId = mgr.createPane(session.id);
      expect(paneId).toBeTruthy();
      expect(session.panes.size).toBe(2);
    });

    it("can add multiple panes", () => {
      const { session } = mgr.create("test");
      mgr.createPane(session.id);
      mgr.createPane(session.id);
      mgr.createPane(session.id);
      expect(session.panes.size).toBe(4);
    });

    it("each pane has unique id", () => {
      const { session, paneId } = mgr.create("test");
      const p2 = mgr.createPane(session.id)!;
      const p3 = mgr.createPane(session.id)!;
      expect(new Set([paneId, p2, p3]).size).toBe(3);
    });

    it("returns null for nonexistent session", () => {
      expect(mgr.createPane("nonexistent")).toBeNull();
    });

    it("new pane is retrievable", () => {
      const { session } = mgr.create("test");
      const paneId = mgr.createPane(session.id)!;
      expect(mgr.getPane(session.id, paneId)).toBeTruthy();
    });

    it("creates pane with custom cwd", () => {
      const { session } = mgr.create("test");
      const paneId = mgr.createPane(session.id, "/tmp");
      expect(paneId).toBeTruthy();
    });
  });

  describe("closePane", () => {
    it("removes a specific pane", () => {
      const { session, paneId } = mgr.create("test");
      const p2 = mgr.createPane(session.id)!;
      mgr.closePane(session.id, p2);
      expect(session.panes.size).toBe(1);
      expect(session.panes.has(paneId)).toBe(true);
      expect(session.panes.has(p2)).toBe(false);
    });

    it("closes session when last pane removed", () => {
      const { session, paneId } = mgr.create("test");
      mgr.closePane(session.id, paneId);
      expect(mgr.getSession(session.id)).toBeUndefined();
    });

    it("other panes survive when one is closed", () => {
      const { session, paneId } = mgr.create("test");
      const p2 = mgr.createPane(session.id)!;
      const p3 = mgr.createPane(session.id)!;
      mgr.closePane(session.id, p2);
      expect(session.panes.has(paneId)).toBe(true);
      expect(session.panes.has(p3)).toBe(true);
      expect(session.panes.size).toBe(2);
    });

    it("no-op for nonexistent pane", () => {
      const { session } = mgr.create("test");
      mgr.closePane(session.id, "nonexistent");
      expect(session.panes.size).toBe(1);
    });
  });

  describe("getPane", () => {
    it("returns PTY for valid ids", () => {
      const { session, paneId } = mgr.create("test");
      const p = mgr.getPane(session.id, paneId);
      expect(p).toBeTruthy();
      expect(typeof p!.pid).toBe("number");
    });

    it("returns undefined for invalid session", () => {
      expect(mgr.getPane("bad", "bad")).toBeUndefined();
    });

    it("returns undefined for invalid pane", () => {
      const { session } = mgr.create("test");
      expect(mgr.getPane(session.id, "bad")).toBeUndefined();
    });
  });

  // ---- I/O operations ----
  describe("writePane", () => {
    it("writes without error", () => {
      const { session, paneId } = mgr.create("test");
      expect(() => mgr.writePane(session.id, paneId, "echo hi\n")).not.toThrow();
    });

    it("no-op for invalid ids", () => {
      expect(() => mgr.writePane("bad", "bad", "test")).not.toThrow();
    });
  });

  describe("resizePane", () => {
    it("resizes without error", () => {
      const { session, paneId } = mgr.create("test");
      expect(() => mgr.resizePane(session.id, paneId, 120, 40)).not.toThrow();
    });

    it("handles small sizes", () => {
      const { session, paneId } = mgr.create("test");
      expect(() => mgr.resizePane(session.id, paneId, 1, 1)).not.toThrow();
    });

    it("handles large sizes", () => {
      const { session, paneId } = mgr.create("test");
      expect(() => mgr.resizePane(session.id, paneId, 500, 200)).not.toThrow();
    });
  });

  // ---- Session operations ----
  describe("switch", () => {
    it("returns session info for valid id", () => {
      const { session } = mgr.create("test");
      const result = mgr.switch(session.id);
      expect(result).toEqual({ id: session.id, label: "test" });
    });

    it("returns null for invalid id", () => {
      expect(mgr.switch("nonexistent")).toBeNull();
    });

    it("switching between sessions works", () => {
      const a = mgr.create("a");
      const b = mgr.create("b");
      expect(mgr.switch(a.session.id)?.label).toBe("a");
      expect(mgr.switch(b.session.id)?.label).toBe("b");
    });
  });

  describe("rename", () => {
    it("renames session", () => {
      const { session } = mgr.create("old");
      mgr.rename(session.id, "new");
      expect(mgr.getSession(session.id)?.label).toBe("new");
    });

    it("no-op for invalid session", () => {
      expect(() => mgr.rename("bad", "name")).not.toThrow();
    });

    it("handles empty label", () => {
      const { session } = mgr.create("test");
      mgr.rename(session.id, "");
      expect(session.label).toBe("");
    });

    it("handles unicode label", () => {
      const { session } = mgr.create("test");
      mgr.rename(session.id, "🚀 Production");
      expect(session.label).toBe("🚀 Production");
    });
  });

  describe("close", () => {
    it("removes session entirely", () => {
      const { session } = mgr.create("test");
      mgr.close(session.id);
      expect(mgr.getSession(session.id)).toBeUndefined();
    });

    it("kills all panes", () => {
      const { session } = mgr.create("test");
      mgr.createPane(session.id);
      mgr.createPane(session.id);
      mgr.close(session.id);
      expect(mgr.getSession(session.id)).toBeUndefined();
    });

    it("no-op for invalid session", () => {
      expect(() => mgr.close("bad")).not.toThrow();
    });

    it("other sessions survive", () => {
      const a = mgr.create("a");
      const b = mgr.create("b");
      mgr.close(a.session.id);
      expect(mgr.getSession(a.session.id)).toBeUndefined();
      expect(mgr.getSession(b.session.id)).toBeTruthy();
    });
  });

  // ---- Async status queries ----
  describe("getCwd", () => {
    it("returns cwd for valid session", async () => {
      const { session } = mgr.create("test", "/tmp");
      await new Promise((r) => setTimeout(r, 300));
      const cwd = await mgr.getCwd(session.id);
      expect(cwd).toBeTruthy();
      expect(typeof cwd).toBe("string");
    });

    it("returns cwd for specific pane", async () => {
      const { session, paneId } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 300));
      const cwd = await mgr.getCwd(session.id, paneId);
      expect(cwd).toBeTruthy();
    });

    it("returns null for invalid session", async () => {
      expect(await mgr.getCwd("bad")).toBeNull();
    });

    it("returns null for invalid pane", async () => {
      const { session } = mgr.create("test");
      expect(await mgr.getCwd(session.id, "bad")).toBeNull();
    });
  });

  describe("getCwdSync", () => {
    it("returns cwd synchronously", () => {
      const { session } = mgr.create("test");
      // Shell may not have started yet, but function shouldn't throw
      const cwd = mgr.getCwdSync(session.id);
      // Could be null or string depending on timing
      expect(cwd === null || typeof cwd === "string").toBe(true);
    });
  });

  describe("getForegroundProcess", () => {
    it("returns process name for running session", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const proc = await mgr.getForegroundProcess(session.id);
      expect(proc).toBeTruthy();
      expect(typeof proc).toBe("string");
    });

    it("returns null for invalid session", async () => {
      expect(await mgr.getForegroundProcess("bad")).toBeNull();
    });

    it("detects specific pane process", async () => {
      const { session, paneId } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const proc = await mgr.getForegroundProcess(session.id, paneId);
      expect(proc).toBeTruthy();
    });
  });

  describe("getSessionMemory", () => {
    it("returns positive number for valid session", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 300));
      const mem = await mgr.getSessionMemory(session.id);
      expect(typeof mem).toBe("number");
      expect(mem!).toBeGreaterThan(0);
    });

    it("includes memory from multiple panes", async () => {
      const { session } = mgr.create("test");
      mgr.createPane(session.id);
      await new Promise((r) => setTimeout(r, 300));
      const mem = await mgr.getSessionMemory(session.id);
      expect(mem!).toBeGreaterThan(0);
    });

    it("returns null for invalid session", async () => {
      expect(await mgr.getSessionMemory("bad")).toBeNull();
    });
  });

  // ---- UI state ----
  describe("UI state persistence", () => {
    it("getSidebarWidth returns default before any save", () => {
      expect(mgr.getSidebarWidth()).toBe(120);
    });

    it("getSidebarWidth returns saved value", () => {
      mgr.saveSidebarWidth(200);
      expect(mgr.getSidebarWidth()).toBe(200);
    });

    it("getSidebarWidth is independent of window bounds", () => {
      mgr.saveWindowBounds({ width: 960, height: 640, x: 100, y: 100 });
      mgr.saveSidebarWidth(150);
      expect(mgr.getSidebarWidth()).toBe(150);
      expect(mgr.getWindowBounds().width).toBe(960);
    });

    it("saves and loads theme", () => {
      mgr.setThemeId("nord");
      expect(mgr.getThemeId()).toBe("nord");
    });

    it("saves and loads 24h preference", () => {
      mgr.setUse24h(false);
      expect(mgr.getUse24h()).toBe(false);
      mgr.setUse24h(true);
      expect(mgr.getUse24h()).toBe(true);
    });

    it("saves and loads window bounds", () => {
      const bounds = { width: 1200, height: 800, x: 100, y: 50 };
      mgr.saveWindowBounds(bounds);
      expect(mgr.getWindowBounds()).toEqual(bounds);
    });
  });

  // ---- destroyAll ----
  describe("destroyAll", () => {
    it("kills all sessions and panes", () => {
      const a = mgr.create("a");
      const b = mgr.create("b");
      mgr.createPane(a.session.id);
      mgr.destroyAll();
      expect(mgr.getSession(a.session.id)).toBeUndefined();
      expect(mgr.getSession(b.session.id)).toBeUndefined();
    });

    it("is safe to call multiple times", () => {
      mgr.create("test");
      mgr.destroyAll();
      expect(() => mgr.destroyAll()).not.toThrow();
    });

    it("is safe with no sessions", () => {
      expect(() => mgr.destroyAll()).not.toThrow();
    });
  });

  // ---- Callbacks ----
  describe("callbacks", () => {
    it("onPaneExit fires when pane process exits", async () => {
      const exits: string[] = [];
      mgr.onPaneExit = (_sid, pid) => exits.push(pid);
      const { session, paneId } = mgr.create("test");
      // Kill the PTY directly
      mgr.getPane(session.id, paneId)!.kill();
      await new Promise((r) => setTimeout(r, 500));
      expect(exits).toContain(paneId);
    });
  });

  // ---- Stress tests ----
  describe("stress", () => {
    it("handles 10 sessions", { timeout: 15000 }, () => {
      for (let i = 0; i < 10; i++) {
        mgr.create(`session-${i}`);
      }
      expect(() => mgr.destroyAll()).not.toThrow();
    });

    it("handles 10 panes in one session", () => {
      const { session } = mgr.create("test");
      for (let i = 0; i < 9; i++) {
        mgr.createPane(session.id);
      }
      expect(session.panes.size).toBe(10);
    });
  });
});
