// _proto/canvas — quick-and-dirty prototype API for the DBAgent portfolio canvas.
//
// Hard-coded paths to the dbagent planning artifacts. NOT a generalized
// Streamliner feature yet. When this proves out, the contract that should be
// promoted is:
//   - Read a portfolio document
//   - Read/write a positions overlay keyed by node ID
//   - Atomic writes (whole-file replace) so concurrent saves do not interleave
//
// Endpoints:
//   GET  /api/_proto/canvas/portfolio      -> the dbagent portfolio.json
//   GET  /api/_proto/canvas/positions      -> the positions overlay (may be {})
//   PUT  /api/_proto/canvas/positions      -> replace the positions overlay
//
// Storage:
//   - portfolio.json: read-only here, sourced from the planning repo
//   - positions.json: lives next to this router under _proto/canvas/state/
//     Committed to git so layout work survives across machines.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Router } from "express";

// Hard-coded for the prototype. Promote this to config when the prototype
// graduates.
const PORTFOLIO_PATH = resolve(
  "C:\\Users\\robemanuele\\proj\\planning\\planning\\streamliner\\dbagent\\deps-4.7\\portfolio.json",
);
const POSITIONS_PATH = resolve(
  process.cwd(),
  "_proto",
  "canvas",
  "state",
  "positions.json",
);

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
    try {
      await writeJsonAtomic(POSITIONS_PATH, cleaned);
      res.status(200).json({
        ok: true,
        path: POSITIONS_PATH,
        count: Object.keys(cleaned).length,
        savedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
