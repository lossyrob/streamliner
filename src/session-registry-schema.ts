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

export interface SessionRegistryGraphBinding {
  workstreamId: string;
  nodeId: string;
  launchClaimId?: string | null;
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
}

export interface SessionRegistryIndexEntry {
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
  copilotSessionId: string | null;
  tags: string[];
  originKind: SessionRegistryOriginKind;
  graphBinding: SessionRegistryGraphBinding | null;
}

export interface SessionRegistryIndex {
  schemaVersion: typeof SESSION_REGISTRY_SCHEMA_VERSION;
  updatedAt: string;
  entries: SessionRegistryIndexEntry[];
}
