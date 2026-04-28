export const SESSION_REGISTRY_SCHEMA_VERSION = 1 as const;

export const SESSION_REGISTRY_LIFECYCLE_STATUSES = [
  "active",
  "paused",
  "ended",
  "archived",
] as const;
export type SessionRegistryLifecycleStatus =
  (typeof SESSION_REGISTRY_LIFECYCLE_STATUSES)[number];

export const SESSION_REGISTRY_ORIGIN_KINDS = [
  "manual",
  "observed",
  "launched",
] as const;
export type SessionRegistryOriginKind =
  (typeof SESSION_REGISTRY_ORIGIN_KINDS)[number];

export const SESSION_REGISTRY_TITLE_SOURCES = [
  "auto",
  "user",
] as const;
export type SessionRegistryTitleSource =
  (typeof SESSION_REGISTRY_TITLE_SOURCES)[number];

export const SESSION_REGISTRY_AI_SUMMARY_STATUSES = [
  "missing",
  "pending",
  "ready",
  "error",
] as const;
export type SessionRegistryAiSummaryStatus =
  (typeof SESSION_REGISTRY_AI_SUMMARY_STATUSES)[number];

export const SESSION_REGISTRY_OBSERVED_SESSION_KINDS = [
  "interactive",
  "helper",
] as const;
export type SessionRegistryObservedSessionKind =
  (typeof SESSION_REGISTRY_OBSERVED_SESSION_KINDS)[number];

export const SESSION_REGISTRY_COPILOT_PROCESS_STATES = [
  "live",
  "stale_lock",
  "none",
] as const;
export type SessionRegistryCopilotProcessState =
  (typeof SESSION_REGISTRY_COPILOT_PROCESS_STATES)[number];

export const SESSION_REGISTRY_ACTIVITY_STATUSES = [
  "unknown",
  "working",
  "waiting_for_input",
  "interrupted",
  "exited",
] as const;
export type SessionRegistryActivityStatus =
  (typeof SESSION_REGISTRY_ACTIVITY_STATUSES)[number];

export const SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES = [
  "copilot-cli-hook",
] as const;
export type SessionRegistryTrustedSignalSource =
  (typeof SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES)[number];

export const SESSION_REGISTRY_TRUSTED_START_SOURCES = [
  "new",
  "resume",
  "startup",
] as const;
export type SessionRegistryTrustedStartSource =
  (typeof SESSION_REGISTRY_TRUSTED_START_SOURCES)[number];

export const SESSION_REGISTRY_TRUSTED_END_REASONS = [
  "complete",
  "error",
  "abort",
  "timeout",
  "user_exit",
] as const;
export type SessionRegistryTrustedEndReason =
  (typeof SESSION_REGISTRY_TRUSTED_END_REASONS)[number];

export const SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS = [
  "copilot_cli",
  "agency",
] as const;
export type SessionRegistryTrustedExecutionKind =
  (typeof SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS)[number];

export const SESSION_REGISTRY_GITHUB_REF_TYPES = [
  "issue",
  "pr",
  "unknown",
] as const;
export type SessionRegistryGithubRefType =
  (typeof SESSION_REGISTRY_GITHUB_REF_TYPES)[number];

export interface SessionRegistryGraphBinding {
  workstreamId: string;
  nodeId: string;
  launchClaimId?: string | null;
}

export interface SessionRegistryGithubRef {
  type: SessionRegistryGithubRefType;
  repo: string | null;
  number: number;
  url: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  source: string;
}

export interface ManualSessionRegistryOrigin {
  kind: "manual";
}

export interface ObservedSessionRegistryOrigin {
  kind: "observed";
  importedFromCopilotSessionId?: string | null;
}

export interface LaunchedSessionRegistryOrigin {
  kind: "launched";
  launchClaimId?: string | null;
}

export type SessionRegistryOrigin =
  | ManualSessionRegistryOrigin
  | ObservedSessionRegistryOrigin
  | LaunchedSessionRegistryOrigin;

