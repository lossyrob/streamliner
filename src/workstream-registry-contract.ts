export const WORKSTREAM_REGISTRY_SCHEMA_VERSION = 1 as const;

export type WorkstreamFileStatus = "available" | "missing" | "unreadable";

export interface WorkstreamRegistryEntry {
  projectKey: string;
  workstreamId: string;
  title: string;
  summary: string;
  path: string;
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

export interface WorkstreamRegistryListResponse {
  version: typeof WORKSTREAM_REGISTRY_SCHEMA_VERSION;
  migratedFromRecentsAt?: string;
  migrationWarnings: WorkstreamRegistryWarning[];
  workstreams: WorkstreamRegistryListEntry[];
}

export interface WorkstreamRegisterResponse {
  workstream: WorkstreamRegistryListEntry;
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
