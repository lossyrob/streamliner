import type {
  SessionRegistryGraphBinding,
  SessionRegistryLifecycleStatus,
  SessionRegistryOrigin,
  SessionRegistryOriginKind,
  SessionRegistryRecord,
} from "./session-registry-schema";

// The future runtime implementation will live under src/session-registry/.

export type SessionRegistryBuilderLifecycleStatus = Exclude<
  SessionRegistryLifecycleStatus,
  "ended"
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

export interface SessionRegistryUpsertInput {
  id?: string;
  title: string;
  description?: string;
  color?: string | null;
  cwd: string;
  repo?: string | null;
  branch?: string | null;
  copilotSessionId?: string | null;
  lifecycleStatus?: SessionRegistryLifecycleStatus;
  lastSeenAt?: string | null;
  tags?: string[];
  origin: SessionRegistryOrigin;
  graphBinding?: SessionRegistryGraphBinding | null;
}

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

export interface SessionRegistryChangeEvent {
  kind: SessionRegistryChangeEventKind;
  sessionId?: string;
  snapshot?: SessionRegistryRecord;
}

export type SessionRegistryChangeListener = (
  event: SessionRegistryChangeEvent,
) => void;

export interface SessionRegistryStore {
  listSessions(options?: SessionRegistryListOptions): SessionRegistryListItem[];
  getSession(id: string): SessionRegistryRecord | null;
  upsertSession(input: SessionRegistryUpsertInput): SessionRegistryRecord;
  patchSession(id: string, patch: SessionRegistryPatch): SessionRegistryRecord;
  archiveSession(id: string): SessionRegistryRecord;
  deleteSession(id: string): void;
  subscribe(listener: SessionRegistryChangeListener): () => void;
}