export interface SessionRegistryRecord {
  schemaVersion: typeof SESSION_REGISTRY_SCHEMA_VERSION;
  id: string;
  title: string;
  titleSource: SessionRegistryTitleSource;
  description: string;
  color: string | null;
  cwd: string;
  repo: string | null;
  branch: string | null;
  copilotSessionId: string | null;
  lifecycleStatus: SessionRegistryLifecycleStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  origin: SessionRegistryOrigin;
  graphBinding: SessionRegistryGraphBinding | null;
  aiSummary: string | null;
  aiSummaryModel: string | null;
  aiSummaryUpdatedAt: string | null;
  aiSummaryEventsFingerprint: string | null;
  aiSummaryStatus: SessionRegistryAiSummaryStatus;
  aiSummaryError: string | null;
  observedSessionKind: SessionRegistryObservedSessionKind | null;
  copilotProcessState: SessionRegistryCopilotProcessState | null;
  copilotProcessId: number | null;
  activityStatus: SessionRegistryActivityStatus;
  activityStatusUpdatedAt: string | null;
  trustedSignalSource: SessionRegistryTrustedSignalSource | null;
  trustedStartedAt: string | null;
  trustedEndedAt: string | null;
  trustedLastSignalAt: string | null;
  trustedStartSource: SessionRegistryTrustedStartSource | null;
  trustedEndReason: SessionRegistryTrustedEndReason | null;
  trustedExecutionKind: SessionRegistryTrustedExecutionKind | null;
  trustedInitialPromptLength: number | null;
  trustedLastPromptLength: number | null;
  derivedWorktreePath: string | null;
  derivedBranch: string | null;
  derivedGithubRefs: SessionRegistryGithubRef[];
  derivedContextUpdatedAt: string | null;
  derivedContextEventsOffset: number;
  derivedContextEventsSize: number;
  derivedContextEventsMtimeMs: number | null;
}

export interface SessionRegistryIndexEntry {
  id: string;
  title: string;
  titleSource: SessionRegistryTitleSource;
  description: string;
  lifecycleStatus: SessionRegistryLifecycleStatus;
  lastSeenAt: string | null;
  updatedAt: string;
  color: string | null;
  cwd: string;
  repo: string | null;
  branch: string | null;
  copilotSessionId: string | null;
  tags: string[];
  originKind: SessionRegistryOriginKind;
  graphBinding: SessionRegistryGraphBinding | null;
  aiSummary: string | null;
  aiSummaryModel: string | null;
  aiSummaryUpdatedAt: string | null;
  aiSummaryEventsFingerprint: string | null;
  aiSummaryStatus: SessionRegistryAiSummaryStatus;
  aiSummaryError: string | null;
  observedSessionKind: SessionRegistryObservedSessionKind | null;
  copilotProcessState: SessionRegistryCopilotProcessState | null;
  copilotProcessId: number | null;
  activityStatus: SessionRegistryActivityStatus;
  activityStatusUpdatedAt: string | null;
  trustedSignalSource: SessionRegistryTrustedSignalSource | null;
  trustedStartedAt: string | null;
  trustedEndedAt: string | null;
  trustedLastSignalAt: string | null;
  trustedStartSource: SessionRegistryTrustedStartSource | null;
  trustedEndReason: SessionRegistryTrustedEndReason | null;
  trustedExecutionKind: SessionRegistryTrustedExecutionKind | null;
  trustedInitialPromptLength: number | null;
  trustedLastPromptLength: number | null;
  derivedWorktreePath: string | null;
  derivedBranch: string | null;
  derivedGithubRefs: SessionRegistryGithubRef[];
  derivedContextUpdatedAt: string | null;
  derivedContextEventsOffset: number;
  derivedContextEventsSize: number;
  derivedContextEventsMtimeMs: number | null;
}

export interface SessionRegistryIndex {
  schemaVersion: typeof SESSION_REGISTRY_SCHEMA_VERSION;
  updatedAt: string;
  entries: SessionRegistryIndexEntry[];
}
