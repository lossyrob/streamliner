import type { IncomingMessage, ServerResponse } from "node:http";
import { type Plugin } from "vite";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import {
  handleSessionRegistryApiRequest,
  SESSION_REGISTRY_API_BASE_PATH,
} from "./src/session-registry/http-api";
import { getSessionRegistryStore } from "./src/session-registry/runtime";

const RECENTS_PATH = resolve(homedir(), ".streamliner", "recent-graphs.json");
const MAX_RECENTS = 20;

interface RecentEntry {
  path: string;
  title: string;
  id: string;
  lastOpened: string;
}

async function loadRecents(): Promise<RecentEntry[]> {
  try {
    const raw = await readFile(RECENTS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRecents(entries: RecentEntry[]): Promise<void> {
  await mkdir(dirname(RECENTS_PATH), { recursive: true });
  await writeFile(RECENTS_PATH, JSON.stringify(entries, null, 2));
}

async function touchRecent(absPath: string, title: string, id: string): Promise<void> {
  const entries = await loadRecents();
  const filtered = entries.filter((e) => e.path !== absPath);
  filtered.unshift({ path: absPath, title, id, lastOpened: new Date().toISOString() });
  await saveRecents(filtered.slice(0, MAX_RECENTS));
}

function openFilePicker(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = 'Workstream Graph (graph.json)|graph.json|JSON files (*.json)|*.json|All files (*.*)|*.*'
$d.Title = 'Open workstream graph'
if ($d.ShowDialog() -eq 'OK') { $d.FileName } else { '' }
`;
    execFile("powershell", ["-NoProfile", "-Command", script], { timeout: 120000 }, (err, stdout) => {
      if (err) return reject(err);
      const path = stdout.trim();
      resolve(path || null);
    });
  });
}

async function serveGraphFile(absPath: string, req: { headers: Record<string, string | string[] | undefined> }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string) => void }) {
  const info = await stat(absPath);
  const lastModified = info.mtime.toUTCString();

  const ifModifiedSince = req.headers["if-modified-since"];
  if (typeof ifModifiedSince === "string" && new Date(ifModifiedSince).getTime() >= Math.floor(info.mtime.getTime() / 1000) * 1000) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const content = await readFile(absPath, "utf-8");

  // Record in recents
  try {
    const parsed = JSON.parse(content);
    if (parsed.title && parsed.id) {
      await touchRecent(absPath, parsed.title, parsed.id);
    }
  } catch { /* ignore parse errors for recents */ }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Last-Modified", lastModified);
  res.setHeader("Cache-Control", "no-cache");
  res.end(content);
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body?: unknown,
): void {
  res.statusCode = statusCode;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function registerApiMiddleware(
  register: (
    handler: (
      req: IncomingMessage,
      res: ServerResponse,
      next: () => void,
    ) => void | Promise<void>,
  ) => void,
  defaultGraphPath?: string,
): void {
  register(async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/recents") {
      try {
        const entries = await loadRecents();
        sendJson(res, 200, entries);
      } catch (err: unknown) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    if (url.pathname === "/api/pick-file") {
      try {
        const picked = await openFilePicker();
        if (picked) {
          sendJson(res, 200, { path: picked });
        } else {
          sendJson(res, 204);
        }
      } catch (err: unknown) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    if (url.pathname.startsWith(SESSION_REGISTRY_API_BASE_PATH)) {
      try {
        const apiResponse = handleSessionRegistryApiRequest(
          getSessionRegistryStore(),
          {
            method: req.method,
            url: req.url ?? url.pathname,
            body:
              req.method === "POST" || req.method === "PATCH"
                ? await readRequestBody(req)
                : undefined,
          },
        );
        if (apiResponse) {
          sendJson(res, apiResponse.statusCode, apiResponse.body);
          return;
        }
      } catch (err: unknown) {
        sendJson(res, 500, { error: String(err) });
        return;
      }
    }

    if (url.pathname !== "/api/graph.json") {
      next();
      return;
    }

    const queryPath = url.searchParams.get("path");
    let targetPath = queryPath ?? defaultGraphPath;

    // If no explicit path, try the most recent graph
    if (!targetPath) {
      try {
        const entries = await loadRecents();
        if (entries.length > 0) targetPath = entries[0].path;
      } catch {
        /* ignore */
      }
    }

    if (!targetPath) {
      sendJson(res, 404, {
        error: "No graph configured. Load a graph file or set STREAMLINER_GRAPH.",
      });
      return;
    }

    try {
      const abs = resolve(targetPath);
      await serveGraphFile(abs, req as never, res as never);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
  });
}

/**
 * Vite plugin that serves local graph.json files.
 *
 * Endpoints:
 *   GET /api/graph.json           — serves the default graph (STREAMLINER_GRAPH env var)
 *   GET /api/graph.json?path=...  — serves any graph by absolute path
 *   GET /api/recents              — returns recent workstreams list
 */
export default function serveGraph(options?: { graphPath?: string }): Plugin {
  const envPath = process.env.STREAMLINER_GRAPH;
  const defaultGraphPath = options?.graphPath ?? envPath;

  return {
    name: "streamliner-serve-graph",
    configureServer(server) {
      registerApiMiddleware(server.middlewares.use.bind(server.middlewares), defaultGraphPath);
    },
    configurePreviewServer(server) {
      registerApiMiddleware(server.middlewares.use.bind(server.middlewares), defaultGraphPath);
    },
  };
}
