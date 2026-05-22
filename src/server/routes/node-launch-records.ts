import { Router } from "express";

import type { LaunchClaimStore } from "../../launch-claim-contract";
import type { LaunchClaim } from "../../launch-claim-schema";
import type {
  NodeLaunchClaimState,
  NodeLaunchOperation,
  NodeLaunchOperationStatus,
  NodeLaunchRecord,
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

function optionalNonEmptyQueryString(value: unknown, label: string): string | null {
  if (value === undefined) {
    return null;
  }
  return nonEmptyQueryString(value, label);
}

function latestClaimForRecord(
  claimStore: LaunchClaimStore | undefined,
  record: NodeLaunchRecord,
): LaunchClaim | null {
  return claimStore
    ? findBlockingLaunchClaim(
      claimStore,
      record.workstreamId,
      record.nodeId,
    ) ?? latestLaunchClaimForNode(
      claimStore,
      record.workstreamId,
      record.nodeId,
    )
    : null;
}

function latestClaimForOperation(
  claimStore: LaunchClaimStore | undefined,
  operation: NodeLaunchOperation,
  record: NodeLaunchRecord | null,
): LaunchClaim | null {
  const workstreamId = nonEmptyString(record?.workstreamId)
    ?? nonEmptyString(operation.handoff?.launchMetadata.workstreamId);
  return workstreamId && claimStore
    ? findBlockingLaunchClaim(
      claimStore,
      workstreamId,
      operation.nodeId,
    ) ?? latestLaunchClaimForNode(
      claimStore,
      workstreamId,
      operation.nodeId,
    )
    : null;
}

function withLatestClaim(
  claimStore: LaunchClaimStore | undefined,
  record: NodeLaunchRecord,
): NodeLaunchRecord {
  const latestClaim = latestClaimForRecord(claimStore, record);
  return {
    ...record,
    latestClaim: latestClaim ? summarizeLaunchClaim(latestClaim) : null,
  };
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function stalePendingBindingMetadata(
  operation: NodeLaunchOperation,
  record: NodeLaunchRecord | null,
): { workstreamId: string; nodeId: string; launchClaimId: string } | null {
  const launchClaimId = nonEmptyString(operation.terminalLaunch?.launchClaim.launchClaimId)
    ?? nonEmptyString(operation.handoff?.launchMetadata.launchClaimRef)
    ?? nonEmptyString(record?.launchClaimRef);
  const workstreamId = nonEmptyString(operation.handoff?.launchMetadata.workstreamId)
    ?? nonEmptyString(record?.workstreamId);
  const nodeId = nonEmptyString(operation.handoff?.launchMetadata.nodeId)
    ?? nonEmptyString(record?.nodeId)
    ?? nonEmptyString(operation.nodeId);
  if (!launchClaimId || !workstreamId || !nodeId || nodeId !== operation.nodeId) {
    return null;
  }
  return { workstreamId, nodeId, launchClaimId };
}

function hasLaunchedRuntimeEvidence(record: ReturnType<SessionRegistryFileStore["getSession"]>): boolean {
  return Boolean(
    record &&
      (record.copilotSessionId !== null || record.runtime?.runtimeKind === "managed-sdk"),
  );
}

function graphBindingMatches(
  actual: NonNullable<ReturnType<SessionRegistryFileStore["getSession"]>>["graphBinding"],
  expected: { workstreamId: string; nodeId: string; launchClaimId: string },
): boolean {
  return actual?.workstreamId === expected.workstreamId &&
    actual.nodeId === expected.nodeId &&
    actual.launchClaimId === expected.launchClaimId;
}

function restoreStalePendingBindingGraphBinding(
  registryStore: SessionRegistryFileStore,
  operation: NodeLaunchOperation,
  record: NodeLaunchRecord | null,
): {
  restored: true;
  registryId: string;
  workstreamId: string;
  nodeId: string;
  launchClaimId: string;
  boundCopilotSessionId: string | null;
} | { restored: false } {
  const metadata = stalePendingBindingMetadata(operation, record);
  if (!metadata) {
    return { restored: false };
  }
  const registryId = registryStore.findRecordIdByLaunchClaimId(metadata.launchClaimId);
  if (!registryId) {
    return { restored: false };
  }
  const session = registryStore.getSession(registryId);
  if (
    !session ||
    session.origin.kind !== "launched" ||
    session.origin.launchClaimId !== metadata.launchClaimId ||
    !hasLaunchedRuntimeEvidence(session)
  ) {
    return { restored: false };
  }
  const desiredGraphBinding = {
    workstreamId: metadata.workstreamId,
    nodeId: metadata.nodeId,
    launchClaimId: metadata.launchClaimId,
  };
  if (session.graphBinding !== null && !graphBindingMatches(session.graphBinding, desiredGraphBinding)) {
    return { restored: false };
  }
  const bindResult = registryStore.bindClaimToRow(
    registryId,
    {
      cwdAfterNormalize: session.cwd,
      branch: null,
      repo: null,
      requireGraphBindingNullOrMatching: desiredGraphBinding,
    },
    { graphBinding: desiredGraphBinding },
  );
  if (!bindResult.ok || !graphBindingMatches(bindResult.record.graphBinding, desiredGraphBinding)) {
    return { restored: false };
  }
  return {
    restored: true,
    registryId,
    workstreamId: metadata.workstreamId,
    nodeId: metadata.nodeId,
    launchClaimId: metadata.launchClaimId,
    boundCopilotSessionId: bindResult.record.copilotSessionId,
  };
}

function markRestoredLaunchClaimBound(
  claimStore: LaunchClaimStore | undefined,
  repair: {
    registryId: string;
    workstreamId: string;
    nodeId: string;
    launchClaimId: string;
    boundCopilotSessionId: string | null;
  },
): boolean {
  if (!claimStore) {
    return true;
  }
  const current = claimStore.getClaim(repair.launchClaimId);
  if (!current) {
    return true;
  }
  if (current.workstreamId !== repair.workstreamId || current.nodeId !== repair.nodeId) {
    return false;
  }
  const now = new Date();
  if (current.status !== "bound" && summarizeLaunchClaim(current, now).blocksLaunch) {
    return false;
  }
  const updated = claimStore.updateClaim(repair.launchClaimId, (claim) => {
    if (claim.workstreamId !== repair.workstreamId || claim.nodeId !== repair.nodeId) {
      return claim;
    }
    if (claim.status !== "bound" && summarizeLaunchClaim(claim, now).blocksLaunch) {
      return claim;
    }
    const seenCandidateCopilotSessionIds =
      repair.boundCopilotSessionId &&
        !claim.seenCandidateCopilotSessionIds.includes(repair.boundCopilotSessionId)
        ? [...claim.seenCandidateCopilotSessionIds, repair.boundCopilotSessionId]
        : claim.seenCandidateCopilotSessionIds;
    return {
      ...claim,
      status: "bound",
      boundRegistryId: repair.registryId,
      boundCopilotSessionId: repair.boundCopilotSessionId ?? claim.boundCopilotSessionId,
      failureCode: null,
      failureReason: null,
      seenCandidateCopilotSessionIds,
      updatedAt: now.toISOString(),
    };
  });
  return updated.status === "bound" &&
    updated.boundRegistryId === repair.registryId &&
    updated.workstreamId === repair.workstreamId &&
    updated.nodeId === repair.nodeId;
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
      const nodeId = optionalNonEmptyQueryString(req.query.nodeId, "nodeId");
      if (nodeId === null) {
        const records = await store.listByGraphPath(graphPath);
        res.json({
          records: records.map((record) => withLatestClaim(options.claimStore, record)),
        });
        return;
      }
      const record = await store.get(graphPath, nodeId);
      const operation = await store.getOperation(graphPath, nodeId);
      const latestClaim = operation
        ? latestClaimForOperation(options.claimStore, operation, record)
        : record
          ? latestClaimForRecord(options.claimStore, record)
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

  router.post("/node-launch-records/operations/release", async (req, res, next) => {
    try {
      if (isNonLoopbackRequest(req)) {
        res.status(403).json({ error: "Operation release must originate from loopback." });
        return;
      }
      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.startsWith("application/json")) {
        res.status(415).json({ error: "Content-Type must be application/json." });
        return;
      }
      const body = (typeof req.body === "object" && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const graphPath = typeof body.graphPath === "string" ? body.graphPath.trim() : "";
      const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      if (!graphPath || !nodeId) {
        res.status(400).json({
          error: "Body must include non-empty 'graphPath' and 'nodeId'.",
        });
        return;
      }

      const operation = await store.getOperation(graphPath, nodeId);
      if (!operation) {
        res.status(404).json({
          code: "operation_not_found",
          error: `No launch operation exists for node '${nodeId}' on this graph.`,
        });
        return;
      }
      const record = await store.get(graphPath, nodeId);
      const latestClaim = latestClaimForOperation(options.claimStore, operation, record);
      const latestClaimSummary = latestClaim ? summarizeLaunchClaim(latestClaim) : null;

      if (operation.status === "launched_pending_binding") {
        if (latestClaimSummary?.blocksLaunch) {
          res.status(409).json({
            code: "operation_claim_still_active",
            error:
              "Operation is still waiting on an active launch claim; release the launch claim first or wait for binding to finish.",
            operation: projectOperation(operation, latestClaimSummary),
          });
          return;
        }
        const repair = options.registryStore
          ? restoreStalePendingBindingGraphBinding(
            options.registryStore,
            operation,
            record,
          )
          : { restored: false as const };
        if (repair.restored) {
          const claimMarkedBound = markRestoredLaunchClaimBound(options.claimStore, repair);
          if (!claimMarkedBound) {
            res.status(409).json({
              code: "claim_changed_before_repair",
              error: "Launch claim changed before the stale pending-binding launch could be resolved.",
              operation,
            });
            return;
          }
          const resolved = await store.markLaunchedPendingBindingBound({ graphPath, nodeId });
          if (!resolved) {
            res.status(409).json({
              code: "operation_not_active",
              error: "Operation changed before the stale pending-binding launch could be resolved.",
              operation,
            });
            return;
          }
          res.json({
            operation: resolved,
            graphBindingRestored: true,
            registryId: repair.registryId,
          });
          return;
        }
        const released = await store.releaseLaunchedPendingBindingOperation({
          graphPath,
          nodeId,
          reason: reason ?? "Stale pending-binding launch released by the user.",
        });
        if (!released) {
          res.status(409).json({
            code: "operation_not_active",
            error: "Operation changed before the stale pending-binding launch could be released.",
            operation,
          });
          return;
        }
        res.json({
          operation: released,
          graphBindingRestored: false,
        });
        return;
      }

      const released = await store.releaseActiveOperation({ graphPath, nodeId, reason });
      if (!released) {
        res.status(409).json({
          code: "operation_not_active",
          error: `Operation status '${operation.status}' is not eligible for release; only preparing/launching/managed_starting, prepared post-preparation terminal launches, or stale launched_pending_binding operations can be released.`,
          operation,
        });
        return;
      }
      res.json({ operation: released });
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
    status: projectOperationStatus(operation, latestClaim),
    latestClaim,
  };
}

function projectOperationStatus(
  operation: NodeLaunchOperation,
  latestClaim: NodeLaunchClaimState | null,
): NodeLaunchOperationStatus {
  const status = operation.status;
  if (
    status === "managed_starting" ||
    status === "managed_running" ||
    status === "managed_failed" ||
    operation.managedLaunch
  ) {
    return status;
  }
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
