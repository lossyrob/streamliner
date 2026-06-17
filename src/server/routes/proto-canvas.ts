// _proto/canvas — quick-and-dirty prototype API for the DBAgent portfolio canvas.
//
// Prototype API for the dbagent planning artifacts. NOT a generalized
// Streamliner feature yet. When this proves out, the contract that should be
// promoted is:
//   - Read a portfolio document
//   - Read/write a positions overlay keyed by node ID / workstream anchor ID
//   - Atomic writes so concurrent saves do not interleave
//
// Endpoints:
//   GET    /api/_proto/canvas/portfolio      -> the dbagent portfolio.json
//   GET    /api/_proto/canvas/positions      -> the positions overlay (may be {})
//   PUT    /api/_proto/canvas/positions      -> legacy full-overlay upsert
//                                              (routine drags use PATCH below)
//   PATCH  /api/_proto/canvas/positions      -> partial update: body is
//                                              { upsert?: {id: pos}, remove?: [id] }.
//                                              Safe against concurrent writes
//                                              from other tabs / portfolio
//                                              manager sessions / branch
//                                              switches.
//   GET  /api/_proto/canvas/colors         -> the workstream color overrides
//                                            ({} when none assigned)
//   PUT  /api/_proto/canvas/colors         -> replace the colors overlay
//   GET  /api/_proto/canvas/terminal-active -> { activeIds: ["wsId", ...] }
//                                            workstreams the user has an open
//                                            terminal window for (used to
//                                            render a terminal-titlebar marker
//                                            on the workstream container)
//   PUT  /api/_proto/canvas/terminal-active -> replace the active set
//   GET  /api/_proto/canvas/workstream-doc?id=<id>
//                                         -> resolves to brief.md (formed) or
//                                            shaping/candidates/<id>.md
//                                            (candidate) and returns the
//                                            markdown content. 404 with a
//                                            `triedPaths` payload when not
//                                            found.
//
// Storage:
//   - portfolio.json: read-only here, sourced from the planning repo
//   - positions/colors/terminal state: lives in the dbagent portfolio state
//     directory configured by dbagent/streamliner.json.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Router } from "express";

// Root of the dbagent planning artifacts. The workstream-doc lookup walks
// `<DBAGENT_ROOT>/workstreams/<id>/brief.md` for formed workstreams and
// `<DBAGENT_ROOT>/shaping/candidates/<id>.md` for candidates, with a fuzzy
// token-subset fallback because portfolio IDs sometimes use short slugs while
// disk uses fully-spelled folder/file names.
const DBAGENT_ROOT = resolve(
  "C:\\Users\\robemanuele\\proj\\planning\\planning\\streamliner\\dbagent",
);
const PROJECT_CONFIG_PATH = join(DBAGENT_ROOT, "streamliner.json");

interface PortfolioConfig {
  path?: string;
  stateDir?: string;
}

interface ProjectConfig {
  portfolio?: PortfolioConfig;
}

function readProjectConfig(): ProjectConfig {
  if (!existsSync(PROJECT_CONFIG_PATH)) {
    return {};
  }
  const parsed = JSON.parse(readFileSync(PROJECT_CONFIG_PATH, "utf-8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${PROJECT_CONFIG_PATH} must contain a JSON object.`);
  }

  const record = parsed as Record<string, unknown>;
  if (record.portfolio === undefined) {
    return {};
  }
  if (
    !record.portfolio ||
    typeof record.portfolio !== "object" ||
    Array.isArray(record.portfolio)
  ) {
    throw new Error(`${PROJECT_CONFIG_PATH} field "portfolio" must be an object.`);
  }

  const portfolioRecord = record.portfolio as Record<string, unknown>;
  const portfolio: PortfolioConfig = {};
  if (portfolioRecord.path !== undefined) {
    if (typeof portfolioRecord.path !== "string" || !portfolioRecord.path.trim()) {
      throw new Error(`${PROJECT_CONFIG_PATH} field "portfolio.path" must be a non-empty string.`);
    }
    portfolio.path = portfolioRecord.path;
  }
  if (portfolioRecord.stateDir !== undefined) {
    if (typeof portfolioRecord.stateDir !== "string" || !portfolioRecord.stateDir.trim()) {
      throw new Error(`${PROJECT_CONFIG_PATH} field "portfolio.stateDir" must be a non-empty string.`);
    }
    portfolio.stateDir = portfolioRecord.stateDir;
  }

  return { portfolio };
}

function resolveProjectPath(configuredPath: string | undefined, fallbackRelativePath: string): string {
  const candidate = configuredPath?.trim() || fallbackRelativePath;
  return isAbsolute(candidate) ? resolve(candidate) : resolve(DBAGENT_ROOT, candidate);
}

const PROJECT_CONFIG = readProjectConfig();
const PORTFOLIO_PATH = resolveProjectPath(
  PROJECT_CONFIG.portfolio?.path,
  join("portfolio", "portfolio.json"),
);
const PORTFOLIO_STATE_DIR = resolveProjectPath(
  PROJECT_CONFIG.portfolio?.stateDir,
  join("portfolio", "state"),
);
const POSITIONS_PATH = join(PORTFOLIO_STATE_DIR, "positions.json");
const COLORS_PATH = join(PORTFOLIO_STATE_DIR, "colors.json");
const TERMINAL_ACTIVE_PATH = join(PORTFOLIO_STATE_DIR, "terminal-active.json");

interface PinnedPosition {
  x: number;
  y: number;
  manuallyMoved: true;
  ts: number;
}

type PositionsFile = Record<string, PinnedPosition>;

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return fallback;
    }
    throw err;
  }
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}

