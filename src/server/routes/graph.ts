import { resolve } from "node:path";
import { Router } from "express";

import { loadRecents, readGraphFile, statGraphFile, touchRecent } from "../local-files";

export function createGraphRouter(options: {
  defaultGraphPath?: string;
  recentsPath?: string;
} = {}): Router {
  const router = Router();

  router.get("/graph.json", async (req, res) => {
    const queryPath =
      typeof req.query.path === "string" ? req.query.path : undefined;
    let targetPath = queryPath ?? options.defaultGraphPath;

    if (!targetPath) {
      try {
        const entries = await loadRecents(options.recentsPath);
        targetPath = entries[0]?.path;
      } catch {
        // Recents are a convenience cache; graph loading can still fail clearly below.
      }
    }

    if (!targetPath) {
      res.status(404).json({
        error: "No graph configured. Load a graph file or set STREAMLINER_GRAPH.",
      });
      return;
    }

    try {
      const absPath = resolve(targetPath);
      const graphInfo = await statGraphFile(absPath);
      const ifModifiedSince = req.header("if-modified-since");
      if (
        ifModifiedSince &&
        new Date(ifModifiedSince).getTime() >= graphInfo.mtimeMs
      ) {
        res.status(304).end();
        return;
      }

      const graph = await readGraphFile(absPath, graphInfo);
      try {
        const parsed = JSON.parse(graph.content) as { title?: unknown; id?: unknown };
        if (typeof parsed.title === "string" && typeof parsed.id === "string") {
          await touchRecent(absPath, parsed.title, parsed.id, options.recentsPath);
        }
      } catch {
        // Invalid graph JSON is reported by the frontend parser; recents skip it.
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Last-Modified", graph.lastModified);
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).send(graph.content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
