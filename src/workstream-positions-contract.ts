export const WORKSTREAM_POSITIONS_SCHEMA_VERSION = 1 as const;

export interface WorkstreamGraphNodePosition {
  x: number;
  y: number;
  updatedAt: string;
}

export interface WorkstreamPositionsDocument {
  schemaVersion: typeof WORKSTREAM_POSITIONS_SCHEMA_VERSION;
  positions: Record<string, WorkstreamGraphNodePosition>;
}

export interface WorkstreamPositionsResponse extends WorkstreamPositionsDocument {
  savedAt?: string;
}
