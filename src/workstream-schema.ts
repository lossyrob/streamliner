export const WORKSTREAM_SCHEMA_VERSION = 1 as const;

export const WORKSTREAM_STATUSES = ["active", "blocked", "completed"] as const;
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];

export const WORKSTREAM_NODE_STATUSES = [
  "planned",
  "ready",
  "in-progress",
  "blocked",
  "completed",
] as const;
export type WorkstreamNodeStatus = (typeof WORKSTREAM_NODE_STATUSES)[number];

export const WORKSTREAM_ATTENTION_STATES = [
  "focus",
  "watch",
  "parked",
] as const;
export type WorkstreamAttention = (typeof WORKSTREAM_ATTENTION_STATES)[number];

export const WORKSTREAM_NODE_TYPES = ["task", "research", "gate"] as const;
export type WorkstreamNodeType = (typeof WORKSTREAM_NODE_TYPES)[number];

export const WORKSTREAM_CHECKPOINT_STATUSES = ["planned", "completed"] as const;
export type WorkstreamCheckpointStatus =
  (typeof WORKSTREAM_CHECKPOINT_STATUSES)[number];

export const WORKSTREAM_PULL_REQUEST_VALIDATION_STATES = [
  "not-applicable",
  "pending",
  "failing",
  "passing",
] as const;
export type WorkstreamPullRequestValidationState =
  (typeof WORKSTREAM_PULL_REQUEST_VALIDATION_STATES)[number];

export interface WorkstreamIssue {
  owner: string;
  repo: string;
  number: number;
}

export interface WorkstreamGithubPullRequestSnapshot {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision?: string | null;
  mergeStateStatus?: string | null;
  validationState: WorkstreamPullRequestValidationState;
  validationLabel: string;
}

export interface WorkstreamGithubIssueSnapshot {
  owner: string;
  repo: string;
  number: number;
  state: string;
  stateReason?: string | null;
  title: string;
  url: string;
  linkedPullRequests: WorkstreamGithubPullRequestSnapshot[];
  fetchedAt: string;
  error?: string;
}

export interface WorkstreamGithubSnapshot {
  issues: WorkstreamGithubIssueSnapshot[];
}

export interface WorkstreamRepo {
  id: string;
  owner: string;
  name: string;
  role?: string;
}

export interface WorkstreamNode {
  id: string;
  type: WorkstreamNodeType;
  title: string;
  summary: string;
  status: WorkstreamNodeStatus;
  attention: WorkstreamAttention;
  repoIds: string[];
  issue?: WorkstreamIssue;
  dependsOn: string[];
}

export interface WorkstreamCheckpoint {
  id: string;
  title: string;
  summary: string;
  status: WorkstreamCheckpointStatus;
  nodeIds: string[];
}

export interface WorkstreamDocument {
  schemaVersion: typeof WORKSTREAM_SCHEMA_VERSION;
  id: string;
  title: string;
  summary: string;
  status: WorkstreamStatus;
  attention: WorkstreamAttention;
  createdAt: string;
  updatedAt: string;
  trackingIssue?: WorkstreamIssue;
  repos: WorkstreamRepo[];
  nodes: WorkstreamNode[];
  checkpoints: WorkstreamCheckpoint[];
}
