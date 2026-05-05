import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  type ObservedSessionRegistryUpsertInput,
  SESSION_REGISTRY_CHANGE_EVENT_KINDS,
  type SessionRegistryBuilderLifecycleStatus,
  type SessionRegistryChangeEvent,
  type SessionRegistryChangeListener,
  type SessionRegistryListItem,
  type SessionRegistryListOptions,
  type SessionRegistryObservedLinkInput,
  type SessionRegistryPatch,
  type SessionRegistryStore,
  type SessionRegistryTrustedSignalInput,
  type SessionRegistryUpsertInput,
} from "../session-registry-contract";
import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  SESSION_REGISTRY_ACTIVITY_CONFIDENCES,
  SESSION_REGISTRY_ACTIVITY_DIAGNOSTIC_CODES,
  SESSION_REGISTRY_ACTIVITY_STATUS_REASONS,
  SESSION_REGISTRY_ACTIVITY_STATUSES,
  SESSION_REGISTRY_AI_SUMMARY_STATUSES,
  SESSION_REGISTRY_COPILOT_PROCESS_STATES,
  SESSION_REGISTRY_GITHUB_REF_TYPES,
  SESSION_REGISTRY_LIFECYCLE_STATUSES,
  SESSION_REGISTRY_OBSERVED_SESSION_KINDS,
  SESSION_REGISTRY_ORIGIN_KINDS,
  SESSION_REGISTRY_PAW_ARTIFACT_KINDS,
  SESSION_REGISTRY_PAW_WORKFLOW_DIAGNOSTIC_CODES,
  SESSION_REGISTRY_PAW_WORKFLOW_KINDS,
  SESSION_REGISTRY_PAW_WORKFLOW_STAGES,
  SESSION_REGISTRY_PAW_WORKFLOW_STATUSES,
  SESSION_REGISTRY_SCHEMA_VERSION,
  SESSION_REGISTRY_TITLE_SOURCES,
  SESSION_REGISTRY_TRUSTED_END_REASONS,
  SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS,
  SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES,
  SESSION_REGISTRY_TRUSTED_START_SOURCES,
  buildSessionRegistryActivityEvidence,
  type SessionRegistryActivityConfidence,
  type SessionRegistryActivityDiagnosticCode,
  type SessionRegistryActivityEvidence,
  type SessionRegistryActivityStatus,
  type SessionRegistryAiSummaryStatus,
  type SessionRegistryCopilotProcessState,
  type SessionRegistryGithubRef,
  type SessionRegistryGithubRefType,
  type SessionRegistryGraphBinding,
  type SessionRegistryIndex,
  type SessionRegistryIndexEntry,
  type SessionRegistryLifecycleStatus,
  type SessionRegistryObservedSessionKind,
  type SessionRegistryOrigin,
  type SessionRegistryOriginKind,
  type SessionRegistryPawArtifactEvidence,
  type SessionRegistryPawArtifactKind,
  type SessionRegistryPawWorkflow,
  type SessionRegistryPawWorkflowDiagnosticCode,
  type SessionRegistryPawWorkflowKind,
  type SessionRegistryPawWorkflowStage,
  type SessionRegistryPawWorkflowStatus,
  type SessionRegistryRecord,
  type SessionRegistryTitleSource,
  type SessionRegistryTrustedEndReason,
  type SessionRegistryTrustedExecutionKind,
  type SessionRegistryTrustedSignalSource,
  type SessionRegistryTrustedStartSource,
} from "../session-registry-schema";

const DEFAULT_REGISTRY_ROOT = resolve(
  homedir(),
  ".streamliner",
  "state",
  "session-registry",
);

const ENTRY_EXTENSION = ".json";
const SHARED_SLEEP_BUFFER = new SharedArrayBuffer(4);
const SHARED_SLEEP_ARRAY = new Int32Array(SHARED_SLEEP_BUFFER);
const WRITE_LOCK_WAIT_TIMEOUT_MS = 5_000;
const WRITE_LOCK_WAIT_INTERVAL_MS = 50;
const REGISTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_WINDOWS_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);
const SESSION_REGISTRY_PATCH_KEYS = [
  "expectedVersion",
  "title",
  "description",
  "color",
  "lifecycleStatus",
  "tags",
  "graphBinding",
] as const;
const SESSION_REGISTRY_UPSERT_BASE_KEYS = [
  "id",
  "title",
  "description",
  "color",
  "cwd",
  "repo",
  "branch",
  "tags",
  "origin",
  "lifecycleStatus",
  "graphBinding",
] as const;
const OBSERVED_SESSION_UPSERT_KEYS = [
  ...SESSION_REGISTRY_UPSERT_BASE_KEYS,
  "copilotSessionId",
  "lastSeenAt",
  "observedSessionKind",
  "copilotProcessState",
  "copilotProcessId",
  "trustedSignalSource",
  "trustedStartedAt",
  "trustedEndedAt",
  "trustedLastSignalAt",
  "trustedStartSource",
  "trustedEndReason",
  "trustedExecutionKind",
  "trustedInitialPromptLength",
  "trustedLastPromptLength",
] as const;

type StoredSessionRegistryRecord = SessionRegistryRecord & Record<string, unknown>;
type JsonObject = Record<string, unknown>;
interface SessionRegistryLockMetadata {
  pid: number;
  acquiredAt: string;
}

export class SessionRegistryNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} does not exist.`);
    this.name = "SessionRegistryNotFoundError";
  }
}

export class SessionRegistryArchivedError extends Error {
  constructor(id: string, action: string) {
    super(`Archived session ${id} cannot ${action}.`);
    this.name = "SessionRegistryArchivedError";
  }
}

export class SessionRegistryLockedError extends Error {
  constructor(lockPath: string) {
    super(`Session registry is locked at ${lockPath}.`);
    this.name = "SessionRegistryLockedError";
  }
}

export class SessionRegistryConflictError extends Error {
  readonly latest: SessionRegistryRecord;
  readonly conflictingFields: string[];

  constructor(latest: SessionRegistryRecord, conflictingFields: string[]) {
    super(`Session ${latest.id} changed before this update could be saved.`);
    this.name = "SessionRegistryConflictError";
    this.latest = latest;
    this.conflictingFields = conflictingFields;
  }
}

export interface SessionRegistryFileStoreOptions {
  rootDir?: string;
  writeLockWaitTimeoutMs?: number;
}

export interface SessionRegistryDerivedStatePatch {
  aiSummary?: string | null;
  aiSummaryModel?: string | null;
  aiSummaryUpdatedAt?: string | null;
  aiSummaryEventsFingerprint?: string | null;
  aiSummaryStatus?: SessionRegistryAiSummaryStatus;
  aiSummaryError?: string | null;
  repo?: string | null;
  branch?: string | null;
  lifecycleStatus?: SessionRegistryLifecycleStatus;
  copilotProcessState?: SessionRegistryCopilotProcessState | null;
  copilotProcessId?: number | null;
  activityStatus?: SessionRegistryActivityStatus;
  activityStatusUpdatedAt?: string | null;
  activityEvidence?: SessionRegistryActivityEvidence;
  pawWorkflow?: SessionRegistryPawWorkflow | null;
  derivedWorktreePath?: string | null;
  derivedBranch?: string | null;
  derivedGithubRefs?: SessionRegistryGithubRef[];
  derivedContextUpdatedAt?: string | null;
  derivedContextEventsOffset?: number;
  derivedContextEventsSize?: number;
  derivedContextEventsMtimeMs?: number | null;
}

export function getDefaultSessionRegistryRoot(): string {
  return DEFAULT_REGISTRY_ROOT;
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(SHARED_SLEEP_ARRAY, 0, 0, milliseconds);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

function renameWithRetries(fromPath: string, toPath: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(fromPath, toPath);
      return;
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (code !== "EPERM" && code !== "EACCES") {
        throw error;
      }

      lastError = error;
      sleepSync(25 * (attempt + 1));
    }
  }

  throw lastError;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function fingerprintMapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function isoNow(): string {
  return new Date().toISOString();
}

function ensureString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }

  return value;
}

function parseRegistryId(value: unknown, fieldName: string): string {
  const id = ensureString(value, fieldName).trim();
  const reservedStem = id.split(".", 1)[0].toUpperCase();
  if (
    !REGISTRY_ID_PATTERN.test(id) ||
    id.endsWith(".") ||
    RESERVED_WINDOWS_FILE_NAMES.has(reservedStem)
  ) {
    throw new Error(`Expected ${fieldName} to be a safe registry id.`);
  }
  return id;
}

function parseTimestampMs(value: string, fieldName: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Expected ${fieldName} to be a valid timestamp.`);
  }
  return timestamp;
}

function optionalTimestampMs(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function ensureOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string or null.`);
  }
  return value;
}

function ensureOptionalInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${fieldName} to be a non-negative integer or null.`);
  }
  return value;
}

function ensureNonNegativeInteger(value: unknown, fieldName: string): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${fieldName} to be a non-negative integer.`);
  }
  return value;
}

function ensureOptionalNonNegativeInteger(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${fieldName} to be a non-negative integer.`);
  }
  return value;
}

function ensureOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Expected ${fieldName} to be a non-negative number or null.`);
  }
  return value;
}

function ensureStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }
  return value;
}

function ensureBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }
  return value;
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function ensureAllowedKeys(
  value: JsonObject,
  fieldName: string,
  allowedKeys: readonly string[],
): void {
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Unexpected ${fieldName} field(s): ${unexpectedKeys.join(", ")}.`);
  }
}

function ensureOptionalGraphBinding(
  value: unknown,
  fieldName: string,
): SessionRegistryGraphBinding | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object or null.`);
  }

  return {
    workstreamId: ensureString(value.workstreamId, `${fieldName}.workstreamId`),
    nodeId: ensureString(value.nodeId, `${fieldName}.nodeId`),
    launchClaimId: ensureOptionalString(
      value.launchClaimId,
      `${fieldName}.launchClaimId`,
    ),
  };
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const next = tag.trim();
    if (next.length === 0 || seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

function ensureStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected ${fieldName} to be an array of strings.`);
  }
  return normalizeTags(value);
}

function parseStoredOrigin(value: unknown, fieldName: string): SessionRegistryOrigin {
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  const kind = ensureString(value.kind, `${fieldName}.kind`) as SessionRegistryOriginKind;
  if (!SESSION_REGISTRY_ORIGIN_KINDS.includes(kind)) {
    throw new Error(`Unsupported ${fieldName}.kind "${kind}".`);
  }

  if (kind === "manual") {
    return { kind: "manual" };
  }

  if (kind === "observed") {
    return {
      kind: "observed",
      importedFromCopilotSessionId: ensureOptionalString(
        value.importedFromCopilotSessionId,
        `${fieldName}.importedFromCopilotSessionId`,
      ),
    };
  }

  return {
    kind: "launched",
    launchClaimId: ensureOptionalString(
      value.launchClaimId,
      `${fieldName}.launchClaimId`,
    ),
  };
}

function preserveValidatedOrigin(value: unknown, fieldName: string): SessionRegistryOrigin {
  const typedOrigin = parseStoredOrigin(value, fieldName);
  if (!isJsonObject(value)) {
    return typedOrigin;
  }

  return {
    ...(value as JsonObject),
    ...typedOrigin,
  } as SessionRegistryOrigin;
}

