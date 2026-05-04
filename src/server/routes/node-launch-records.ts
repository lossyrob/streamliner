import { Router } from "express";

import type { LaunchClaimStore } from "../../launch-claim-contract";
import {
  findBlockingLaunchClaim,
  latestLaunchClaimForNode,
  summarizeLaunchClaim,
} from "../node-launch";
import { NodeLaunchRecordStore } from "../node-launch-record-store";

function nonEmptyQueryString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }
  return value;
}

export function createNodeLaunchRecordsRouter(options: {
  store?: NodeLaunchRecordStore;
  claimStore?: LaunchClaimStore;
} = {}): Router {
  const router = Router();
  const store = options.store ?? new NodeLaunchRecordStore();

  router.get("/node-launch-records", async (req, res, next) => {
    try {
      const graphPath = nonEmptyQueryString(req.query.graphPath, "graphPath");
      const nodeId = nonEmptyQueryString(req.query.nodeId, "nodeId");
      const record = await store.get(graphPath, nodeId);
      const latestClaim = record && options.claimStore
        ? findBlockingLaunchClaim(
          options.claimStore,
          record.workstreamId,
          record.nodeId,
        ) ?? latestLaunchClaimForNode(
          options.claimStore,
          record.workstreamId,
          record.nodeId,
        )
        : null;
      res.json({
        record: record
          ? {
            ...record,
            latestClaim: latestClaim ? summarizeLaunchClaim(latestClaim) : null,
          }
          : null,
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
