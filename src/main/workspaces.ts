import fs from "fs";
import path from "path";
import os from "os";

const WORKSPACES_DIR = path.join(os.homedir(), ".husk", "workspaces");

export interface SavedPaneLeaf {
  type: "leaf";
  id: string;
  cwd: string;
}

export interface SavedPaneSplit {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [SavedPaneNode, SavedPaneNode];
}

export type SavedPaneNode = SavedPaneLeaf | SavedPaneSplit;

export interface WorkspaceSession {
  label: string;
  paneTree: SavedPaneNode;
  focusedPaneIndex: number; // index into getAllLeafIds(paneTree)
}

export interface WorkspaceWindow {
  bounds: { x: number; y: number; width: number; height: number };
  sessions: WorkspaceSession[];
  activeSessionIndex: number;
  sidebarWidth: number;
}

export interface Workspace {
  name: string;
  windows: WorkspaceWindow[];
}

function ensureDir() {
  if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

export function saveWorkspace(workspace: Workspace): void {
  ensureDir();
  const filename = workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
  fs.writeFileSync(path.join(WORKSPACES_DIR, filename), JSON.stringify(workspace, null, 2));
}

export function loadWorkspaces(): Workspace[] {
  ensureDir();
  const workspaces: Workspace[] = [];
  for (const file of fs.readdirSync(WORKSPACES_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR, file), "utf-8"));
      if (data.name && Array.isArray(data.windows)) workspaces.push(data);
    } catch {}
  }
  return workspaces.sort((a, b) => a.name.localeCompare(b.name));
}

export function deleteWorkspace(name: string): void {
  ensureDir();
  const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
  const filepath = path.join(WORKSPACES_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}