function parseInputOrigin(value: unknown, fieldName: string): SessionRegistryOrigin {
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  const kind = ensureString(value.kind, `${fieldName}.kind`) as SessionRegistryOriginKind;
  if (!SESSION_REGISTRY_ORIGIN_KINDS.includes(kind)) {
    throw new Error(`Unsupported ${fieldName}.kind "${kind}".`);
  }

  if (kind === "manual") {
    ensureAllowedKeys(value, fieldName, ["kind"]);
    return { kind: "manual" };
  }

  if (kind === "observed") {
    ensureAllowedKeys(value, fieldName, ["kind", "importedFromCopilotSessionId"]);
    return {
      kind: "observed",
      ...(hasOwn(value, "importedFromCopilotSessionId")
        ? {
            importedFromCopilotSessionId: ensureOptionalString(
              value.importedFromCopilotSessionId,
              `${fieldName}.importedFromCopilotSessionId`,
            ),
          }
        : {}),
    };
  }

  ensureAllowedKeys(value, fieldName, ["kind", "launchClaimId"]);
  return {
    kind: "launched",
    ...(hasOwn(value, "launchClaimId")
      ? {
          launchClaimId: ensureOptionalString(
            value.launchClaimId,
            `${fieldName}.launchClaimId`,
          ),
        }
      : {}),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLifecycleStatus(value: string): value is SessionRegistryLifecycleStatus {
  return SESSION_REGISTRY_LIFECYCLE_STATUSES.includes(value as SessionRegistryLifecycleStatus);
}

function isTitleSource(value: string): value is SessionRegistryTitleSource {
  return SESSION_REGISTRY_TITLE_SOURCES.includes(value as SessionRegistryTitleSource);
}

function isAiSummaryStatus(value: string): value is SessionRegistryAiSummaryStatus {
  return SESSION_REGISTRY_AI_SUMMARY_STATUSES.includes(value as SessionRegistryAiSummaryStatus);
}

function isActivityStatus(value: string): value is SessionRegistryActivityStatus {
  return SESSION_REGISTRY_ACTIVITY_STATUSES.includes(value as SessionRegistryActivityStatus);
}

function isActivityConfidence(value: string): value is SessionRegistryActivityConfidence {
  return SESSION_REGISTRY_ACTIVITY_CONFIDENCES.includes(
    value as SessionRegistryActivityConfidence,
  );
}

function isActivityStatusReason(
  value: string,
): value is SessionRegistryActivityEvidence["statusReason"] {
  return SESSION_REGISTRY_ACTIVITY_STATUS_REASONS.includes(
    value as SessionRegistryActivityEvidence["statusReason"],
  );
}

function isActivityDiagnosticCode(
  value: string,
): value is SessionRegistryActivityDiagnosticCode {
  return SESSION_REGISTRY_ACTIVITY_DIAGNOSTIC_CODES.includes(
    value as SessionRegistryActivityDiagnosticCode,
  );
}

function isObservedSessionKind(value: string): value is SessionRegistryObservedSessionKind {
  return SESSION_REGISTRY_OBSERVED_SESSION_KINDS.includes(
    value as SessionRegistryObservedSessionKind,
  );
}

function isCopilotProcessState(value: string): value is SessionRegistryCopilotProcessState {
  return SESSION_REGISTRY_COPILOT_PROCESS_STATES.includes(
    value as SessionRegistryCopilotProcessState,
  );
}

function isTrustedSignalSource(value: string): value is SessionRegistryTrustedSignalSource {
  return SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES.includes(
    value as SessionRegistryTrustedSignalSource,
  );
}

function isTrustedStartSource(value: string): value is SessionRegistryTrustedStartSource {
  return SESSION_REGISTRY_TRUSTED_START_SOURCES.includes(
    value as SessionRegistryTrustedStartSource,
  );
}

function isTrustedEndReason(value: string): value is SessionRegistryTrustedEndReason {
  return SESSION_REGISTRY_TRUSTED_END_REASONS.includes(
    value as SessionRegistryTrustedEndReason,
  );
}

function isTrustedExecutionKind(value: string): value is SessionRegistryTrustedExecutionKind {
  return SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS.includes(
    value as SessionRegistryTrustedExecutionKind,
  );
}

function isGithubRefType(value: string): value is SessionRegistryGithubRefType {
  return SESSION_REGISTRY_GITHUB_REF_TYPES.includes(value as SessionRegistryGithubRefType);
}

function isPawWorkflowStatus(value: string): value is SessionRegistryPawWorkflowStatus {
  return SESSION_REGISTRY_PAW_WORKFLOW_STATUSES.includes(
    value as SessionRegistryPawWorkflowStatus,
  );
}

function isPawWorkflowStage(value: string): value is SessionRegistryPawWorkflowStage {
  return SESSION_REGISTRY_PAW_WORKFLOW_STAGES.includes(
    value as SessionRegistryPawWorkflowStage,
  );
}

function isPawWorkflowKind(value: string): value is SessionRegistryPawWorkflowKind {
  return SESSION_REGISTRY_PAW_WORKFLOW_KINDS.includes(
    value as SessionRegistryPawWorkflowKind,
  );
}

function isPawArtifactKind(value: string): value is SessionRegistryPawArtifactKind {
  return SESSION_REGISTRY_PAW_ARTIFACT_KINDS.includes(
    value as SessionRegistryPawArtifactKind,
  );
}

function isPawWorkflowDiagnosticCode(
  value: string,
): value is SessionRegistryPawWorkflowDiagnosticCode {
  return SESSION_REGISTRY_PAW_WORKFLOW_DIAGNOSTIC_CODES.includes(
    value as SessionRegistryPawWorkflowDiagnosticCode,
  );
}

function isObservedUpsertInput(
  input: SessionRegistryUpsertInput,
): input is ObservedSessionRegistryUpsertInput {
  return input.origin.kind === "observed";
}

function parseBuilderLifecycleStatus(
  value: unknown,
  fieldName: string,
): SessionRegistryBuilderLifecycleStatus {
  const lifecycle = ensureString(value, fieldName);
  if (lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "archived") {
    throw new Error(
      `Builder-managed ${fieldName} must be active, paused, or archived, received ${lifecycle}.`,
    );
  }
  return lifecycle;
}

function parseObservedLifecycleStatus(
  value: unknown,
  fieldName: string,
): Extract<SessionRegistryLifecycleStatus, "active" | "ended"> {
  const lifecycle = ensureString(value, fieldName);
  if (lifecycle !== "active" && lifecycle !== "ended") {
    throw new Error(
      `Observed ${fieldName} must be active or ended, received ${lifecycle}.`,
    );
  }
  return lifecycle;
}

function parseCreateLifecycleStatus(
  value: unknown,
  fieldName: string,
): Extract<SessionRegistryLifecycleStatus, "active" | "paused"> {
  const lifecycle = ensureString(value, fieldName);
  if (lifecycle !== "active" && lifecycle !== "paused") {
    throw new Error(
      `Manual or launched ${fieldName} must be active or paused, received ${lifecycle}.`,
    );
  }
  return lifecycle;
}

function normalizeAiSummaryStatus(
  value: unknown,
  fieldName: string,
): SessionRegistryAiSummaryStatus {
  if (value === undefined || value === null) {
    return "missing";
  }
  const status = ensureString(value, fieldName);
  if (!isAiSummaryStatus(status)) {
    throw new Error(`Unsupported ${fieldName} "${status}".`);
  }
  return status;
}

function normalizeTitleSource(
  value: unknown,
  fieldName: string,
  fallback: SessionRegistryTitleSource,
): SessionRegistryTitleSource {
  if (value === undefined || value === null) {
    return fallback;
  }
  const source = ensureString(value, fieldName);
  if (!isTitleSource(source)) {
    throw new Error(`Unsupported ${fieldName} "${source}".`);
  }
  return source;
}

function normalizeActivityStatus(
  value: unknown,
  fieldName: string,
): SessionRegistryActivityStatus {
  if (value === undefined || value === null) {
    return "unknown";
  }
  const status = ensureString(value, fieldName);
  if (!isActivityStatus(status)) {
    throw new Error(`Unsupported ${fieldName} "${status}".`);
  }
  return status;
}

function normalizeActivityDiagnostics(
  value: unknown,
  fieldName: string,
): SessionRegistryActivityDiagnosticCode[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${fieldName} to be an array.`);
  }
  const seen = new Set<SessionRegistryActivityDiagnosticCode>();
  const diagnostics: SessionRegistryActivityDiagnosticCode[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !isActivityDiagnosticCode(entry)) {
      throw new Error(`Unsupported ${fieldName}[${index}] "${String(entry)}".`);
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      diagnostics.push(entry);
    }
  }
  return diagnostics;
}

function normalizeActivityConfidence(
  value: unknown,
  fieldName: string,
): SessionRegistryActivityConfidence {
  const confidence = ensureString(value, fieldName);
  if (!isActivityConfidence(confidence)) {
    throw new Error(`Unsupported ${fieldName} "${confidence}".`);
  }
  return confidence;
}

function normalizeActivityStatusReason(
  value: unknown,
  fieldName: string,
): SessionRegistryActivityEvidence["statusReason"] {
  const reason = ensureString(value, fieldName);
  if (!isActivityStatusReason(reason)) {
    throw new Error(`Unsupported ${fieldName} "${reason}".`);
  }
  return reason;
}

function normalizeActivityEvidence(
  value: unknown,
  fieldName: string,
): SessionRegistryActivityEvidence {
  const defaults = cloneValue(DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE);
  if (value === undefined || value === null) {
    return defaults;
  }
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object or null.`);
  }

  return {
    statusReason: hasOwn(value, "statusReason")
      ? normalizeActivityStatusReason(value.statusReason, `${fieldName}.statusReason`)
      : defaults.statusReason,
    confidence: hasOwn(value, "confidence")
      ? normalizeActivityConfidence(value.confidence, `${fieldName}.confidence`)
      : defaults.confidence,
    diagnostics: hasOwn(value, "diagnostics")
      ? normalizeActivityDiagnostics(value.diagnostics, `${fieldName}.diagnostics`)
      : defaults.diagnostics,
    pendingInputRequest: hasOwn(value, "pendingInputRequest")
      ? ensureBoolean(value.pendingInputRequest, `${fieldName}.pendingInputRequest`)
      : defaults.pendingInputRequest,
    pendingInputRequestCount: hasOwn(value, "pendingInputRequestCount")
      ? ensureNonNegativeInteger(
          value.pendingInputRequestCount,
          `${fieldName}.pendingInputRequestCount`,
        )
      : defaults.pendingInputRequestCount,
    lastUserMessageAt: hasOwn(value, "lastUserMessageAt")
      ? ensureOptionalString(value.lastUserMessageAt, `${fieldName}.lastUserMessageAt`)
      : defaults.lastUserMessageAt,
    lastAssistantTurnStartedAt: hasOwn(value, "lastAssistantTurnStartedAt")
      ? ensureOptionalString(
          value.lastAssistantTurnStartedAt,
          `${fieldName}.lastAssistantTurnStartedAt`,
        )
      : defaults.lastAssistantTurnStartedAt,
    lastAssistantTurnEndedAt: hasOwn(value, "lastAssistantTurnEndedAt")
      ? ensureOptionalString(
          value.lastAssistantTurnEndedAt,
          `${fieldName}.lastAssistantTurnEndedAt`,
        )
      : defaults.lastAssistantTurnEndedAt,
    lastActivityEventAt: hasOwn(value, "lastActivityEventAt")
      ? ensureOptionalString(value.lastActivityEventAt, `${fieldName}.lastActivityEventAt`)
      : defaults.lastActivityEventAt,
    userMessageCount: hasOwn(value, "userMessageCount")
      ? ensureNonNegativeInteger(value.userMessageCount, `${fieldName}.userMessageCount`)
      : defaults.userMessageCount,
    assistantTurnCount: hasOwn(value, "assistantTurnCount")
      ? ensureNonNegativeInteger(value.assistantTurnCount, `${fieldName}.assistantTurnCount`)
      : defaults.assistantTurnCount,
    eventsScannedAt: hasOwn(value, "eventsScannedAt")
      ? ensureOptionalString(value.eventsScannedAt, `${fieldName}.eventsScannedAt`)
      : defaults.eventsScannedAt,
    eventsOffset: hasOwn(value, "eventsOffset")
      ? ensureNonNegativeInteger(value.eventsOffset, `${fieldName}.eventsOffset`)
      : defaults.eventsOffset,
    eventsSize: hasOwn(value, "eventsSize")
      ? ensureNonNegativeInteger(value.eventsSize, `${fieldName}.eventsSize`)
      : defaults.eventsSize,
    eventsMtimeMs: hasOwn(value, "eventsMtimeMs")
      ? ensureOptionalNumber(value.eventsMtimeMs, `${fieldName}.eventsMtimeMs`)
      : defaults.eventsMtimeMs,
  };
}

function normalizeObservedSessionKind(
  value: unknown,
  fieldName: string,
): SessionRegistryObservedSessionKind | null {
  if (value === undefined || value === null) {
    return null;
  }
  const kind = ensureString(value, fieldName);
  if (!isObservedSessionKind(kind)) {
    throw new Error(`Unsupported ${fieldName} "${kind}".`);
  }
  return kind;
}

function normalizeCopilotProcessState(
  value: unknown,
  fieldName: string,
): SessionRegistryCopilotProcessState | null {
  if (value === undefined || value === null) {
    return null;
  }
  const state = ensureString(value, fieldName);
  if (!isCopilotProcessState(state)) {
    throw new Error(`Unsupported ${fieldName} "${state}".`);
  }
  return state;
}

function normalizeTrustedSignalSource(
  value: unknown,
  fieldName: string,
): SessionRegistryTrustedSignalSource | null {
  if (value === undefined || value === null) {
    return null;
  }
  const source = ensureString(value, fieldName);
  if (!isTrustedSignalSource(source)) {
    throw new Error(`Unsupported ${fieldName} "${source}".`);
  }
  return source;
}

function normalizeTrustedStartSource(
  value: unknown,
  fieldName: string,
): SessionRegistryTrustedStartSource | null {
  if (value === undefined || value === null) {
    return null;
  }
  const source = ensureString(value, fieldName);
  if (!isTrustedStartSource(source)) {
    throw new Error(`Unsupported ${fieldName} "${source}".`);
  }
  return source;
}

function normalizeTrustedEndReason(
  value: unknown,
  fieldName: string,
): SessionRegistryTrustedEndReason | null {
  if (value === undefined || value === null) {
    return null;
  }
  const reason = ensureString(value, fieldName);
  if (!isTrustedEndReason(reason)) {
    throw new Error(`Unsupported ${fieldName} "${reason}".`);
  }
  return reason;
}

function normalizeTrustedExecutionKind(
  value: unknown,
  fieldName: string,
): SessionRegistryTrustedExecutionKind | null {
  if (value === undefined || value === null) {
    return null;
  }
  const kind = ensureString(value, fieldName);
  if (!isTrustedExecutionKind(kind)) {
    throw new Error(`Unsupported ${fieldName} "${kind}".`);
  }
  return kind;
}

function normalizeGithubRef(value: unknown, fieldName: string): SessionRegistryGithubRef {
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }
  const type = ensureString(value.type, `${fieldName}.type`);
  if (!isGithubRefType(type)) {
    throw new Error(`Unsupported ${fieldName}.type "${type}".`);
  }
  const number = ensureNonNegativeInteger(value.number, `${fieldName}.number`);
  if (number < 1) {
    throw new Error(`Expected ${fieldName}.number to be at least 1.`);
  }
  return {
    type,
    repo: ensureOptionalString(value.repo, `${fieldName}.repo`),
    number,
    url: ensureOptionalString(value.url, `${fieldName}.url`),
    firstSeenAt: ensureOptionalString(value.firstSeenAt, `${fieldName}.firstSeenAt`),
    lastSeenAt: ensureOptionalString(value.lastSeenAt, `${fieldName}.lastSeenAt`),
    source: ensureString(value.source, `${fieldName}.source`),
  };
}

function normalizeGithubRefs(value: unknown, fieldName: string): SessionRegistryGithubRef[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${fieldName} to be an array.`);
  }
  return value.map((entry, index) => normalizeGithubRef(entry, `${fieldName}[${index}]`));
}

function normalizePawWorkflowStage(
  value: unknown,
  fieldName: string,
): SessionRegistryPawWorkflowStage | null {
  if (value === undefined || value === null) {
    return null;
  }
  const stage = ensureString(value, fieldName);
  if (!isPawWorkflowStage(stage)) {
    throw new Error(`Unsupported ${fieldName} "${stage}".`);
  }
  return stage;
}

function normalizePawWorkflowDiagnosticCodes(
  value: unknown,
  fieldName: string,
): SessionRegistryPawWorkflowDiagnosticCode[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${fieldName} to be an array.`);
  }
  const seen = new Set<SessionRegistryPawWorkflowDiagnosticCode>();
  const diagnostics: SessionRegistryPawWorkflowDiagnosticCode[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !isPawWorkflowDiagnosticCode(entry)) {
      throw new Error(`Unsupported ${fieldName}[${index}] "${String(entry)}".`);
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      diagnostics.push(entry);
    }
  }
  return diagnostics;
}

function normalizePawArtifactEvidence(
  value: unknown,
  fieldName: string,
): SessionRegistryPawArtifactEvidence {
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }
  const kind = ensureString(value.kind, `${fieldName}.kind`);
  if (!isPawArtifactKind(kind)) {
    throw new Error(`Unsupported ${fieldName}.kind "${kind}".`);
  }
  return {
    path: ensureString(value.path, `${fieldName}.path`),
    kind,
    stage: normalizePawWorkflowStage(value.stage, `${fieldName}.stage`),
    mtimeMs: ensureOptionalNumber(value.mtimeMs, `${fieldName}.mtimeMs`),
  };
}

function normalizePawArtifactEvidenceList(
  value: unknown,
  fieldName: string,
): SessionRegistryPawArtifactEvidence[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${fieldName} to be an array.`);
  }
  return value.map((entry, index) =>
    normalizePawArtifactEvidence(entry, `${fieldName}[${index}]`),
  );
}

function normalizePawWorkflow(
  value: unknown,
  fieldName: string,
): SessionRegistryPawWorkflow | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object or null.`);
  }
  const status = ensureString(value.status, `${fieldName}.status`);
  if (!isPawWorkflowStatus(status)) {
    throw new Error(`Unsupported ${fieldName}.status "${status}".`);
  }
  const workflowKind = hasOwn(value, "workflowKind")
    ? ensureString(value.workflowKind, `${fieldName}.workflowKind`)
    : "unknown";
  if (!isPawWorkflowKind(workflowKind)) {
    throw new Error(`Unsupported ${fieldName}.workflowKind "${workflowKind}".`);
  }
  const artifacts = normalizePawArtifactEvidenceList(
    value.artifacts,
    `${fieldName}.artifacts`,
  );
  return {
    status,
    stage: normalizePawWorkflowStage(value.stage, `${fieldName}.stage`),
    workflowKind,
    workId: ensureOptionalString(value.workId, `${fieldName}.workId`),
    workTitle: ensureOptionalString(value.workTitle, `${fieldName}.workTitle`),
    workDir: ensureOptionalString(value.workDir, `${fieldName}.workDir`),
    candidateWorkDirs: ensureStringArray(
      value.candidateWorkDirs ?? [],
      `${fieldName}.candidateWorkDirs`,
    ),
    artifacts,
    artifactCount: ensureNonNegativeInteger(
      value.artifactCount ?? artifacts.length,
      `${fieldName}.artifactCount`,
    ),
    latestArtifactPath: ensureOptionalString(
      value.latestArtifactPath,
      `${fieldName}.latestArtifactPath`,
    ),
    latestArtifactMtimeMs: ensureOptionalNumber(
      value.latestArtifactMtimeMs,
      `${fieldName}.latestArtifactMtimeMs`,
    ),
    scannedAt: ensureOptionalString(value.scannedAt, `${fieldName}.scannedAt`),
    diagnostics: normalizePawWorkflowDiagnosticCodes(
      value.diagnostics,
      `${fieldName}.diagnostics`,
    ),
  };
}

