import fs from "fs";
import path from "path";
import os from "os";

const PROFILES_DIR = path.join(os.homedir(), ".husk", "profiles");

export interface Profile {
  name: string;
  sessions: { label: string; cwd: string }[];
}

function ensureDir() {
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

export function saveProfile(profile: Profile): void {
  ensureDir();
  const filename = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
  fs.writeFileSync(path.join(PROFILES_DIR, filename), JSON.stringify(profile, null, 2));
}

export function loadProfiles(): Profile[] {
  ensureDir();
  const profiles: Profile[] = [];
  for (const file of fs.readdirSync(PROFILES_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), "utf-8"));
      if (data.name && Array.isArray(data.sessions)) profiles.push(data);
    } catch {}
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

export function deleteProfile(name: string): void {
  ensureDir();
  const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
  const filepath = path.join(PROFILES_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}
