import type {
  LaunchedSessionRegistryOrigin,
  ManualSessionRegistryOrigin,
  ObservedSessionRegistryOrigin,
  SessionRegistryGraphBinding,
  SessionRegistryLifecycleStatus,
  SessionRegistryOriginKind,
  SessionRegistryRecord,
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
  cwd: string;
  repo?: string | null;
  branch?: string | null;
  lastSeenAt?: string | null;
  lifecycleStatus?: Extract<SessionRegistryLifecycleStatus, "ended">;
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
  patchSession(id: string, patch: SessionRegistryPatch): SessionRegistryRecord;
  archiveSession(id: string): SessionRegistryRecord;
  deleteSession(id: string): void;
  subscribe(listener: SessionRegistryChangeListener): () => void;
}
