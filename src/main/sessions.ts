import * as pty from "node-pty";
import { v4 as uuid } from "uuid";
import os from "os";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const STATE_DIR = path.join(os.homedir(), ".husk");
const STATE_FILE = path.join(STATE_DIR, "sessions.json");

interface SavedSession {
  id: string;
  label: string;
  cwd: string;
}

export interface Session {
  id: string;
  label: string;
  pty: pty.IPty;
  subPty: pty.IPty | null;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private activeId: string | null = null;
  private sidebarWidth = 120;
  private themeId = "mocha";
  private use24h = true;
  private windowBounds = { width: 960, height: 640, x: undefined as number | undefined, y: undefined as number | undefined };
  private restored = false;

  onExit: ((id: string) => void) | null = null;
  onSubPtyExit: ((id: string) => void) | null = null;

  create(label: string, cwd?: string): Session {
    const id = uuid();
    const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");

    const p = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: cwd || os.homedir(),
      env: process.env as Record<string, string>,
    });

    p.onExit(() => {
      setTimeout(() => {
        this.sessions.delete(id);
        if (this.activeId === id) {
          this.activeId = null;
        }
        this.save();
        this.onExit?.(id);
      }, 300);
    });

    const session: Session = { id, label, pty: p, subPty: null };
    this.sessions.set(id, session);
    this.activeId = id;
    this.save();
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  write(id: string, data: string) {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.pty.resize(cols, rows);
  }

  createSubPty(id: string): pty.IPty | null {
    const session = this.sessions.get(id);
    if (!session || session.subPty) return null;
    const cwd = this.getCwdSync(id) || os.homedir();
    const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");

    const p = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 12,
      cwd,
      env: process.env as Record<string, string>,
    });

    p.onExit(() => {
      session.subPty = null;
      this.onSubPtyExit?.(id);
    });

    session.subPty = p;
    return p;
  }

  closeSubPty(id: string) {
    const session = this.sessions.get(id);
    if (!session?.subPty) return;
    session.subPty.kill();
    session.subPty = null;
  }

  writeSubPty(id: string, data: string) {
    this.sessions.get(id)?.subPty?.write(data);
  }

  resizeSubPty(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.subPty?.resize(cols, rows);
  }

  switch(id: string): { id: string; label: string } | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    this.activeId = id;
    this.save();
    return { id: session.id, label: session.label };
  }

  rename(id: string, label: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.label = label;
      this.save();
    }
  }

  saveSidebarWidth(width: number) {
    this.sidebarWidth = width;
    this.save();
  }

  loadUiState() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (data.windowBounds) this.windowBounds = data.windowBounds;
      if (data.sidebarWidth) this.sidebarWidth = data.sidebarWidth;
      if (data.themeId) this.themeId = data.themeId;
      if (typeof data.use24h === "boolean") this.use24h = data.use24h;
    } catch {}
  }

  getWindowBounds() { return this.windowBounds; }

  saveWindowBounds(bounds: { width: number; height: number; x: number; y: number }) {
    this.windowBounds = bounds;
    this.save();
  }

  getUse24h(): boolean { return this.use24h; }

  setUse24h(val: boolean) {
    this.use24h = val;
    this.save();
  }

  getThemeId(): string { return this.themeId; }

  setThemeId(id: string) {
    this.themeId = id;
    this.save();
  }

  private getCwdSync(id: string): string | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    try {
      const pid = session.pty.pid;
      if (os.platform() === "darwin") {
        const { execSync } = require("child_process");
        const result = execSync(`lsof -d cwd -a -p ${pid} -Fn`, { encoding: "utf-8", timeout: 500 }).trim();
        const match = result.match(/^n(.+)$/m);
        return match ? match[1] : null;
      } else {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
      }
    } catch {
      return null;
    }
  }

  async getCwd(id: string): Promise<string | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    try {
      const pid = session.pty.pid;
      if (os.platform() === "darwin") {
        const { stdout } = await execFileAsync("lsof", ["-d", "cwd", "-a", "-p", String(pid), "-Fn"], { timeout: 500 });
        const match = stdout.trim().match(/^n(.+)$/m);
        return match ? match[1] : null;
      } else {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
      }
    } catch {
      return null;
    }
  }

  async getSessionMemory(id: string): Promise<number | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    try {
      const pids = [String(session.pty.pid)];

      // Walk the process tree
      const findChildren = async (pid: string) => {
        try {
          const { stdout } = await execFileAsync("pgrep", ["-P", pid], { timeout: 500 });
          const children = stdout.trim().split("\n").filter(Boolean);
          for (const child of children) {
            pids.push(child);
            await findChildren(child);
          }
        } catch {}
      };
      await findChildren(String(session.pty.pid));

      // Sum RSS for all PIDs
      const { stdout: rss } = await execFileAsync("ps", ["-o", "rss=", "-p", pids.join(",")], { timeout: 500 });
      const totalKB = rss.trim().split("\n").reduce((sum, line) => sum + parseInt(line.trim() || "0", 10), 0);
      return Math.round(totalKB / 1024); // MB
    } catch {
      return null;
    }
  }

  // Known apps that should be identified even if buried in the process tree
  private static KNOWN_APPS = ["claude", "codex", "aider", "cursor", "copilot", "vim", "nvim", "emacs", "nano", "htop", "top", "docker", "ssh", "git"];

  async getForegroundProcess(id: string): Promise<string | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    try {
      // Walk the full process tree, collecting all command lines
      const allCmds: string[] = [];
      let currentPid = session.pty.pid;
      while (true) {
        try {
          const { stdout: cmdOut } = await execFileAsync("ps", ["-o", "command=", "-p", String(currentPid)], { timeout: 500 });
          allCmds.push(cmdOut.trim());
        } catch {}

        try {
          const { stdout } = await execFileAsync("pgrep", ["-P", String(currentPid)], { timeout: 500 });
          const trimmed = stdout.trim();
          if (!trimmed) break;
          currentPid = parseInt(trimmed.split("\n").pop()!.trim(), 10);
        } catch {
          break;
        }
      }
      // Get the leaf process command too
      try {
        const { stdout: cmdOut } = await execFileAsync("ps", ["-o", "command=", "-p", String(currentPid)], { timeout: 500 });
        allCmds.push(cmdOut.trim());
      } catch {}

      // Check all commands for known apps (search the whole tree)
      for (const known of SessionManager.KNOWN_APPS) {
        for (const cmd of allCmds) {
          const lower = cmd.toLowerCase();
          if (lower.includes(`/${known}`) || lower.includes(` ${known}`) || lower.startsWith(known)) {
            return known;
          }
        }
      }

      // Fall back to parsing the leaf process
      const leafCmd = allCmds[allCmds.length - 1] || "";
      const parts = leafCmd.split(/\s+/);
      const exe = parts[0].split("/").pop() || parts[0];
      const runtimes = ["node", "python", "python3", "ruby", "perl", "deno", "bun", "tsx", "ts-node", "npx", "caffeinate"];
      if (runtimes.includes(exe) && parts.length > 1) {
        const script = parts[1].split("/").pop() || parts[1];
        return script.replace(/\.(js|ts|mjs|cjs|py|rb|pl)$/, "");
      }
      return exe;
    } catch {
      return null;
    }
  }

  close(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.subPty) session.subPty.kill();
    session.pty.kill();
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.save();
  }

  private save() {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }
      const saved: SavedSession[] = [];
      const ids: string[] = [];
      for (const [id, session] of this.sessions) {
        const cwd = this.getCwdSync(id) || os.homedir();
        saved.push({ id: session.id, label: session.label, cwd });
        ids.push(id);
      }
      const activeIndex = this.activeId ? ids.indexOf(this.activeId) : -1;
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        sessions: saved,
        activeIndex,
        sidebarWidth: this.sidebarWidth,
        themeId: this.themeId,
        use24h: this.use24h,
        windowBounds: this.windowBounds,
      }, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  restore(): { sessions: { id: string; label: string }[]; activeIndex: number; sidebarWidth: number; themeId: string; use24h: boolean } {
    const empty = { sessions: [] as { id: string; label: string }[], activeIndex: -1, sidebarWidth: this.sidebarWidth, themeId: this.themeId, use24h: this.use24h };

    // Guard against multiple calls (e.g. HMR reloads)
    if (this.restored) {
      // Return current sessions instead of creating new ones
      const current = Array.from(this.sessions.values()).map(s => ({ id: s.id, label: s.label }));
      const ids = Array.from(this.sessions.keys());
      return {
        sessions: current,
        activeIndex: this.activeId ? ids.indexOf(this.activeId) : -1,
        sidebarWidth: this.sidebarWidth,
        themeId: this.themeId,
        use24h: this.use24h,
      };
    }
    this.restored = true;

    try {
      if (!fs.existsSync(STATE_FILE)) return empty;
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

      // Restore UI state BEFORE creating sessions (create() calls save())
      this.sidebarWidth = data.sidebarWidth || 120;
      this.themeId = data.themeId || "mocha";
      if (data.windowBounds) this.windowBounds = data.windowBounds;

      const restored: { id: string; label: string }[] = [];
      for (const saved of data.sessions as SavedSession[]) {
        const session = this.create(saved.label, saved.cwd);
        restored.push({ id: session.id, label: session.label });
      }
      const activeIndex = typeof data.activeIndex === "number" ? data.activeIndex : restored.length - 1;
      if (activeIndex >= 0 && activeIndex < restored.length) {
        this.activeId = restored[activeIndex].id;
      }
      return {
        sessions: restored,
        activeIndex,
        sidebarWidth: this.sidebarWidth,
        themeId: this.themeId,
        use24h: this.use24h,
      };
    } catch {
      return empty;
    }
  }

  destroyAll() {
    this.save();
    for (const session of this.sessions.values()) {
      session.pty.kill();
    }
    this.sessions.clear();
  }
}
