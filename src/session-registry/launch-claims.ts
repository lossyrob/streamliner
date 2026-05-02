import { randomBytes, randomUUID } from "node:crypto";

import {
  LAUNCH_CLAIM_DEFAULT_BINDING_WINDOW_MS,
  LAUNCH_CLAIM_DEFAULT_RETENTION_WINDOW_MS,
  LAUNCH_CLAIM_TERMINAL_STATUSES,
  type LaunchClaim,
  type LaunchClaimFailureCode,
  type LaunchClaimStatus,
  sanitizeFailureReason,
  validateLineageMetadata,
} from "../launch-claim-schema";
import {
  type LaunchClaimCreateInput,
  type LaunchClaimStore,
  LaunchClaimNotFoundError,
} from "../launch-claim-contract";
import { SessionRegistryFileStore } from "./file-store";

export const LAUNCH_NONCE_PROMPT_LINE_PREFIX = "Streamliner launch nonce: ";

/**
 * Returns the canonical kickoff-prompt line containing a launch nonce.
 * Use this in the kickoff prompt produced by the launch-prompt-profiles
 * slice so the binding pass's substring scan reliably finds the nonce.
 * The binding pass matches by exact substring on `nonce` (not the
 * whole line) so manual prompt edits that preserve the token still
 * bind.
 */
export function kickoffNonceLine(nonce: string): string {
  return `${LAUNCH_NONCE_PROMPT_LINE_PREFIX}${nonce}`;
}

/** Minimum nonce length in URL-safe base64 characters (≥128 bits → 22). */
export const LAUNCH_NONCE_MIN_LENGTH = 22;

/**
 * Mints a fresh launch nonce. Default implementation uses 16 random
 * bytes encoded as URL-safe base64 (no padding), yielding ~128 bits of
 * entropy and a 22-character single-line token. Tests can inject a
 * deterministic generator via the LaunchClaimsDeps.mintNonce field.
 */
export function defaultMintLaunchNonce(): string {
  return randomBytes(16).toString("base64url");
}

export interface CreateLaunchClaimInput {
  workstreamId: string;
  nodeId: string;
  expectedCwd: string;
  expectedBranch?: string | null;
  expectedRepo?: string | null;
  contextId?: string | null;
  /** Caller-supplied nonce (e.g., when the prompt-profile slice already minted one). */
  launchNonce?: string | null;
  bindingWindowMs?: number;
  retentionWindowMs?: number;
  /** Defaults to true per Spec FR-3. Set false only for diagnostic / preview flows. */
  reserveRegistryRow?: boolean;
  /** Display title for the reserved row. Defaults to "Launch: {nodeId}". */
  reservedRowTitle?: string | null;
  reservedRowDescription?: string | null;
  /** Wave-5 lineage extensibility slot (≤4 KB JSON object). */
  lineageMetadata?: Record<string, unknown> | null;
}

export type CreateLaunchClaimErrorCode =
  | "invalid-input"
  | "row-reservation-failed"
  | "claim-write-failed";

export type CreateLaunchClaimOutcome =
  | {
      ok: true;
      claim: LaunchClaim;
      reservedRegistryId: string | null;
    }
  | {
      ok: false;
      error: { code: CreateLaunchClaimErrorCode; message: string };
    };

export interface MarkClaimFailedOutcome {
  ok: boolean;
  claim: LaunchClaim | null;
  /** True when this call performed the transition; false if already terminal. */
  transitioned: boolean;
  /** True when the reserved-row cleanup actually removed a row. */
  reservedRowDeleted: boolean;
  /** True when the reserved-row cleanup cleared graphBinding instead of deleting. */
  reservedRowGraphBindingCleared: boolean;
}

export interface LaunchClaimsDeps {
  /** Now-source for evidence/timestamps. Defaults to wall clock. */
  now?: () => Date;
  /** Nonce generator. Defaults to crypto.randomBytes(16).toString("base64url"). */
  mintNonce?: () => string;
  /** Registry-row id generator for reserved rows. Defaults to randomUUID. */
  mintRegistryRowId?: () => string;
  /** Launch-claim id generator. Defaults to randomUUID. */
  mintLaunchClaimId?: () => string;
}

function isoFromDeps(deps: LaunchClaimsDeps | undefined): string {
  return (deps?.now ? deps.now() : new Date()).toISOString();
}

