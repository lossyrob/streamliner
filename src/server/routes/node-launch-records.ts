import { Router } from "express";

import { NodeLaunchRecordStore } from "../node-launch-record-store";

function nonEmptyQueryString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }
  return value;
}

export function createNodeLaunchRecordsRouter(options: {
  store?: NodeLaunchRecordStore;
} = {}): Router {
  const router = Router();
  const store = options.store ?? new NodeLaunchRecordStore();

  router.get("/node-launch-records", async (req, res, next) => {
    try {
      const graphPath = nonEmptyQueryString(req.query.graphPath, "graphPath");
      const nodeId = nonEmptyQueryString(req.query.nodeId, "nodeId");
      res.json({
        record: await store.get(graphPath, nodeId),
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
