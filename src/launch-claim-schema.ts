export const LAUNCH_CLAIM_SCHEMA_VERSION = 1 as const;

export const LAUNCH_CLAIM_STATUSES = [
  "pending",
  "bound",
  "nonce-missing",
  "ambiguous",
  "expired",
  "failed",
] as const;
export type LaunchClaimStatus = (typeof LAUNCH_CLAIM_STATUSES)[number];

export const LAUNCH_CLAIM_TERMINAL_STATUSES: ReadonlySet<LaunchClaimStatus> =
  new Set<LaunchClaimStatus>([
    "bound",
    "nonce-missing",
    "ambiguous",
    "expired",
    "failed",
  ]);

export const LAUNCH_CLAIM_FAILURE_CODES = [
  "terminal-spawn-failed",
  "context-prep-failed",
  "branch-conflict",
  "user-cancelled",
  "internal-error",
  "expired-no-candidates",
  "expired-no-nonce",
  "ambiguous-candidates",
] as const;
export type LaunchClaimFailureCode =
  (typeof LAUNCH_CLAIM_FAILURE_CODES)[number];

export const LAUNCH_CLAIM_EVIDENCE_DECISIONS = [
  "bind",
  "wait-for-more-evidence",
  "ambiguous",
  "ignore-out-of-window",
  "ignore-already-bound",
  "reserved-row-fused",
  "reserved-row-cleanup-skipped",
  "reserved-row-cleanup-deleted",
  "reserved-row-cleanup-graphbinding-cleared",
] as const;
export type LaunchClaimEvidenceDecision =
  (typeof LAUNCH_CLAIM_EVIDENCE_DECISIONS)[number];

export const LAUNCH_CLAIM_EVIDENCE_REASONS = [
  "no-candidates",
  "no-nonce-match",
  "nonce-match-single",
  "nonce-match-multiple",
  "candidate-cwd-mismatch-after-recheck",
  "candidate-cwd-mismatch",
  "candidate-branch-mismatch",
  "candidate-repo-mismatch",
  "events-file-unreadable",
  "events-scan-cutoff-reached",
  "awaiting-registry-row",
  "claim-already-bound",
  "claim-out-of-window",
  "row-attached-during-cleanup-window",
  "duplicate-observed-row-deleted",
] as const;
export type LaunchClaimEvidenceReason =
  (typeof LAUNCH_CLAIM_EVIDENCE_REASONS)[number];

export interface LaunchClaimEvidenceAttempt {
  at: string;
  candidateCopilotSessionId: string | null;
  decision: LaunchClaimEvidenceDecision;
  reason: LaunchClaimEvidenceReason;
  nonceMatch: boolean;
  nonceScanByteOffset: number | null;
  nonceScanEventIndex: number | null;
  cwdMatch: boolean;
  branchMatch: boolean | null;
  repoMatch: boolean | null;
}

export interface LaunchClaimEvidence {
  attempts: LaunchClaimEvidenceAttempt[];
}

