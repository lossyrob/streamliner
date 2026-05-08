export const WORKSTREAM_RUNTIME_KINDS = [
  "terminal-cli",
  "managed-sdk",
] as const;
export type WorkstreamRuntimeKind = (typeof WORKSTREAM_RUNTIME_KINDS)[number];

export const MANAGED_RUNTIME_OWNERS = [
  "streamliner-sdk",
  "terminal",
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
  return value === "terminal-takeover" || value === "cleanup";
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
    case "completed":
    case "cleanup_ready":
    case "cleaning_up":
    case "cleaned_up":
      return "green";
    case "preparing":
    case "starting":
    case "waiting_for_builder":
    case "interrupt_requested":
      return "amber";
    case "interrupted":
    case "canceled":
    case "failed":
      return "red";
    case "terminal_takeover":
      return "muted";
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
        summary:
          (event.summary as string).length > MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH
            ? `${(event.summary as string).slice(0, MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH - 3)}...`
            : event.summary as string,
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
