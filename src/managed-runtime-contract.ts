import type {
  SessionRegistryRuntimeEvidence,
  SessionRegistryRuntimeMetadata,
  SessionRegistryRuntimeProgressEvent,
} from "./session-registry-schema";

// Forward compatibility policy: unknown managed-runtime literals from stored
// projections are invalid for this reader, so callers should drop the projection
// to null and keep the owning session/launch record rather than throwing.
export const WORKSTREAM_RUNTIME_KINDS = [
  "terminal-cli",
  "managed-sdk",
] as const;
export type WorkstreamRuntimeKind = (typeof WORKSTREAM_RUNTIME_KINDS)[number];

export const MANAGED_RUNTIME_OWNERS = [
  "builder-terminal",
  "streamliner-sdk",
] as const;
export type ManagedRuntimeOwner = (typeof MANAGED_RUNTIME_OWNERS)[number];

export const MANAGED_RUNTIME_PERMISSION_PROFILES = [
  "managed-autonomous",
] as const;
export type ManagedRuntimePermissionProfile =
  (typeof MANAGED_RUNTIME_PERMISSION_PROFILES)[number];

export const MANAGED_RUNTIME_LIFECYCLE_STATES = [
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "interrupted",
  "canceled",
  "failed",
  "pr_ready",
  "review_ready",
  "completed",
  "cleanup_ready",
  "cleaning_up",
  "cleaned_up",
  "terminal_takeover",
] as const;
export type ManagedRuntimeLifecycleState =
  (typeof MANAGED_RUNTIME_LIFECYCLE_STATES)[number];

export const MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT = 8;
export const MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP = 1000;
export const MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH = 240;

export const MANAGED_RUNTIME_PROGRESS_KINDS = [
  "lifecycle",
  "assistant-status",
  "tool",
  "permission",
  "mcp",
  "skill",
  "review",
  "pull-request",
  "cleanup",
  "usage",
  "summary",
] as const;
export type ManagedRuntimeProgressKind =
  (typeof MANAGED_RUNTIME_PROGRESS_KINDS)[number];

export const MANAGED_RUNTIME_LINK_KINDS = [
  "pull-request",
  "completion",
  "blocker",
  "error",
  "review",
  "cleanup",
] as const;
export type ManagedRuntimeLinkKind = (typeof MANAGED_RUNTIME_LINK_KINDS)[number];

export type ManagedRuntimeActionKind =
  | "interrupt"
  | "cancel"
  | "terminal-takeover"
  | "cleanup";

export interface ManagedRuntimeSafeLink {
  label: string;
  url?: string | null;
}

export interface ManagedRuntimeProgressEvent {
  timestamp: string;
  phase: string;
  summary: string;
  kind?: ManagedRuntimeProgressKind;
  status?: "info" | "success" | "warning" | "error";
  link?: ManagedRuntimeSafeLink | null;
  count?: number | null;
}

export interface ManagedRuntimeLink {
  kind: ManagedRuntimeLinkKind;
  label: string;
  url?: string | null;
  summary?: string | null;
}

export interface ManagedRuntimeActionAvailability {
  action: ManagedRuntimeActionKind;
  label: string;
  available: boolean;
  reason?: string | null;
}

export interface ManagedRuntimeSdkMetadata {
  sdkSessionId?: string | null;
  sdkWorkspacePath?: string | null;
  sdkStateRoot?: string | null;
}

export interface ManagedRuntimeProjection {
  runtimeKind: "managed-sdk";
  runtimeOwner: ManagedRuntimeOwner;
  permissionProfile: ManagedRuntimePermissionProfile;
  lifecycleState: ManagedRuntimeLifecycleState;
  lifecycleUpdatedAt?: string | null;
  summary?: string | null;
  blockerSummary?: string | null;
  errorSummary?: string | null;
  sdk?: ManagedRuntimeSdkMetadata | null;
  progress?: ManagedRuntimeProgressEvent[];
  links?: ManagedRuntimeLink[];
  actions?: ManagedRuntimeActionAvailability[];
}

const MANAGED_RUNTIME_PROGRESS_STATUSES = [
  "info",
  "success",
  "warning",
  "error",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isManagedRuntimeOwner(value: unknown): value is ManagedRuntimeOwner {
  return typeof value === "string" && MANAGED_RUNTIME_OWNERS.includes(value as ManagedRuntimeOwner);
}

function isManagedRuntimePermissionProfile(
  value: unknown,
): value is ManagedRuntimePermissionProfile {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_PERMISSION_PROFILES.includes(value as ManagedRuntimePermissionProfile)
  );
}

