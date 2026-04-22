import * as pty from "node-pty";
import { v4 as uuid } from "uuid";
import os from "os";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { SavedPaneNode } from "./workspaces";

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
  panes: Map<string, pty.IPty>;
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
  onPaneExit: ((sessionId: string, paneId: string) => void) | null = null;

  private shellEnv: Record<string, string> | null = null;

  private getShellEnv(): Record<string, string> {
    if (this.shellEnv) return this.shellEnv;
    try {
      // Get the user's full login shell environment
      const shell = process.env.SHELL || "/bin/zsh";
      const { execSync } = require("child_process");
      const output = execSync(`${shell} -ilc env`, { encoding: "utf-8", timeout: 5000 });
      const env: Record<string, string> = {};
      for (const line of output.split("\n")) {
        const idx = line.indexOf("=");
        if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
      }
      this.shellEnv = env;
      return env;
    } catch {
      return process.env as Record<string, string>;
    }
  }

  private spawnPty(cwd: string): pty.IPty {
    const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");
    const env = { ...this.getShellEnv() };
    // Strip host-terminal identity so shell rc files don't re-inject terminal-
    // specific vars (e.g. Ghostty's zsh integration resets TERM=xterm-ghostty
    // and TERMINFO after node-pty sets TERM=xterm-256color).
    for (const key of Object.keys(env)) {
      if (key.startsWith("GHOSTTY_")) delete env[key];
    }
    delete env.TERMINFO;
    delete env.TERMINFO_DIRS;
    env.TERM_PROGRAM = "iTerm.app";
    env.TERM_PROGRAM_VERSION = "3.5.0";
    return pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env,
    });
  }

  create(label: string, cwd?: string): { session: Session; paneId: string } {
    const id = uuid();
    const paneId = uuid();
    const p = this.spawnPty(cwd || os.homedir());

    const session: Session = { id, label, panes: new Map([[paneId, p]]) };
    this.sessions.set(id, session);
    this.activeId = id;

    p.onExit(() => {
      this.removePaneInternal(id, paneId);
    });

    this.save();
    return { session, paneId };
  }

  createPane(sessionId: string, cwd?: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const paneId = uuid();
    const p = this.spawnPty(cwd || os.homedir());

    session.panes.set(paneId, p);

    p.onExit(() => {
      this.removePaneInternal(sessionId, paneId);
    });

    return paneId;
  }

  private removePaneInternal(sessionId: string, paneId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.panes.delete(paneId);
    this.onPaneExit?.(sessionId, paneId);

    if (session.panes.size === 0) {
      setTimeout(() => {
        this.sessions.delete(sessionId);
        if (this.activeId === sessionId) this.activeId = null;
        this.save();
        this.onExit?.(sessionId);
      }, 300);
    }
  }

  closePane(sessionId: string, paneId: string) {
    const session = this.sessions.get(sessionId);
    const p = session?.panes.get(paneId);
    if (p) {
      p.kill();
      session!.panes.delete(paneId);
      if (session!.panes.size === 0) {
        this.sessions.delete(sessionId);
        if (this.activeId === sessionId) this.activeId = null;
        this.save();
      }
    }
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getPane(sessionId: string, paneId: string): pty.IPty | undefined {
    return this.sessions.get(sessionId)?.panes.get(paneId);
  }

  writePane(sessionId: string, paneId: string, data: string) {
    this.getPane(sessionId, paneId)?.write(data);
  }

  resizePane(sessionId: string, paneId: string, cols: number, rows: number) {
    this.getPane(sessionId, paneId)?.resize(cols, rows);
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

  close(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    for (const p of session.panes.values()) p.kill();
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.save();
  }

  async isCaffeinated(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      for (const p of session.panes.values()) {
        const { stdout } = await execFileAsync("pgrep", ["-P", String(p.pid), "-f", "caffeinate"], { timeout: 500 });
        if (stdout.trim()) return true;
      }
    } catch {}
    return false;
  }

  // CWD for a specific pane
  private getCwdByPid(pid: number): string | null {
    try {
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

  getCwdSync(sessionId: string, paneId?: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const p = paneId ? session.panes.get(paneId) : session.panes.values().next().value;
    if (!p) return null;
    return this.getCwdByPid(p.pid);
  }

  async getCwd(sessionId: string, paneId?: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const p = paneId ? session.panes.get(paneId) : session.panes.values().next().value;
    if (!p) return null;
    try {
      if (os.platform() === "darwin") {
        const { stdout } = await execFileAsync("lsof", ["-d", "cwd", "-a", "-p", String(p.pid), "-Fn"], { timeout: 500 });
        const match = stdout.trim().match(/^n(.+)$/m);
        return match ? match[1] : null;
      } else {
        return fs.readlinkSync(`/proc/${p.pid}/cwd`);
      }
    } catch {
      return null;
    }
  }

  static KNOWN_APPS = ["claude", "codex", "gemini", "aider", "copilot", "vim", "nvim", "emacs", "nano", "htop", "top", "docker", "ssh", "git"];
  // Umbrella processes — stop walking into their children
  static STOP_APPS = new Set(["claude", "codex", "gemini", "aider", "copilot", "vim", "nvim", "emacs", "docker"]);

  static matchKnownApp(cmd: string): string | null {
    const lower = cmd.toLowerCase();
    for (const known of SessionManager.KNOWN_APPS) {
      if (lower.includes(`/${known}`) || lower.includes(` ${known}`) || lower.startsWith(known)) {
        return known;
      }
    }
    return null;
  }

  async getForegroundProcess(sessionId: string, paneId?: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const p = paneId ? session.panes.get(paneId) : session.panes.values().next().value;
    if (!p) return null;
    try {
      let lastCmd = "";
      let currentPid = p.pid;
      while (true) {
        let cmd = "";
        try {
          const { stdout: cmdOut } = await execFileAsync("ps", ["-o", "command=", "-p", String(currentPid)], { timeout: 500 });
          cmd = cmdOut.trim();
        } catch {}

        if (cmd) {
          lastCmd = cmd;
          // Stop descending into umbrella apps — they ARE the foreground process
          const known = SessionManager.matchKnownApp(cmd);
          if (known && SessionManager.STOP_APPS.has(known)) return known;
        }

        try {
          const { stdout } = await execFileAsync("pgrep", ["-P", String(currentPid)], { timeout: 500 });
          const trimmed = stdout.trim();
          if (!trimmed) break;
          currentPid = parseInt(trimmed.split("\n").pop()!.trim(), 10);
        } catch {
          break;
        }
      }
      // Check the leaf
      try {
        const { stdout: cmdOut } = await execFileAsync("ps", ["-o", "command=", "-p", String(currentPid)], { timeout: 500 });
        if (cmdOut.trim()) lastCmd = cmdOut.trim();
      } catch {}

      const known = SessionManager.matchKnownApp(lastCmd);
      if (known) return known;

      const parts = lastCmd.split(/\s+/);
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

  async getSessionProcessBreakdown(sessionId: string): Promise<{ pid: number; name: string; memory: number; cpu: number }[] | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    try {
      const allPids: string[] = [];
      for (const p of session.panes.values()) {
        allPids.push(String(p.pid));
        const findChildren = async (pid: string) => {
          try {
            const { stdout } = await execFileAsync("pgrep", ["-P", pid], { timeout: 500 });
            for (const child of stdout.trim().split("\n").filter(Boolean)) {
              allPids.push(child);
              await findChildren(child);
            }
          } catch {}
        };
        await findChildren(String(p.pid));
      }
      if (allPids.length === 0) return [];
      // Get pid, command, rss, %cpu for all processes
      const { stdout } = await execFileAsync("ps", ["-o", "pid=,comm=,rss=,%cpu=", "-p", allPids.join(",")], { timeout: 500 });
      const processes: { pid: number; name: string; memory: number; cpu: number }[] = [];
      for (const line of stdout.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const pid = parseInt(parts[0], 10);
          const name = parts[1].split("/").pop() || parts[1];
          const memory = Math.round(parseInt(parts[2], 10) / 1024); // KB to MB
          const cpu = parseFloat(parts[3]) || 0;
          if (pid > 0) processes.push({ pid, name, memory, cpu });
        }
      }
      return processes.sort((a, b) => b.memory - a.memory);
    } catch {
      return null;
    }
  }

  async getSessionMemory(sessionId: string): Promise<number | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    try {
      const allPids: string[] = [];
      for (const p of session.panes.values()) {
        allPids.push(String(p.pid));
        const findChildren = async (pid: string) => {
          try {
            const { stdout } = await execFileAsync("pgrep", ["-P", pid], { timeout: 500 });
            const children = stdout.trim().split("\n").filter(Boolean);
            for (const child of children) {
              allPids.push(child);
              await findChildren(child);
            }
          } catch {}
        };
        await findChildren(String(p.pid));
      }
      const { stdout: rss } = await execFileAsync("ps", ["-o", "rss=", "-p", allPids.join(",")], { timeout: 500 });
      const totalKB = rss.trim().split("\n").reduce((sum, line) => sum + parseInt(line.trim() || "0", 10), 0);
      return Math.round(totalKB / 1024);
    } catch {
      return null;
    }
  }

  // UI state
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
  setUse24h(val: boolean) { this.use24h = val; this.save(); }

  getThemeId(): string { return this.themeId; }
  setThemeId(id: string) { this.themeId = id; this.save(); }

  getSidebarWidth(): number { return this.sidebarWidth; }
  saveSidebarWidth(width: number) { this.sidebarWidth = width; this.save(); }

  private save() {
    try {
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
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
    } catch {}
  }

  restore(): { sessions: { id: string; label: string; paneId: string }[]; activeIndex: number; sidebarWidth: number; themeId: string; use24h: boolean } {
    const empty = { sessions: [] as { id: string; label: string; paneId: string }[], activeIndex: -1, sidebarWidth: this.sidebarWidth, themeId: this.themeId, use24h: this.use24h };

    if (this.restored) {
      const current: { id: string; label: string; paneId: string }[] = [];
      for (const [id, session] of this.sessions) {
        const paneId = session.panes.keys().next().value;
        if (paneId) current.push({ id, label: session.label, paneId });
      }
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
      this.sidebarWidth = data.sidebarWidth || 120;
      this.themeId = data.themeId || "mocha";
      if (typeof data.use24h === "boolean") this.use24h = data.use24h;
      if (data.windowBounds) this.windowBounds = data.windowBounds;

      const restored: { id: string; label: string; paneId: string }[] = [];
      for (const saved of data.sessions as SavedSession[]) {
        const { session, paneId } = this.create(saved.label, saved.cwd);
        restored.push({ id: session.id, label: session.label, paneId });
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

  // Restored pane node — mirrors renderer's PaneNode (no CWD, new IDs)
  private spawnPaneTree(sessionId: string, session: Session, node: SavedPaneNode): RestoredPaneNode {
    if (node.type === "leaf") {
      const paneId = uuid();
      const p = this.spawnPty(node.cwd);
      session.panes.set(paneId, p);
      p.onExit(() => this.removePaneInternal(sessionId, paneId));
      return { type: "leaf", id: paneId };
    }
    return {
      type: "split",
      id: uuid(),
      direction: node.direction,
      ratio: node.ratio,
      children: [
        this.spawnPaneTree(sessionId, session, node.children[0]),
        this.spawnPaneTree(sessionId, session, node.children[1]),
      ],
    };
  }

  private restoredLeafIds(node: RestoredPaneNode): string[] {
    if (node.type === "leaf") return [node.id];
    return [...this.restoredLeafIds(node.children[0]), ...this.restoredLeafIds(node.children[1])];
  }

  createWithPaneTree(label: string, paneTree: SavedPaneNode): { session: Session; paneTree: RestoredPaneNode; allPaneIds: string[]; focusedPaneId: string } {
    const id = uuid();
    const session: Session = { id, label, panes: new Map() };
    this.sessions.set(id, session);
    this.activeId = id;

    const newTree = this.spawnPaneTree(id, session, paneTree);
    const allPaneIds = this.restoredLeafIds(newTree);
    const focusedPaneId = allPaneIds[0] || "";

    this.save();
    return { session, paneTree: newTree, allPaneIds, focusedPaneId };
  }

  destroyAll() {
    this.save();
    for (const session of this.sessions.values()) {
      for (const p of session.panes.values()) p.kill();
    }
    this.sessions.clear();
  }
}

// Matches renderer's PaneNode — leaves have id only (no CWD)
export type RestoredPaneNode =
  | { type: "leaf"; id: string }
  | { type: "split"; id: string; direction: "horizontal" | "vertical"; ratio: number; children: [RestoredPaneNode, RestoredPaneNode] };