function resolveDeps(deps?: LaunchClaimsDeps): Required<LaunchClaimsDeps> {
  return {
    now: deps?.now ?? (() => new Date()),
    mintNonce: deps?.mintNonce ?? defaultMintLaunchNonce,
    mintRegistryRowId: deps?.mintRegistryRowId ?? randomUUID,
    mintLaunchClaimId: deps?.mintLaunchClaimId ?? randomUUID,
  };
}

function buildReservedRowTitle(input: CreateLaunchClaimInput): string {
  if (input.reservedRowTitle && input.reservedRowTitle.trim().length > 0) {
    return input.reservedRowTitle.trim();
  }
  return `Launch: ${input.nodeId}`;
}

function buildReservedRowDescription(input: CreateLaunchClaimInput): string {
  if (input.reservedRowDescription !== undefined && input.reservedRowDescription !== null) {
    return input.reservedRowDescription;
  }
  return `Launch claim for workstream ${input.workstreamId}, node ${input.nodeId}.`;
}

/**
 * Creates a new launch claim. Canonical write order is row-first,
 * claim-second so a crash between the two writes is recoverable by
 * `reconcileOrphanReservedRows`.
 *
 * 1. Mints `reservedRegistryId` and `launchClaimId` in memory.
 * 2. If `reserveRegistryRow !== false` (default true), reserves the
 *    registry row with `origin.kind: "launched"`,
 *    `origin.launchClaimId`, and `graphBinding`.
 * 3. Writes the claim file with both ids persisted.
 * 4. Returns the claim and the reserved row id.
 *
 * If step 2 fails, no orphan claim is written. If step 3 fails, the
 * row is rolled back via `deleteSessionIf(..., copilotSessionId === null)`.
 * If even the rollback fails (e.g., disk full on cleanup), the
 * orphan-row recovery routine handles it on the next API restart.
 */
export function createLaunchClaim(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  input: CreateLaunchClaimInput,
  deps?: LaunchClaimsDeps,
): CreateLaunchClaimOutcome {
  if (!input.workstreamId || input.workstreamId.length === 0) {
    return errorOutcome("invalid-input", "workstreamId is required.");
  }
  if (!input.nodeId || input.nodeId.length === 0) {
    return errorOutcome("invalid-input", "nodeId is required.");
  }
  if (!input.expectedCwd || input.expectedCwd.length === 0) {
    return errorOutcome("invalid-input", "expectedCwd is required.");
  }

  let lineageMetadata: Record<string, unknown> | null;
  try {
    lineageMetadata = validateLineageMetadata(input.lineageMetadata ?? null);
  } catch (error) {
    return errorOutcome(
      "invalid-input",
      `lineageMetadata is invalid: ${(error as Error).message}`,
    );
  }

  const resolved = resolveDeps(deps);
  const launchedAt = isoFromDeps(deps);
  const launchClaimId = resolved.mintLaunchClaimId();
  const launchNonce =
    input.launchNonce && input.launchNonce.length > 0 ? input.launchNonce : resolved.mintNonce();
  const bindingWindowMs = input.bindingWindowMs ?? LAUNCH_CLAIM_DEFAULT_BINDING_WINDOW_MS;
  const retentionWindowMs = input.retentionWindowMs ?? LAUNCH_CLAIM_DEFAULT_RETENTION_WINDOW_MS;
  const wantReservation = input.reserveRegistryRow !== false;

  let reservedRegistryId: string | null = null;
  if (wantReservation) {
    reservedRegistryId = resolved.mintRegistryRowId();
    try {
      registryStore.upsertSession({
        id: reservedRegistryId,
        title: buildReservedRowTitle(input),
        description: buildReservedRowDescription(input),
        cwd: input.expectedCwd,
        repo: input.expectedRepo ?? null,
        branch: input.expectedBranch ?? null,
        tags: [],
        origin: { kind: "launched", launchClaimId },
        lifecycleStatus: "active",
        graphBinding: {
          workstreamId: input.workstreamId,
          nodeId: input.nodeId,
          launchClaimId,
        },
      });
    } catch (error) {
      return errorOutcome(
        "row-reservation-failed",
        `Failed to reserve registry row: ${(error as Error).message}`,
      );
    }
  }

  const createInput: LaunchClaimCreateInput = {
    launchClaimId,
    workstreamId: input.workstreamId,
    nodeId: input.nodeId,
    launchNonce,
    expectedCwd: input.expectedCwd,
    expectedBranch: input.expectedBranch ?? null,
    expectedRepo: input.expectedRepo ?? null,
    contextId: input.contextId ?? null,
    launchedAt,
    bindingWindowMs,
    retentionWindowMs,
    reservedRegistryId,
    lineageMetadata,
  };

  let claim: LaunchClaim;
  try {
    claim = claimStore.createClaim(createInput);
  } catch (error) {
    if (reservedRegistryId !== null) {
      try {
        registryStore.deleteSessionIf(
          reservedRegistryId,
          (current) => current.copilotSessionId === null,
        );
      } catch {
        // Orphan row recovery on next startup will handle this.
      }
    }
    return errorOutcome(
      "claim-write-failed",
      `Failed to write launch claim: ${(error as Error).message}`,
    );
  }
  return { ok: true, claim, reservedRegistryId };
}