function isManagedRuntimeLifecycleState(
  value: unknown,
): value is ManagedRuntimeLifecycleState {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_LIFECYCLE_STATES.includes(value as ManagedRuntimeLifecycleState)
  );
}

function isManagedRuntimeProgressKind(
  value: unknown,
): value is ManagedRuntimeProgressKind {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_PROGRESS_KINDS.includes(value as ManagedRuntimeProgressKind)
  );
}

function isManagedRuntimeProgressStatus(
  value: unknown,
): value is ManagedRuntimeProgressEvent["status"] {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_PROGRESS_STATUSES.includes(
      value as NonNullable<ManagedRuntimeProgressEvent["status"]>,
    )
  );
}

function isManagedRuntimeLinkKind(value: unknown): value is ManagedRuntimeLinkKind {
  return typeof value === "string" && MANAGED_RUNTIME_LINK_KINDS.includes(value as ManagedRuntimeLinkKind);
}

function isManagedRuntimeActionKind(
  value: unknown,
): value is ManagedRuntimeActionKind {
  return value === "interrupt" ||
    value === "cancel" ||
    value === "terminal-takeover" ||
    value === "cleanup";
}

function assertUnhandledManagedLifecycleState(state: never): never {
  throw new Error(`unhandled managed lifecycle state: ${String(state)}`);
}

function progressEventSummary(value: string): string {
  if (value.length <= MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH) {
    return value;
  }
  const maxBodyLength = MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH - 3;
  let summary = "";
  for (const char of value) {
    if (summary.length + char.length > maxBodyLength) {
      break;
    }
    summary += char;
  }
  return `${summary}...`;
}

