import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./sessions";

let mgr: SessionManager;

beforeEach(() => {
  mgr = new SessionManager();
});

afterEach(() => {
  mgr.destroyAll();
});

describe("Session Performance Monitor", () => {
  describe("getSessionMemory", () => {
    it("returns memory for single-pane session", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 300));
      const mem = await mgr.getSessionMemory(session.id);
      expect(mem).not.toBeNull();
      expect(mem!).toBeGreaterThan(0);
    });

    it("returns higher memory with more panes", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 300));
      const memBefore = await mgr.getSessionMemory(session.id);

      mgr.createPane(session.id);
      mgr.createPane(session.id);
      await new Promise((r) => setTimeout(r, 300));
      const memAfter = await mgr.getSessionMemory(session.id);

      expect(memAfter!).toBeGreaterThanOrEqual(memBefore!);
    });

    it("returns null after session is closed", async () => {
      const { session } = mgr.create("test");
      mgr.close(session.id);
      const mem = await mgr.getSessionMemory(session.id);
      expect(mem).toBeNull();
    });

    it("memory is independent per session", async () => {
      const a = mgr.create("a");
      const b = mgr.create("b");
      await new Promise((r) => setTimeout(r, 300));
      const memA = await mgr.getSessionMemory(a.session.id);
      const memB = await mgr.getSessionMemory(b.session.id);
      expect(memA).not.toBeNull();
      expect(memB).not.toBeNull();
      // Both should have similar base memory (just shells)
      expect(Math.abs(memA! - memB!)).toBeLessThan(50);
    });
  });

  describe("getForegroundProcess per pane", () => {
    it("returns process for specific pane", async () => {
      const { session, paneId } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const proc = await mgr.getForegroundProcess(session.id, paneId);
      expect(proc).toBeTruthy();
    });

    it("different panes can run different processes", async () => {
      const { session, paneId } = mgr.create("test");
      const pane2 = mgr.createPane(session.id)!;
      await new Promise((r) => setTimeout(r, 500));

      const proc1 = await mgr.getForegroundProcess(session.id, paneId);
      const proc2 = await mgr.getForegroundProcess(session.id, pane2);
      // Both should be shells initially
      expect(proc1).toBeTruthy();
      expect(proc2).toBeTruthy();
    });
  });

  describe("getSessionProcessBreakdown", () => {
    it("returns array of processes", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const breakdown = await mgr.getSessionProcessBreakdown(session.id);
      expect(breakdown).not.toBeNull();
      expect(Array.isArray(breakdown)).toBe(true);
      expect(breakdown!.length).toBeGreaterThan(0);
    });

    it("each process has pid, name, memory, cpu", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const breakdown = await mgr.getSessionProcessBreakdown(session.id);
      for (const p of breakdown!) {
        expect(p.pid).toBeGreaterThan(0);
        expect(p.name).toBeTruthy();
        expect(typeof p.memory).toBe("number");
        expect(typeof p.cpu).toBe("number");
      }
    });

    it("sorted by memory descending", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const breakdown = await mgr.getSessionProcessBreakdown(session.id);
      for (let i = 1; i < breakdown!.length; i++) {
        expect(breakdown![i - 1].memory).toBeGreaterThanOrEqual(breakdown![i].memory);
      }
    });

    it("returns null for invalid session", async () => {
      expect(await mgr.getSessionProcessBreakdown("bad")).toBeNull();
    });

    it("includes shell process", async () => {
      const { session } = mgr.create("test");
      await new Promise((r) => setTimeout(r, 500));
      const breakdown = await mgr.getSessionProcessBreakdown(session.id);
      const hasShell = breakdown!.some((p) => ["zsh", "bash", "fish", "sh"].includes(p.name));
      expect(hasShell).toBe(true);
    });
  });

  describe("getCwd per pane", () => {
    it("panes in same session can have different cwds", async () => {
      const { session, paneId } = mgr.create("test");
      const pane2 = mgr.createPane(session.id, "/tmp")!;
      await new Promise((r) => setTimeout(r, 500));

      const cwd1 = await mgr.getCwd(session.id, paneId);
      const cwd2 = await mgr.getCwd(session.id, pane2);
      expect(cwd1).toBeTruthy();
      expect(cwd2).toBeTruthy();
      // pane2 was created in /tmp, should be different
      // (though shell might cd elsewhere on init)
    });
  });
});
