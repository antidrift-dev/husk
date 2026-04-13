import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./sessions";

let mgr: SessionManager;

beforeEach(() => {
  mgr = new SessionManager();
});

afterEach(() => {
  mgr.destroyAll();
});

describe("Caffeinate Detection", () => {
  it("returns false for a plain shell session", async () => {
    const { session } = mgr.create("test");
    await new Promise((r) => setTimeout(r, 500));
    const result = await mgr.isCaffeinated(session.id);
    expect(result).toBe(false);
  });

  it("returns false for nonexistent session", async () => {
    const result = await mgr.isCaffeinated("nonexistent");
    expect(result).toBe(false);
  });

  it("returns false for closed session", async () => {
    const { session } = mgr.create("test");
    mgr.close(session.id);
    const result = await mgr.isCaffeinated(session.id);
    expect(result).toBe(false);
  });

  it("detects caffeinate when running", async () => {
    const { session, paneId } = mgr.create("test");
    await new Promise((r) => setTimeout(r, 500));
    // Start caffeinate in the session
    mgr.writePane(session.id, paneId, "caffeinate -i &\n");
    await new Promise((r) => setTimeout(r, 1000));
    const result = await mgr.isCaffeinated(session.id);
    expect(result).toBe(true);
    // Clean up
    mgr.writePane(session.id, paneId, "kill %1 2>/dev/null\n");
    await new Promise((r) => setTimeout(r, 500));
  });

  it("returns false after caffeinate is killed", async () => {
    const { session, paneId } = mgr.create("test");
    await new Promise((r) => setTimeout(r, 500));
    mgr.writePane(session.id, paneId, "caffeinate -i &\n");
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mgr.isCaffeinated(session.id)).toBe(true);
    mgr.writePane(session.id, paneId, "kill %1\n");
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mgr.isCaffeinated(session.id)).toBe(false);
  });
});
