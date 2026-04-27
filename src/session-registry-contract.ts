import type {
  LaunchedSessionRegistryOrigin,
  ManualSessionRegistryOrigin,
  ObservedSessionRegistryOrigin,
  SessionRegistryAiSummaryStatus,
  SessionRegistryActivityStatus,
  SessionRegistryCopilotProcessState,
  SessionRegistryGithubRef,
  SessionRegistryGraphBinding,
  SessionRegistryLifecycleStatus,
  SessionRegistryObservedSessionKind,
  SessionRegistryOriginKind,
  SessionRegistryRecord,
  SessionRegistryTitleSource,
  SessionRegistryTrustedEndReason,
  SessionRegistryTrustedExecutionKind,
  SessionRegistryTrustedSignalSource,
  SessionRegistryTrustedStartSource,
} from "./session-registry-schema";

// The future runtime implementation will live under src/session-registry/.

export type SessionRegistryBuilderLifecycleStatus = Exclude<
  SessionRegistryLifecycleStatus,
  "ended"
>;

export type SessionRegistryObservedLifecycleStatus = Extract<
  SessionRegistryLifecycleStatus,
  "active" | "ended"
>;

export interface SessionRegistryListOptions {
  includeArchived?: boolean;
  repo?: string | null;
  workstreamId?: string;
  nodeId?: string;
  text?: string;
}

export interface SessionRegistryListItem {
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
  tags: string[];
  originKind: SessionRegistryOriginKind;
  graphBinding: SessionRegistryGraphBinding | null;
  copilotSessionId: string | null;
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

interface SessionRegistryUpsertInputBase {
  id?: string;
  title: string;
  description?: string;
  color?: string | null;
  cwd: string;
  repo?: string | null;
  branch?: string | null;
  tags?: string[];
}

export interface ManualSessionRegistryUpsertInput
  extends SessionRegistryUpsertInputBase {
  origin: ManualSessionRegistryOrigin;
  lifecycleStatus?: Exclude<
    SessionRegistryLifecycleStatus,
    "ended" | "archived"
  >;
  graphBinding?: SessionRegistryGraphBinding | null;
}

export interface ObservedSessionRegistryUpsertInput
  extends SessionRegistryUpsertInputBase {
  origin: ObservedSessionRegistryOrigin;
  copilotSessionId: string;
  lastSeenAt?: string | null;
  lifecycleStatus?: SessionRegistryObservedLifecycleStatus;
  graphBinding?: SessionRegistryGraphBinding | null;
  observedSessionKind?: SessionRegistryObservedSessionKind | null;
  copilotProcessState?: SessionRegistryCopilotProcessState | null;
  copilotProcessId?: number | null;
  trustedSignalSource?: SessionRegistryTrustedSignalSource | null;
  trustedStartedAt?: string | null;
  trustedEndedAt?: string | null;
  trustedLastSignalAt?: string | null;
  trustedStartSource?: SessionRegistryTrustedStartSource | null;
  trustedEndReason?: SessionRegistryTrustedEndReason | null;
  trustedExecutionKind?: SessionRegistryTrustedExecutionKind | null;
  trustedInitialPromptLength?: number | null;
  trustedLastPromptLength?: number | null;
}

export interface LaunchedSessionRegistryUpsertInput
  extends SessionRegistryUpsertInputBase {
  origin: LaunchedSessionRegistryOrigin;
  lifecycleStatus?: Exclude<
    SessionRegistryLifecycleStatus,
    "ended" | "archived"
  >;
  graphBinding?: SessionRegistryGraphBinding | null;
}

export interface SessionRegistryObservedLinkInput {
  copilotSessionId: string;
  title?: string;
  cwd: string;
  repo?: string | null;
  branch?: string | null;
  lastSeenAt?: string | null;
  lifecycleStatus?: SessionRegistryObservedLifecycleStatus;
  observedSessionKind?: SessionRegistryObservedSessionKind | null;
  copilotProcessState?: SessionRegistryCopilotProcessState | null;
  copilotProcessId?: number | null;
  trustedSignalSource?: SessionRegistryTrustedSignalSource | null;
  trustedStartedAt?: string | null;
  trustedEndedAt?: string | null;
  trustedLastSignalAt?: string | null;
  trustedStartSource?: SessionRegistryTrustedStartSource | null;
  trustedEndReason?: SessionRegistryTrustedEndReason | null;
  trustedExecutionKind?: SessionRegistryTrustedExecutionKind | null;
  trustedInitialPromptLength?: number | null;
  trustedLastPromptLength?: number | null;
}

export const SESSION_REGISTRY_TRUSTED_SIGNAL_EVENTS = [
  "session.started",
  "session.ended",
  "prompt.submitted",
] as const;
export type SessionRegistryTrustedSignalEvent =
  (typeof SESSION_REGISTRY_TRUSTED_SIGNAL_EVENTS)[number];

export interface SessionRegistryTrustedSignalInput {
  event: SessionRegistryTrustedSignalEvent;
  source: SessionRegistryTrustedSignalSource;
  sessionId: string;
  timestamp: string;
  cwd: string;
  repo?: string | null;
  branch?: string | null;
  hookSource?: SessionRegistryTrustedStartSource | null;
  endReason?: SessionRegistryTrustedEndReason | null;
  executionKind?: SessionRegistryTrustedExecutionKind | null;
  environmentId?: string | null;
  initialPromptLength?: number | null;
  promptLength?: number | null;
}

export type SessionRegistryUpsertInput =
  | ManualSessionRegistryUpsertInput
  | ObservedSessionRegistryUpsertInput
  | LaunchedSessionRegistryUpsertInput;

export interface SessionRegistryPatch {
  title?: string;
  description?: string;
  color?: string | null;
  lifecycleStatus?: SessionRegistryBuilderLifecycleStatus;
  tags?: string[];
  graphBinding?: SessionRegistryGraphBinding | null;
}

export const SESSION_REGISTRY_CHANGE_EVENT_KINDS = [
  "upsert",
  "delete",
  "rebuild",
] as const;
export type SessionRegistryChangeEventKind =
  (typeof SESSION_REGISTRY_CHANGE_EVENT_KINDS)[number];

export interface SessionRegistryUpsertChangeEvent {
  kind: "upsert";
  registryId: string;
  snapshot: SessionRegistryRecord;
}

export interface SessionRegistryDeleteChangeEvent {
  kind: "delete";
  registryId: string;
}

export interface SessionRegistryRebuildChangeEvent {
  kind: "rebuild";
  registryIds: string[];
}

export type SessionRegistryChangeEvent =
  | SessionRegistryUpsertChangeEvent
  | SessionRegistryDeleteChangeEvent
  | SessionRegistryRebuildChangeEvent;

export type SessionRegistryChangeListener = (
  event: SessionRegistryChangeEvent,
) => void;

export interface SessionRegistryStore {
  listSessions(options?: SessionRegistryListOptions): SessionRegistryListItem[];
  getSession(id: string): SessionRegistryRecord | null;
  upsertSession(input: SessionRegistryUpsertInput): SessionRegistryRecord;
  attachObservedSession(
    id: string,
    observation: SessionRegistryObservedLinkInput,
  ): SessionRegistryRecord;
  recordTrustedSessionSignal(input: SessionRegistryTrustedSignalInput): SessionRegistryRecord;
  patchSession(id: string, patch: SessionRegistryPatch): SessionRegistryRecord;
  archiveSession(id: string): SessionRegistryRecord;
  deleteSession(id: string): void;
  subscribe(listener: SessionRegistryChangeListener): () => void;
}
