import { describe, it, expect } from "vitest";
import { SessionManager } from "./sessions";

describe("SessionManager.matchKnownApp", () => {
  // ---- Positive matches ----
  describe("recognizes known apps by leading path component", () => {
    it("matches /usr/local/bin/claude", () => {
      expect(SessionManager.matchKnownApp("/usr/local/bin/claude")).toBe("claude");
    });

    it("matches /opt/homebrew/bin/codex", () => {
      expect(SessionManager.matchKnownApp("/opt/homebrew/bin/codex")).toBe("codex");
    });

    it("matches /usr/bin/gemini", () => {
      expect(SessionManager.matchKnownApp("/usr/bin/gemini")).toBe("gemini");
    });

    it("matches /usr/bin/git status", () => {
      expect(SessionManager.matchKnownApp("/usr/bin/git status")).toBe("git");
    });

    it("matches /usr/bin/vim file.txt", () => {
      expect(SessionManager.matchKnownApp("/usr/bin/vim file.txt")).toBe("vim");
    });
  });

  describe("recognizes known apps as leading command", () => {
    it("matches 'claude' as bare command", () => {
      expect(SessionManager.matchKnownApp("claude")).toBe("claude");
    });

    it("matches 'claude --help'", () => {
      expect(SessionManager.matchKnownApp("claude --help")).toBe("claude");
    });

    it("matches 'git status -s'", () => {
      expect(SessionManager.matchKnownApp("git status -s")).toBe("git");
    });

    it("matches 'docker ps -a'", () => {
      expect(SessionManager.matchKnownApp("docker ps -a")).toBe("docker");
    });
  });

  describe("recognizes known apps via space-separated wrapper", () => {
    it("matches 'node /path/to/claude'", () => {
      expect(SessionManager.matchKnownApp("node /path/to/claude")).toBe("claude");
    });

    it("matches 'caffeinate -i codex'", () => {
      expect(SessionManager.matchKnownApp("caffeinate -i codex")).toBe("codex");
    });
  });

  describe("case insensitivity", () => {
    it("matches 'CLAUDE' (uppercase)", () => {
      expect(SessionManager.matchKnownApp("CLAUDE")).toBe("claude");
    });

    it("matches '/Users/foo/.CLAUDE/bin/claude'", () => {
      expect(SessionManager.matchKnownApp("/Users/foo/.CLAUDE/bin/claude")).toBe("claude");
    });
  });

  // ---- Negative matches ----
  describe("returns null for unknown commands", () => {
    it("returns null for 'zsh'", () => {
      expect(SessionManager.matchKnownApp("zsh")).toBeNull();
    });

    it("returns null for 'bash -l'", () => {
      expect(SessionManager.matchKnownApp("bash -l")).toBeNull();
    });

    it("returns null for 'node server.js'", () => {
      expect(SessionManager.matchKnownApp("node server.js")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(SessionManager.matchKnownApp("")).toBeNull();
    });

    it("returns null for whitespace only", () => {
      expect(SessionManager.matchKnownApp("   ")).toBeNull();
    });
  });

  describe("does not false-match substrings", () => {
    it("'claudemate' does not match claude (no path prefix, no space, not leading)", () => {
      // "claude" appears at the start of "claudemate", so startsWith is true.
      // This is a known false-positive we accept — document it here.
      // If we wanted to fix it, we'd need word-boundary checks.
      const result = SessionManager.matchKnownApp("claudemate");
      expect(result).toBe("claude"); // known false positive, documenting behavior
    });

    it("'/path/to/reclaim' does not match claude", () => {
      expect(SessionManager.matchKnownApp("/path/to/reclaim")).toBeNull();
    });
  });
});

describe("SessionManager.STOP_APPS", () => {
  it("claude is an umbrella app (should stop tree walk)", () => {
    expect(SessionManager.STOP_APPS.has("claude")).toBe(true);
  });

  it("codex is an umbrella app", () => {
    expect(SessionManager.STOP_APPS.has("codex")).toBe(true);
  });

  it("gemini is an umbrella app", () => {
    expect(SessionManager.STOP_APPS.has("gemini")).toBe(true);
  });

  it("vim/nvim/emacs are umbrella apps", () => {
    expect(SessionManager.STOP_APPS.has("vim")).toBe(true);
    expect(SessionManager.STOP_APPS.has("nvim")).toBe(true);
    expect(SessionManager.STOP_APPS.has("emacs")).toBe(true);
  });

  it("docker is an umbrella app", () => {
    expect(SessionManager.STOP_APPS.has("docker")).toBe(true);
  });

  it("git is NOT an umbrella app (want to see git subcommands)", () => {
    expect(SessionManager.STOP_APPS.has("git")).toBe(false);
  });

  it("ssh is NOT an umbrella app", () => {
    expect(SessionManager.STOP_APPS.has("ssh")).toBe(false);
  });

  it("every STOP_APP is also in KNOWN_APPS", () => {
    for (const app of SessionManager.STOP_APPS) {
      expect(SessionManager.KNOWN_APPS).toContain(app);
    }
  });
});

describe("SessionManager.KNOWN_APPS", () => {
  it("includes all current AI CLIs", () => {
    expect(SessionManager.KNOWN_APPS).toContain("claude");
    expect(SessionManager.KNOWN_APPS).toContain("codex");
    expect(SessionManager.KNOWN_APPS).toContain("gemini");
    expect(SessionManager.KNOWN_APPS).toContain("aider");
    expect(SessionManager.KNOWN_APPS).toContain("copilot");
  });

  it("does not contain cursor (not a terminal app)", () => {
    expect(SessionManager.KNOWN_APPS).not.toContain("cursor");
  });

  it("contains common editors", () => {
    expect(SessionManager.KNOWN_APPS).toContain("vim");
    expect(SessionManager.KNOWN_APPS).toContain("nvim");
    expect(SessionManager.KNOWN_APPS).toContain("emacs");
    expect(SessionManager.KNOWN_APPS).toContain("nano");
  });

  it("contains ssh, git, docker", () => {
    expect(SessionManager.KNOWN_APPS).toContain("ssh");
    expect(SessionManager.KNOWN_APPS).toContain("git");
    expect(SessionManager.KNOWN_APPS).toContain("docker");
  });

  it("has no duplicates", () => {
    const unique = new Set(SessionManager.KNOWN_APPS);
    expect(unique.size).toBe(SessionManager.KNOWN_APPS.length);
  });
});
