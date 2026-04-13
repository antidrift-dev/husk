import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveProfile, loadProfiles, deleteProfile } from "./profiles";
import fs from "fs";
import path from "path";
import os from "os";

const PROFILES_DIR = path.join(os.homedir(), ".husk", "profiles");

function cleanProfiles() {
  if (fs.existsSync(PROFILES_DIR)) fs.rmSync(PROFILES_DIR, { recursive: true, force: true });
}

describe("Profiles", () => {
  beforeEach(() => cleanProfiles());
  afterEach(() => cleanProfiles());

  describe("saveProfile", () => {
    it("creates profile file", () => {
      saveProfile({ name: "Test", sessions: [{ label: "S1", cwd: "/tmp" }] });
      expect(fs.existsSync(path.join(PROFILES_DIR, "test.json"))).toBe(true);
    });

    it("saves correct content", () => {
      saveProfile({ name: "My Project", sessions: [{ label: "Dev", cwd: "/Projects/dev" }] });
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, "my-project.json"), "utf-8"));
      expect(data.name).toBe("My Project");
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].label).toBe("Dev");
      expect(data.sessions[0].cwd).toBe("/Projects/dev");
    });

    it("handles multiple sessions", () => {
      saveProfile({
        name: "Full Stack",
        sessions: [
          { label: "Frontend", cwd: "/app/frontend" },
          { label: "Backend", cwd: "/app/backend" },
          { label: "DB", cwd: "/app/db" },
        ],
      });
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, "full-stack.json"), "utf-8"));
      expect(data.sessions).toHaveLength(3);
    });

    it("overwrites existing profile with same name", () => {
      saveProfile({ name: "Test", sessions: [{ label: "V1", cwd: "/v1" }] });
      saveProfile({ name: "Test", sessions: [{ label: "V2", cwd: "/v2" }] });
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, "test.json"), "utf-8"));
      expect(data.sessions[0].label).toBe("V2");
    });

    it("sanitizes filename from name", () => {
      saveProfile({ name: "My Cool Project!!!", sessions: [] });
      expect(fs.existsSync(path.join(PROFILES_DIR, "my-cool-project-.json"))).toBe(true);
    });

    it("handles unicode names", () => {
      saveProfile({ name: "🚀 Rocket", sessions: [] });
      const profiles = loadProfiles();
      expect(profiles.some((p) => p.name === "🚀 Rocket")).toBe(true);
    });
  });

  describe("loadProfiles", () => {
    it("returns empty array with no profiles", () => {
      expect(loadProfiles()).toEqual([]);
    });

    it("loads saved profiles", () => {
      saveProfile({ name: "Alpha", sessions: [] });
      saveProfile({ name: "Beta", sessions: [] });
      const profiles = loadProfiles();
      expect(profiles).toHaveLength(2);
    });

    it("returns profiles sorted by name", () => {
      saveProfile({ name: "Zebra", sessions: [] });
      saveProfile({ name: "Alpha", sessions: [] });
      saveProfile({ name: "Middle", sessions: [] });
      const profiles = loadProfiles();
      expect(profiles[0].name).toBe("Alpha");
      expect(profiles[1].name).toBe("Middle");
      expect(profiles[2].name).toBe("Zebra");
    });

    it("ignores non-json files", () => {
      fs.mkdirSync(PROFILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(PROFILES_DIR, "readme.txt"), "not a profile");
      expect(loadProfiles()).toEqual([]);
    });

    it("ignores malformed json", () => {
      fs.mkdirSync(PROFILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(PROFILES_DIR, "bad.json"), "not json");
      expect(loadProfiles()).toEqual([]);
    });

    it("ignores json without name or sessions", () => {
      fs.mkdirSync(PROFILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(PROFILES_DIR, "partial.json"), '{"name":"test"}');
      expect(loadProfiles()).toEqual([]);
    });
  });

  describe("deleteProfile", () => {
    it("deletes existing profile", () => {
      saveProfile({ name: "ToDelete", sessions: [] });
      expect(loadProfiles()).toHaveLength(1);
      deleteProfile("ToDelete");
      expect(loadProfiles()).toHaveLength(0);
    });

    it("no-op for nonexistent profile", () => {
      expect(() => deleteProfile("nonexistent")).not.toThrow();
    });

    it("doesn't affect other profiles", () => {
      saveProfile({ name: "Keep", sessions: [] });
      saveProfile({ name: "Delete", sessions: [] });
      deleteProfile("Delete");
      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("Keep");
    });
  });
});