export interface LaunchClaim {
  schemaVersion: typeof LAUNCH_CLAIM_SCHEMA_VERSION;
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
  status: LaunchClaimStatus;
  boundCopilotSessionId: string | null;
  boundRegistryId: string | null;
  reservedRegistryId: string | null;
  failureReason: string | null;
  failureCode: LaunchClaimFailureCode | null;
  seenCandidateCopilotSessionIds: string[];
  evidence: LaunchClaimEvidence;
  lineageMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface LaunchClaimIndexEntry {
  launchClaimId: string;
  workstreamId: string;
  nodeId: string;
  status: LaunchClaimStatus;
  launchedAt: string;
  updatedAt: string;
  reservedRegistryId: string | null;
  boundRegistryId: string | null;
  boundCopilotSessionId: string | null;
}

export interface LaunchClaimIndex {
  schemaVersion: typeof LAUNCH_CLAIM_SCHEMA_VERSION;
  entries: LaunchClaimIndexEntry[];
}

export const LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH = 256;
export const LAUNCH_CLAIM_LINEAGE_METADATA_MAX_BYTES = 4096;
export const LAUNCH_CLAIM_DEFAULT_BINDING_WINDOW_MS = 5 * 60 * 1000;
export const LAUNCH_CLAIM_DEFAULT_RETENTION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Sanitizes a caller-provided failure reason string into the shape we are
 * willing to persist on a LaunchClaim record. Strips control characters,
 * collapses newlines/tabs to "; ", trims, and truncates to
 * LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH characters. Callers should pass a
 * machine-readable LaunchClaimFailureCode in addition to (not in place of)
 * a sanitized human description; raw stack traces, command lines, and
 * stderr should NOT be passed in here — they belong in transient log
 * output. Returns null for null/undefined/empty input.
 */
export function sanitizeFailureReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  // Strip Unicode control characters; collapse line breaks and tabs to "; ".
  const collapsed = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[\r\n\t]+/g, "; ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length === 0) {
    return null;
  }
  if (collapsed.length <= LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH) {
    return collapsed;
  }
  return collapsed.slice(0, LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH - 1) + "…";
}

/**
 * Validates that lineage metadata is JSON-serializable and within the
 * configured byte cap. Throws on oversize or non-serializable input.
 * Returns null when given null/undefined; returns a deep-cloned copy
 * otherwise to defeat caller-side mutation after persistence.
 */
export function validateLineageMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("lineageMetadata must be a JSON object or null.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(
      `lineageMetadata is not JSON-serializable: ${(error as Error).message}`,
    );
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > LAUNCH_CLAIM_LINEAGE_METADATA_MAX_BYTES) {
    throw new RangeError(
      `lineageMetadata exceeds ${LAUNCH_CLAIM_LINEAGE_METADATA_MAX_BYTES} bytes (${byteLength}).`,
    );
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function ensureOptionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string or null.`);
  }
  return value;
}

function ensureFiniteNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer.`);
  }
  return value;
}

function ensureBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be a boolean.`);
  }
  return value;
}

function ensureOptionalBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  return ensureBoolean(value, field);
}

function ensureOptionalInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError(`${field} must be an integer or null.`);
  }
  return value;
}

function ensureStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array of strings.`);
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new TypeError(`${field} must contain only strings.`);
    }
  }
  return [...new Set(value as string[])];
}