function inferLegacyTitleSource(value: {
  title: string;
  cwd: string;
  repo: string | null;
  copilotSessionId: string | null;
  originKind: SessionRegistryOriginKind;
  observedSessionKind: SessionRegistryObservedSessionKind | null;
  trustedSignalSource: SessionRegistryTrustedSignalSource | null;
}): SessionRegistryTitleSource {
  if (value.originKind === "manual" || value.originKind === "launched") {
    return "user";
  }
  if (!value.trustedSignalSource && value.originKind !== "observed") {
    return "user";
  }

  const title = value.title.trim();
  const candidates = new Set<string>();
  const repoName = value.repo?.split("/").at(-1)?.trim();
  const cwdName = basename(value.cwd).trim();
  const helperSuffix =
    value.observedSessionKind === "helper" ? " helper session" : "";
  for (const candidate of [repoName, cwdName, value.copilotSessionId]) {
    if (candidate && candidate.trim().length > 0) {
      candidates.add(`${candidate.trim()}${helperSuffix}`);
    }
  }
  if (value.observedSessionKind === "helper") {
    candidates.add("AI helper session");
  }

  return candidates.has(title) ? "auto" : "user";
}

export function parseSessionRegistryPatch(value: unknown): SessionRegistryPatch {
  if (!isJsonObject(value)) {
    throw new Error("Expected patch to be a JSON object.");
  }
  ensureAllowedKeys(value, "patch", SESSION_REGISTRY_PATCH_KEYS);

  const patch: SessionRegistryPatch = {};
  if (hasOwn(value, "expectedVersion")) {
    patch.expectedVersion = ensureOptionalNonNegativeInteger(
      value.expectedVersion,
      "patch.expectedVersion",
    );
  }
  if (hasOwn(value, "title")) {
    patch.title = ensureString(value.title, "patch.title");
  }
  if (hasOwn(value, "description")) {
    patch.description = ensureStringField(value.description, "patch.description");
  }
  if (hasOwn(value, "color")) {
    patch.color = ensureOptionalString(value.color, "patch.color");
  }
  if (hasOwn(value, "lifecycleStatus")) {
    patch.lifecycleStatus = parseBuilderLifecycleStatus(
      value.lifecycleStatus,
      "patch.lifecycleStatus",
    );
  }
  if (hasOwn(value, "tags")) {
    patch.tags = ensureStringArray(value.tags, "patch.tags");
  }
  if (hasOwn(value, "graphBinding")) {
    patch.graphBinding = ensureOptionalGraphBinding(
      value.graphBinding,
      "patch.graphBinding",
    );
  }
  return patch;
}