function errorOutcome(
  code: CreateLaunchClaimErrorCode,
  message: string,
): CreateLaunchClaimOutcome {
  return { ok: false, error: { code, message } };
}

/**
 * Transitions a pending launch claim to status: "failed". Idempotent —
 * subsequent calls on an already-terminal claim are no-ops. Also
 * applies the FR-3 reserved-row cleanup rule: if the claim has a
 * reservedRegistryId and the row's copilotSessionId is still null,
 * delete the row; otherwise clear graphBinding.
 */
export function markClaimFailed(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  launchClaimId: string,
  failureCode: LaunchClaimFailureCode,
  failureReasonRaw: string | null,
  deps?: LaunchClaimsDeps,
): MarkClaimFailedOutcome {
  const failureReason = sanitizeFailureReason(failureReasonRaw);

  let claim: LaunchClaim | null = null;
  let transitioned = false;
  try {
    claim = claimStore.updateClaim(launchClaimId, (current) => {
      if (LAUNCH_CLAIM_TERMINAL_STATUSES.has(current.status)) {
        return current;
      }
      transitioned = true;
      return {
        ...current,
        status: "failed",
        failureCode,
        failureReason,
      };
    });
  } catch (error) {
    if (error instanceof LaunchClaimNotFoundError) {
      return {
        ok: false,
        claim: null,
        transitioned: false,
        reservedRowDeleted: false,
        reservedRowGraphBindingCleared: false,
      };
    }
    throw error;
  }

  let reservedRowDeleted = false;
  let reservedRowGraphBindingCleared = false;
  if (claim.reservedRegistryId !== null) {
    const cleanup = applyReservedRowCleanup(registryStore, claim);
    reservedRowDeleted = cleanup.reservedRowDeleted;
    reservedRowGraphBindingCleared = cleanup.reservedRowGraphBindingCleared;
  }

  // Suppress unused-deps warnings when not consumed.
  void deps;

  return {
    ok: true,
    claim,
    transitioned,
    reservedRowDeleted,
    reservedRowGraphBindingCleared,
  };
}

/**
 * Applies the FR-3 reserved-row cleanup rule for a non-bound terminal
 * claim. If the reserved row's copilotSessionId is still null, deletes
 * the row (under the registry lock, predicate-checked). Otherwise,
 * clears graphBinding via bindClaimToRow (also under the lock,
 * launchClaimId-guarded).
 */
export function applyReservedRowCleanup(
  registryStore: SessionRegistryFileStore,
  claim: LaunchClaim,
): { reservedRowDeleted: boolean; reservedRowGraphBindingCleared: boolean } {
  if (claim.reservedRegistryId === null) {
    return { reservedRowDeleted: false, reservedRowGraphBindingCleared: false };
  }
  const deleteResult = registryStore.deleteSessionIf(
    claim.reservedRegistryId,
    (current) => current.copilotSessionId === null,
  );
  if (deleteResult.deleted) {
    return { reservedRowDeleted: true, reservedRowGraphBindingCleared: false };
  }
  if (deleteResult.reason === "not-found") {
    return { reservedRowDeleted: false, reservedRowGraphBindingCleared: false };
  }
  // predicate-false → preserve the row but clear its graphBinding.
  const current = registryStore.getSession(claim.reservedRegistryId);
  if (!current) {
    return { reservedRowDeleted: false, reservedRowGraphBindingCleared: false };
  }
  const result = registryStore.bindClaimToRow(
    claim.reservedRegistryId,
    {
      cwdAfterNormalize: current.cwd,
      branch: null,
      repo: null,
      requireGraphBindingNullOrMatching: {
        workstreamId: claim.workstreamId,
        nodeId: claim.nodeId,
        launchClaimId: claim.launchClaimId,
      },
    },
    { graphBinding: null },
  );
  return {
    reservedRowDeleted: false,
    reservedRowGraphBindingCleared: result.ok,
  };
}

