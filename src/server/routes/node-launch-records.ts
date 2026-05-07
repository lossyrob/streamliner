import { Router } from "express";

import type { LaunchClaimStore } from "../../launch-claim-contract";
import type { LaunchClaim } from "../../launch-claim-schema";
import type {
  NodeLaunchClaimState,
  NodeLaunchOperation,
  NodeLaunchOperationStatus,
} from "../../node-launch-record-contract";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import { stopSession } from "../../session-registry/stop";
import {
  findBlockingLaunchClaim,
  latestLaunchClaimForNode,
  summarizeLaunchClaim,
} from "../node-launch";
import { NodeLaunchRecordStore } from "../node-launch-record-store";
import { isLoopbackAddress } from "../config";

function hasNonLoopbackForwardedFor(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const values = Array.isArray(value) ? value : value.split(",");
  return values.some((entry) => !isLoopbackAddress(entry.trim()));
}

function isNonLoopbackRequest(req: {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  return (
    !isLoopbackAddress(req.socket.remoteAddress) ||
    hasNonLoopbackForwardedFor(req.headers["x-forwarded-for"])
  );
}

function nonEmptyQueryString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }
  return value;
}

export function createNodeLaunchRecordsRouter(options: {
  store?: NodeLaunchRecordStore;
  claimStore?: LaunchClaimStore;
  registryStore?: SessionRegistryFileStore;
} = {}): Router {
  const router = Router();
  const store = options.store ?? new NodeLaunchRecordStore();

  router.get("/node-launch-records", async (req, res, next) => {
    try {
      const graphPath = nonEmptyQueryString(req.query.graphPath, "graphPath");
      const nodeId = nonEmptyQueryString(req.query.nodeId, "nodeId");
      const record = await store.get(graphPath, nodeId);
      const operation = await store.getOperation(graphPath, nodeId);
      const claimWorkstreamId = record?.workstreamId
        ?? operation?.handoff?.launchMetadata.workstreamId;
      const latestClaim = claimWorkstreamId && options.claimStore
        ? findBlockingLaunchClaim(
          options.claimStore,
          claimWorkstreamId,
          nodeId,
        ) ?? latestLaunchClaimForNode(
          options.claimStore,
          claimWorkstreamId,
          nodeId,
        )
        : null;
      const latestClaimSummary = latestClaim ? summarizeLaunchClaim(latestClaim) : null;
      res.json({
        record: record
          ? {
            ...record,
            latestClaim: latestClaimSummary,
          }
          : null,
        operation: operation ? projectOperation(operation, latestClaimSummary) : null,
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post("/node-launch-records/launch-claims/:launchClaimId/release", (req, res, next) => {
    try {
      if (isNonLoopbackRequest(req)) {
        res.status(403).json({ error: "Node launch release must originate from loopback." });
        return;
      }
      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.startsWith("application/json")) {
        res.status(415).json({ error: "Content-Type must be application/json." });
        return;
      }
      if (!options.claimStore || !options.registryStore) {
        res.status(503).json({ error: "Node launch release is unavailable without launch-claim state." });
        return;
      }

      const launchClaimId = nonEmptyQueryString(req.params.launchClaimId, "launchClaimId");
      const claim = options.claimStore.getClaim(launchClaimId);
      if (!claim) {
        res.status(404).json({ error: `Launch claim ${launchClaimId} does not exist.` });
        return;
      }

      const detachedRegistryIds = releaseClaimRegistryRows(
        options.registryStore,
        claim,
      );
      const releasedClaim = options.claimStore.updateClaim(launchClaimId, (current) => ({
        ...current,
        status: "failed",
        failureCode: "user-cancelled",
        failureReason: "Manually released by the user after the terminal launch could not be controlled.",
      }));

      res.json({
        launchClaim: summarizeLaunchClaim(releasedClaim),
        detachedRegistryIds,
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}

function projectOperation(
  operation: NodeLaunchOperation,
  latestClaim: NodeLaunchClaimState | null,
): NodeLaunchOperation {
  return {
    ...operation,
    status: projectOperationStatus(operation.status, latestClaim),
    latestClaim,
  };
}

function projectOperationStatus(
  status: NodeLaunchOperationStatus,
  latestClaim: NodeLaunchClaimState | null,
): NodeLaunchOperationStatus {
  if (latestClaim?.status === "bound") {
    return "bound";
  }
  if (latestClaim?.status === "pending" && latestClaim.blocksLaunch) {
    return "launched_pending_binding";
  }
  return status;
}

function releaseClaimRegistryRows(
  registryStore: SessionRegistryFileStore,
  claim: LaunchClaim,
): string[] {
  const candidateIds = new Set<string>();
  if (claim.boundRegistryId) {
    candidateIds.add(claim.boundRegistryId);
  }
  if (claim.reservedRegistryId) {
    candidateIds.add(claim.reservedRegistryId);
  }
  if (claim.boundCopilotSessionId) {
    const observedId = registryStore.findRecordIdByCopilotSession(claim.boundCopilotSessionId);
    if (observedId) {
      candidateIds.add(observedId);
    }
  }

  const detached: string[] = [];
  for (const registryId of candidateIds) {
    const session = registryStore.getSession(registryId);
    if (!session) {
      continue;
    }
    if (session.lifecycleStatus !== "ended" && session.copilotSessionId) {
      stopSession(registryStore, registryId);
    }
    const current = registryStore.getSession(registryId);
    if (current?.graphBinding?.launchClaimId === claim.launchClaimId) {
      registryStore.patchSession(registryId, { graphBinding: null });
      detached.push(registryId);
    }
  }
  return detached;
}
