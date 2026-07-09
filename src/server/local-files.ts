import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

export const RECENTS_PATH = resolve(homedir(), ".streamliner", "recent-graphs.json");
const MAX_RECENTS = 20;

export interface RecentEntry {
  path: string;
  title: string;
  id: string;
  lastOpened: string;
}

export async function loadRecents(
  recentsPath: string = RECENTS_PATH,
): Promise<RecentEntry[]> {
  try {
    const raw = await readFile(recentsPath, "utf-8");
    return JSON.parse(raw) as RecentEntry[];
  } catch {
    return [];
  }
}

export async function saveRecents(
  entries: RecentEntry[],
  recentsPath: string = RECENTS_PATH,
): Promise<void> {
  await mkdir(dirname(recentsPath), { recursive: true });
  await writeFile(recentsPath, JSON.stringify(entries, null, 2));
}

export async function touchRecent(
  absPath: string,
  title: string,
  id: string,
  recentsPath: string = RECENTS_PATH,
): Promise<void> {
  const entries = await loadRecents(recentsPath);
  const filtered = entries.filter((entry) => entry.path !== absPath);
  filtered.unshift({ path: absPath, title, id, lastOpened: new Date().toISOString() });
  await saveRecents(filtered.slice(0, MAX_RECENTS), recentsPath);
}

export interface GraphFileInfo {
  lastModified: string;
  mtimeMs: number;
}

export interface GraphFile extends GraphFileInfo {
  content: string;
}

export async function statGraphFile(absPath: string): Promise<GraphFileInfo> {
  const info = await stat(absPath);
  return {
    lastModified: info.mtime.toUTCString(),
    mtimeMs: Math.floor(info.mtime.getTime() / 1000) * 1000,
  };
}

export async function readGraphFile(
  absPath: string,
  graphInfo?: GraphFileInfo,
): Promise<GraphFile> {
  const info = graphInfo ?? await statGraphFile(absPath);
  const content = await readFile(absPath, "utf-8");
  return {
    ...info,
    content,
  };
}
