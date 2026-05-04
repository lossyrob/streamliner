import {
  applyReservedRowCleanup,
  isClaimPastRetention,
  isClaimTerminal,
  isClaimWindowOpen,
} from "./launch-claims";
import { SessionRegistryFileStore } from "./file-store";
import type { LaunchClaimStore } from "../launch-claim-contract";
import type { LaunchClaimStatus } from "../launch-claim-schema";
import type { ScopedLogger } from "../server/logger";

export interface LaunchClaimSweepOptions {
  registryStore: SessionRegistryFileStore;
  claimStore: LaunchClaimStore;
  now: () => Date;
  logger: ScopedLogger;
}

export interface LaunchClaimSweepResult {
  claimsTransitioned: number;
  claimsPruned: number;
  reservedRowsDeleted: number;
  reservedRowsGraphBindingCleared: number;
}

/**
 * Runs one launch-claim sweep cycle:
 *
 * - Pending claims past `launchedAt + bindingWindowMs` transition to
 *   `nonce-missing` (when at least one candidate session was observed
 *   during the window) or `expired` (when no candidate ever appeared).
 *   Reserved rows are conditionally deleted or have their graphBinding
 *   cleared per FR-3.
 * - Any claim past `updatedAt + retentionWindowMs` is deleted.
 *
 * Idempotent: re-runs on a claim already past its window produce no
 * further state changes (terminal status is sticky; cleanup primitives
 * return predicate-false / not-found on subsequent runs).
 *
 * Emits structured diagnostic events via the supplied logger:
 * - `launch-claim.nonce-absent-after-window` on `nonce-missing`
 *   transition.
 * - `launch-claim.launch-claim-orphan-session` (case "a") for each
 *   candidate session that was observed in expectedCwd but never
 *   produced a nonce match before the window closed.
 * - `launch-claim.launch-claim-orphan-session` (case "b") when a
 *   reserved-launched row is preserved (had `copilotSessionId`) and its
 *   `graphBinding` is cleared.
 */
export function runLaunchClaimSweep(options: LaunchClaimSweepOptions): LaunchClaimSweepResult {
  const nowMs = options.now().getTime();
  const nowIso = options.now().toISOString();
  const result: LaunchClaimSweepResult = {
    claimsTransitioned: 0,
    claimsPruned: 0,
    reservedRowsDeleted: 0,
    reservedRowsGraphBindingCleared: 0,
  };

  const allClaims = options.claimStore.listClaims();
  for (const entry of allClaims) {
    const claim = options.claimStore.getClaim(entry.launchClaimId);
    if (!claim) continue;

    let appliedCleanupThisIteration = false;

    // 1) Transition past-window non-terminal claims.
    if (!isClaimTerminal(claim.status) && !isClaimWindowOpen(claim, nowMs)) {
      const sawCandidates = claim.seenCandidateCopilotSessionIds.length > 0;
      const nextStatus: LaunchClaimStatus = sawCandidates ? "nonce-missing" : "expired";
      options.claimStore.updateClaim(claim.launchClaimId, (current) => ({
        ...current,
        status: nextStatus,
        failureCode: sawCandidates ? "expired-no-nonce" : "expired-no-candidates",
        updatedAt: nowIso,
      }));
      result.claimsTransitioned += 1;

      if (sawCandidates) {
        options.logger.warn("nonce-absent-after-window", {
          event: "launch-claim.nonce-absent-after-window",
          launchClaimId: claim.launchClaimId,
          workstreamId: claim.workstreamId,
          nodeId: claim.nodeId,
          candidateCount: claim.seenCandidateCopilotSessionIds.length,
          at: nowIso,
        });
        for (const cid of claim.seenCandidateCopilotSessionIds) {
          options.logger.warn("orphan-session-no-nonce", {
            event: "launch-claim.launch-claim-orphan-session",
            case: "a",
            launchClaimId: claim.launchClaimId,
            workstreamId: claim.workstreamId,
            nodeId: claim.nodeId,
            copilotSessionId: cid,
            at: nowIso,
          });
        }
      }

      if (claim.reservedRegistryId !== null) {
        const cleanup = applyReservedRowCleanup(options.registryStore, {
          ...claim,
          status: nextStatus,
        });
        if (cleanup.reservedRowDeleted) {
          result.reservedRowsDeleted += 1;
        }
        if (cleanup.reservedRowGraphBindingCleared) {
          result.reservedRowsGraphBindingCleared += 1;
          options.logger.warn("orphan-session-reserved-preserved", {
            event: "launch-claim.launch-claim-orphan-session",
            case: "b",
            launchClaimId: claim.launchClaimId,
            workstreamId: claim.workstreamId,
            nodeId: claim.nodeId,
            registryId: claim.reservedRegistryId,
            at: nowIso,
          });
        }
        appliedCleanupThisIteration = true;
      }
    }

    // Apply reserved-row cleanup for already-terminal-non-bound claims that
    // never had cleanup applied yet (e.g., markClaimFailed without cleanup,
    // or ambiguous transition from binding pass). Skip if we already
    // applied cleanup in the transition block above.
    const refreshed = options.claimStore.getClaim(claim.launchClaimId);
    if (
      !appliedCleanupThisIteration &&
      refreshed &&
      refreshed.reservedRegistryId !== null &&
      isClaimTerminal(refreshed.status) &&
      refreshed.status !== "bound"
    ) {
      const cleanup = applyReservedRowCleanup(options.registryStore, refreshed);
      if (cleanup.reservedRowDeleted) {
        result.reservedRowsDeleted += 1;
      }
      if (cleanup.reservedRowGraphBindingCleared) {
        result.reservedRowsGraphBindingCleared += 1;
      }
    }

    // 2) Prune past retention.
    if (refreshed && isClaimPastRetention(refreshed, nowMs)) {
      const deleted = options.claimStore.deleteClaim(claim.launchClaimId);
      if (deleted) {
        result.claimsPruned += 1;
      }
    }
  }

  return result;
}
