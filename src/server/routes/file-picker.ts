import { Router } from "express";

import { openFilePicker } from "../local-files";

export function createFilePickerRouter(): Router {
  const router = Router();

  router.post("/pick-file", async (_req, res) => {
    try {
      const picked = await openFilePicker();
      if (!picked) {
        res.status(204).end();
        return;
      }
      res.json({ path: picked });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