function parseEvidenceAttempt(value: unknown, field: string): LaunchClaimEvidenceAttempt {
  if (!isPlainObject(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const decision = ensureString(value.decision, `${field}.decision`);
  if (!LAUNCH_CLAIM_EVIDENCE_DECISIONS.includes(decision as LaunchClaimEvidenceDecision)) {
    throw new TypeError(`${field}.decision is not a valid decision: ${decision}`);
  }
  const reason = ensureString(value.reason, `${field}.reason`);
  if (!LAUNCH_CLAIM_EVIDENCE_REASONS.includes(reason as LaunchClaimEvidenceReason)) {
    throw new TypeError(`${field}.reason is not a valid reason: ${reason}`);
  }
  return {
    at: ensureString(value.at, `${field}.at`),
    candidateCopilotSessionId: ensureOptionalString(
      value.candidateCopilotSessionId,
      `${field}.candidateCopilotSessionId`,
    ),
    decision: decision as LaunchClaimEvidenceDecision,
    reason: reason as LaunchClaimEvidenceReason,
    nonceMatch: ensureBoolean(value.nonceMatch, `${field}.nonceMatch`),
    nonceScanByteOffset: ensureOptionalInteger(
      value.nonceScanByteOffset,
      `${field}.nonceScanByteOffset`,
    ),
    nonceScanEventIndex: ensureOptionalInteger(
      value.nonceScanEventIndex,
      `${field}.nonceScanEventIndex`,
    ),
    cwdMatch: ensureBoolean(value.cwdMatch, `${field}.cwdMatch`),
    branchMatch: ensureOptionalBoolean(value.branchMatch, `${field}.branchMatch`),
    repoMatch: ensureOptionalBoolean(value.repoMatch, `${field}.repoMatch`),
  };
}

function parseEvidence(value: unknown, field: string): LaunchClaimEvidence {
  if (!isPlainObject(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const attemptsRaw = (value as { attempts?: unknown }).attempts;
  if (!Array.isArray(attemptsRaw)) {
    throw new TypeError(`${field}.attempts must be an array.`);
  }
  return {
    attempts: attemptsRaw.map((entry, index) =>
      parseEvidenceAttempt(entry, `${field}.attempts[${index}]`),
    ),
  };
}

/**
 * Parses an unknown value into a LaunchClaim record. Throws on validation
 * failure. Used by the file store on read; also re-used for round-trip
 * validation in tests.
 */
export function parseLaunchClaim(value: unknown): LaunchClaim {
  if (!isPlainObject(value)) {
    throw new TypeError("LaunchClaim must be an object.");
  }
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== LAUNCH_CLAIM_SCHEMA_VERSION) {
    throw new TypeError(
      `LaunchClaim schemaVersion must be ${LAUNCH_CLAIM_SCHEMA_VERSION}, got ${String(schemaVersion)}.`,
    );
  }
  const status = ensureString(value.status, "LaunchClaim.status");
  if (!LAUNCH_CLAIM_STATUSES.includes(status as LaunchClaimStatus)) {
    throw new TypeError(`LaunchClaim.status is not a valid status: ${status}`);
  }
  const failureCode =
    value.failureCode === null || value.failureCode === undefined
      ? null
      : (() => {
          const raw = ensureString(value.failureCode, "LaunchClaim.failureCode");
          if (!LAUNCH_CLAIM_FAILURE_CODES.includes(raw as LaunchClaimFailureCode)) {
            throw new TypeError(`LaunchClaim.failureCode is not valid: ${raw}`);
          }
          return raw as LaunchClaimFailureCode;
        })();
  const lineageMetadataRaw = (value as { lineageMetadata?: unknown }).lineageMetadata;
  const lineageMetadata =
    lineageMetadataRaw === null || lineageMetadataRaw === undefined
      ? null
      : validateLineageMetadata(lineageMetadataRaw as Record<string, unknown>);
  const claim: LaunchClaim = {
    schemaVersion: LAUNCH_CLAIM_SCHEMA_VERSION,
    launchClaimId: ensureString(value.launchClaimId, "LaunchClaim.launchClaimId"),
    workstreamId: ensureString(value.workstreamId, "LaunchClaim.workstreamId"),
    nodeId: ensureString(value.nodeId, "LaunchClaim.nodeId"),
    launchNonce: ensureString(value.launchNonce, "LaunchClaim.launchNonce"),
    expectedCwd: ensureString(value.expectedCwd, "LaunchClaim.expectedCwd"),
    expectedBranch: ensureOptionalString(value.expectedBranch, "LaunchClaim.expectedBranch"),
    expectedRepo: ensureOptionalString(value.expectedRepo, "LaunchClaim.expectedRepo"),
    contextId: ensureOptionalString(value.contextId, "LaunchClaim.contextId"),
    launchedAt: ensureString(value.launchedAt, "LaunchClaim.launchedAt"),
    bindingWindowMs: ensureFiniteNonNegativeInteger(
      value.bindingWindowMs,
      "LaunchClaim.bindingWindowMs",
    ),
    retentionWindowMs: ensureFiniteNonNegativeInteger(
      value.retentionWindowMs,
      "LaunchClaim.retentionWindowMs",
    ),
    status: status as LaunchClaimStatus,
    boundCopilotSessionId: ensureOptionalString(
      value.boundCopilotSessionId,
      "LaunchClaim.boundCopilotSessionId",
    ),
    boundRegistryId: ensureOptionalString(value.boundRegistryId, "LaunchClaim.boundRegistryId"),
    reservedRegistryId: ensureOptionalString(
      value.reservedRegistryId,
      "LaunchClaim.reservedRegistryId",
    ),
    failureReason:
      value.failureReason === null || value.failureReason === undefined
        ? null
        : sanitizeFailureReason(
            ensureOptionalString(value.failureReason, "LaunchClaim.failureReason"),
          ),
    failureCode,
    seenCandidateCopilotSessionIds: ensureStringArray(
      value.seenCandidateCopilotSessionIds ?? [],
      "LaunchClaim.seenCandidateCopilotSessionIds",
    ),
    evidence: parseEvidence(value.evidence ?? { attempts: [] }, "LaunchClaim.evidence"),
    lineageMetadata,
    createdAt: ensureString(value.createdAt, "LaunchClaim.createdAt"),
    updatedAt: ensureString(value.updatedAt, "LaunchClaim.updatedAt"),
  };
  return claim;
}

export function parseLaunchClaimIndex(value: unknown): LaunchClaimIndex {
  if (!isPlainObject(value)) {
    throw new TypeError("LaunchClaimIndex must be an object.");
  }
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== LAUNCH_CLAIM_SCHEMA_VERSION) {
    throw new TypeError(
      `LaunchClaimIndex schemaVersion must be ${LAUNCH_CLAIM_SCHEMA_VERSION}, got ${String(schemaVersion)}.`,
    );
  }
  const entriesRaw = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) {
    throw new TypeError("LaunchClaimIndex.entries must be an array.");
  }
  const entries: LaunchClaimIndexEntry[] = entriesRaw.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`LaunchClaimIndex.entries[${index}] must be an object.`);
    }
    const status = ensureString(entry.status, `LaunchClaimIndex.entries[${index}].status`);
    if (!LAUNCH_CLAIM_STATUSES.includes(status as LaunchClaimStatus)) {
      throw new TypeError(
        `LaunchClaimIndex.entries[${index}].status is not valid: ${status}`,
      );
    }
    return {
      launchClaimId: ensureString(
        entry.launchClaimId,
        `LaunchClaimIndex.entries[${index}].launchClaimId`,
      ),
      workstreamId: ensureString(
        entry.workstreamId,
        `LaunchClaimIndex.entries[${index}].workstreamId`,
      ),
      nodeId: ensureString(entry.nodeId, `LaunchClaimIndex.entries[${index}].nodeId`),
      status: status as LaunchClaimStatus,
      launchedAt: ensureString(
        entry.launchedAt,
        `LaunchClaimIndex.entries[${index}].launchedAt`,
      ),
      updatedAt: ensureString(
        entry.updatedAt,
        `LaunchClaimIndex.entries[${index}].updatedAt`,
      ),
      reservedRegistryId: ensureOptionalString(
        entry.reservedRegistryId,
        `LaunchClaimIndex.entries[${index}].reservedRegistryId`,
      ),
      boundRegistryId: ensureOptionalString(
        entry.boundRegistryId,
        `LaunchClaimIndex.entries[${index}].boundRegistryId`,
      ),
      boundCopilotSessionId: ensureOptionalString(
        entry.boundCopilotSessionId,
        `LaunchClaimIndex.entries[${index}].boundCopilotSessionId`,
      ),
    };
  });
  return { schemaVersion: LAUNCH_CLAIM_SCHEMA_VERSION, entries };
}

export function projectLaunchClaimToIndexEntry(claim: LaunchClaim): LaunchClaimIndexEntry {
  return {
    launchClaimId: claim.launchClaimId,
    workstreamId: claim.workstreamId,
    nodeId: claim.nodeId,
    status: claim.status,
    launchedAt: claim.launchedAt,
    updatedAt: claim.updatedAt,
    reservedRegistryId: claim.reservedRegistryId,
    boundRegistryId: claim.boundRegistryId,
    boundCopilotSessionId: claim.boundCopilotSessionId,
  };
}
