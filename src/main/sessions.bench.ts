import { bench, describe, beforeAll, afterAll } from "vitest";
import { SessionManager } from "./sessions";

// ── Query ops ────────────────────────────────────────────────────────────────
// Run on every status-bar tick — P99 here is directly felt by the user.
describe("SessionManager — query ops", () => {
  let mgr: SessionManager;
  let sessionId: string;
  let paneId: string;

  beforeAll(async () => {
    mgr = new SessionManager();
    const { session, paneId: pid } = mgr.create("bench");
    sessionId = session.id;
    paneId = pid;
    // Let the shell settle and warm up the env cache before timing starts
    await new Promise((r) => setTimeout(r, 1500));
  });

  afterAll(() => mgr.destroyAll());

  bench("getSessionMemory", async () => {
    await mgr.getSessionMemory(sessionId);
  }, { time: 5000, warmupTime: 500 });

  bench("getForegroundProcess", async () => {
    await mgr.getForegroundProcess(sessionId, paneId);
  }, { time: 5000, warmupTime: 500 });

  bench("getSessionProcessBreakdown", async () => {
    await mgr.getSessionProcessBreakdown(sessionId);
  }, { time: 5000, warmupTime: 500 });

  bench("getCwd", async () => {
    await mgr.getCwd(sessionId, paneId);
  }, { time: 5000, warmupTime: 500 });
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
// PTY spawn cost — felt when creating sessions and panes.
describe("SessionManager — lifecycle", () => {
  let mgr: SessionManager;

  beforeAll(() => { mgr = new SessionManager(); });
  afterAll(() => mgr.destroyAll());

  bench("session create + close", async () => {
    const { session } = mgr.create("bench");
    await new Promise((r) => setTimeout(r, 80));
    mgr.close(session.id);
  }, { iterations: 20, warmupIterations: 3 });

  bench("createPane", async () => {
    const { session } = mgr.create("bench");
    await new Promise((r) => setTimeout(r, 300));
    const paneId = mgr.createPane(session.id);
    if (paneId) mgr.closePane(session.id, paneId);
    mgr.close(session.id);
  }, { iterations: 10, warmupIterations: 2 });
});
