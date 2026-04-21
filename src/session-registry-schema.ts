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

export interface SessionRegistryOrigin {
  kind: SessionRegistryOriginKind;
  importedFromCopilotSessionId?: string | null;
  launchClaimId?: string | null;
}

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
  lifecycleStatus: SessionRegistryLifecycleStatus;
  lastSeenAt: string | null;
  updatedAt: string;
  color: string | null;
  cwd: string;
  repo: string | null;
  branch: string | null;
  copilotSessionId: string | null;
  originKind: SessionRegistryOriginKind;
  graphBinding: SessionRegistryGraphBinding | null;
}

export interface SessionRegistryIndex {
  schemaVersion: typeof SESSION_REGISTRY_SCHEMA_VERSION;
  updatedAt: string;
  entries: SessionRegistryIndexEntry[];
}
