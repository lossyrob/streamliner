import { Router } from "express";

import { loadRecents } from "../local-files";

export function createRecentsRouter(options: { recentsPath?: string } = {}): Router {
  const router = Router();

  router.get("/recents", async (_req, res) => {
    try {
      res.json(await loadRecents(options.recentsPath));
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
