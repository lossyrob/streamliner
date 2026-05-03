import type {
  LaunchClaim,
  LaunchClaimEvidenceAttempt,
  LaunchClaimFailureCode,
  LaunchClaimIndexEntry,
  LaunchClaimStatus,
} from "./launch-claim-schema";

/**
 * Public input shape for creating a brand-new launch claim. The
 * launch-claims helper module owns nonce minting and id generation; the
 * underlying LaunchClaimStore receives a fully-resolved
 * LaunchClaimCreateInput with both ids already chosen so writes are
 * deterministic and recoverable across crashes.
 */
export interface LaunchClaimCreateInput {
  launchClaimId: string;
  workstreamId: string;
  nodeId: string;
  launchNonce: string;
  expectedCwd: string;
  expectedBranch: string | null;
  expectedRepo: string | null;
  contextId: string | null;
  launchedAt: string;
  bindingWindowMs: number;
  retentionWindowMs: number;
  reservedRegistryId: string | null;
  lineageMetadata: Record<string, unknown> | null;
}

export interface LaunchClaimListOptions {
  status?: LaunchClaimStatus | ReadonlyArray<LaunchClaimStatus>;
  workstreamId?: string;
  nodeId?: string;
  /** Limit applied after sorting newest-first by launchedAt. */
  limit?: number;
}

export interface LaunchClaimMutationContext {
  /** Now-source for `updatedAt`. Defaults to wall clock when omitted. */
  now?: () => Date;
}

export interface LaunchClaimRecordBindResult {
  copilotSessionId: string;
  registryId: string;
  evidence: LaunchClaimEvidenceAttempt;
}

export interface LaunchClaimRecordRejectionResult {
  evidence: LaunchClaimEvidenceAttempt;
}

export interface LaunchClaimMarkFailedInput {
  failureCode: LaunchClaimFailureCode;
  failureReason: string | null;
}

export const LAUNCH_CLAIM_CHANGE_KINDS = [
  "claim.upserted",
  "claim.deleted",
  "claim.rebuilt",
] as const;
export type LaunchClaimChangeKind = (typeof LAUNCH_CLAIM_CHANGE_KINDS)[number];

export type LaunchClaimChangeEvent =
  | {
      kind: "claim.upserted";
      launchClaimId: string;
      snapshot: LaunchClaim;
    }
  | { kind: "claim.deleted"; launchClaimId: string }
  | { kind: "claim.rebuilt"; launchClaimIds: string[] };

export type LaunchClaimChangeListener = (event: LaunchClaimChangeEvent) => void;

/**
 * Public store contract. Mirrors SessionRegistryStore in spirit but with
 * a smaller surface (no expectedVersion, no observation paths). All
 * mutations are write-then-rename + advisory lock so concurrent readers
 * never see partial state.
 */
export interface LaunchClaimStore {
  /** Creates a new claim. Throws if launchClaimId already exists. */
  createClaim(input: LaunchClaimCreateInput): LaunchClaim;
  /** Returns a deep clone or null. */
  getClaim(launchClaimId: string): LaunchClaim | null;
  /** Returns deep clones of index entries, sorted newest-first. */
  listClaims(options?: LaunchClaimListOptions): LaunchClaimIndexEntry[];
  /**
   * Acquires the lock once, re-reads the latest claim, applies the
   * mutator function, and writes back atomically. The mutator MUST
   * return a fully-formed LaunchClaim (callers typically spread the
   * current value and override changed fields). Returns the new value.
   * Throws if the claim does not exist.
   */
  updateClaim(
    launchClaimId: string,
    mutator: (current: LaunchClaim) => LaunchClaim,
  ): LaunchClaim;
  deleteClaim(launchClaimId: string): boolean;
  subscribe(listener: LaunchClaimChangeListener): () => void;
}

export class LaunchClaimNotFoundError extends Error {
  readonly launchClaimId: string;
  constructor(launchClaimId: string) {
    super(`Launch claim ${launchClaimId} not found.`);
    this.name = "LaunchClaimNotFoundError";
    this.launchClaimId = launchClaimId;
  }
}

export class LaunchClaimAlreadyExistsError extends Error {
  readonly launchClaimId: string;
  constructor(launchClaimId: string) {
    super(`Launch claim ${launchClaimId} already exists.`);
    this.name = "LaunchClaimAlreadyExistsError";
    this.launchClaimId = launchClaimId;
  }
}

export class LaunchClaimLockedError extends Error {
  constructor(message = "Launch claim store is locked by another writer.") {
    super(message);
    this.name = "LaunchClaimLockedError";
  }
}