/**
 * Startup recovery routine. Lists all launched-origin registry rows
 * whose `origin.launchClaimId` does not appear in the launch-claim
 * store and conditionally cleans them up:
 *
 *   - If `copilotSessionId === null`: delete the row (orphan reserved
 *     row, no real session ever attached). Deletion is conditional on
 *     the predicate evaluated under the lock.
 *   - Else: clear `graphBinding` (the row had a real session attach,
 *     but the owning claim is gone — preserve session history).
 *
 * Also handles the inverse case: claims whose `reservedRegistryId`
 * points at a missing row are left intact (the binding pass and sweep
 * will eventually transition them to expired/nonce-missing).
 *
 * Should be called by the background worker on startup before the
 * first poll cycle.
 */
export function reconcileOrphanReservedRows(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
): { rowsDeleted: number; rowsGraphBindingCleared: number; rowsInspected: number } {
  const sessions = registryStore.listSessions({ includeArchived: true });
  const launchedSessions = sessions.filter((session) => session.originKind === "launched");
  let rowsDeleted = 0;
  let rowsGraphBindingCleared = 0;
  let rowsInspected = 0;
  for (const session of launchedSessions) {
    rowsInspected += 1;
    const fullRecord = registryStore.getSession(session.id);
    if (!fullRecord) continue;
    if (fullRecord.origin.kind !== "launched") continue;
    const launchClaimId = fullRecord.origin.launchClaimId ?? null;
    if (!launchClaimId) continue;
    const claim = claimStore.getClaim(launchClaimId);
    if (claim) continue; // claim still exists; not orphan
    // Orphan row.
    if (fullRecord.copilotSessionId === null) {
      const deleteResult = registryStore.deleteSessionIf(
        fullRecord.id,
        (current) => current.copilotSessionId === null,
      );
      if (deleteResult.deleted) {
        rowsDeleted += 1;
      } else if (deleteResult.reason === "predicate-false") {
        // A session attached during the gap; clear graphBinding.
        const cleared = registryStore.bindClaimToRow(
          fullRecord.id,
          {
            cwdAfterNormalize: fullRecord.cwd,
            branch: null,
            repo: null,
            requireGraphBindingNullOrMatching: {
              workstreamId: fullRecord.graphBinding?.workstreamId ?? "",
              nodeId: fullRecord.graphBinding?.nodeId ?? "",
              launchClaimId,
            },
          },
          { graphBinding: null },
        );
        if (cleared.ok) {
          rowsGraphBindingCleared += 1;
        }
      }
    } else {
      // Has copilotSessionId — preserve row, clear graphBinding.
      const cleared = registryStore.bindClaimToRow(
        fullRecord.id,
        {
          cwdAfterNormalize: fullRecord.cwd,
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: fullRecord.graphBinding?.workstreamId ?? "",
            nodeId: fullRecord.graphBinding?.nodeId ?? "",
            launchClaimId,
          },
        },
        { graphBinding: null },
      );
      if (cleared.ok) {
        rowsGraphBindingCleared += 1;
      }
    }
  }
  return { rowsDeleted, rowsGraphBindingCleared, rowsInspected };
}

/**
 * Predicate: is the claim's launch window still open at `at`?
 */
export function isClaimWindowOpen(claim: LaunchClaim, atMs: number): boolean {
  const launchedAtMs = Date.parse(claim.launchedAt);
  if (!Number.isFinite(launchedAtMs)) return false;
  return atMs <= launchedAtMs + claim.bindingWindowMs;
}

/**
 * Predicate: is the claim past its retention deadline at `at`? Used by
 * the sweep to decide pruning.
 */
export function isClaimPastRetention(claim: LaunchClaim, atMs: number): boolean {
  const updatedAtMs = Date.parse(claim.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return atMs > updatedAtMs + claim.retentionWindowMs;
}

/**
 * Returns the claim's status set, used by sweep filters.
 */
export function isClaimTerminal(status: LaunchClaimStatus): boolean {
  return LAUNCH_CLAIM_TERMINAL_STATUSES.has(status);
}