// Tokens we ignore when comparing portfolio IDs against on-disk names; these
// are connective filler words that bloat folder names without adding meaning.
const IGNORED_TOKENS = new Set([
  "and", "or", "the", "a", "an", "of", "for", "to", "in", "on", "with",
  "per", "via", "by", "from", "into",
]);

// Synonym groups: every token in a group is considered equivalent for matching.
// These cover the abbreviations the dbagent portfolio uses against fully-spelled
// disk folder names (e.g. id `vmagent-cas-db-access` -> disk
// `vmagent-cas-database-access`). Add new groups sparingly; over-matching makes
// fuzzy resolution pick wrong folders.
const TOKEN_SYNONYMS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["db", "database"]),
  new Set(["auth", "authentication", "authn"]),
  new Set(["authz", "authorization"]),
  new Set(["cfg", "config", "configuration"]),
  new Set(["repo", "repository"]),
];

function synonymGroupFor(token: string): ReadonlySet<string> | null {
  for (const group of TOKEN_SYNONYMS) {
    if (group.has(token)) return group;
  }
  return null;
}

function tokensOf(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[-_./]+/)
      .filter((t) => t.length > 0 && !IGNORED_TOKENS.has(t)),
  );
}

/**
 * A portfolio token matches an on-disk token if they're equal or if both
 * belong to the same synonym group (covers `db` <-> `database` etc.).
 */
function tokenMatches(portfolioToken: string, onDiskToken: string): boolean {
  if (portfolioToken === onDiskToken) return true;
  const group = synonymGroupFor(portfolioToken);
  return group ? group.has(onDiskToken) : false;
}

function isSubset(needle: Set<string>, haystack: Set<string>): boolean {
  for (const t of needle) {
    let matched = false;
    for (const h of haystack) {
      if (tokenMatches(t, h)) { matched = true; break; }
    }
    if (!matched) return false;
  }
  return true;
}

/**
 * Find the candidate name (folder for formed, file stem for candidate) whose
 * tokens are a superset of the workstream id tokens. Returns the best
 * (shortest) match, or null. Used as a fallback when the portfolio id and the
 * on-disk slug do not match exactly (e.g. `preview-api-rbac` ->
 * `preview-api-rbac-approval-contract`).
 */
function bestFuzzyMatch(id: string, candidates: string[]): string | null {
  const idTokens = tokensOf(id);
  if (idTokens.size === 0) return null;
  const matches = candidates
    .filter((name) => isSubset(idTokens, tokensOf(name)))
    .sort((a, b) => a.length - b.length);
  return matches[0] ?? null;
}

async function listChildren(
  dir: string,
  kind: "directory" | "file",
): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) =>
        kind === "directory" ? entry.isDirectory() : entry.isFile(),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

