import {
  SESSION_REGISTRY_MANAGED_LIFECYCLE_STATES,
  SESSION_REGISTRY_RUNTIME_EVIDENCE_KINDS,
  SESSION_REGISTRY_RUNTIME_KINDS,
  SESSION_REGISTRY_RUNTIME_OWNERS,
  SESSION_REGISTRY_RUNTIME_PERMISSION_PROFILES,
  SESSION_REGISTRY_RUNTIME_PROGRESS_EVENT_TYPES,
  type SessionRegistryManagedLifecycleState,
  type SessionRegistryRuntimeEvidence,
  type SessionRegistryRuntimeEvidenceKind,
  type SessionRegistryRuntimeKind,
  type SessionRegistryRuntimeMetadata,
  type SessionRegistryRuntimeOwner,
  type SessionRegistryRuntimePermissionProfile,
  type SessionRegistryRuntimeProgressEvent,
  type SessionRegistryRuntimeProgressEventType,
} from "../session-registry-schema";

export const MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT = 50;
export const MANAGED_RUNTIME_PROGRESS_STRING_LIMIT = 240;

const SENSITIVE_DATA_KEYS = new Set([
  "arg",
  "args",
  "argument",
  "arguments",
  "authorization",
  "command",
  "content",
  "credential",
  "output",
  "password",
  "payload",
  "prompt",
  "reasoning",
  "result",
  "secret",
  "token",
  "tokens",
  "toolargs",
  "toolarguments",
  "toolresult",
]);

const SAFE_SUMMARY_DATA_KEYS = new Set([
  "argumentcount",
  "choicecount",
  "contentlength",
  "errorcount",
  "inputtokens",
  "outputtokens",
  "questionlength",
]);

const ACTIVE_MANAGED_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "pr_ready",
  "review_ready",
  "cleanup_ready",
  "cleaning_up",
  "terminal_takeover",
]);

const TERMINAL_MANAGED_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
  "canceled",
  "cleaned_up",
  "completed",
  "failed",
  "interrupted",
]);

export interface SessionRegistryRuntimeProgressEventInput {
  type: SessionRegistryRuntimeProgressEventType;
  message: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}

export interface SessionRegistryRuntimeEvidenceInput {
  kind: SessionRegistryRuntimeEvidenceKind;
  source: string;
  detectedAt?: string;
  url?: string | null;
  repo?: string | null;
  number?: number | null;
  sha?: string | null;
  summary?: string | null;
}

export interface SessionRegistryRuntimeMetadataPatch {
  runtimeKind?: SessionRegistryRuntimeKind;
  runtimeOwner?: SessionRegistryRuntimeOwner;
  lifecycleState?: SessionRegistryManagedLifecycleState | null;
  permissionProfile?: SessionRegistryRuntimePermissionProfile | null;
  launchClaimId?: string | null;
  launchNonce?: string | null;
  sdkSessionId?: string | null;
  sdkWorkspacePath?: string | null;
  sdkStateRoot?: string | null;
  startedAt?: string | null;
  lastStateChangedAt?: string | null;
  progressEvents?: SessionRegistryRuntimeProgressEventInput[];
  evidence?: SessionRegistryRuntimeEvidenceInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string or null.`);
  }
  return truncateProgressString(value);
}

function optionalRawString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string or null.`);
  }
  return value;
}

function optionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${fieldName} to be a non-negative integer or null.`);
  }
  return value;
}

function runtimeKind(value: unknown, fieldName: string): SessionRegistryRuntimeKind {
  const kind = requireString(value, fieldName) as SessionRegistryRuntimeKind;
  if (!SESSION_REGISTRY_RUNTIME_KINDS.includes(kind)) {
    throw new Error(`Unsupported ${fieldName} "${kind}".`);
  }
  return kind;
}

function runtimeOwner(value: unknown, fieldName: string): SessionRegistryRuntimeOwner {
  const owner = requireString(value, fieldName) as SessionRegistryRuntimeOwner;
  if (!SESSION_REGISTRY_RUNTIME_OWNERS.includes(owner)) {
    throw new Error(`Unsupported ${fieldName} "${owner}".`);
  }
  return owner;
}

function lifecycleState(
  value: unknown,
  fieldName: string,
): SessionRegistryManagedLifecycleState | null {
  if (value === undefined || value === null) {
    return null;
  }
  const state = requireString(value, fieldName) as SessionRegistryManagedLifecycleState;
  if (!SESSION_REGISTRY_MANAGED_LIFECYCLE_STATES.includes(state)) {
    throw new Error(`Unsupported ${fieldName} "${state}".`);
  }
  return state;
}

function permissionProfile(
  value: unknown,
  fieldName: string,
): SessionRegistryRuntimePermissionProfile | null {
  if (value === undefined || value === null) {
    return null;
  }
  const profile = requireString(value, fieldName) as SessionRegistryRuntimePermissionProfile;
  if (!SESSION_REGISTRY_RUNTIME_PERMISSION_PROFILES.includes(profile)) {
    throw new Error(`Unsupported ${fieldName} "${profile}".`);
  }
  return profile;
}

function progressEventType(
  value: unknown,
  fieldName: string,
): SessionRegistryRuntimeProgressEventType {
  const type = requireString(value, fieldName) as SessionRegistryRuntimeProgressEventType;
  if (!SESSION_REGISTRY_RUNTIME_PROGRESS_EVENT_TYPES.includes(type)) {
    throw new Error(`Unsupported ${fieldName} "${type}".`);
  }
  return type;
}

function evidenceKind(value: unknown, fieldName: string): SessionRegistryRuntimeEvidenceKind {
  const kind = requireString(value, fieldName) as SessionRegistryRuntimeEvidenceKind;
  if (!SESSION_REGISTRY_RUNTIME_EVIDENCE_KINDS.includes(kind)) {
    throw new Error(`Unsupported ${fieldName} "${kind}".`);
  }
  return kind;
}

function truncateProgressString(value: string): string {
  return value.length > MANAGED_RUNTIME_PROGRESS_STRING_LIMIT
    ? `${value.slice(0, MANAGED_RUNTIME_PROGRESS_STRING_LIMIT)}...`
    : value;
}

function isSensitiveDataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SAFE_SUMMARY_DATA_KEYS.has(normalized)) {
    return false;
  }
  return SENSITIVE_DATA_KEYS.has(normalized);
}

function sanitizeProgressData(value: unknown, key = "data", depth = 0): unknown {
  if (isSensitiveDataKey(key)) {
    return undefined;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return truncateProgressString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 2) {
      return undefined;
    }
    return value
      .slice(0, 20)
      .map((entry, index) => sanitizeProgressData(entry, `${key}.${index}`, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!isRecord(value) || depth >= 2) {
    return undefined;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const nextValue = sanitizeProgressData(childValue, childKey, depth + 1);
    if (nextValue !== undefined) {
      sanitized[childKey] = nextValue;
    }
  }
  return sanitized;
}

function normalizeProgressEvent(
  value: unknown,
  fieldName: string,
): SessionRegistryRuntimeProgressEvent {
  if (!isRecord(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }
  const event: SessionRegistryRuntimeProgressEvent = {
    id: requireString(value.id, `${fieldName}.id`),
    sequence: optionalNumber(value.sequence, `${fieldName}.sequence`) ?? 0,
    type: progressEventType(value.type, `${fieldName}.type`),
    message: truncateProgressString(requireString(value.message, `${fieldName}.message`)),
    timestamp: requireString(value.timestamp, `${fieldName}.timestamp`),
  };
  const data = sanitizeProgressData(value.data);
  if (isRecord(data)) {
    event.data = data;
  }
  return event;
}

function normalizeEvidence(value: unknown, fieldName: string): SessionRegistryRuntimeEvidence {
  if (!isRecord(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }
  return {
    id: requireString(value.id, `${fieldName}.id`),
    kind: evidenceKind(value.kind, `${fieldName}.kind`),
    source: truncateProgressString(requireString(value.source, `${fieldName}.source`)),
    detectedAt: requireString(value.detectedAt, `${fieldName}.detectedAt`),
    url: optionalRawString(value.url, `${fieldName}.url`),
    repo: optionalRawString(value.repo, `${fieldName}.repo`),
    number: optionalNumber(value.number, `${fieldName}.number`),
    sha: optionalRawString(value.sha, `${fieldName}.sha`),
    summary: optionalString(value.summary, `${fieldName}.summary`),
  };
}

export function normalizeSessionRegistryRuntimeMetadata(
  value: unknown,
  fieldName: string,
): SessionRegistryRuntimeMetadata | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error(`Expected ${fieldName} to be an object or null.`);
  }
  const progressEvents = Array.isArray(value.progressEvents)
    ? value.progressEvents
        .map((entry, index) => normalizeProgressEvent(entry, `${fieldName}.progressEvents[${index}]`))
        .slice(-MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT)
    : [];
  return {
    runtimeKind: runtimeKind(value.runtimeKind, `${fieldName}.runtimeKind`),
    runtimeOwner: runtimeOwner(value.runtimeOwner, `${fieldName}.runtimeOwner`),
    lifecycleState: lifecycleState(value.lifecycleState, `${fieldName}.lifecycleState`),
    permissionProfile: permissionProfile(value.permissionProfile, `${fieldName}.permissionProfile`),
    launchClaimId: optionalRawString(value.launchClaimId, `${fieldName}.launchClaimId`),
    launchNonce: optionalRawString(value.launchNonce, `${fieldName}.launchNonce`),
    sdkSessionId: optionalRawString(value.sdkSessionId, `${fieldName}.sdkSessionId`),
    sdkWorkspacePath: optionalRawString(value.sdkWorkspacePath, `${fieldName}.sdkWorkspacePath`),
    sdkStateRoot: optionalRawString(value.sdkStateRoot, `${fieldName}.sdkStateRoot`),
    startedAt: optionalRawString(value.startedAt, `${fieldName}.startedAt`),
    lastStateChangedAt: optionalRawString(value.lastStateChangedAt, `${fieldName}.lastStateChangedAt`),
    progressEvents,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map((entry, index) => normalizeEvidence(entry, `${fieldName}.evidence[${index}]`))
      : [],
  };
}

export function isManagedRuntimeActive(
  runtime: SessionRegistryRuntimeMetadata | null | undefined,
): boolean {
  return runtime?.runtimeKind === "managed-sdk" &&
    runtime.lifecycleState !== null &&
    ACTIVE_MANAGED_LIFECYCLE_STATES.has(runtime.lifecycleState);
}

export function mergeSessionRegistryRuntimeMetadata(
  current: SessionRegistryRuntimeMetadata | null | undefined,
  patch: SessionRegistryRuntimeMetadataPatch,
  now = new Date(),
): SessionRegistryRuntimeMetadata {
  const timestamp = now.toISOString();
  const currentProgress = current?.progressEvents ?? [];
  const highestSequence = currentProgress.reduce(
    (max, event) => Math.max(max, event.sequence),
    0,
  );
  const nextProgress = (patch.progressEvents ?? []).map((event, index) => {
    const sequence = highestSequence + index + 1;
    const progress: SessionRegistryRuntimeProgressEvent = {
      id: `${timestamp}:${sequence}`,
      sequence,
      type: event.type,
      message: truncateProgressString(event.message),
      timestamp: event.timestamp ?? timestamp,
    };
    const data = sanitizeProgressData(event.data);
    if (isRecord(data)) {
      progress.data = data;
    }
    return progress;
  });
  const evidenceById = new Map<string, SessionRegistryRuntimeEvidence>();
  for (const evidence of current?.evidence ?? []) {
    evidenceById.set(evidence.id, evidence);
  }
  for (const evidence of patch.evidence ?? []) {
    const normalized = inputEvidenceToStoredEvidence(evidence, timestamp);
    evidenceById.set(normalized.id, normalized);
  }
  const lifecycleChanged =
    patch.lifecycleState !== undefined &&
    !isTerminalLifecycleState(current?.lifecycleState) &&
    patch.lifecycleState !== (current?.lifecycleState ?? null);
  const nextLifecycleState = lifecycleChanged
    ? patch.lifecycleState ?? null
    : current?.lifecycleState ?? (patch.lifecycleState !== undefined ? patch.lifecycleState : null);
  return {
    runtimeKind: patch.runtimeKind ?? current?.runtimeKind ?? "managed-sdk",
    runtimeOwner: patch.runtimeOwner ?? current?.runtimeOwner ?? "streamliner-sdk",
    lifecycleState:
      nextLifecycleState,
    permissionProfile:
      patch.permissionProfile !== undefined
        ? patch.permissionProfile
        : current?.permissionProfile ?? null,
    launchClaimId:
      patch.launchClaimId !== undefined
        ? patch.launchClaimId
        : current?.launchClaimId ?? null,
    launchNonce:
      patch.launchNonce !== undefined
        ? patch.launchNonce
        : current?.launchNonce ?? null,
    sdkSessionId:
      patch.sdkSessionId !== undefined
        ? patch.sdkSessionId
        : current?.sdkSessionId ?? null,
    sdkWorkspacePath:
      patch.sdkWorkspacePath !== undefined
        ? patch.sdkWorkspacePath
        : current?.sdkWorkspacePath ?? null,
    sdkStateRoot:
      patch.sdkStateRoot !== undefined
        ? patch.sdkStateRoot
        : current?.sdkStateRoot ?? null,
    startedAt: patch.startedAt !== undefined ? patch.startedAt : current?.startedAt ?? null,
    lastStateChangedAt:
      patch.lastStateChangedAt !== undefined
        ? patch.lastStateChangedAt
        : lifecycleChanged
          ? timestamp
          : current?.lastStateChangedAt ?? null,
    progressEvents: [...currentProgress, ...nextProgress].slice(-MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT),
    evidence: [...evidenceById.values()],
  };
}

function isTerminalLifecycleState(
  state: SessionRegistryManagedLifecycleState | null | undefined,
): boolean {
  return state !== null &&
    state !== undefined &&
    TERMINAL_MANAGED_LIFECYCLE_STATES.has(state);
}

function inputEvidenceToStoredEvidence(
  input: SessionRegistryRuntimeEvidenceInput,
  timestamp: string,
): SessionRegistryRuntimeEvidence {
  const detectedAt = input.detectedAt ?? timestamp;
  const id = [
    input.kind,
    input.source,
    input.url ?? "",
    input.repo ?? "",
    input.number ?? "",
    input.sha ?? "",
  ].join(":");
  return {
    id,
    kind: input.kind,
    source: truncateProgressString(input.source),
    detectedAt,
    url: input.url ?? null,
    repo: input.repo ?? null,
    number: input.number ?? null,
    sha: input.sha ?? null,
    summary: input.summary ? truncateProgressString(input.summary) : null,
  };
}