export function formatManagedRuntimeLabel(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

export function managedLifecycleStatusClass(
  state: ManagedRuntimeLifecycleState,
): "green" | "amber" | "red" | "muted" | "accent" {
  switch (state) {
    case "running":
    case "idle":
    case "pr_ready":
    case "review_ready":
    case "cleanup_ready":
    case "cleaning_up":
      return "green";
    case "completed":
    case "cleaned_up":
    case "terminal_takeover":
      return "muted";
    case "preparing":
    case "starting":
    case "waiting_for_builder":
    case "interrupt_requested":
      return "amber";
    case "interrupted":
    case "canceled":
    case "failed":
      return "red";
    default:
      return assertUnhandledManagedLifecycleState(state);
  }
}

export function managedRuntimeProgressEvents(
  events: readonly unknown[] | null | undefined,
  limit = MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT,
): ManagedRuntimeProgressEvent[] {
  if (!events || limit <= 0) {
    return [];
  }
  return events
    .slice(-MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP)
    .filter(isRecord)
    .filter(
      (event) =>
        typeof event.timestamp === "string" &&
        typeof event.phase === "string" &&
        typeof event.summary === "string",
    )
    .slice(-limit)
    .map((event) => {
      const progressEvent: ManagedRuntimeProgressEvent = {
        timestamp: event.timestamp as string,
        phase: event.phase as string,
        summary: progressEventSummary(event.summary as string),
      };
      if (isManagedRuntimeProgressKind(event.kind)) {
        progressEvent.kind = event.kind;
      }
      if (isManagedRuntimeProgressStatus(event.status)) {
        progressEvent.status = event.status;
      }
      if (isRecord(event.link) && typeof event.link.label === "string") {
        progressEvent.link = {
          label: event.link.label,
          url: optionalString(event.link.url),
        };
      }
      if (typeof event.count === "number") {
        progressEvent.count = event.count;
      }
      return progressEvent;
    });
}

export function defaultManagedRuntimeActions(): ManagedRuntimeActionAvailability[] {
  return [
    {
      action: "interrupt",
      label: "Interrupt",
      available: false,
      reason: "Interrupt is unavailable for this background session state.",
    },
    {
      action: "cancel",
      label: "Cancel",
      available: false,
      reason: "Cancel is unavailable for this background session state.",
    },
    {
      action: "terminal-takeover",
      label: "Terminal takeover",
      available: false,
      reason: "Terminal takeover is unavailable for this background session state.",
    },
    {
      action: "cleanup",
      label: "Cleanup",
      available: false,
      reason: "Cleanup is unavailable until merged PR cleanup is ready.",
    },
  ];
}

export function resolveManagedRuntimeActions(
  projection: ManagedRuntimeProjection | null | undefined,
): ManagedRuntimeActionAvailability[] {
  const actions = projection?.actions ?? [];
  return actions.length > 0 ? actions : defaultManagedRuntimeActions();
}

const RUNTIME_PROGRESS_KINDS_BY_EVENT_TYPE: Partial<
  Record<SessionRegistryRuntimeProgressEvent["type"], ManagedRuntimeProgressKind>
> = {
  lifecycle: "lifecycle",
  assistant_status: "assistant-status",
  tool_started: "tool",
  tool_completed: "tool",
  permission_decision: "permission",
  mcp_status: "mcp",
  skill_status: "skill",
  evidence: "summary",
  terminal_takeover: "summary",
  error: "summary",
  usage: "usage",
};

const SDK_INTERRUPT_STATES = new Set<ManagedRuntimeLifecycleState>([
  "running",
  "idle",
  "waiting_for_builder",
]);

const SDK_CANCEL_STATES = new Set<ManagedRuntimeLifecycleState>([
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
]);

const SDK_TAKEOVER_STATES = new Set<ManagedRuntimeLifecycleState>([
  "running",
  "idle",
  "waiting_for_builder",
  "interrupted",
  "pr_ready",
  "review_ready",
  "cleanup_ready",
]);

function managedRuntimeActionsFromMetadata(
  runtime: SessionRegistryRuntimeMetadata,
): ManagedRuntimeActionAvailability[] {
  const state = runtime.lifecycleState;
  if (!state) {
    return defaultManagedRuntimeActions();
  }
  const sdkOwned = runtime.runtimeOwner === "streamliner-sdk";
  const terminalOwnedReason = runtime.runtimeOwner === "builder-terminal"
    ? "Terminal owns this session after takeover."
    : "Streamliner does not own this runtime.";
  const interruptAvailable = sdkOwned && SDK_INTERRUPT_STATES.has(state);
  const cancelAvailable = sdkOwned && SDK_CANCEL_STATES.has(state);
  const takeoverAvailable = sdkOwned &&
    Boolean(runtime.sdkSessionId) &&
    SDK_TAKEOVER_STATES.has(state);
  const cleanupReady = state === "cleanup_ready" ||
    runtime.evidence.some((evidence) => evidence.kind === "cleanup_ready");
  const cleanupAvailable = cleanupReady && state !== "cleaning_up" && state !== "cleaned_up";
  return [
    {
      action: "interrupt",
      label: "Interrupt",
      available: interruptAvailable,
      reason: interruptAvailable
        ? null
        : sdkOwned
          ? `Interrupt is unavailable while lifecycle is ${formatManagedRuntimeLabel(state)}.`
          : terminalOwnedReason,
    },
    {
      action: "cancel",
      label: "Cancel",
      available: cancelAvailable,
      reason: cancelAvailable
        ? null
        : sdkOwned
          ? `Cancel is unavailable while lifecycle is ${formatManagedRuntimeLabel(state)}.`
          : terminalOwnedReason,
    },
    {
      action: "terminal-takeover",
      label: "Terminal takeover",
      available: takeoverAvailable,
      reason: takeoverAvailable
        ? null
        : !sdkOwned
          ? terminalOwnedReason
          : !runtime.sdkSessionId
            ? "Terminal takeover requires an SDK session id."
            : `Terminal takeover is unavailable while lifecycle is ${formatManagedRuntimeLabel(state)}.`,
    },
    {
      action: "cleanup",
      label: "Cleanup",
      available: cleanupAvailable,
      reason: cleanupAvailable
        ? null
        : state === "cleaned_up"
          ? "Cleanup already completed."
          : state === "cleaning_up"
            ? "Cleanup is already running."
            : "Cleanup is unavailable until merged PR cleanup is ready.",
    },
  ];
}

function progressStatusForRuntimeEvent(
  event: SessionRegistryRuntimeProgressEvent,
): ManagedRuntimeProgressEvent["status"] {
  if (event.type === "error") {
    return "error";
  }
  if (event.type === "tool_completed" || event.type === "evidence") {
    return "success";
  }
  if (event.type === "permission_decision") {
    return "warning";
  }
  return "info";
}

function evidenceLinkKind(
  evidence: SessionRegistryRuntimeEvidence,
): ManagedRuntimeLinkKind {
  switch (evidence.kind) {
    case "pr_ready":
      return "pull-request";
    case "review_ready":
      return "review";
    case "cleanup_ready":
    case "cleaned_up":
      return "cleanup";
    case "terminal_takeover":
    case "completed":
      return "completion";
    default: {
      const _exhaustive: never = evidence.kind;
      return _exhaustive;
    }
  }
}

function latestRuntimeSummary(
  runtime: SessionRegistryRuntimeMetadata,
): string | null {
  const evidenceSummary = [...runtime.evidence]
    .reverse()
    .find((evidence) => evidence.summary?.trim())?.summary;
  if (evidenceSummary) {
    return evidenceSummary;
  }
  const progressSummary = [...runtime.progressEvents]
    .reverse()
    .find((event) => event.message.trim())?.message;
  return progressSummary ?? null;
}

export function managedRuntimeProjectionFromMetadata(
  runtime: SessionRegistryRuntimeMetadata | null | undefined,
): ManagedRuntimeProjection | null {
  if (
    !runtime ||
    runtime.runtimeKind !== "managed-sdk" ||
    !isManagedRuntimeOwner(runtime.runtimeOwner) ||
    !runtime.lifecycleState
  ) {
    return null;
  }

  const summary = latestRuntimeSummary(runtime);
  const progress: ManagedRuntimeProgressEvent[] = runtime.progressEvents.map((event) => ({
    timestamp: event.timestamp,
    phase: event.type,
    summary: progressEventSummary(event.message),
    kind: RUNTIME_PROGRESS_KINDS_BY_EVENT_TYPE[event.type] ?? "summary",
    status: progressStatusForRuntimeEvent(event),
  }));
  const links: ManagedRuntimeLink[] = runtime.evidence.map((evidence) => ({
    kind: evidenceLinkKind(evidence),
    label: formatManagedRuntimeLabel(evidence.kind),
    url: evidence.url,
    summary: evidence.summary,
  }));

  return {
    runtimeKind: "managed-sdk",
    runtimeOwner: runtime.runtimeOwner,
    permissionProfile: "managed-autonomous",
    lifecycleState: runtime.lifecycleState,
    lifecycleUpdatedAt: runtime.lastStateChangedAt ?? runtime.startedAt,
    summary,
    blockerSummary: runtime.lifecycleState === "waiting_for_builder" ? summary : null,
    errorSummary: runtime.lifecycleState === "failed" ? summary : null,
    sdk: {
      sdkSessionId: runtime.sdkSessionId,
      sdkWorkspacePath: runtime.sdkWorkspacePath,
      sdkStateRoot: runtime.sdkStateRoot,
    },
    progress,
    links,
    actions: managedRuntimeActionsFromMetadata(runtime),
  };
}

export function sanitizeManagedRuntimeProjection(
  value: unknown,
): ManagedRuntimeProjection | null {
  if (
    !isRecord(value) ||
    value.runtimeKind !== "managed-sdk" ||
    !isManagedRuntimeOwner(value.runtimeOwner) ||
    !isManagedRuntimePermissionProfile(value.permissionProfile) ||
    !isManagedRuntimeLifecycleState(value.lifecycleState)
  ) {
    return null;
  }

  const sdk = isRecord(value.sdk)
    ? {
        sdkSessionId: optionalString(value.sdk.sdkSessionId),
        sdkWorkspacePath: optionalString(value.sdk.sdkWorkspacePath),
        sdkStateRoot: optionalString(value.sdk.sdkStateRoot),
      }
    : null;
  const links = Array.isArray(value.links)
    ? value.links.flatMap((link): ManagedRuntimeLink[] => {
        if (
          !isRecord(link) ||
          !isManagedRuntimeLinkKind(link.kind) ||
          typeof link.label !== "string"
        ) {
          return [];
        }
        return [{
          kind: link.kind,
          label: link.label,
          url: optionalString(link.url),
          summary: optionalString(link.summary),
        }];
      })
    : [];
  const actions = Array.isArray(value.actions)
    ? value.actions.flatMap((action): ManagedRuntimeActionAvailability[] => {
        if (
          !isRecord(action) ||
          !isManagedRuntimeActionKind(action.action) ||
          typeof action.label !== "string" ||
          typeof action.available !== "boolean"
        ) {
          return [];
        }
        return [{
          action: action.action,
          label: action.label,
          available: action.available,
          reason: optionalString(action.reason),
        }];
      })
    : [];

  return {
    runtimeKind: "managed-sdk",
    runtimeOwner: value.runtimeOwner,
    permissionProfile: value.permissionProfile,
    lifecycleState: value.lifecycleState,
    lifecycleUpdatedAt: optionalString(value.lifecycleUpdatedAt),
    summary: optionalString(value.summary),
    blockerSummary: optionalString(value.blockerSummary),
    errorSummary: optionalString(value.errorSummary),
    sdk,
    progress: managedRuntimeProgressEvents(
      Array.isArray(value.progress) ? value.progress : [],
    ),
    links,
    actions,
  };
}