interface ResolvedDoc {
  kind: "brief" | "candidate";
  path: string;
  content: string;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

async function resolveWorkstreamDoc(
  id: string,
  preferred: "formed" | "candidate" | "auto" = "auto",
): Promise<{
  doc: ResolvedDoc | null;
  triedPaths: string[];
}> {
  const triedPaths: string[] = [];

  const tryFormed = async (): Promise<ResolvedDoc | null> => {
    const workstreamsDir = join(DBAGENT_ROOT, "workstreams");
    const directBrief = join(workstreamsDir, id, "brief.md");
    triedPaths.push(directBrief);
    const direct = await readIfExists(directBrief);
    if (direct !== null) return { kind: "brief", path: directBrief, content: direct };
    const wsDirs = await listChildren(workstreamsDir, "directory");
    const wsMatch = bestFuzzyMatch(id, wsDirs);
    if (!wsMatch) return null;
    const fuzzyBrief = join(workstreamsDir, wsMatch, "brief.md");
    triedPaths.push(fuzzyBrief);
    const fuzzy = await readIfExists(fuzzyBrief);
    return fuzzy === null ? null : { kind: "brief", path: fuzzyBrief, content: fuzzy };
  };

  const tryCandidate = async (): Promise<ResolvedDoc | null> => {
    const candidatesDir = join(DBAGENT_ROOT, "shaping", "candidates");
    const directCandidate = join(candidatesDir, `${id}.md`);
    triedPaths.push(directCandidate);
    const direct = await readIfExists(directCandidate);
    if (direct !== null) return { kind: "candidate", path: directCandidate, content: direct };
    const candidateFiles = (await listChildren(candidatesDir, "file"))
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .map((name) => name.slice(0, -3));
    const candidateMatch = bestFuzzyMatch(id, candidateFiles);
    if (!candidateMatch) return null;
    const fuzzyCandidate = join(candidatesDir, `${candidateMatch}.md`);
    triedPaths.push(fuzzyCandidate);
    const fuzzy = await readIfExists(fuzzyCandidate);
    return fuzzy === null ? null : { kind: "candidate", path: fuzzyCandidate, content: fuzzy };
  };

  // Honor the caller's `type` hint so a portfolio entry marked `candidate` does
  // not accidentally resolve to a leftover `workstreams/<id>/brief.md` when the
  // shaping doc is what the user asked for.
  const order: Array<() => Promise<ResolvedDoc | null>> =
    preferred === "candidate"
      ? [tryCandidate, tryFormed]
      : [tryFormed, tryCandidate];
  for (const probe of order) {
    const doc = await probe();
    if (doc) return { doc, triedPaths };
  }
  return { doc: null, triedPaths };
}

export function createProtoCanvasRouter(): Router {
  const router = Router();

  router.get("/portfolio", async (_req, res) => {
    if (!existsSync(PORTFOLIO_PATH)) {
      res.status(500).json({
        error: `Hard-coded portfolio path missing: ${PORTFOLIO_PATH}`,
      });
      return;
    }
    try {
      const raw = await readFile(PORTFOLIO_PATH, "utf-8");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).send(raw);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get("/positions", async (_req, res) => {
    try {
      const data = await readJsonSafe<PositionsFile>(POSITIONS_PATH, {});
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).json({
        path: POSITIONS_PATH,
        positions: data,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.put("/positions", async (req, res) => {
    const body = req.body as { positions?: unknown };
    if (!body || typeof body !== "object" || typeof body.positions !== "object" || body.positions === null) {
      res.status(400).json({ error: "Body must be { positions: { id: { x, y, ... } } }" });
      return;
    }
    // Light validation — accept what looks like a position record.
    const incoming = body.positions as Record<string, unknown>;
    const cleaned: PositionsFile = {};
    for (const [id, val] of Object.entries(incoming)) {
      if (val && typeof val === "object" && "x" in val && "y" in val) {
        const v = val as { x: unknown; y: unknown; manuallyMoved?: unknown; ts?: unknown };
        if (typeof v.x === "number" && typeof v.y === "number") {
          cleaned[id] = {
            x: v.x,
            y: v.y,
            manuallyMoved: true,
            ts: typeof v.ts === "number" ? v.ts : Date.now(),
          };
        }
      }
    }
    // Defense-in-depth for clients that still send a full overlay (or a
    // partial overlay via the legacy method): merge `cleaned` over the current
    // file instead of replacing it. Routine saves use PATCH /positions and
    // continue to handle both upserts and explicit removes.
    try {
      const current = await readJsonSafe<PositionsFile>(POSITIONS_PATH, {});
      const merged: PositionsFile = { ...current, ...cleaned };
      await writeJsonAtomic(POSITIONS_PATH, merged);
      res.status(200).json({
        ok: true,
        path: POSITIONS_PATH,
        count: Object.keys(merged).length,
        upserts: Object.keys(cleaned).length,
        savedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Partial update — the safe path for routine drag/unpin saves. The client
  // sends just the ids it touched; the server reads the current file, applies
  // upserts and removes, and writes atomically. This prevents full-overlay
  // lost updates where a client's in-memory cache overwrites changes another
  // writer (e.g. a separate portfolio manager session, a git branch switch, a
  // second canvas tab) made in the meantime.
  const handlePositionsPatch = async (
    req: Parameters<Parameters<typeof router.patch>[1]>[0],
    res: Parameters<Parameters<typeof router.patch>[1]>[1],
  ) => {
    const body = req.body as { upsert?: unknown; remove?: unknown };
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Body must be { upsert?: {...}, remove?: [...] }" });
      return;
    }
    const upsertInput =
      body.upsert && typeof body.upsert === "object" && body.upsert !== null
        ? (body.upsert as Record<string, unknown>)
        : {};
    const removeInput = Array.isArray(body.remove) ? body.remove : [];
    const upserts: PositionsFile = {};
    for (const [id, val] of Object.entries(upsertInput)) {
      if (val && typeof val === "object" && "x" in val && "y" in val) {
        const v = val as { x: unknown; y: unknown; ts?: unknown };
        if (typeof v.x === "number" && typeof v.y === "number") {
          upserts[id] = {
            x: v.x,
            y: v.y,
            manuallyMoved: true,
            ts: typeof v.ts === "number" ? v.ts : Date.now(),
          };
        }
      }
    }
    const removes = new Set<string>();
    for (const id of removeInput) {
      if (typeof id === "string" && id.length > 0) removes.add(id);
    }
    try {
      const current = await readJsonSafe<PositionsFile>(POSITIONS_PATH, {});
      const merged: PositionsFile = { ...current };
      for (const id of removes) {
        delete merged[id];
      }
      for (const [id, val] of Object.entries(upserts)) {
        merged[id] = val;
      }
      await writeJsonAtomic(POSITIONS_PATH, merged);
      res.status(200).json({
        ok: true,
        path: POSITIONS_PATH,
        count: Object.keys(merged).length,
        upserts: Object.keys(upserts).length,
        removes: removes.size,
        positions: merged,
        savedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  };
  router.patch("/positions", handlePositionsPatch);
  // sendBeacon (used for last-chance saves during page unload) can only POST.
  // Route POST /positions?method=patch through the same merge handler so the
  // unload path stays merge-safe.
  router.post("/positions", async (req, res, next) => {
    if (req.query?.method === "patch") {
      await handlePositionsPatch(req, res);
      return;
    }
    next();
  });

  router.get("/colors", async (_req, res) => {
    try {
      const data = await readJsonSafe<Record<string, string>>(COLORS_PATH, {});
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).json({ path: COLORS_PATH, colors: data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.put("/colors", async (req, res) => {
    const body = req.body as { colors?: unknown };
    if (!body || typeof body !== "object" || typeof body.colors !== "object" || body.colors === null) {
      res.status(400).json({ error: "Body must be { colors: { workstreamId: '#rrggbb' } }" });
      return;
    }
    const incoming = body.colors as Record<string, unknown>;
    const cleaned: Record<string, string> = {};
    for (const [id, value] of Object.entries(incoming)) {
      // Tolerate clients that send null/empty to clear an override.
      if (value === null || value === "") continue;
      if (typeof value !== "string") continue;
      const hex = value.trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
      // Same defense-in-depth as workstream-doc: ids must be slug-safe.
      if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) continue;
      cleaned[id] = hex;
    }
    try {
      await writeJsonAtomic(COLORS_PATH, cleaned);
      res.status(200).json({
        ok: true,
        path: COLORS_PATH,
        count: Object.keys(cleaned).length,
        savedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get("/terminal-active", async (_req, res) => {
    try {
      const data = await readJsonSafe<{ activeIds?: unknown }>(
        TERMINAL_ACTIVE_PATH,
        { activeIds: [] },
      );
      const activeIds = Array.isArray(data.activeIds)
        ? data.activeIds.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [];
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).json({ path: TERMINAL_ACTIVE_PATH, activeIds });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.put("/terminal-active", async (req, res) => {
    const body = req.body as { activeIds?: unknown };
    if (!body || typeof body !== "object" || !Array.isArray(body.activeIds)) {
      res.status(400).json({ error: "Body must be { activeIds: ['workstreamId', ...] }" });
      return;
    }
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const id of body.activeIds) {
      if (typeof id !== "string") continue;
      const trimmed = id.trim();
      if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
    try {
      await writeJsonAtomic(TERMINAL_ACTIVE_PATH, { activeIds: cleaned });
      res.status(200).json({
        ok: true,
        path: TERMINAL_ACTIVE_PATH,
        count: cleaned.length,
        savedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get("/workstream-doc", async (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
    if (!id) {
      res.status(400).json({ error: "Query param 'id' is required." });
      return;
    }
    // Defense-in-depth: reject anything with path separators so a hostile id
    // can't reach outside DBAGENT_ROOT via the fuzzy-match step.
    if (id.includes("/") || id.includes("\\") || id.includes("..")) {
      res.status(400).json({ error: "Workstream id must be a slug." });
      return;
    }
    const rawType = typeof req.query.type === "string" ? req.query.type : "";
    const preferred: "formed" | "candidate" | "auto" =
      rawType === "candidate" ? "candidate"
      : rawType === "formed" ? "formed"
      : "auto";
    try {
      const { doc, triedPaths } = await resolveWorkstreamDoc(id, preferred);
      if (!doc) {
        res.status(404).json({
          error: `No brief or candidate markdown found for workstream '${id}'.`,
          triedPaths,
        });
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).json({
        id,
        kind: doc.kind,
        path: doc.path,
        content: doc.content,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