export function parseSessionRegistryUpsertInput(value: unknown): SessionRegistryUpsertInput {
  if (!isJsonObject(value)) {
    throw new Error("Expected input to be a JSON object.");
  }

  const origin = parseInputOrigin(value.origin, "input.origin");
  const common = {
    ...(hasOwn(value, "id") ? { id: parseRegistryId(value.id, "input.id") } : {}),
    title: ensureString(value.title, "input.title"),
    ...(hasOwn(value, "description")
      ? { description: ensureStringField(value.description, "input.description") }
      : {}),
    ...(hasOwn(value, "color")
      ? { color: ensureOptionalString(value.color, "input.color") }
      : {}),
    cwd: ensureString(value.cwd, "input.cwd"),
    ...(hasOwn(value, "repo")
      ? { repo: ensureOptionalString(value.repo, "input.repo") }
      : {}),
    ...(hasOwn(value, "branch")
      ? { branch: ensureOptionalString(value.branch, "input.branch") }
      : {}),
    ...(hasOwn(value, "tags")
      ? { tags: ensureStringArray(value.tags, "input.tags") }
      : {}),
    ...(hasOwn(value, "graphBinding")
      ? {
          graphBinding: ensureOptionalGraphBinding(
            value.graphBinding,
            "input.graphBinding",
          ),
        }
      : {}),
  };

  if (origin.kind === "observed") {
    ensureAllowedKeys(value, "input", OBSERVED_SESSION_UPSERT_KEYS);
    return {
      ...common,
      origin,
      copilotSessionId: ensureString(value.copilotSessionId, "input.copilotSessionId"),
      ...(hasOwn(value, "lastSeenAt")
        ? { lastSeenAt: ensureOptionalString(value.lastSeenAt, "input.lastSeenAt") }
        : {}),
      ...(hasOwn(value, "lifecycleStatus")
        ? {
            lifecycleStatus: parseObservedLifecycleStatus(
              value.lifecycleStatus,
              "input.lifecycleStatus",
            ),
          }
        : {}),
      ...(hasOwn(value, "observedSessionKind")
        ? {
            observedSessionKind: normalizeObservedSessionKind(
              value.observedSessionKind,
              "input.observedSessionKind",
            ),
          }
        : {}),
      ...(hasOwn(value, "copilotProcessState")
        ? {
            copilotProcessState: normalizeCopilotProcessState(
              value.copilotProcessState,
              "input.copilotProcessState",
            ),
          }
        : {}),
      ...(hasOwn(value, "copilotProcessId")
        ? {
            copilotProcessId: ensureOptionalInteger(
              value.copilotProcessId,
              "input.copilotProcessId",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedSignalSource")
        ? {
            trustedSignalSource: normalizeTrustedSignalSource(
              value.trustedSignalSource,
              "input.trustedSignalSource",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedStartedAt")
        ? {
            trustedStartedAt: ensureOptionalString(
              value.trustedStartedAt,
              "input.trustedStartedAt",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedEndedAt")
        ? {
            trustedEndedAt: ensureOptionalString(
              value.trustedEndedAt,
              "input.trustedEndedAt",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedLastSignalAt")
        ? {
            trustedLastSignalAt: ensureOptionalString(
              value.trustedLastSignalAt,
              "input.trustedLastSignalAt",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedStartSource")
        ? {
            trustedStartSource: normalizeTrustedStartSource(
              value.trustedStartSource,
              "input.trustedStartSource",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedEndReason")
        ? {
            trustedEndReason: normalizeTrustedEndReason(
              value.trustedEndReason,
              "input.trustedEndReason",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedExecutionKind")
        ? {
            trustedExecutionKind: normalizeTrustedExecutionKind(
              value.trustedExecutionKind,
              "input.trustedExecutionKind",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedInitialPromptLength")
        ? {
            trustedInitialPromptLength: ensureOptionalInteger(
              value.trustedInitialPromptLength,
              "input.trustedInitialPromptLength",
            ),
          }
        : {}),
      ...(hasOwn(value, "trustedLastPromptLength")
        ? {
            trustedLastPromptLength: ensureOptionalInteger(
              value.trustedLastPromptLength,
              "input.trustedLastPromptLength",
            ),
          }
        : {}),
    };
  }

  ensureAllowedKeys(value, "input", SESSION_REGISTRY_UPSERT_BASE_KEYS);
  if (origin.kind === "manual") {
    return {
      ...common,
      origin,
      ...(hasOwn(value, "lifecycleStatus")
        ? {
            lifecycleStatus: parseCreateLifecycleStatus(
              value.lifecycleStatus,
              "input.lifecycleStatus",
            ),
          }
        : {}),
    };
  }

  return {
    ...common,
    origin,
    ...(hasOwn(value, "lifecycleStatus")
      ? {
          lifecycleStatus: parseCreateLifecycleStatus(
            value.lifecycleStatus,
            "input.lifecycleStatus",
          ),
        }
      : {}),
  };
}

function validateStoredRecord(
  rawRecord: unknown,
  filePath: string,
): StoredSessionRegistryRecord {
  if (!isJsonObject(rawRecord)) {
    throw new Error(`Expected ${filePath} to contain an object.`);
  }

  if (rawRecord.schemaVersion !== SESSION_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion in ${filePath}: ${String(rawRecord.schemaVersion)}`,
    );
  }

  const id = parseRegistryId(rawRecord.id, `${filePath}.id`);
  const expectedFileName = `${id}${ENTRY_EXTENSION}`;
  if (basename(filePath) !== expectedFileName) {
    throw new Error(
      `Entry filename ${basename(filePath)} does not match record id ${id}.`,
    );
  }

  const lifecycleStatus = ensureString(
    rawRecord.lifecycleStatus,
    `${filePath}.lifecycleStatus`,
  );
  if (!isLifecycleStatus(lifecycleStatus)) {
    throw new Error(`Unsupported lifecycleStatus "${lifecycleStatus}" in ${filePath}.`);
  }

  const tagsValue = rawRecord.tags;
  if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string")) {
    throw new Error(`Expected ${filePath}.tags to be an array of strings.`);
  }

  const origin = preserveValidatedOrigin(rawRecord.origin, `${filePath}.origin`);
  const copilotSessionId = ensureOptionalString(
    rawRecord.copilotSessionId,
    `${filePath}.copilotSessionId`,
  );
  if (origin.kind === "observed" && !copilotSessionId) {
    throw new Error(`Observed record ${filePath} is missing copilotSessionId.`);
  }

  const storedRecord: StoredSessionRegistryRecord = {
    ...rawRecord,
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    id,
    version:
      typeof rawRecord.version === "number" &&
      Number.isInteger(rawRecord.version) &&
      rawRecord.version >= 0
        ? rawRecord.version
        : 0,
    title: ensureString(rawRecord.title, `${filePath}.title`),
    titleSource: normalizeTitleSource(
      rawRecord.titleSource,
      `${filePath}.titleSource`,
      inferLegacyTitleSource({
        title: typeof rawRecord.title === "string" ? rawRecord.title : "",
        cwd: typeof rawRecord.cwd === "string" ? rawRecord.cwd : "",
        repo: typeof rawRecord.repo === "string" ? rawRecord.repo : null,
        copilotSessionId,
        originKind: origin.kind,
        observedSessionKind:
          typeof rawRecord.observedSessionKind === "string" &&
          isObservedSessionKind(rawRecord.observedSessionKind)
            ? rawRecord.observedSessionKind
            : null,
        trustedSignalSource:
          typeof rawRecord.trustedSignalSource === "string" &&
          isTrustedSignalSource(rawRecord.trustedSignalSource)
            ? rawRecord.trustedSignalSource
            : null,
      }),
    ),
    description:
      typeof rawRecord.description === "string" ? rawRecord.description : "",
    color: ensureOptionalString(rawRecord.color, `${filePath}.color`),
    cwd: ensureString(rawRecord.cwd, `${filePath}.cwd`),
    repo: ensureOptionalString(rawRecord.repo, `${filePath}.repo`),
    branch: ensureOptionalString(rawRecord.branch, `${filePath}.branch`),
    copilotSessionId,
    lifecycleStatus,
    lastSeenAt: ensureOptionalString(rawRecord.lastSeenAt, `${filePath}.lastSeenAt`),
    createdAt: ensureString(rawRecord.createdAt, `${filePath}.createdAt`),
    updatedAt: ensureString(rawRecord.updatedAt, `${filePath}.updatedAt`),
    tags: normalizeTags(tagsValue),
    origin,
    graphBinding: (() => {
      const typedGraphBinding = ensureOptionalGraphBinding(
        rawRecord.graphBinding,
        `${filePath}.graphBinding`,
      );
      if (!typedGraphBinding || !isJsonObject(rawRecord.graphBinding)) {
        return typedGraphBinding;
      }

      return {
        ...(rawRecord.graphBinding as JsonObject),
        ...typedGraphBinding,
        } as SessionRegistryGraphBinding;
      })(),
    aiSummary: ensureOptionalString(rawRecord.aiSummary, `${filePath}.aiSummary`),
    aiSummaryModel: ensureOptionalString(rawRecord.aiSummaryModel, `${filePath}.aiSummaryModel`),
    aiSummaryUpdatedAt: ensureOptionalString(
      rawRecord.aiSummaryUpdatedAt,
      `${filePath}.aiSummaryUpdatedAt`,
    ),
    aiSummaryEventsFingerprint: ensureOptionalString(
      rawRecord.aiSummaryEventsFingerprint,
      `${filePath}.aiSummaryEventsFingerprint`,
    ),
    aiSummaryStatus: normalizeAiSummaryStatus(
      rawRecord.aiSummaryStatus,
      `${filePath}.aiSummaryStatus`,
    ),
    aiSummaryError: ensureOptionalString(
      rawRecord.aiSummaryError,
      `${filePath}.aiSummaryError`,
    ),
    observedSessionKind: normalizeObservedSessionKind(
      rawRecord.observedSessionKind,
      `${filePath}.observedSessionKind`,
    ),
    copilotProcessState: normalizeCopilotProcessState(
      rawRecord.copilotProcessState,
      `${filePath}.copilotProcessState`,
    ),
    copilotProcessId: ensureOptionalInteger(
      rawRecord.copilotProcessId,
      `${filePath}.copilotProcessId`,
    ),
    activityStatus: normalizeActivityStatus(
      rawRecord.activityStatus,
      `${filePath}.activityStatus`,
    ),
    activityStatusUpdatedAt: ensureOptionalString(
      rawRecord.activityStatusUpdatedAt,
      `${filePath}.activityStatusUpdatedAt`,
    ),
    activityEvidence: normalizeActivityEvidence(
      rawRecord.activityEvidence,
      `${filePath}.activityEvidence`,
    ),
    pawWorkflow: normalizePawWorkflow(rawRecord.pawWorkflow, `${filePath}.pawWorkflow`),
    trustedSignalSource: normalizeTrustedSignalSource(
      rawRecord.trustedSignalSource,
      `${filePath}.trustedSignalSource`,
    ),
    trustedStartedAt: ensureOptionalString(
      rawRecord.trustedStartedAt,
      `${filePath}.trustedStartedAt`,
    ),
    trustedEndedAt: ensureOptionalString(
      rawRecord.trustedEndedAt,
      `${filePath}.trustedEndedAt`,
    ),
    trustedLastSignalAt: ensureOptionalString(
      rawRecord.trustedLastSignalAt,
      `${filePath}.trustedLastSignalAt`,
    ),
    trustedStartSource: normalizeTrustedStartSource(
      rawRecord.trustedStartSource,
      `${filePath}.trustedStartSource`,
    ),
    trustedEndReason: normalizeTrustedEndReason(
      rawRecord.trustedEndReason,
      `${filePath}.trustedEndReason`,
    ),
    trustedExecutionKind: normalizeTrustedExecutionKind(
      rawRecord.trustedExecutionKind,
      `${filePath}.trustedExecutionKind`,
    ),
    trustedInitialPromptLength: ensureOptionalInteger(
      rawRecord.trustedInitialPromptLength,
      `${filePath}.trustedInitialPromptLength`,
    ),
    trustedLastPromptLength: ensureOptionalInteger(
      rawRecord.trustedLastPromptLength,
      `${filePath}.trustedLastPromptLength`,
    ),
    derivedWorktreePath: ensureOptionalString(
      rawRecord.derivedWorktreePath,
      `${filePath}.derivedWorktreePath`,
    ),
    derivedBranch: ensureOptionalString(rawRecord.derivedBranch, `${filePath}.derivedBranch`),
    derivedGithubRefs: normalizeGithubRefs(
      rawRecord.derivedGithubRefs,
      `${filePath}.derivedGithubRefs`,
    ),
    derivedContextUpdatedAt: ensureOptionalString(
      rawRecord.derivedContextUpdatedAt,
      `${filePath}.derivedContextUpdatedAt`,
    ),
    derivedContextEventsOffset: ensureNonNegativeInteger(
      rawRecord.derivedContextEventsOffset,
      `${filePath}.derivedContextEventsOffset`,
    ),
    derivedContextEventsSize: ensureNonNegativeInteger(
      rawRecord.derivedContextEventsSize,
      `${filePath}.derivedContextEventsSize`,
    ),
    derivedContextEventsMtimeMs: ensureOptionalNumber(
      rawRecord.derivedContextEventsMtimeMs,
      `${filePath}.derivedContextEventsMtimeMs`,
    ),
  };

  return storedRecord;
}

function validateIndexEntry(
  rawEntry: unknown,
  fieldName: string,
): SessionRegistryIndexEntry {
  if (!isJsonObject(rawEntry)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  const lifecycleStatus = ensureString(rawEntry.lifecycleStatus, `${fieldName}.lifecycleStatus`);
  if (!isLifecycleStatus(lifecycleStatus)) {
    throw new Error(`Unsupported ${fieldName}.lifecycleStatus "${lifecycleStatus}".`);
  }

  const originKind = ensureString(rawEntry.originKind, `${fieldName}.originKind`) as SessionRegistryOriginKind;
  if (!SESSION_REGISTRY_ORIGIN_KINDS.includes(originKind)) {
    throw new Error(`Unsupported ${fieldName}.originKind "${originKind}".`);
  }

  return {
    id: ensureString(rawEntry.id, `${fieldName}.id`),
    version: ensureNonNegativeInteger(rawEntry.version, `${fieldName}.version`),
    title: ensureString(rawEntry.title, `${fieldName}.title`),
    titleSource: normalizeTitleSource(
      rawEntry.titleSource,
      `${fieldName}.titleSource`,
      inferLegacyTitleSource({
        title: typeof rawEntry.title === "string" ? rawEntry.title : "",
        cwd: typeof rawEntry.cwd === "string" ? rawEntry.cwd : "",
        repo: typeof rawEntry.repo === "string" ? rawEntry.repo : null,
        copilotSessionId:
          typeof rawEntry.copilotSessionId === "string"
            ? rawEntry.copilotSessionId
            : null,
        originKind,
        observedSessionKind:
          typeof rawEntry.observedSessionKind === "string" &&
          isObservedSessionKind(rawEntry.observedSessionKind)
            ? rawEntry.observedSessionKind
            : null,
        trustedSignalSource:
          typeof rawEntry.trustedSignalSource === "string" &&
          isTrustedSignalSource(rawEntry.trustedSignalSource)
            ? rawEntry.trustedSignalSource
            : null,
      }),
    ),
    description: ensureStringField(rawEntry.description, `${fieldName}.description`),
    lifecycleStatus,
    lastSeenAt: ensureOptionalString(rawEntry.lastSeenAt, `${fieldName}.lastSeenAt`),
    updatedAt: ensureString(rawEntry.updatedAt, `${fieldName}.updatedAt`),
    color: ensureOptionalString(rawEntry.color, `${fieldName}.color`),
    cwd: ensureString(rawEntry.cwd, `${fieldName}.cwd`),
    repo: ensureOptionalString(rawEntry.repo, `${fieldName}.repo`),
    branch: ensureOptionalString(rawEntry.branch, `${fieldName}.branch`),
    copilotSessionId: ensureOptionalString(
      rawEntry.copilotSessionId,
      `${fieldName}.copilotSessionId`,
    ),
    tags: ensureStringArray(rawEntry.tags, `${fieldName}.tags`),
    originKind,
    graphBinding: ensureOptionalGraphBinding(rawEntry.graphBinding, `${fieldName}.graphBinding`),
    aiSummary: ensureOptionalString(rawEntry.aiSummary, `${fieldName}.aiSummary`),
    aiSummaryModel: ensureOptionalString(rawEntry.aiSummaryModel, `${fieldName}.aiSummaryModel`),
    aiSummaryUpdatedAt: ensureOptionalString(
      rawEntry.aiSummaryUpdatedAt,
      `${fieldName}.aiSummaryUpdatedAt`,
    ),
    aiSummaryEventsFingerprint: ensureOptionalString(
      rawEntry.aiSummaryEventsFingerprint,
      `${fieldName}.aiSummaryEventsFingerprint`,
    ),
    aiSummaryStatus: normalizeAiSummaryStatus(
      rawEntry.aiSummaryStatus,
      `${fieldName}.aiSummaryStatus`,
    ),
    aiSummaryError: ensureOptionalString(
      rawEntry.aiSummaryError,
      `${fieldName}.aiSummaryError`,
    ),
    observedSessionKind: normalizeObservedSessionKind(
      rawEntry.observedSessionKind,
      `${fieldName}.observedSessionKind`,
    ),
    copilotProcessState: normalizeCopilotProcessState(
      rawEntry.copilotProcessState,
      `${fieldName}.copilotProcessState`,
    ),
    copilotProcessId: ensureOptionalInteger(
      rawEntry.copilotProcessId,
      `${fieldName}.copilotProcessId`,
    ),
    activityStatus: normalizeActivityStatus(
      rawEntry.activityStatus,
      `${fieldName}.activityStatus`,
    ),
    activityStatusUpdatedAt: ensureOptionalString(
      rawEntry.activityStatusUpdatedAt,
      `${fieldName}.activityStatusUpdatedAt`,
    ),
    activityEvidence: normalizeActivityEvidence(
      rawEntry.activityEvidence,
      `${fieldName}.activityEvidence`,
    ),
    pawWorkflow: normalizePawWorkflow(rawEntry.pawWorkflow, `${fieldName}.pawWorkflow`),
    trustedSignalSource: normalizeTrustedSignalSource(
      rawEntry.trustedSignalSource,
      `${fieldName}.trustedSignalSource`,
    ),
    trustedStartedAt: ensureOptionalString(
      rawEntry.trustedStartedAt,
      `${fieldName}.trustedStartedAt`,
    ),
    trustedEndedAt: ensureOptionalString(
      rawEntry.trustedEndedAt,
      `${fieldName}.trustedEndedAt`,
    ),
    trustedLastSignalAt: ensureOptionalString(
      rawEntry.trustedLastSignalAt,
      `${fieldName}.trustedLastSignalAt`,
    ),
    trustedStartSource: normalizeTrustedStartSource(
      rawEntry.trustedStartSource,
      `${fieldName}.trustedStartSource`,
    ),
    trustedEndReason: normalizeTrustedEndReason(
      rawEntry.trustedEndReason,
      `${fieldName}.trustedEndReason`,
    ),
    trustedExecutionKind: normalizeTrustedExecutionKind(
      rawEntry.trustedExecutionKind,
      `${fieldName}.trustedExecutionKind`,
    ),
    trustedInitialPromptLength: ensureOptionalInteger(
      rawEntry.trustedInitialPromptLength,
      `${fieldName}.trustedInitialPromptLength`,
    ),
    trustedLastPromptLength: ensureOptionalInteger(
      rawEntry.trustedLastPromptLength,
      `${fieldName}.trustedLastPromptLength`,
    ),
    derivedWorktreePath: ensureOptionalString(
      rawEntry.derivedWorktreePath,
      `${fieldName}.derivedWorktreePath`,
    ),
    derivedBranch: ensureOptionalString(rawEntry.derivedBranch, `${fieldName}.derivedBranch`),
    derivedGithubRefs: normalizeGithubRefs(
      rawEntry.derivedGithubRefs,
      `${fieldName}.derivedGithubRefs`,
    ),
    derivedContextUpdatedAt: ensureOptionalString(
      rawEntry.derivedContextUpdatedAt,
      `${fieldName}.derivedContextUpdatedAt`,
    ),
    derivedContextEventsOffset: ensureNonNegativeInteger(
      rawEntry.derivedContextEventsOffset,
      `${fieldName}.derivedContextEventsOffset`,
    ),
    derivedContextEventsSize: ensureNonNegativeInteger(
      rawEntry.derivedContextEventsSize,
      `${fieldName}.derivedContextEventsSize`,
    ),
    derivedContextEventsMtimeMs: ensureOptionalNumber(
      rawEntry.derivedContextEventsMtimeMs,
      `${fieldName}.derivedContextEventsMtimeMs`,
    ),
  };
}

function validateIndex(rawIndex: unknown, filePath: string): SessionRegistryIndex {
  if (!isJsonObject(rawIndex)) {
    throw new Error(`Expected ${filePath} to contain an object.`);
  }
  if (rawIndex.schemaVersion !== SESSION_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion in ${filePath}: ${String(rawIndex.schemaVersion)}`,
    );
  }
  if (!Array.isArray(rawIndex.entries)) {
    throw new Error(`Expected ${filePath}.entries to be an array.`);
  }

  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    updatedAt: ensureString(rawIndex.updatedAt, `${filePath}.updatedAt`),
    entries: rawIndex.entries.map((entry, index) =>
      validateIndexEntry(entry, `${filePath}.entries[${index}]`),
    ),
  };
}

function computeIndexEntriesSignature(entries: readonly SessionRegistryIndexEntry[]): string {
  return JSON.stringify(entries);
}

function buildIndex(records: Iterable<StoredSessionRegistryRecord>): SessionRegistryIndex {
  const entries = [...records].map<SessionRegistryIndexEntry>((record) => ({
    id: record.id,
    version: record.version,
    title: record.title,
    titleSource: record.titleSource,
    description: record.description,
    lifecycleStatus: record.lifecycleStatus,
    lastSeenAt: record.lastSeenAt,
    updatedAt: record.updatedAt,
    color: record.color,
    cwd: record.cwd,
    repo: record.repo,
    branch: record.branch,
    copilotSessionId: record.copilotSessionId,
    tags: cloneValue(record.tags),
    originKind: record.origin.kind,
    graphBinding: record.graphBinding ? cloneValue(record.graphBinding) : null,
    aiSummary: record.aiSummary,
    aiSummaryModel: record.aiSummaryModel,
    aiSummaryUpdatedAt: record.aiSummaryUpdatedAt,
    aiSummaryEventsFingerprint: record.aiSummaryEventsFingerprint,
    aiSummaryStatus: record.aiSummaryStatus,
    aiSummaryError: record.aiSummaryError,
    observedSessionKind: record.observedSessionKind,
    copilotProcessState: record.copilotProcessState,
    copilotProcessId: record.copilotProcessId,
    activityStatus: record.activityStatus,
    activityStatusUpdatedAt: record.activityStatusUpdatedAt,
    activityEvidence: cloneValue(record.activityEvidence),
    pawWorkflow: record.pawWorkflow ? cloneValue(record.pawWorkflow) : null,
    trustedSignalSource: record.trustedSignalSource,
    trustedStartedAt: record.trustedStartedAt,
    trustedEndedAt: record.trustedEndedAt,
    trustedLastSignalAt: record.trustedLastSignalAt,
    trustedStartSource: record.trustedStartSource,
    trustedEndReason: record.trustedEndReason,
    trustedExecutionKind: record.trustedExecutionKind,
    trustedInitialPromptLength: record.trustedInitialPromptLength,
    trustedLastPromptLength: record.trustedLastPromptLength,
    derivedWorktreePath: record.derivedWorktreePath,
    derivedBranch: record.derivedBranch,
    derivedGithubRefs: cloneValue(record.derivedGithubRefs),
    derivedContextUpdatedAt: record.derivedContextUpdatedAt,
    derivedContextEventsOffset: record.derivedContextEventsOffset,
    derivedContextEventsSize: record.derivedContextEventsSize,
    derivedContextEventsMtimeMs: record.derivedContextEventsMtimeMs,
  }));
  entries.sort(compareByFreshness);

  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    updatedAt: isoNow(),
    entries,
  };
}

function compareByFreshness(
  left: Pick<SessionRegistryListItem, "lastSeenAt" | "updatedAt" | "trustedLastSignalAt">,
  right: Pick<SessionRegistryListItem, "lastSeenAt" | "updatedAt" | "trustedLastSignalAt">,
): number {
  // Use the most recent of (trustedLastSignalAt, lastSeenAt, updatedAt) as
  // the freshness key. The discovery worker tracks lastSeenAt from
  // workspace.yaml mtime, which lags real user activity by minutes/hours
  // for sessions that aren't constantly writing turns to disk. Trusted
  // hook signals (prompt.submitted, session.started, session.ended) are
  // the truest signal of "this session was just used."
  const leftKey = freshnessKey(left);
  const rightKey = freshnessKey(right);
  return rightKey - leftKey;
}

function freshnessKey(
  entry: Pick<SessionRegistryListItem, "lastSeenAt" | "updatedAt" | "trustedLastSignalAt">,
): number {
  const candidates = [entry.trustedLastSignalAt, entry.lastSeenAt, entry.updatedAt]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return candidates.length > 0 ? Math.max(...candidates) : Number.NEGATIVE_INFINITY;
}

function matchesText(
  record: Pick<
    SessionRegistryIndexEntry,
    | "title"
    | "description"
    | "aiSummary"
    | "tags"
    | "cwd"
    | "repo"
    | "branch"
    | "derivedBranch"
    | "derivedWorktreePath"
    | "derivedGithubRefs"
    | "pawWorkflow"
  >,
  text: string,
): boolean {
  const refs = record.derivedGithubRefs.map((ref) =>
    [ref.repo, ref.type, `#${ref.number}`, `${ref.type} #${ref.number}`]
      .filter(Boolean)
      .join(" "),
  );
  const pawWorkflowHaystacks = record.pawWorkflow
    ? [
        record.pawWorkflow.status,
        record.pawWorkflow.stage ?? "",
        record.pawWorkflow.workflowKind,
        record.pawWorkflow.workId ?? "",
        record.pawWorkflow.workTitle ?? "",
        record.pawWorkflow.workDir ?? "",
        ...record.pawWorkflow.diagnostics,
      ]
    : [];
  const haystacks = [
    record.title,
    record.description,
    record.aiSummary ?? "",
    record.cwd,
    record.repo ?? "",
    record.branch ?? "",
    record.derivedBranch ?? "",
    record.derivedWorktreePath ?? "",
    ...refs,
    ...pawWorkflowHaystacks,
    ...record.tags,
  ];
  return haystacks.some((value) => value.toLowerCase().includes(text));
}

function mergeStoredRecord(
  existingRecord: StoredSessionRegistryRecord | undefined,
  nextRecord: SessionRegistryRecord,
): StoredSessionRegistryRecord {
  const nextOrigin = existingRecord?.origin && isJsonObject(existingRecord.origin)
    ? { ...(existingRecord.origin as JsonObject), ...nextRecord.origin }
    : nextRecord.origin;

  const nextGraphBinding =
    existingRecord?.graphBinding && isJsonObject(existingRecord.graphBinding) && nextRecord.graphBinding
      ? {
          ...(existingRecord.graphBinding as JsonObject),
          ...nextRecord.graphBinding,
        }
      : nextRecord.graphBinding;

  return {
    ...(existingRecord ?? {}),
    ...nextRecord,
    origin: nextOrigin,
    graphBinding: nextGraphBinding,
  };
}

function activityEvidenceForTrustedSignal(
  base: SessionRegistryActivityEvidence | undefined,
  statusReason: SessionRegistryActivityEvidence["statusReason"],
  timestamp: string,
): SessionRegistryActivityEvidence {
  return buildSessionRegistryActivityEvidence(
    {
      statusReason,
      confidence: "high",
      diagnostics: [],
      pendingInputRequest: false,
      pendingInputRequestCount: 0,
      lastActivityEventAt: timestamp,
    },
    base ? cloneValue(base) : DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  );
}

function getBuilderConflictFields(patch: SessionRegistryPatch): string[] {
  const fields: string[] = [];
  for (const key of SESSION_REGISTRY_PATCH_KEYS) {
    if (key === "expectedVersion") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      fields.push(key);
    }
  }
  return fields;
}

function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  renameWithRetries(tempPath, path);
}

function optionalNullableFilterApplied<T>(
  options: SessionRegistryListOptions,
  key: "repo",
  currentValue: T,
): boolean {
  return Object.prototype.hasOwnProperty.call(options, key) && currentValue !== options[key];
}

export class SessionRegistryFileStore implements SessionRegistryStore {
  private readonly entriesDir: string;
  private readonly quarantineDir: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly recoveryLockPath: string;
  private readonly writeLockWaitTimeoutMs: number;
  private readonly listeners = new Set<SessionRegistryChangeListener>();

  private records = new Map<string, StoredSessionRegistryRecord>();
  private index: SessionRegistryIndex = buildIndex([]);
  private lastSignature = "";
  private lastDiskFingerprint = "";
  private loaded = false;

  /**
   * Per-file (filename → "mtimeMs:size") snapshot of the entries directory.
   * Used by loadEntriesFromDisk to skip re-reading 1000+ JSON files when
   * nothing has changed externally. Updated incrementally in persistEntry /
   * deleteSession so write paths don't pay the read cost either.
   */
  private cachedEntryFingerprints: Map<string, string> | null = null;
  private cachedEntryRecords: Map<string, StoredSessionRegistryRecord> | null = null;

  constructor(options?: SessionRegistryFileStoreOptions) {
    const resolvedRoot = resolve(options?.rootDir ?? DEFAULT_REGISTRY_ROOT);
    this.entriesDir = join(resolvedRoot, "entries");
    this.quarantineDir = join(resolvedRoot, "quarantine");
    this.indexPath = join(resolvedRoot, "index.json");
    this.lockPath = join(resolvedRoot, "registry.lock");
    this.recoveryLockPath = join(resolvedRoot, "registry.lock.recovery");
    this.writeLockWaitTimeoutMs =
      options?.writeLockWaitTimeoutMs ?? WRITE_LOCK_WAIT_TIMEOUT_MS;
  }

  listSessions(options: SessionRegistryListOptions = {}): SessionRegistryListItem[] {
    this.refreshFromDisk();

    const text = options.text?.trim().toLowerCase();
    const items = this.index.entries
      .filter((entry) => options.includeArchived || entry.lifecycleStatus !== "archived")
      .filter((entry) => (text ? matchesText(entry, text) : true))
      .filter((entry) =>
        optionalNullableFilterApplied(options, "repo", entry.repo) ? false : true,
      )
      .filter((entry) =>
        options.workstreamId
          ? entry.graphBinding?.workstreamId === options.workstreamId
          : true,
      )
      .filter((entry) =>
        options.nodeId ? entry.graphBinding?.nodeId === options.nodeId : true,
      );

    return items.map((item) => cloneValue(item));
  }

  getSession(id: string): SessionRegistryRecord | null {
    this.refreshFromDisk();
    const record = this.records.get(id);
    return record ? cloneValue(record) : null;
  }

  upsertSession(input: SessionRegistryUpsertInput): SessionRegistryRecord {
    const validatedInput = parseSessionRegistryUpsertInput(input);
    const nextRepo = validatedInput.repo ?? null;
    const nextBranch = validatedInput.branch ?? null;
    let nextTitle = validatedInput.title;
    let nextTitleSource: SessionRegistryTitleSource =
      validatedInput.origin.kind === "observed" ? "auto" : "user";
    let nextDescription = validatedInput.description ?? "";
    let nextColor = validatedInput.color ?? null;
    let nextTags = normalizeTags(validatedInput.tags);
    let nextGraphBinding = validatedInput.graphBinding ?? null;

    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      let targetId = validatedInput.id ?? randomUUID();
      let latestRecord = records.get(targetId);
      let nextCopilotSessionId = latestRecord?.copilotSessionId ?? null;
      let nextLastSeenAt = latestRecord?.lastSeenAt ?? null;
      let nextObservedSessionKind = latestRecord?.observedSessionKind ?? null;
      let nextCopilotProcessState = latestRecord?.copilotProcessState ?? null;
      let nextCopilotProcessId = latestRecord?.copilotProcessId ?? null;
      let nextActivityStatus = latestRecord?.activityStatus ?? "unknown";
      let nextActivityStatusUpdatedAt = latestRecord?.activityStatusUpdatedAt ?? null;
      let nextActivityEvidence = latestRecord?.activityEvidence
        ? cloneValue(latestRecord.activityEvidence)
        : cloneValue(DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE);
      let nextPawWorkflow = latestRecord?.pawWorkflow
        ? cloneValue(latestRecord.pawWorkflow)
        : null;
      let nextTrustedSignalSource = latestRecord?.trustedSignalSource ?? null;
      let nextTrustedStartedAt = latestRecord?.trustedStartedAt ?? null;
      let nextTrustedEndedAt = latestRecord?.trustedEndedAt ?? null;
      let nextTrustedLastSignalAt = latestRecord?.trustedLastSignalAt ?? null;
      let nextTrustedStartSource = latestRecord?.trustedStartSource ?? null;
      let nextTrustedEndReason = latestRecord?.trustedEndReason ?? null;
      let nextTrustedExecutionKind = latestRecord?.trustedExecutionKind ?? null;
      let nextTrustedInitialPromptLength =
        latestRecord?.trustedInitialPromptLength ?? null;
      let nextTrustedLastPromptLength =
        latestRecord?.trustedLastPromptLength ?? null;

      if (isObservedUpsertInput(validatedInput)) {
        targetId =
          validatedInput.id ??
          this.findRecordIdByCopilotSessionId(records, validatedInput.copilotSessionId) ??
          targetId;
        latestRecord = records.get(targetId);
        if (latestRecord) {
          nextTitleSource = latestRecord.titleSource;
          nextTitle =
            latestRecord.titleSource === "auto" ? validatedInput.title : latestRecord.title;
          nextDescription = latestRecord.description;
          nextColor = latestRecord.color;
          nextTags = cloneValue(latestRecord.tags);
          nextGraphBinding = latestRecord.graphBinding
            ? cloneValue(latestRecord.graphBinding)
            : null;
        }
        nextCopilotSessionId = validatedInput.copilotSessionId;
        nextLastSeenAt =
          Object.prototype.hasOwnProperty.call(validatedInput, "lastSeenAt")
            ? validatedInput.lastSeenAt ?? null
            : latestRecord?.lastSeenAt ?? null;
        nextObservedSessionKind =
          Object.prototype.hasOwnProperty.call(validatedInput, "observedSessionKind")
            ? validatedInput.observedSessionKind ?? null
            : latestRecord?.observedSessionKind ?? null;
        nextCopilotProcessState =
          Object.prototype.hasOwnProperty.call(validatedInput, "copilotProcessState")
            ? validatedInput.copilotProcessState ?? null
            : latestRecord?.copilotProcessState ?? null;
        nextCopilotProcessId =
          Object.prototype.hasOwnProperty.call(validatedInput, "copilotProcessId")
            ? validatedInput.copilotProcessId ?? null
            : latestRecord?.copilotProcessId ?? null;
        nextActivityStatus = latestRecord?.activityStatus ?? "unknown";
        nextActivityStatusUpdatedAt = latestRecord?.activityStatusUpdatedAt ?? null;
        nextActivityEvidence = latestRecord?.activityEvidence
          ? cloneValue(latestRecord.activityEvidence)
          : cloneValue(DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE);
        nextPawWorkflow = latestRecord?.pawWorkflow
          ? cloneValue(latestRecord.pawWorkflow)
          : null;
        nextTrustedSignalSource =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedSignalSource")
            ? validatedInput.trustedSignalSource ?? null
            : latestRecord?.trustedSignalSource ?? null;
        nextTrustedStartedAt =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedStartedAt")
            ? validatedInput.trustedStartedAt ?? null
            : latestRecord?.trustedStartedAt ?? null;
        nextTrustedEndedAt =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedEndedAt")
            ? validatedInput.trustedEndedAt ?? null
            : latestRecord?.trustedEndedAt ?? null;
        nextTrustedLastSignalAt =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedLastSignalAt")
            ? validatedInput.trustedLastSignalAt ?? null
            : latestRecord?.trustedLastSignalAt ?? null;
        nextTrustedStartSource =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedStartSource")
            ? validatedInput.trustedStartSource ?? null
            : latestRecord?.trustedStartSource ?? null;
        nextTrustedEndReason =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedEndReason")
            ? validatedInput.trustedEndReason ?? null
            : latestRecord?.trustedEndReason ?? null;
        nextTrustedExecutionKind =
          Object.prototype.hasOwnProperty.call(validatedInput, "trustedExecutionKind")
            ? validatedInput.trustedExecutionKind ?? null
            : latestRecord?.trustedExecutionKind ?? null;
        nextTrustedInitialPromptLength =
          Object.prototype.hasOwnProperty.call(
            validatedInput,
            "trustedInitialPromptLength",
          )
            ? validatedInput.trustedInitialPromptLength ?? null
            : latestRecord?.trustedInitialPromptLength ?? null;
        nextTrustedLastPromptLength =
          Object.prototype.hasOwnProperty.call(
            validatedInput,
            "trustedLastPromptLength",
          )
            ? validatedInput.trustedLastPromptLength ?? null
            : latestRecord?.trustedLastPromptLength ?? null;
      } else {
        nextTitleSource = "user";
        nextObservedSessionKind = null;
        nextCopilotProcessState = null;
        nextCopilotProcessId = null;
        nextActivityStatus = latestRecord?.activityStatus ?? "unknown";
        nextActivityStatusUpdatedAt = latestRecord?.activityStatusUpdatedAt ?? null;
        nextActivityEvidence = latestRecord?.activityEvidence
          ? cloneValue(latestRecord.activityEvidence)
          : cloneValue(DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE);
        nextPawWorkflow = latestRecord?.pawWorkflow
          ? cloneValue(latestRecord.pawWorkflow)
          : null;
        nextTrustedSignalSource = null;
        nextTrustedStartedAt = null;
        nextTrustedEndedAt = null;
        nextTrustedLastSignalAt = null;
        nextTrustedStartSource = null;
        nextTrustedEndReason = null;
        nextTrustedExecutionKind = null;
        nextTrustedInitialPromptLength = null;
        nextTrustedLastPromptLength = null;
      }

      const nextLifecycle = this.resolveUpsertLifecycle(latestRecord, validatedInput);
      const nextRecord: SessionRegistryRecord = {
        schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
        id: targetId,
        version: latestRecord?.version ?? 0,
        title: nextTitle,
        titleSource: nextTitleSource,
        description: nextDescription,
        color: nextColor,
        cwd: validatedInput.cwd,
        repo: nextRepo,
        branch: nextBranch,
        copilotSessionId: nextCopilotSessionId,
        lifecycleStatus: nextLifecycle,
        lastSeenAt: nextLastSeenAt,
        createdAt: latestRecord?.createdAt ?? isoNow(),
        updatedAt: isoNow(),
        tags: nextTags,
        origin: cloneValue(validatedInput.origin),
        graphBinding: nextGraphBinding,
        aiSummary: latestRecord?.aiSummary ?? null,
        aiSummaryModel: latestRecord?.aiSummaryModel ?? null,
        aiSummaryUpdatedAt: latestRecord?.aiSummaryUpdatedAt ?? null,
        aiSummaryEventsFingerprint: latestRecord?.aiSummaryEventsFingerprint ?? null,
        aiSummaryStatus: latestRecord?.aiSummaryStatus ?? "missing",
        aiSummaryError: latestRecord?.aiSummaryError ?? null,
        observedSessionKind: nextObservedSessionKind,
        copilotProcessState: nextCopilotProcessState,
        copilotProcessId: nextCopilotProcessId,
        activityStatus: nextActivityStatus,
        activityStatusUpdatedAt: nextActivityStatusUpdatedAt,
        activityEvidence: nextActivityEvidence,
        pawWorkflow: nextPawWorkflow,
        trustedSignalSource: nextTrustedSignalSource,
        trustedStartedAt: nextTrustedStartedAt,
        trustedEndedAt: nextTrustedEndedAt,
        trustedLastSignalAt: nextTrustedLastSignalAt,
        trustedStartSource: nextTrustedStartSource,
        trustedEndReason: nextTrustedEndReason,
        trustedExecutionKind: nextTrustedExecutionKind,
        trustedInitialPromptLength: nextTrustedInitialPromptLength,
        trustedLastPromptLength: nextTrustedLastPromptLength,
        derivedWorktreePath: latestRecord?.derivedWorktreePath ?? null,
        derivedBranch: latestRecord?.derivedBranch ?? null,
        derivedGithubRefs: cloneValue(latestRecord?.derivedGithubRefs ?? []),
        derivedContextUpdatedAt: latestRecord?.derivedContextUpdatedAt ?? null,
        derivedContextEventsOffset: latestRecord?.derivedContextEventsOffset ?? 0,
        derivedContextEventsSize: latestRecord?.derivedContextEventsSize ?? 0,
        derivedContextEventsMtimeMs: latestRecord?.derivedContextEventsMtimeMs ?? null,
      };

      const storedRecord = mergeStoredRecord(latestRecord, nextRecord);
      records.set(targetId, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: targetId,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  attachObservedSession(
    id: string,
    observation: SessionRegistryObservedLinkInput,
  ): SessionRegistryRecord {
    const copilotSessionId = ensureString(
      observation.copilotSessionId,
      "observation.copilotSessionId",
    );
    const title = Object.prototype.hasOwnProperty.call(observation, "title")
      ? ensureString(observation.title, "observation.title")
      : undefined;
    const cwd = ensureString(observation.cwd, "observation.cwd");
    const repo = Object.prototype.hasOwnProperty.call(observation, "repo")
      ? ensureOptionalString(observation.repo, "observation.repo")
      : undefined;
    const branch = Object.prototype.hasOwnProperty.call(observation, "branch")
      ? ensureOptionalString(observation.branch, "observation.branch")
      : undefined;
    const lastSeenAt = Object.prototype.hasOwnProperty.call(observation, "lastSeenAt")
      ? ensureOptionalString(observation.lastSeenAt, "observation.lastSeenAt")
      : undefined;
    const lifecycleStatus = Object.prototype.hasOwnProperty.call(
      observation,
      "lifecycleStatus",
    )
      ? parseObservedLifecycleStatus(
          observation.lifecycleStatus,
          "observation.lifecycleStatus",
        )
      : undefined;
    const observedSessionKind = Object.prototype.hasOwnProperty.call(
      observation,
      "observedSessionKind",
    )
      ? normalizeObservedSessionKind(
          observation.observedSessionKind,
          "observation.observedSessionKind",
        )
      : undefined;
    const copilotProcessState = Object.prototype.hasOwnProperty.call(
      observation,
      "copilotProcessState",
    )
      ? normalizeCopilotProcessState(
          observation.copilotProcessState,
          "observation.copilotProcessState",
        )
      : undefined;
    const copilotProcessId = Object.prototype.hasOwnProperty.call(
      observation,
      "copilotProcessId",
    )
      ? ensureOptionalInteger(observation.copilotProcessId, "observation.copilotProcessId")
      : undefined;
    const trustedSignalSource = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedSignalSource",
    )
      ? normalizeTrustedSignalSource(
          observation.trustedSignalSource,
          "observation.trustedSignalSource",
        )
      : undefined;
    const trustedStartedAt = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedStartedAt",
    )
      ? ensureOptionalString(observation.trustedStartedAt, "observation.trustedStartedAt")
      : undefined;
    const trustedEndedAt = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedEndedAt",
    )
      ? ensureOptionalString(observation.trustedEndedAt, "observation.trustedEndedAt")
      : undefined;
    const trustedLastSignalAt = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedLastSignalAt",
    )
      ? ensureOptionalString(
          observation.trustedLastSignalAt,
          "observation.trustedLastSignalAt",
        )
      : undefined;
    const trustedStartSource = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedStartSource",
    )
      ? normalizeTrustedStartSource(
          observation.trustedStartSource,
          "observation.trustedStartSource",
        )
      : undefined;
    const trustedEndReason = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedEndReason",
    )
      ? normalizeTrustedEndReason(
          observation.trustedEndReason,
          "observation.trustedEndReason",
        )
      : undefined;
    const trustedExecutionKind = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedExecutionKind",
    )
      ? normalizeTrustedExecutionKind(
          observation.trustedExecutionKind,
          "observation.trustedExecutionKind",
        )
      : undefined;
    const trustedInitialPromptLength = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedInitialPromptLength",
    )
      ? ensureOptionalInteger(
          observation.trustedInitialPromptLength,
          "observation.trustedInitialPromptLength",
        )
      : undefined;
    const trustedLastPromptLength = Object.prototype.hasOwnProperty.call(
      observation,
      "trustedLastPromptLength",
    )
      ? ensureOptionalInteger(
          observation.trustedLastPromptLength,
          "observation.trustedLastPromptLength",
        )
      : undefined;

    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const existingRecord = records.get(id);
      if (!existingRecord) {
        throw new SessionRegistryNotFoundError(id);
      }
      if (existingRecord.lifecycleStatus === "archived") {
        throw new SessionRegistryArchivedError(id, "be reattached by observation");
      }

      const nextLifecycle =
        lifecycleStatus ?? existingRecord.lifecycleStatus;

      const nextRecord: SessionRegistryRecord = {
        ...cloneValue(existingRecord),
        title:
          title !== undefined && existingRecord.titleSource === "auto"
            ? title
            : existingRecord.title,
        titleSource: existingRecord.titleSource,
        cwd,
        repo: repo !== undefined ? repo : existingRecord.repo,
        branch: branch !== undefined ? branch : existingRecord.branch,
        copilotSessionId,
        lastSeenAt:
          lastSeenAt !== undefined ? lastSeenAt : existingRecord.lastSeenAt,
        lifecycleStatus: nextLifecycle,
        observedSessionKind:
          observedSessionKind !== undefined
            ? observedSessionKind
            : existingRecord.observedSessionKind,
        copilotProcessState:
          copilotProcessState !== undefined
            ? copilotProcessState
            : existingRecord.copilotProcessState,
        copilotProcessId:
          copilotProcessId !== undefined
            ? copilotProcessId
            : existingRecord.copilotProcessId,
        trustedSignalSource:
          trustedSignalSource !== undefined
            ? trustedSignalSource
            : existingRecord.trustedSignalSource,
        trustedStartedAt:
          trustedStartedAt !== undefined
            ? trustedStartedAt
            : existingRecord.trustedStartedAt,
        trustedEndedAt:
          trustedEndedAt !== undefined
            ? trustedEndedAt
            : existingRecord.trustedEndedAt,
        trustedLastSignalAt:
          trustedLastSignalAt !== undefined
            ? trustedLastSignalAt
            : existingRecord.trustedLastSignalAt,
        trustedStartSource:
          trustedStartSource !== undefined
            ? trustedStartSource
            : existingRecord.trustedStartSource,
        trustedEndReason:
          trustedEndReason !== undefined
            ? trustedEndReason
            : existingRecord.trustedEndReason,
        trustedExecutionKind:
          trustedExecutionKind !== undefined
            ? trustedExecutionKind
            : existingRecord.trustedExecutionKind,
        trustedInitialPromptLength:
          trustedInitialPromptLength !== undefined
            ? trustedInitialPromptLength
            : existingRecord.trustedInitialPromptLength,
        trustedLastPromptLength:
          trustedLastPromptLength !== undefined
            ? trustedLastPromptLength
            : existingRecord.trustedLastPromptLength,
        updatedAt: isoNow(),
      };

      const storedRecord = mergeStoredRecord(existingRecord, nextRecord);
      records.set(id, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: id,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  patchSession(id: string, patch: SessionRegistryPatch): SessionRegistryRecord {
    const validatedPatch = parseSessionRegistryPatch(patch);
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const existingRecord = records.get(id);
      if (!existingRecord) {
        throw new SessionRegistryNotFoundError(id);
      }

      const conflictFields = getBuilderConflictFields(validatedPatch);
      if (
        validatedPatch.expectedVersion !== undefined &&
        validatedPatch.expectedVersion !== existingRecord.version
      ) {
        throw new SessionRegistryConflictError(
          cloneValue(existingRecord),
          conflictFields,
        );
      }

      const nextLifecycle =
        validatedPatch.lifecycleStatus ?? existingRecord.lifecycleStatus;

      const nextRecord: SessionRegistryRecord = {
        ...cloneValue(existingRecord),
        version:
          conflictFields.length > 0
            ? existingRecord.version + 1
            : existingRecord.version,
        title: validatedPatch.title ?? existingRecord.title,
        titleSource:
          validatedPatch.title !== undefined ? "user" : existingRecord.titleSource,
        description: validatedPatch.description ?? existingRecord.description,
        color:
          validatedPatch.color !== undefined ? validatedPatch.color : existingRecord.color,
        lifecycleStatus: nextLifecycle,
        tags:
          validatedPatch.tags !== undefined
            ? normalizeTags(validatedPatch.tags)
            : cloneValue(existingRecord.tags),
        graphBinding:
          validatedPatch.graphBinding !== undefined
            ? validatedPatch.graphBinding
            : existingRecord.graphBinding,
        updatedAt: isoNow(),
      };

      const storedRecord = mergeStoredRecord(existingRecord, nextRecord);
      records.set(id, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: id,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  archiveSession(id: string): SessionRegistryRecord {
    return this.patchSession(id, { lifecycleStatus: "archived" });
  }

  recordTrustedSessionSignal(
    input: SessionRegistryTrustedSignalInput,
  ): SessionRegistryRecord {
    const sessionId = ensureString(input.sessionId, "signal.sessionId");
    const cwd = ensureString(input.cwd, "signal.cwd");
    const timestamp = ensureString(input.timestamp, "signal.timestamp");
    const signalTime = parseTimestampMs(timestamp, "signal.timestamp");
    const signalSource = normalizeTrustedSignalSource(input.source, "signal.source");
    if (!signalSource) {
      throw new Error("Trusted session signal requires a source.");
    }
    const hookSource = normalizeTrustedStartSource(input.hookSource, "signal.hookSource");
    const endReason = normalizeTrustedEndReason(input.endReason, "signal.endReason");
    const executionKind = normalizeTrustedExecutionKind(
      input.executionKind,
      "signal.executionKind",
    );
    const initialPromptLength = ensureOptionalInteger(
      input.initialPromptLength,
      "signal.initialPromptLength",
    );
    const promptLength = ensureOptionalInteger(input.promptLength, "signal.promptLength");
    const repo = Object.prototype.hasOwnProperty.call(input, "repo")
      ? ensureOptionalString(input.repo, "signal.repo")
      : undefined;
    const branch = Object.prototype.hasOwnProperty.call(input, "branch")
      ? ensureOptionalString(input.branch, "signal.branch")
      : undefined;
    if (
      input.event !== "session.started" &&
      input.event !== "session.ended" &&
      input.event !== "prompt.submitted"
    ) {
      throw new Error(`Unsupported trusted session signal event "${input.event}".`);
    }

    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const targetId =
        this.findRecordIdByCopilotSessionId(records, sessionId) ??
        parseRegistryId(sessionId, "signal.sessionId");
      const existingRecord = records.get(targetId);
      if (existingRecord?.lifecycleStatus === "archived") {
        throw new SessionRegistryArchivedError(targetId, "accept trusted signals");
      }
      const lastSignalTime = optionalTimestampMs(existingRecord?.trustedLastSignalAt);
      const isLatestSignal = signalTime >= lastSignalTime;
      if (existingRecord && !isLatestSignal) {
        return cloneValue(existingRecord);
      }

      const existingEndTime = optionalTimestampMs(existingRecord?.trustedEndedAt);
      const isEnded =
        existingRecord?.lifecycleStatus === "ended" || existingRecord?.trustedEndedAt != null;
      const appliesStart =
        input.event === "session.started" && signalTime >= existingEndTime;
      const appliesEnd = input.event === "session.ended";
      const appliesPrompt = input.event === "prompt.submitted" && !isEnded;
      const cwdName = basename(cwd).trim();
      const lifecycleStatus: SessionRegistryLifecycleStatus =
        appliesEnd
          ? "ended"
          : appliesStart
            ? "active"
            : existingRecord?.lifecycleStatus ?? "active";
      const activityStatus: SessionRegistryActivityStatus =
        appliesEnd
          ? "exited"
          : appliesPrompt
            ? "working"
            : appliesStart && initialPromptLength !== null && initialPromptLength > 0
              ? "working"
              : existingRecord?.activityStatus ?? "waiting_for_input";
      const activityEvidence =
        appliesEnd
          ? activityEvidenceForTrustedSignal(
              existingRecord?.activityEvidence,
              "trusted_end",
              timestamp,
            )
          : appliesPrompt
            ? activityEvidenceForTrustedSignal(
                existingRecord?.activityEvidence,
                "trusted_prompt",
                timestamp,
              )
            : appliesStart
              ? activityEvidenceForTrustedSignal(
                  existingRecord?.activityEvidence,
                  "trusted_start",
                  timestamp,
                )
              : existingRecord?.activityEvidence
                ? cloneValue(existingRecord.activityEvidence)
                : cloneValue(DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE);
      const nextRecord: SessionRegistryRecord = {
        schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
        id: targetId,
        version: existingRecord?.version ?? 0,
        title: (existingRecord?.title ?? cwdName) || sessionId,
        titleSource: existingRecord?.titleSource ?? "auto",
        description:
          existingRecord?.description ??
          (executionKind === "agency" ? "Agency Copilot session" : "Copilot CLI session"),
        color: existingRecord?.color ?? null,
        cwd: isLatestSignal ? cwd : existingRecord?.cwd ?? cwd,
        repo: isLatestSignal && repo !== undefined ? repo : existingRecord?.repo ?? null,
        branch: isLatestSignal && branch !== undefined ? branch : existingRecord?.branch ?? null,
        copilotSessionId: sessionId,
        lifecycleStatus,
        lastSeenAt: isLatestSignal ? timestamp : existingRecord?.lastSeenAt ?? timestamp,
        createdAt: existingRecord?.createdAt ?? timestamp,
        updatedAt: isoNow(),
        tags: existingRecord ? cloneValue(existingRecord.tags) : [],
        origin: existingRecord?.origin ?? {
          kind: "observed",
          importedFromCopilotSessionId: sessionId,
        },
        graphBinding: existingRecord?.graphBinding
          ? cloneValue(existingRecord.graphBinding)
          : null,
        aiSummary: existingRecord?.aiSummary ?? null,
        aiSummaryModel: existingRecord?.aiSummaryModel ?? null,
        aiSummaryUpdatedAt: existingRecord?.aiSummaryUpdatedAt ?? null,
        aiSummaryEventsFingerprint:
          existingRecord?.aiSummaryEventsFingerprint ?? null,
        aiSummaryStatus: existingRecord?.aiSummaryStatus ?? "missing",
        aiSummaryError: existingRecord?.aiSummaryError ?? null,
        observedSessionKind: "interactive",
        copilotProcessState:
          appliesEnd
            ? "none"
            : appliesStart
              ? "live"
              : existingRecord?.copilotProcessState ?? "live",
        // session.started signals (whether for a fresh session or a resume)
        // logically establish a new process. Clear any stale PID from the
        // previous incarnation so the activity indexer doesn't see a
        // process-state mismatch and flash "interrupted" before discovery
        // picks up the new PID.
        copilotProcessId: appliesStart
          ? null
          : appliesEnd
            ? null
            : existingRecord?.copilotProcessId ?? null,
        activityStatus,
        activityStatusUpdatedAt:
          appliesStart || appliesEnd || appliesPrompt
            ? timestamp
            : existingRecord?.activityStatusUpdatedAt ?? timestamp,
        activityEvidence,
        pawWorkflow: existingRecord?.pawWorkflow
          ? cloneValue(existingRecord.pawWorkflow)
          : null,
        trustedSignalSource: signalSource,
        trustedStartedAt:
          appliesStart
            ? timestamp
            : existingRecord?.trustedStartedAt ?? null,
        trustedEndedAt:
          appliesEnd
            ? timestamp
            : appliesStart
              ? null
              : existingRecord?.trustedEndedAt ?? null,
        trustedLastSignalAt: timestamp,
        trustedStartSource:
          appliesStart
            ? hookSource
            : existingRecord?.trustedStartSource ?? null,
        trustedEndReason:
          appliesEnd
            ? endReason
            : appliesStart
              ? null
              : existingRecord?.trustedEndReason ?? null,
        trustedExecutionKind: executionKind ?? existingRecord?.trustedExecutionKind ?? null,
        trustedInitialPromptLength:
          appliesStart
            ? initialPromptLength ?? existingRecord?.trustedInitialPromptLength ?? null
            : existingRecord?.trustedInitialPromptLength ?? null,
        trustedLastPromptLength:
          appliesPrompt
            ? promptLength ?? existingRecord?.trustedLastPromptLength ?? null
            : existingRecord?.trustedLastPromptLength ?? null,
        derivedWorktreePath: existingRecord?.derivedWorktreePath ?? null,
        derivedBranch: existingRecord?.derivedBranch ?? null,
        derivedGithubRefs: cloneValue(existingRecord?.derivedGithubRefs ?? []),
        derivedContextUpdatedAt: existingRecord?.derivedContextUpdatedAt ?? null,
        derivedContextEventsOffset: existingRecord?.derivedContextEventsOffset ?? 0,
        derivedContextEventsSize: existingRecord?.derivedContextEventsSize ?? 0,
        derivedContextEventsMtimeMs: existingRecord?.derivedContextEventsMtimeMs ?? null,
      };

      const storedRecord = mergeStoredRecord(existingRecord, nextRecord);
      records.set(targetId, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: targetId,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  patchDerivedSessionState(
    id: string,
    patch: SessionRegistryDerivedStatePatch,
  ): SessionRegistryRecord {
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const existingRecord = records.get(id);
      if (!existingRecord) {
        throw new SessionRegistryNotFoundError(id);
      }

      const nextRecord: SessionRegistryRecord = {
        ...cloneValue(existingRecord),
        lifecycleStatus:
          patch.lifecycleStatus !== undefined
            ? patch.lifecycleStatus
            : existingRecord.lifecycleStatus,
        repo: patch.repo !== undefined ? patch.repo : existingRecord.repo,
        branch: patch.branch !== undefined ? patch.branch : existingRecord.branch,
        copilotProcessState:
          patch.copilotProcessState !== undefined
            ? patch.copilotProcessState
            : existingRecord.copilotProcessState,
        copilotProcessId:
          patch.copilotProcessId !== undefined
            ? patch.copilotProcessId
            : existingRecord.copilotProcessId,
        activityStatus:
          patch.activityStatus !== undefined
            ? patch.activityStatus
            : existingRecord.activityStatus,
        activityStatusUpdatedAt:
          patch.activityStatusUpdatedAt !== undefined
            ? patch.activityStatusUpdatedAt
            : existingRecord.activityStatusUpdatedAt,
        activityEvidence:
          patch.activityEvidence !== undefined
            ? cloneValue(patch.activityEvidence)
            : existingRecord.activityEvidence,
        pawWorkflow:
          patch.pawWorkflow !== undefined
            ? patch.pawWorkflow
              ? cloneValue(patch.pawWorkflow)
              : null
            : existingRecord.pawWorkflow,
        aiSummary:
          patch.aiSummary !== undefined ? patch.aiSummary : existingRecord.aiSummary,
        aiSummaryModel:
          patch.aiSummaryModel !== undefined
            ? patch.aiSummaryModel
            : existingRecord.aiSummaryModel,
        aiSummaryUpdatedAt:
          patch.aiSummaryUpdatedAt !== undefined
            ? patch.aiSummaryUpdatedAt
            : existingRecord.aiSummaryUpdatedAt,
        aiSummaryEventsFingerprint:
          patch.aiSummaryEventsFingerprint !== undefined
            ? patch.aiSummaryEventsFingerprint
            : existingRecord.aiSummaryEventsFingerprint,
        aiSummaryStatus:
          patch.aiSummaryStatus !== undefined
            ? patch.aiSummaryStatus
            : existingRecord.aiSummaryStatus,
        aiSummaryError:
          patch.aiSummaryError !== undefined
            ? patch.aiSummaryError
            : existingRecord.aiSummaryError,
        derivedWorktreePath:
          patch.derivedWorktreePath !== undefined
            ? patch.derivedWorktreePath
            : existingRecord.derivedWorktreePath,
        derivedBranch:
          patch.derivedBranch !== undefined
            ? patch.derivedBranch
            : existingRecord.derivedBranch,
        derivedGithubRefs:
          patch.derivedGithubRefs !== undefined
            ? cloneValue(patch.derivedGithubRefs)
            : existingRecord.derivedGithubRefs,
        derivedContextUpdatedAt:
          patch.derivedContextUpdatedAt !== undefined
            ? patch.derivedContextUpdatedAt
            : existingRecord.derivedContextUpdatedAt,
        derivedContextEventsOffset:
          patch.derivedContextEventsOffset !== undefined
            ? patch.derivedContextEventsOffset
            : existingRecord.derivedContextEventsOffset,
        derivedContextEventsSize:
          patch.derivedContextEventsSize !== undefined
            ? patch.derivedContextEventsSize
            : existingRecord.derivedContextEventsSize,
        derivedContextEventsMtimeMs:
          patch.derivedContextEventsMtimeMs !== undefined
            ? patch.derivedContextEventsMtimeMs
            : existingRecord.derivedContextEventsMtimeMs,
      };

      const storedRecord = mergeStoredRecord(existingRecord, nextRecord);
      records.set(id, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: id,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  deleteSession(id: string): void {
    this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      if (!records.has(id)) {
        throw new SessionRegistryNotFoundError(id);
      }

      records.delete(id);
      const nextIndex = buildIndex(records.values());
      const entryFileName = `${id}${ENTRY_EXTENSION}`;
      const entryPath = join(this.entriesDir, entryFileName);
      rmSync(entryPath, { force: true });

      // Keep the loadEntriesFromDisk cache in sync.
      if (this.cachedEntryRecords) {
        this.cachedEntryRecords.delete(id);
      }
      if (this.cachedEntryFingerprints) {
        this.cachedEntryFingerprints.delete(entryFileName);
      }

      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[1],
        registryId: id,
      });
    });
  }

  /**
   * Atomic conditional delete: acquires the write lock, re-reads the row,
   * invokes `predicate(current)` against the freshly-loaded record, and
   * deletes only if the predicate returns true. Used by the launch-claim
   * sweep and reserved-row recovery to avoid racing with observation
   * writes.
   */
  deleteSessionIf(
    id: string,
    predicate: (current: SessionRegistryRecord) => boolean,
  ): {
    deleted: boolean;
    reason: "deleted" | "predicate-false" | "not-found";
  } {
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const current = records.get(id);
      if (!current) {
        return { deleted: false, reason: "not-found" as const };
      }
      const verdict = predicate(cloneValue(current));
      if (!verdict) {
        return { deleted: false, reason: "predicate-false" as const };
      }
      records.delete(id);
      const nextIndex = buildIndex(records.values());
      const entryFileName = `${id}${ENTRY_EXTENSION}`;
      const entryPath = join(this.entriesDir, entryFileName);
      rmSync(entryPath, { force: true });
      if (this.cachedEntryRecords) {
        this.cachedEntryRecords.delete(id);
      }
      if (this.cachedEntryFingerprints) {
        this.cachedEntryFingerprints.delete(entryFileName);
      }
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[1],
        registryId: id,
      });
      return { deleted: true, reason: "deleted" as const };
    });
  }

  /**
   * Atomic launch-claim binding write. Acquires the write lock, re-reads
   * the row, re-validates that the binding-pass invariants
   * (cwd/branch/repo/launchClaimId compatibility) still hold against the
   * latest persisted state, and only then writes `graphBinding`.
   * Returns a typed outcome so the binding pass can decide whether to
   * retry on the next cycle.
   *
   * The `bindClaimToRow` primitive exists because observation paths
   * (`attachObservedSession`, `recordTrustedSessionSignal`) intentionally
   * do not bump `version`, so `expectedVersion` cannot detect a
   * cwd-changed-since-decision race. This method closes the loop by
   * re-validating cwd (and optionally branch/repo) inside the same
   * critical section as the write.
   */
  bindClaimToRow(
    id: string,
    expected: {
      cwdAfterNormalize: string;
      branch: string | null;
      repo: string | null;
      requireGraphBindingNullOrMatching: {
        workstreamId: string;
        nodeId: string;
        launchClaimId: string;
      };
    },
    desired: {
      graphBinding: SessionRegistryGraphBinding | null;
    },
    pathCompare: (a: string, b: string) => boolean = (a, b) => a === b,
  ):
    | { ok: true; record: SessionRegistryRecord }
    | {
        ok: false;
        reason:
          | "row-vanished"
          | "cwd-changed"
          | "branch-changed"
          | "repo-changed"
          | "graph-binding-conflict";
        detail?: string;
      } {
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const current = records.get(id);
      if (!current) {
        return { ok: false as const, reason: "row-vanished" as const };
      }
      if (!pathCompare(current.cwd, expected.cwdAfterNormalize)) {
        return {
          ok: false as const,
          reason: "cwd-changed" as const,
          detail: `expected cwd "${expected.cwdAfterNormalize}", row has "${current.cwd}"`,
        };
      }
      if (expected.branch !== null && current.branch !== expected.branch) {
        return {
          ok: false as const,
          reason: "branch-changed" as const,
          detail: `expected branch "${expected.branch}", row has "${String(current.branch)}"`,
        };
      }
      if (expected.repo !== null && current.repo !== expected.repo) {
        return {
          ok: false as const,
          reason: "repo-changed" as const,
          detail: `expected repo "${expected.repo}", row has "${String(current.repo)}"`,
        };
      }
      if (
        current.graphBinding !== null &&
        current.graphBinding.launchClaimId !==
          expected.requireGraphBindingNullOrMatching.launchClaimId
      ) {
        return {
          ok: false as const,
          reason: "graph-binding-conflict" as const,
          detail: `existing graphBinding launchClaimId differs`,
        };
      }
      const desiredBinding = desired.graphBinding;
      const isChange =
        JSON.stringify(current.graphBinding) !== JSON.stringify(desiredBinding);
      const nextRecord: SessionRegistryRecord = {
        ...cloneValue(current),
        graphBinding: desiredBinding,
        version: isChange ? current.version + 1 : current.version,
        updatedAt: isChange ? isoNow() : current.updatedAt,
      };
      const storedRecord = mergeStoredRecord(current, nextRecord);
      // Force graphBinding to the desired value, defeating the merge's
      // shallow-merge behavior when desired is null but existing is non-null.
      storedRecord.graphBinding = desiredBinding;
      records.set(id, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      if (isChange) {
        this.emitChange({
          kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
          registryId: id,
          snapshot: cloneValue(storedRecord),
        });
      }
      return { ok: true as const, record: cloneValue(storedRecord) };
    });
  }

  /**
   * Atomic launch-claim row fusion. When discovery (or trusted-signal
   * intake) has created a separate observed row for a Copilot session id
   * that should belong to a launch-claim's reserved row, this method:
   *
   * 1. Re-reads both rows under the registry write lock.
   * 2. Validates that the reserved row is still unattached or already
   *    attached to the same `copilotSessionId`, and that its
   *    `graphBinding.launchClaimId` matches the caller's claim.
   * 3. Copies the observation-owned fields (`copilotSessionId`, `cwd`,
   *    `repo`, `branch`, `lastSeenAt`, observation-derived
   *    lifecycle/process state, trusted signal fields) from the observed
   *    row onto the reserved row.
   * 4. Deletes the observed row.
   * 5. Confirms the reserved row's `graphBinding` matches the claim
   *    (sets it if it was null; rejects if it points to a different
   *    claim).
   *
   * All five steps occur within one `withWriteLock` acquisition. SSE
   * subscribers see one `upsert` for the reserved row and one `delete`
   * for the observed row, in that order.
   */
  fuseObservedRowIntoReservedRow(args: {
    reservedRowId: string;
    observedRowId: string;
    bindClaim: {
      workstreamId: string;
      nodeId: string;
      launchClaimId: string;
    };
  }):
    | {
        ok: true;
        reservedRecord: SessionRegistryRecord;
        deletedObservedId: string;
      }
    | {
        ok: false;
        reason:
          | "reserved-row-vanished"
          | "observed-row-vanished"
          | "reserved-row-already-attached"
          | "graph-binding-conflict";
        detail?: string;
      } {
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const reserved = records.get(args.reservedRowId);
      if (!reserved) {
        return { ok: false as const, reason: "reserved-row-vanished" as const };
      }
      const observed = records.get(args.observedRowId);
      if (!observed) {
        return { ok: false as const, reason: "observed-row-vanished" as const };
      }
      if (
        reserved.copilotSessionId !== null &&
        reserved.copilotSessionId !== observed.copilotSessionId
      ) {
        return {
          ok: false as const,
          reason: "reserved-row-already-attached" as const,
          detail: `reserved row already bound to a different copilot session ${reserved.copilotSessionId}`,
        };
      }
      if (
        reserved.graphBinding !== null &&
        reserved.graphBinding.launchClaimId !== args.bindClaim.launchClaimId
      ) {
        return {
          ok: false as const,
          reason: "graph-binding-conflict" as const,
          detail: `reserved row graphBinding launchClaimId differs from claim`,
        };
      }
      const desiredGraphBinding: SessionRegistryGraphBinding = {
        workstreamId: args.bindClaim.workstreamId,
        nodeId: args.bindClaim.nodeId,
        launchClaimId: args.bindClaim.launchClaimId,
      };
      const fusedReserved: SessionRegistryRecord = {
        ...cloneValue(reserved),
        cwd: observed.cwd,
        repo: observed.repo,
        branch: observed.branch,
        copilotSessionId: observed.copilotSessionId,
        lastSeenAt: observed.lastSeenAt,
        observedSessionKind: observed.observedSessionKind,
        copilotProcessState: observed.copilotProcessState,
        copilotProcessId: observed.copilotProcessId,
        activityStatus: observed.activityStatus,
        activityStatusUpdatedAt: observed.activityStatusUpdatedAt,
        activityEvidence: cloneValue(observed.activityEvidence),
        pawWorkflow: observed.pawWorkflow
          ? cloneValue(observed.pawWorkflow)
          : reserved.pawWorkflow
            ? cloneValue(reserved.pawWorkflow)
            : null,
        trustedSignalSource: observed.trustedSignalSource,
        trustedStartedAt: observed.trustedStartedAt,
        trustedEndedAt: observed.trustedEndedAt,
        trustedLastSignalAt: observed.trustedLastSignalAt,
        trustedStartSource: observed.trustedStartSource,
        trustedEndReason: observed.trustedEndReason,
        trustedExecutionKind: observed.trustedExecutionKind,
        trustedInitialPromptLength: observed.trustedInitialPromptLength,
        trustedLastPromptLength: observed.trustedLastPromptLength,
        graphBinding: desiredGraphBinding,
        updatedAt: isoNow(),
      };
      const storedFused = mergeStoredRecord(reserved, fusedReserved);
      storedFused.graphBinding = desiredGraphBinding;
      records.set(args.reservedRowId, storedFused);
      records.delete(args.observedRowId);
      const observedFileName = `${args.observedRowId}${ENTRY_EXTENSION}`;
      const observedPath = join(this.entriesDir, observedFileName);
      rmSync(observedPath, { force: true });
      if (this.cachedEntryRecords) {
        this.cachedEntryRecords.delete(args.observedRowId);
      }
      if (this.cachedEntryFingerprints) {
        this.cachedEntryFingerprints.delete(observedFileName);
      }
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedFused);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: args.reservedRowId,
        snapshot: cloneValue(storedFused),
      });
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[1],
        registryId: args.observedRowId,
      });
      return {
        ok: true as const,
        reservedRecord: cloneValue(storedFused),
        deletedObservedId: args.observedRowId,
      };
    });
  }

  /**
   * Returns the registry id of the row whose `origin.kind === "launched"`
   * and `origin.launchClaimId` equals the supplied id, or null. Used by
   * launch-claim startup recovery to find orphan reserved rows.
   */
  findRecordIdByLaunchClaimId(launchClaimId: string): string | null {
    this.refreshFromDisk();
    for (const record of this.records.values()) {
      if (
        record.origin.kind === "launched" &&
        record.origin.launchClaimId === launchClaimId
      ) {
        return record.id;
      }
    }
    return null;
  }

  /**
   * Returns the registry id of the row whose `copilotSessionId` matches
   * the supplied id, or null. Used by the launch-claim binding pass.
   */
  findRecordIdByCopilotSession(copilotSessionId: string): string | null {
    this.refreshFromDisk();
    for (const record of this.records.values()) {
      if (record.copilotSessionId === copilotSessionId) {
        return record.id;
      }
    }
    return null;
  }

  subscribe(listener: SessionRegistryChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureDirectories(): void {
    mkdirSync(this.entriesDir, { recursive: true });
    mkdirSync(this.quarantineDir, { recursive: true });
  }

  private refreshFromDisk(): void {
    const nextDiskFingerprint = this.readDiskFingerprint();
    if (this.loaded && nextDiskFingerprint === this.lastDiskFingerprint) {
      return;
    }

    const records = this.loadEntriesFromDisk();
    const index = this.loadOrRebuildIndex(records);
    const nextSignature = this.computeSignature(records);

    if (!this.loaded) {
      this.commitSnapshot(records, index, nextDiskFingerprint);
      return;
    }

    const didChange = nextSignature !== this.lastSignature;
    this.commitSnapshot(records, index, nextDiskFingerprint);
    if (didChange) {
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[2],
        registryIds: [...records.keys()].sort(),
      });
    }
  }

  private computeSignature(records: Map<string, StoredSessionRegistryRecord>): string {
    const entries = [...records.entries()].sort(([leftId], [rightId]) =>
      leftId.localeCompare(rightId),
    );
    return JSON.stringify(entries);
  }

  private commitSnapshot(
    records: Map<string, StoredSessionRegistryRecord>,
    index: SessionRegistryIndex,
    diskFingerprint: string = this.readDiskFingerprint(),
  ): void {
    this.records = records;
    this.index = index;
    this.lastSignature = this.computeSignature(records);
    this.lastDiskFingerprint = diskFingerprint;
    this.loaded = true;
  }

  private readDiskFingerprint(): string {
    this.ensureDirectories();

    let indexFingerprint = "missing";
    try {
      const indexStat = statSync(this.indexPath);
      indexFingerprint = `${indexStat.mtimeMs}:${indexStat.size}`;
    } catch {
      // Index is optional on first load; refreshFromDisk will rebuild it from entries.
    }

    const entryFingerprints = readdirSync(this.entriesDir)
      .filter((fileName) => fileName.endsWith(ENTRY_EXTENSION))
      .sort()
      .flatMap((fileName) => {
        try {
          const entryStat = statSync(join(this.entriesDir, fileName));
          return [`${fileName}:${entryStat.mtimeMs}:${entryStat.size}`];
        } catch (error) {
          if (isErrnoCode(error, "ENOENT")) {
            return [];
          }
          throw error;
        }
      });
    return `${entryFingerprints.join("|")}|${indexFingerprint}`;
  }

  private loadEntriesFromDisk(): Map<string, StoredSessionRegistryRecord> {
    this.ensureDirectories();

    // Cheap check: stat all entry files in the directory and build a
    // (filename → "mtime:size") map. If it matches our cache, return the
    // cached records without re-reading any file content.
    const currentFingerprints = new Map<string, string>();
    for (const fileName of readdirSync(this.entriesDir)) {
      if (!fileName.endsWith(ENTRY_EXTENSION)) {
        continue;
      }
      try {
        const stat = statSync(join(this.entriesDir, fileName));
        currentFingerprints.set(fileName, `${stat.mtimeMs}:${stat.size}`);
      } catch (error) {
        if (isErrnoCode(error, "ENOENT")) {
          continue;
        }
        throw error;
      }
    }

    if (
      this.cachedEntryRecords &&
      this.cachedEntryFingerprints &&
      fingerprintMapsEqual(this.cachedEntryFingerprints, currentFingerprints)
    ) {
      return this.cachedEntryRecords;
    }

    // Slow path: reload every entry. Only happens on first load or when
    // an external process modified the entries directory.
    const records = new Map<string, StoredSessionRegistryRecord>();
    for (const fileName of currentFingerprints.keys()) {
      const entryPath = join(this.entriesDir, fileName);
      try {
        const parsed = JSON.parse(readFileSync(entryPath, "utf8")) as unknown;
        const record = validateStoredRecord(parsed, entryPath);
        if (records.has(record.id)) {
          throw new Error(`Duplicate registry id ${record.id} detected.`);
        }
        records.set(record.id, record);
      } catch (error) {
        if (isErrnoCode(error, "ENOENT")) {
          continue;
        }
        this.quarantineEntry(entryPath);
        continue;
      }
    }

    this.cachedEntryRecords = records;
    this.cachedEntryFingerprints = currentFingerprints;
    return records;
  }

  private loadOrRebuildIndex(
    records: Map<string, StoredSessionRegistryRecord>,
  ): SessionRegistryIndex {
    const rebuiltIndex = buildIndex(records.values());

    try {
      const rawIndex = JSON.parse(readFileSync(this.indexPath, "utf8")) as unknown;
      const parsedIndex = validateIndex(rawIndex, this.indexPath);
      if (
        computeIndexEntriesSignature(parsedIndex.entries) ===
        computeIndexEntriesSignature(rebuiltIndex.entries)
      ) {
        return parsedIndex;
      }
    } catch {
      // Rebuild below from authoritative entries.
    }

    this.persistIndex(records, rebuiltIndex);
    return rebuiltIndex;
  }

  private quarantineEntry(entryPath: string): void {
    this.ensureDirectories();
    const quarantinePath = join(
      this.quarantineDir,
      `${Date.now()}-${basename(entryPath)}`,
    );
    try {
      renameWithRetries(entryPath, quarantinePath);
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
    // The entry no longer exists; drop it from any cached state so the next
    // read doesn't try to reuse a stale record.
    const entryFileName = basename(entryPath);
    this.cachedEntryFingerprints?.delete(entryFileName);
    if (this.cachedEntryRecords) {
      const idMatch = entryFileName.endsWith(ENTRY_EXTENSION)
        ? entryFileName.slice(0, -ENTRY_EXTENSION.length)
        : null;
      if (idMatch) {
        this.cachedEntryRecords.delete(idMatch);
      }
    }
  }

  private persistEntry(record: StoredSessionRegistryRecord): void {
    const entryFileName = `${record.id}${ENTRY_EXTENSION}`;
    const entryPath = join(this.entriesDir, entryFileName);
    writeJsonFile(entryPath, record);

    // Keep the loadEntriesFromDisk cache in sync so the next read sees this
    // change without re-reading every file in the entries directory.
    if (this.cachedEntryRecords) {
      this.cachedEntryRecords.set(record.id, cloneValue(record));
    }
    if (this.cachedEntryFingerprints) {
      try {
        const stat = statSync(entryPath);
        this.cachedEntryFingerprints.set(entryFileName, `${stat.mtimeMs}:${stat.size}`);
      } catch {
        // Stat failure is rare immediately after a successful write; if it
        // happens, drop the cache entry so the next load detects the
        // mismatch and reloads from disk.
        this.cachedEntryFingerprints.delete(entryFileName);
      }
    }
  }

  private persistIndex(
    records: Map<string, StoredSessionRegistryRecord>,
    index: SessionRegistryIndex = buildIndex(records.values()),
  ): void {
    writeJsonFile(this.indexPath, index);
  }

  private withWriteLock<T>(operation: () => T): T {
    this.ensureDirectories();
    const lockFd = this.acquireLock();
    try {
      return operation();
    } finally {
      this.releaseLock(lockFd);
    }
  }

  private acquireLock(): number {
    let recoveryLockFd: number | null = null;
    const deadline = Date.now() + this.writeLockWaitTimeoutMs;

    try {
      for (;;) {
        if (recoveryLockFd === null && this.hasActiveRecoveryLock()) {
          if (Date.now() < deadline) {
            sleepSync(WRITE_LOCK_WAIT_INTERVAL_MS);
            continue;
          }
          throw new SessionRegistryLockedError(this.lockPath);
        }

        let fd: number;
        try {
          fd = openSync(this.lockPath, "wx");
        } catch (error: unknown) {
          const code =
            error instanceof Error && "code" in error
              ? String((error as NodeJS.ErrnoException).code)
              : "";
          if (code === "EEXIST") {
            if (recoveryLockFd === null) {
              recoveryLockFd = this.acquireRecoveryLock();
            }
            if (recoveryLockFd !== null && this.removeStaleLock()) {
              continue;
            }
            if (recoveryLockFd !== null) {
              this.releaseRecoveryLock(recoveryLockFd);
              recoveryLockFd = null;
            }
            if (this.hasActiveRecoveryLock() && Date.now() < deadline) {
              sleepSync(WRITE_LOCK_WAIT_INTERVAL_MS);
              continue;
            }
            if (this.hasActiveRegistryLock() && Date.now() < deadline) {
              sleepSync(WRITE_LOCK_WAIT_INTERVAL_MS);
              continue;
            }
            if (!existsSync(this.lockPath) && Date.now() < deadline) {
              continue;
            }
            throw new SessionRegistryLockedError(this.lockPath);
          }
          throw error;
        }

        try {
          writeFileSync(
            fd,
            JSON.stringify({
              pid: process.pid,
              acquiredAt: isoNow(),
            }),
            "utf8",
          );
        } catch (error: unknown) {
          try {
            closeSync(fd);
          } catch {
            // Best effort cleanup; the original error is more important.
          }
          try {
            unlinkSync(this.lockPath);
          } catch {
            // Best effort cleanup; the original error is more important.
          }
          throw error;
        }

        if (recoveryLockFd === null && this.hasActiveRecoveryLock()) {
          this.releaseLock(fd);
          if (Date.now() < deadline) {
            sleepSync(WRITE_LOCK_WAIT_INTERVAL_MS);
            continue;
          }
          throw new SessionRegistryLockedError(this.lockPath);
        }

        if (recoveryLockFd !== null) {
          this.releaseRecoveryLock(recoveryLockFd);
          recoveryLockFd = null;
        }

        return fd;
      }
    } finally {
      if (recoveryLockFd !== null) {
        this.releaseRecoveryLock(recoveryLockFd);
      }
    }
  }

  private releaseLock(lockFd: number): void {
    try {
      closeSync(lockFd);
    } finally {
      rmSync(this.lockPath, { force: true });
    }
  }

  private removeStaleLock(): boolean {
    const lockMetadata = this.readLockMetadata();
    if (!lockMetadata || processExists(lockMetadata.pid)) {
      return false;
    }

    rmSync(this.lockPath, { force: true });
    return true;
  }

  private hasActiveRegistryLock(): boolean {
    const lockMetadata = this.readLockMetadata();
    return lockMetadata !== null && processExists(lockMetadata.pid);
  }

  private acquireRecoveryLock(): number | null {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let fd: number;
      try {
        fd = openSync(this.recoveryLockPath, "wx");
      } catch (error: unknown) {
        const code =
          error instanceof Error && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : "";
        if (code === "EEXIST") {
          if (attempt === 0 && !this.hasActiveRecoveryLock()) {
            continue;
          }
          return null;
        }
        throw error;
      }

      try {
        writeFileSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            acquiredAt: isoNow(),
          }),
          "utf8",
        );
      } catch (error: unknown) {
        try {
          closeSync(fd);
        } catch {
          // Best effort cleanup; the original error is more important.
        }
        try {
          unlinkSync(this.recoveryLockPath);
        } catch {
          // Best effort cleanup; the original error is more important.
        }
        throw error;
      }

      return fd;
    }

    return null;
  }

  private releaseRecoveryLock(recoveryLockFd: number): void {
    try {
      closeSync(recoveryLockFd);
    } finally {
      rmSync(this.recoveryLockPath, { force: true });
    }
  }

  private hasActiveRecoveryLock(): boolean {
    const metadata = this.readLockMetadata(this.recoveryLockPath);
    if (!metadata) {
      return false;
    }

    if (processExists(metadata.pid)) {
      return true;
    }

    rmSync(this.recoveryLockPath, { force: true });
    return false;
  }

  private readLockMetadata(lockPath = this.lockPath): SessionRegistryLockMetadata | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.pid !== "number" ||
      !Number.isInteger(candidate.pid) ||
      candidate.pid <= 0 ||
      typeof candidate.acquiredAt !== "string"
    ) {
      return null;
    }

    return {
      pid: candidate.pid,
      acquiredAt: candidate.acquiredAt,
    };
  }

  private findRecordIdByCopilotSessionId(
    records: Map<string, StoredSessionRegistryRecord>,
    copilotSessionId: string,
  ): string | undefined {
    for (const record of records.values()) {
      if (record.copilotSessionId === copilotSessionId) {
        return record.id;
      }
    }

    return undefined;
  }

  private resolveUpsertLifecycle(
    existingRecord: StoredSessionRegistryRecord | undefined,
    input: SessionRegistryUpsertInput,
  ): SessionRegistryLifecycleStatus {
    if (input.origin.kind === "observed") {
      const nextLifecycle = input.lifecycleStatus ?? existingRecord?.lifecycleStatus ?? "active";
      if (nextLifecycle !== "active" && nextLifecycle !== "ended") {
        throw new Error(
          `Observed rows may only use active or ended lifecycle statuses, received ${nextLifecycle}.`,
        );
      }
      return nextLifecycle;
    }

    const existingLifecycle =
      existingRecord?.lifecycleStatus === "active" ||
      existingRecord?.lifecycleStatus === "paused"
        ? existingRecord.lifecycleStatus
        : "active";
    const nextLifecycle = input.lifecycleStatus ?? existingLifecycle;
    if (nextLifecycle !== "active" && nextLifecycle !== "paused") {
      throw new Error(
        `Manual or launched rows may only be created in active or paused status, received ${nextLifecycle}.`,
      );
    }
    return nextLifecycle;
  }

  private emitChange(event: SessionRegistryChangeEvent): void {
    for (const listener of this.listeners) {
      listener(cloneValue(event));
    }
  }
}
