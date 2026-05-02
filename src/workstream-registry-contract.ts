export const WORKSTREAM_REGISTRY_SCHEMA_VERSION = 1 as const;
export const WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION = 1 as const;

export type WorkstreamFileStatus = "available" | "missing" | "unreadable";
export type WorkstreamRegistrySource = "path" | "browser-directory" | "source";
export type WorkstreamSourceType = "project-root" | "workstreams-root";
export type WorkstreamSourceHealth = "available" | "missing" | "unreadable";
export type WorkstreamScanMessageSeverity = "warning" | "error";

export interface WorkstreamScanMessage {
  code: string;
  severity: WorkstreamScanMessageSeverity;
  message: string;
  path?: string;
  sourceId?: string;
  projectKey?: string;
  workstreamId?: string;
}

export interface WorkstreamSourceConfig {
  id: string;
  type: WorkstreamSourceType;
  path: string;
  addedAt: string;
  updatedAt: string;
  lastScanAt?: string;
  health?: WorkstreamSourceHealth;
  discoveredCount?: number;
  messages?: WorkstreamScanMessage[];
}

export interface WorkstreamSourceListEntry extends WorkstreamSourceConfig {
  health: WorkstreamSourceHealth;
  discoveredCount: number;
  messages: WorkstreamScanMessage[];
}

export interface ArchivedWorkstreamIdentity {
  projectKey: string;
  workstreamId: string;
  archivedAt: string;
}

export interface WorkstreamConflictCandidate {
  source: WorkstreamRegistrySource;
  path: string;
  selected: boolean;
  title?: string;
  sourceId?: string;
  sourceType?: WorkstreamSourceType;
  sourcePath?: string;
}

export interface WorkstreamConflict {
  projectKey: string;
  workstreamId: string;
  archived: boolean;
  message: string;
  candidates: WorkstreamConflictCandidate[];
}

export interface WorkstreamRegistryEntry {
  source?: WorkstreamRegistrySource;
  sourceId?: string;
  sourceType?: WorkstreamSourceType;
  sourcePath?: string;
  archived?: boolean;
  projectKey: string;
  workstreamId: string;
  title: string;
  summary: string;
  path: string;
  browserDirectoryKey?: string;
  browserDirectoryName?: string;
  addedAt: string;
  lastOpenedAt: string;
}

export interface WorkstreamRegistryListEntry extends WorkstreamRegistryEntry {
  fileStatus: WorkstreamFileStatus;
  lastError?: string;
}

export interface WorkstreamRegistryWarning {
  code: string;
  message: string;
  path?: string;
  projectKey?: string;
  workstreamId?: string;
}

export interface WorkstreamRegistryDocument {
  version: typeof WORKSTREAM_REGISTRY_SCHEMA_VERSION;
  migratedFromRecentsAt?: string;
  migrationWarnings: WorkstreamRegistryWarning[];
  workstreams: WorkstreamRegistryEntry[];
}

export interface WorkstreamSourceRegistryDocument {
  version: typeof WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION;
  sources: WorkstreamSourceConfig[];
  archivedWorkstreams: ArchivedWorkstreamIdentity[];
  discoveredWorkstreams: WorkstreamRegistryEntry[];
}

export interface WorkstreamRegistryListResponse {
  version: typeof WORKSTREAM_REGISTRY_SCHEMA_VERSION;
  migratedFromRecentsAt?: string;
  migrationWarnings: WorkstreamRegistryWarning[];
  workstreams: WorkstreamRegistryListEntry[];
  archivedWorkstreams?: WorkstreamRegistryListEntry[];
  sources?: WorkstreamSourceListEntry[];
  conflicts?: WorkstreamConflict[];
}

export interface WorkstreamRegisterResponse {
  workstream: WorkstreamRegistryListEntry;
}

export interface WorkstreamSourceRegisterResponse {
  source: WorkstreamSourceListEntry;
  workstreams: WorkstreamRegistryListEntry[];
  archivedWorkstreams: WorkstreamRegistryListEntry[];
  conflicts: WorkstreamConflict[];
}

export interface WorkstreamGraphErrorResponse {
  code:
    | "workstream_not_found"
    | "workstream_file_missing"
    | "workstream_file_unreadable"
    | "workstream_graph_invalid";
  error: string;
  workstream?: WorkstreamRegistryListEntry;
}
