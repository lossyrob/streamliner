import type {
  WorkstreamAttention,
  WorkstreamCheckpoint,
  WorkstreamCheckpointStatus,
  WorkstreamDesignReference,
  WorkstreamDocument,
  WorkstreamExternalDependency,
  WorkstreamExternalDependencyStatus,
  WorkstreamExternalDependencyTarget,
  WorkstreamGithubIssueSnapshot,
  WorkstreamGithubPullRequestSnapshot,
  WorkstreamGithubSnapshot,
  WorkstreamIssue,
  WorkstreamLaunchDefaults,
  WorkstreamLaunchPolicy,
  WorkstreamLaunchRequiredTracker,
  WorkstreamLaunchTerminalDefaults,
  WorkstreamLaunchTerminalPreference,
  WorkstreamNode,
  WorkstreamNodeStatus,
  WorkstreamTracker,
  WorkstreamTrackerType,
  WorkstreamNodeType,
  WorkstreamRepo,
  WorkstreamStatus,
} from "./workstream-schema";
import {
  WORKSTREAM_ATTENTION_STATES,
  WORKSTREAM_CHECKPOINT_STATUSES,
  WORKSTREAM_EXTERNAL_DEPENDENCY_STATUSES,
  WORKSTREAM_LAUNCH_REQUIRED_TRACKERS,
  WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES,
  WORKSTREAM_NODE_STATUSES,
  WORKSTREAM_NODE_TYPES,
  WORKSTREAM_SCHEMA_VERSION,
  WORKSTREAM_STATUSES,
  WORKSTREAM_TRACKER_TYPES,
} from "./workstream-schema";

type JsonRecord = Record<string, unknown>;

export interface WorkstreamFreshness {
  label: string;
  stale: boolean;
  timestampLabel: string;
}

export interface WorkstreamSignal {
  label: string;
  value: string;
  tone: "accent" | "green" | "amber" | "muted";
}

export type WorkstreamOperationalStatus =
  | WorkstreamNodeStatus
  | "waiting-for-review"
  | "waiting-for-validation";

export interface WorkstreamDerivedNode {
  node: WorkstreamNode;
  operationalStatus: WorkstreamOperationalStatus;
  dependencyReady: boolean;
  completionSource: "artifact" | "github" | null;
  externalDependencies: WorkstreamExternalDependencyView[];
  githubIssue?: WorkstreamGithubIssueSnapshot;
  activePullRequest?: WorkstreamGithubPullRequestSnapshot;
}

export type WorkstreamExternalDependencyResolutionState =
  | "resolving"
  | "resolved"
  | "unresolved"
  | "error"
  | "manual";

export interface WorkstreamResolvedExternalDependencyTarget {
  kind: "node" | "workstream";
  title: string;
  status: WorkstreamNodeStatus | WorkstreamStatus;
  satisfied: boolean;
  archived?: boolean;
}

export type WorkstreamExternalDependencyResolution =
  | {
      state: "resolved";
      target: WorkstreamResolvedExternalDependencyTarget;
    }
  | {
      state: "unresolved";
      reason: string;
      archived?: boolean;
    }
  | {
      state: "error";
      error: string;
      archived?: boolean;
    };

export interface WorkstreamExternalDependencyView {
  key: string;
  graphNodeId: string;
  nodeId: string;
  dependency: WorkstreamExternalDependency;
  label: string;
  detail: string;
  statusLabel: string;
  state: WorkstreamExternalDependencyResolutionState;
  satisfied: boolean;
  target?: WorkstreamExternalDependencyTarget;
  targetTitle?: string;
  targetStatus?: WorkstreamNodeStatus | WorkstreamStatus;
  targetKind?: "node" | "workstream";
  archived?: boolean;
  url?: string;
  error?: string;
  ignoredStatus?: WorkstreamExternalDependencyStatus;
}

export interface WorkstreamCheckpointProgress {
  checkpoint: WorkstreamCheckpoint;
  totalNodes: number;
  completedNodes: number;
  isCurrent: boolean;
}

export interface WorkstreamViewModel {
  readyNow: WorkstreamNode[];
  inFlight: WorkstreamNode[];
  blockedOrAttention: WorkstreamNode[];
  gateNodes: WorkstreamNode[];
  waitingForReview: WorkstreamDerivedNode[];
  waitingForValidation: WorkstreamDerivedNode[];
  derivedNodes: WorkstreamDerivedNode[];
  freshness: WorkstreamFreshness;
  signals: WorkstreamSignal[];
  checkpoints: WorkstreamCheckpointProgress[];
}

export interface BuildWorkstreamViewModelOptions {
  externalDependencyResolutions?: ReadonlyMap<
    string,
    WorkstreamExternalDependencyResolution
  >;
}

const STALE_ARTIFACT_MS = 7 * 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value as JsonRecord;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value;
}

function asKebabCaseId(value: unknown, label: string): string {
  const id = asNonEmptyString(value, label);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Expected ${label} to be a kebab-case id.`);
  }
  return id;
}

function asTimestamp(value: unknown, label: string): string {
  const timestamp = asNonEmptyString(value, label);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Expected ${label} to be an ISO timestamp.`);
  }
  return timestamp;
}

function asInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return value;
}

function asIdArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array.`);
  }

  return value.map((entry, index) =>
    asKebabCaseId(entry, `${label}[${index}]`),
  );
}

function asOptionalNonEmptyString(
  value: unknown,
  label: string,
): string | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  return asNonEmptyString(value, label);
}

function asOptionalUrl(value: unknown, label: string): string | undefined {
  const url = asOptionalNonEmptyString(value, label);
  if (typeof url === "undefined") {
    return undefined;
  }
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(`Expected ${label} to be a valid absolute URL.`);
  }
}

function asEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Expected ${label} to be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/**
 * Tolerant variant of asEnum used when the caller has opted into resilient
 * parsing (e.g., the source scanner). When the value is not in the allowed
 * set, emits a warning through the parse-options callback and returns the
 * provided fallback so the document can still load. When no callback is
 * supplied, behaves exactly like asEnum (throws).
 */
function asEnumTolerant<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
  fallback: T,
  options: ParseWorkstreamOptions | undefined,
): T {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  if (!options?.onParseWarning) {
    throw new Error(`Expected ${label} to be one of: ${allowed.join(", ")}.`);
  }
  options.onParseWarning({
    code: "non-canonical-enum",
    label,
    received: typeof value === "string" ? value : null,
    allowed: [...allowed],
    fallback,
  });
  return fallback;
}

function parseIssue(value: unknown, label: string): WorkstreamIssue {
  const record = asObject(value, label);
  return {
    owner: asNonEmptyString(record.owner, `${label}.owner`),
    repo: asNonEmptyString(record.repo, `${label}.repo`),
    number: asInteger(record.number, `${label}.number`),
  };
}

function parseDesignReference(
  value: unknown,
  label: string,
): WorkstreamDesignReference {
  const record = asObject(value, label);
  return {
    repoId: asKebabCaseId(record.repoId, `${label}.repoId`),
    path: asNonEmptyString(record.path, `${label}.path`),
  };
}

function parseTracker(value: unknown, label: string): WorkstreamTracker {
  const record = asObject(value, label);
  const type = asEnum<WorkstreamTrackerType>(
    record.type,
    `${label}.type`,
    WORKSTREAM_TRACKER_TYPES,
  );

  switch (type) {
    case "github":
      return {
        type,
        ...parseIssue(record, label),
      };
    case "local":
      return {
        type,
        path: asNonEmptyString(record.path, `${label}.path`),
      };
  }
}

function parseExternalDependencyTarget(
  value: unknown,
  label: string,
): WorkstreamExternalDependencyTarget {
  const record = asObject(value, label);
  return {
    projectKey: asKebabCaseId(record.projectKey, `${label}.projectKey`),
    workstreamId: asKebabCaseId(record.workstreamId, `${label}.workstreamId`),
    nodeId:
      typeof record.nodeId === "undefined"
        ? undefined
        : asKebabCaseId(record.nodeId, `${label}.nodeId`),
  };
}

function parseExternalDependency(
  value: unknown,
  label: string,
): WorkstreamExternalDependency {
  const record = asObject(value, label);
  const target =
    typeof record.target === "undefined"
      ? undefined
      : parseExternalDependencyTarget(record.target, `${label}.target`);
  const labelText = asOptionalNonEmptyString(record.label, `${label}.label`);
  const url = asOptionalUrl(record.url, `${label}.url`);
  const status =
    typeof record.status === "undefined"
      ? undefined
      : asEnum<WorkstreamExternalDependencyStatus>(
          record.status,
          `${label}.status`,
          WORKSTREAM_EXTERNAL_DEPENDENCY_STATUSES,
        );

  if (!target && !labelText && !url) {
    throw new Error(
      `Expected ${label} to include target, label, or url for unresolved external dependency context.`,
    );
  }

  return {
    id: asKebabCaseId(record.id, `${label}.id`),
    target,
    label: labelText,
    url,
    status,
  };
}

function parseExternalDependencies(
  value: unknown,
  label: string,
): WorkstreamExternalDependency[] {
  if (typeof value === "undefined") {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array.`);
  }
  return value.map((entry, index) =>
    parseExternalDependency(entry, `${label}[${index}]`),
  );
}

function parseRepo(value: unknown, label: string): WorkstreamRepo {
  const record = asObject(value, label);
  const role = record.role;

  return {
    id: asKebabCaseId(record.id, `${label}.id`),
    owner: asNonEmptyString(record.owner, `${label}.owner`),
    name: asNonEmptyString(record.name, `${label}.name`),
    role:
      typeof role === "undefined"
        ? undefined
        : asNonEmptyString(role, `${label}.role`),
  };
}

function parseLaunchPolicy(value: unknown, label: string): WorkstreamLaunchPolicy {
  const record = asObject(value, label);
  const requiredTracker = record.requiredTracker;
  return {
    requiredTracker:
      typeof requiredTracker === "undefined"
        ? undefined
        : asEnum<WorkstreamLaunchRequiredTracker>(
            requiredTracker,
            `${label}.requiredTracker`,
            WORKSTREAM_LAUNCH_REQUIRED_TRACKERS,
          ),
  };
}

function parseOptionalHexColor(value: unknown, label: string): string | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const color = asNonEmptyString(value, label).trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error(`Expected ${label} to be a #RRGGBB color.`);
  }
  return color.toLowerCase();
}

function parseOptionalString(value: unknown, label: string): string | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return asNonEmptyString(value, label).trim();
}

function parseOptionalKebabCaseId(value: unknown, label: string): string | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return asKebabCaseId(value, label);
}

function parseLaunchTerminalDefaults(
  value: unknown,
  label: string,
): WorkstreamLaunchTerminalDefaults {
  const record = asObject(value, label);
  const preferredTerminal = record.preferredTerminal;
  return {
    preferredTerminal:
      typeof preferredTerminal === "undefined"
        ? undefined
        : asEnum<WorkstreamLaunchTerminalPreference>(
            preferredTerminal,
            `${label}.preferredTerminal`,
            WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES,
          ),
    titleTemplate: parseOptionalString(record.titleTemplate, `${label}.titleTemplate`),
    tabColor: parseOptionalHexColor(record.tabColor, `${label}.tabColor`),
  };
}

function parseOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${label} to be a boolean.`);
  }
  return value;
}

function parseLaunchDefaults(value: unknown, label: string): WorkstreamLaunchDefaults {
  const record = asObject(value, label);
  const terminal = record.terminal;
  return {
    promptProfileId: parseOptionalKebabCaseId(record.promptProfileId, `${label}.promptProfileId`),
    terminal:
      typeof terminal === "undefined"
        ? undefined
        : parseLaunchTerminalDefaults(terminal, `${label}.terminal`),
    launchAfterInit: parseOptionalBoolean(record.launchAfterInit, `${label}.launchAfterInit`),
    reviewCompanion: parseOptionalBoolean(record.reviewCompanion, `${label}.reviewCompanion`),
    reviewPromptTemplateId: parseOptionalKebabCaseId(
      record.reviewPromptTemplateId,
      `${label}.reviewPromptTemplateId`,
    ),
  };
}

function parseNode(
  value: unknown,
  label: string,
  options?: ParseWorkstreamOptions,
): WorkstreamNode {
  const record = asObject(value, label);
  const tracker = record.tracker;

  return {
    id: asKebabCaseId(record.id, `${label}.id`),
    type: asEnum<WorkstreamNodeType>(
      record.type,
      `${label}.type`,
      WORKSTREAM_NODE_TYPES,
    ),
    title: asNonEmptyString(record.title, `${label}.title`),
    summary: asNonEmptyString(record.summary, `${label}.summary`),
    status: asEnumTolerant<WorkstreamNodeStatus>(
      record.status,
      `${label}.status`,
      WORKSTREAM_NODE_STATUSES,
      "blocked",
      options,
    ),
    attention: asEnum<WorkstreamAttention>(
      record.attention,
      `${label}.attention`,
      WORKSTREAM_ATTENTION_STATES,
    ),
    repoIds: asIdArray(record.repoIds ?? [], `${label}.repoIds`),
    tracker:
      typeof tracker === "undefined"
        ? undefined
        : parseTracker(tracker, `${label}.tracker`),
    dependsOn: asIdArray(record.dependsOn ?? [], `${label}.dependsOn`),
    externalDependsOn: parseExternalDependencies(
      record.externalDependsOn,
      `${label}.externalDependsOn`,
    ),
  };
}

function parseCheckpoint(value: unknown, label: string): WorkstreamCheckpoint {
  const record = asObject(value, label);
  return {
    id: asKebabCaseId(record.id, `${label}.id`),
    title: asNonEmptyString(record.title, `${label}.title`),
    summary: asNonEmptyString(record.summary, `${label}.summary`),
    status: asEnum<WorkstreamCheckpointStatus>(
      record.status,
      `${label}.status`,
      WORKSTREAM_CHECKPOINT_STATUSES,
    ),
    nodeIds: asIdArray(record.nodeIds ?? [], `${label}.nodeIds`),
  };
}

function parseArray<T>(
  value: unknown,
  label: string,
  parser: (entry: unknown, label: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array.`);
  }
  return value.map((entry, index) => parser(entry, `${label}[${index}]`));
}

function assertSemanticallyValid(
  workstream: WorkstreamDocument,
): WorkstreamDocument {
  const repoIds = new Set<string>();
  for (const repo of workstream.repos) {
    if (repoIds.has(repo.id)) {
      throw new Error(`Duplicate repo id '${repo.id}'`);
    }
    repoIds.add(repo.id);
  }

  const knownRepos = new Set(
    workstream.repos.map((repo) => `${repo.owner}/${repo.name}`.toLowerCase()),
  );
  if (workstream.trackingIssue) {
    const trackingIssueRepo =
      `${workstream.trackingIssue.owner}/${workstream.trackingIssue.repo}`.toLowerCase();
    if (!knownRepos.has(trackingIssueRepo)) {
      throw new Error(
        `Issue repo '${trackingIssueRepo}' is not declared in repos`,
      );
    }
  }
  const nodeIds = new Set<string>();
  for (const node of workstream.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate node id '${node.id}'`);
    }
    nodeIds.add(node.id);

    for (const repoId of node.repoIds) {
      if (!repoIds.has(repoId)) {
        throw new Error(`Unknown repo id '${repoId}'`);
      }
    }

    for (const dependencyId of node.dependsOn) {
      if (dependencyId === node.id) {
        throw new Error("A node cannot depend on itself");
      }
    }

    const externalDependencyIds = new Set<string>();
    for (const dependency of node.externalDependsOn ?? []) {
      if (externalDependencyIds.has(dependency.id)) {
        throw new Error(
          `Duplicate external dependency id '${dependency.id}' on node '${node.id}'`,
        );
      }
      externalDependencyIds.add(dependency.id);
      const target = dependency.target;
      if (
        target &&
        target.projectKey === (workstream.projectKey ?? workstream.id) &&
        target.workstreamId === workstream.id &&
        target.nodeId === node.id
      ) {
        throw new Error("A node cannot externally depend on itself");
      }
    }

    if (node.tracker?.type === "github") {
      const trackerRepo =
        `${node.tracker.owner}/${node.tracker.repo}`.toLowerCase();
      if (!knownRepos.has(trackerRepo)) {
        throw new Error(`Tracker repo '${trackerRepo}' is not declared in repos`);
      }
    }
  }

  const designRefKeys = new Set<string>();
  for (const designRef of workstream.designRefs) {
    if (!repoIds.has(designRef.repoId)) {
      throw new Error(`Unknown design ref repo '${designRef.repoId}'`);
    }

    const designRefKey = `${designRef.repoId}:${designRef.path}`.toLowerCase();
    if (designRefKeys.has(designRefKey)) {
      throw new Error(
        `Duplicate design ref '${designRef.repoId}:${designRef.path}'`,
      );
    }
    designRefKeys.add(designRefKey);
  }

  for (const node of workstream.nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!nodeIds.has(dependencyId)) {
        throw new Error(`Unknown dependency '${dependencyId}'`);
      }
    }
  }

  const checkpointIds = new Set<string>();
  for (const checkpoint of workstream.checkpoints) {
    if (checkpointIds.has(checkpoint.id)) {
      throw new Error(`Duplicate checkpoint id '${checkpoint.id}'`);
    }
    checkpointIds.add(checkpoint.id);

    for (const nodeId of checkpoint.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        throw new Error(`Unknown checkpoint node '${nodeId}'`);
      }
    }
  }

  return workstream;
}

export interface ParseWorkstreamWarning {
  code: "non-canonical-enum";
  label: string;
  received: string | null;
  allowed: string[];
  fallback: string;
}

export interface ParseWorkstreamOptions {
  /**
   * Callback invoked when a non-fatal schema deviation is tolerated (e.g., an
   * unknown node status). Without this callback, parseWorkstreamDocument
   * preserves its strict behavior and throws on unknown enum values.
   */
  onParseWarning?: (warning: ParseWorkstreamWarning) => void;
}

export function parseWorkstreamDocument(
  rawJson: string,
  options?: ParseWorkstreamOptions,
): WorkstreamDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid workstream JSON: ${message}`);
  }

  const record = asObject(parsed, "workstream");
  const projectKey = record.projectKey;
  const trackingIssue = record.trackingIssue;
  const launchPolicy = record.launchPolicy;
  const launchDefaults = record.launchDefaults;
  const designRefs = record.designRefs;

  return assertSemanticallyValid({
    schemaVersion:
      record.schemaVersion === WORKSTREAM_SCHEMA_VERSION
        ? WORKSTREAM_SCHEMA_VERSION
        : (() => {
            throw new Error(
              `Expected workstream.schemaVersion to equal ${WORKSTREAM_SCHEMA_VERSION}.`,
            );
          })(),
    id: asKebabCaseId(record.id, "workstream.id"),
    projectKey:
      typeof projectKey === "undefined"
        ? undefined
        : asKebabCaseId(projectKey, "workstream.projectKey"),
    title: asNonEmptyString(record.title, "workstream.title"),
    summary: asNonEmptyString(record.summary, "workstream.summary"),
    status: asEnum<WorkstreamStatus>(
      record.status,
      "workstream.status",
      WORKSTREAM_STATUSES,
    ),
    attention: asEnum<WorkstreamAttention>(
      record.attention,
      "workstream.attention",
      WORKSTREAM_ATTENTION_STATES,
    ),
    createdAt: asTimestamp(record.createdAt, "workstream.createdAt"),
    updatedAt: asTimestamp(record.updatedAt, "workstream.updatedAt"),
    trackingIssue:
      typeof trackingIssue === "undefined"
        ? undefined
        : parseIssue(trackingIssue, "workstream.trackingIssue"),
    launchPolicy:
      typeof launchPolicy === "undefined"
        ? undefined
        : parseLaunchPolicy(launchPolicy, "workstream.launchPolicy"),
    launchDefaults:
      typeof launchDefaults === "undefined"
        ? undefined
        : parseLaunchDefaults(launchDefaults, "workstream.launchDefaults"),
    repos: parseArray(record.repos, "workstream.repos", parseRepo),
    designRefs:
      typeof designRefs === "undefined"
        ? []
        : parseArray(
            designRefs,
            "workstream.designRefs",
            parseDesignReference,
          ),
    nodes: parseArray(record.nodes, "workstream.nodes", (v, l) => parseNode(v, l, options)),
    checkpoints: parseArray(
      record.checkpoints,
      "workstream.checkpoints",
      parseCheckpoint,
    ),
  });
}

function formatList(values: string[], fallback: string): string {
  if (values.length === 0) {
    return fallback;
  }
  if (values.length <= 3) {
    return values.join(" · ");
  }
  return `${values.slice(0, 3).join(" · ")} +${values.length - 3} more`;
}

export function describeFreshness(
  updatedAt: string,
  now = new Date(),
): WorkstreamFreshness {
  const updated = new Date(updatedAt);
  const diffMs = now.getTime() - updated.getTime();

  if (diffMs < 0) {
    return {
      label: "Updated in the future",
      stale: true,
      timestampLabel: updated.toLocaleString(),
    };
  }

  const stale = diffMs > STALE_ARTIFACT_MS;

  let label = "Updated just now";
  if (diffMs >= 24 * 60 * 60 * 1000) {
    label = `Updated ${Math.round(diffMs / (24 * 60 * 60 * 1000))} day(s) ago`;
  } else if (diffMs >= 60 * 60 * 1000) {
    label = `Updated ${Math.round(diffMs / (60 * 60 * 1000))} hour(s) ago`;
  } else if (diffMs >= 60 * 1000) {
    label = `Updated ${Math.round(diffMs / (60 * 1000))} minute(s) ago`;
  }

  return {
    label,
    stale,
    timestampLabel: updated.toLocaleString(),
  };
}

function issueKey(issue: WorkstreamIssue): string {
  return `${issue.owner}/${issue.repo}#${issue.number}`.toLowerCase();
}

function githubIssueOf(tracker?: WorkstreamTracker): WorkstreamIssue | undefined {
  if (tracker?.type !== "github") {
    return undefined;
  }

  return tracker;
}

function buildIssueSnapshotMap(
  githubSnapshot?: WorkstreamGithubSnapshot,
): Map<string, WorkstreamGithubIssueSnapshot> {
  return new Map(
    (githubSnapshot?.issues ?? []).map((issueSnapshot) => [
      issueKey(issueSnapshot),
      issueSnapshot,
    ]),
  );
}

function isIssueCompleted(
  issueSnapshot?: WorkstreamGithubIssueSnapshot,
): boolean {
  if (issueSnapshot?.state.toLowerCase() !== "closed") {
    return false;
  }

  const stateReason = issueSnapshot.stateReason?.trim().toUpperCase();
  return !stateReason || stateReason === "COMPLETED";
}

function isOpenPullRequest(pr: WorkstreamGithubPullRequestSnapshot): boolean {
  return pr.state.toLowerCase() === "open";
}

function needsReview(pr: WorkstreamGithubPullRequestSnapshot): boolean {
  if (pr.isDraft || !isOpenPullRequest(pr)) {
    return false;
  }

  const reviewDecision = pr.reviewDecision?.toUpperCase() ?? "REVIEW_REQUIRED";
  return reviewDecision === "REVIEW_REQUIRED";
}

function waitsForValidation(pr: WorkstreamGithubPullRequestSnapshot): boolean {
  if (pr.isDraft || !isOpenPullRequest(pr)) {
    return false;
  }

  if (pr.reviewDecision?.toUpperCase() !== "APPROVED") {
    return false;
  }

  return pr.validationState === "pending" || pr.validationState === "failing";
}

function selectActionablePullRequest(
  pullRequests: WorkstreamGithubPullRequestSnapshot[],
): WorkstreamGithubPullRequestSnapshot | undefined {
  return (
    pullRequests.find((pr) => needsReview(pr)) ??
    pullRequests.find((pr) => waitsForValidation(pr)) ??
    pullRequests.find((pr) => isOpenPullRequest(pr))
  );
}

function buildCheckpointProgress(
  workstream: WorkstreamDocument,
  completedNodeIds: Set<string>,
): WorkstreamCheckpointProgress[] {
  let currentAssigned = false;
  return workstream.checkpoints.map((checkpoint) => {
    const totalNodes = checkpoint.nodeIds.length;
    const completedNodes = checkpoint.nodeIds.reduce(
      (count, nodeId) => (completedNodeIds.has(nodeId) ? count + 1 : count),
      0,
    );
    const isComplete =
      checkpoint.status === "completed" ||
      (totalNodes > 0 && completedNodes === totalNodes);
    let isCurrent = false;
    if (!currentAssigned && !isComplete) {
      isCurrent = true;
      currentAssigned = true;
    }
    return {
      checkpoint,
      totalNodes,
      completedNodes,
      isCurrent,
    };
  });
}

export function workstreamExternalDependencyKey(
  nodeId: string,
  dependencyId: string,
): string {
  return `${nodeId}:${dependencyId}`;
}

export function workstreamExternalDependencyGraphNodeId(
  nodeId: string,
  dependencyId: string,
): string {
  return `external:${nodeId}:${dependencyId}`;
}

function externalDependencyFallbackLabel(
  dependency: WorkstreamExternalDependency,
): string {
  if (dependency.label) {
    return dependency.label;
  }
  if (dependency.target?.nodeId) {
    return `${dependency.target.workstreamId} / ${dependency.target.nodeId}`;
  }
  if (dependency.target) {
    return dependency.target.workstreamId;
  }
  if (dependency.url) {
    return dependency.url;
  }
  return dependency.id;
}

function buildExternalDependencyView(
  nodeId: string,
  dependency: WorkstreamExternalDependency,
  resolution: WorkstreamExternalDependencyResolution | undefined,
): WorkstreamExternalDependencyView {
  const key = workstreamExternalDependencyKey(nodeId, dependency.id);
  const graphNodeId = workstreamExternalDependencyGraphNodeId(nodeId, dependency.id);
  const fallbackLabel = externalDependencyFallbackLabel(dependency);

  if (dependency.target) {
    if (resolution?.state === "resolved") {
      const target = resolution.target;
      return {
        key,
        graphNodeId,
        nodeId,
        dependency,
        label: dependency.label ?? target.title,
        detail: `${target.kind === "node" ? "Node" : "Workstream"} ${target.status}`,
        statusLabel: target.satisfied ? "satisfied" : "waiting",
        state: "resolved",
        satisfied: target.satisfied,
        target: dependency.target,
        targetTitle: target.title,
        targetStatus: target.status,
        targetKind: target.kind,
        archived: target.archived,
        url: dependency.url,
        ignoredStatus: dependency.status,
      };
    }

    const unresolvedSatisfied = dependency.status === "satisfied";
    if (unresolvedSatisfied) {
      return {
        key,
        graphNodeId,
        nodeId,
        dependency,
        label: fallbackLabel,
        detail:
          resolution?.state === "error"
            ? `Manual override while target errored: ${resolution.error}`
            : resolution?.state === "unresolved"
              ? `Manual override while target unresolved: ${resolution.reason}`
              : "Manual override while target is resolving",
        statusLabel: "manually satisfied",
        state: "manual",
        satisfied: true,
        target: dependency.target,
        archived: resolution?.state === "unresolved" || resolution?.state === "error"
          ? resolution.archived
          : undefined,
        url: dependency.url,
        error: resolution?.state === "error" ? resolution.error : undefined,
      };
    }

    if (resolution?.state === "error") {
      return {
        key,
        graphNodeId,
        nodeId,
        dependency,
        label: fallbackLabel,
        detail: resolution.error,
        statusLabel: "error",
        state: "error",
        satisfied: false,
        target: dependency.target,
        archived: resolution.archived,
        url: dependency.url,
        error: resolution.error,
      };
    }

    if (resolution?.state === "unresolved") {
      return {
        key,
        graphNodeId,
        nodeId,
        dependency,
        label: fallbackLabel,
        detail: resolution.reason,
        statusLabel: "unresolved",
        state: "unresolved",
        satisfied: false,
        target: dependency.target,
        archived: resolution.archived,
        url: dependency.url,
      };
    }

    return {
      key,
      graphNodeId,
      nodeId,
      dependency,
      label: fallbackLabel,
      detail: "Resolving upstream workstream dependency.",
      statusLabel: "resolving",
      state: "resolving",
      satisfied: false,
      target: dependency.target,
      url: dependency.url,
    };
  }

  const satisfied = dependency.status === "satisfied";
  return {
    key,
    graphNodeId,
    nodeId,
    dependency,
    label: fallbackLabel,
    detail: dependency.url
      ? "URL-only external dependency."
      : "Manual external dependency.",
    statusLabel: satisfied ? "manually satisfied" : "pending",
    state: "manual",
    satisfied,
    url: dependency.url,
  };
}

function externalDependencyViewsForNode(
  node: WorkstreamNode,
  resolutions:
    | ReadonlyMap<string, WorkstreamExternalDependencyResolution>
    | undefined,
): WorkstreamExternalDependencyView[] {
  return (node.externalDependsOn ?? []).map((dependency) =>
    buildExternalDependencyView(
      node.id,
      dependency,
      resolutions?.get(workstreamExternalDependencyKey(node.id, dependency.id)),
    ),
  );
}

function buildArtifactOnlyViewModel(
  workstream: WorkstreamDocument,
  freshness: WorkstreamFreshness,
  options: BuildWorkstreamViewModelOptions = {},
): WorkstreamViewModel {
  const inFlight = workstream.nodes.filter(
    (node) => node.status === "in-progress",
  );
  // Retired and completed are both "no further work expected" buckets, but
  // they are semantically distinct: completed = work was done; retired = work
  // was intentionally not pursued (scope moved elsewhere or no longer needed).
  // Both are excluded from "needs attention" derivations.
  const attentionEligibleNodes = workstream.nodes.filter(
    (node) => node.status !== "completed" && node.status !== "retired",
  );
  const gateNodes = workstream.nodes.filter((node) => node.type === "gate");
  const focusNodes = attentionEligibleNodes
    .filter((node) => node.attention === "focus")
    .map((node) => node.title);
  const watchNodes = attentionEligibleNodes
    .filter((node) => node.attention === "watch")
    .map((node) => node.title);
  const nextValidationItem =
    workstream.nodes.find(
      (node) =>
        node.type === "gate" &&
        node.status !== "completed" &&
        node.status !== "retired",
    ) ??
    workstream.checkpoints.find(
      (checkpoint) => checkpoint.status !== "completed",
    );

  const signals: WorkstreamSignal[] = [
    {
      label: "Artifact freshness",
      value: freshness.label,
      tone: freshness.stale ? "amber" : "accent",
    },
    {
      label: "In flight",
      value: formatList(
        inFlight.map((node) => node.title),
        "No nodes are currently in progress.",
      ),
      tone: inFlight.length > 0 ? "green" : "muted",
    },
    {
      label: "Focus now",
      value: formatList(focusNodes, "No nodes are marked as focus."),
      tone: focusNodes.length > 0 ? "accent" : "muted",
    },
    {
      label: "Watching",
      value: formatList(watchNodes, "No nodes are currently in watch state."),
      tone: watchNodes.length > 0 ? "amber" : "muted",
    },
    {
      label: "Next validation item",
      value: nextValidationItem
        ? nextValidationItem.title
        : "All validation items are currently completed.",
      tone: nextValidationItem ? "accent" : "muted",
    },
  ];
  const completedOrRetiredByArtifact = new Set(
    workstream.nodes
      .filter((node) => node.status === "completed" || node.status === "retired")
      .map((node) => node.id),
  );
  const derivedNodes: WorkstreamDerivedNode[] = workstream.nodes.map((node) => {
    const externalDependencies = externalDependencyViewsForNode(
      node,
      options.externalDependencyResolutions,
    );
    const externalDependenciesReady = externalDependencies.every(
      (dependency) => dependency.satisfied,
    );
    const localDependenciesReady = node.dependsOn.every((dependencyId) =>
      completedOrRetiredByArtifact.has(dependencyId),
    );
    const hasExternalDependencies = externalDependencies.length > 0;
    const dependencyReady = localDependenciesReady && externalDependenciesReady;
    let operationalStatus: WorkstreamOperationalStatus = node.status;
    if (
      hasExternalDependencies &&
      (node.status === "ready" || node.status === "planned" || node.status === "blocked")
    ) {
      operationalStatus = dependencyReady ? "ready" : "blocked";
    }

    return {
      node,
      operationalStatus,
      dependencyReady,
      // Both completed and retired nodes count as artifact-satisfied for
      // downstream gating; operationalStatus distinguishes them in the UI.
      completionSource:
        node.status === "completed" || node.status === "retired"
          ? ("artifact" as const)
          : null,
      externalDependencies,
    };
  });
  const readyNow = derivedNodes
    .filter((entry) => entry.operationalStatus === "ready")
    .map((entry) => entry.node);
  const readyIds = new Set(readyNow.map((node) => node.id));
  const inFlightIds = new Set(inFlight.map((node) => node.id));
  const blockedOrAttention = derivedNodes
    .filter(
      ({ node, operationalStatus }) =>
        operationalStatus === "blocked" ||
        (node.attention !== "parked" &&
          operationalStatus !== "completed" &&
          operationalStatus !== "retired" &&
          !readyIds.has(node.id) &&
          !inFlightIds.has(node.id)),
    )
    .map((entry) => entry.node);
  const artifactCompletedNodeIds = new Set(
    derivedNodes
      .filter(
        (entry) =>
          entry.node.status === "completed" || entry.node.status === "retired",
      )
      .map((entry) => entry.node.id),
  );
  const checkpoints = buildCheckpointProgress(
    workstream,
    artifactCompletedNodeIds,
  );

  return {
    readyNow,
    inFlight,
    blockedOrAttention,
    gateNodes,
    waitingForReview: [],
    waitingForValidation: [],
    derivedNodes,
    freshness,
    signals,
    checkpoints,
  };
}

export function buildWorkstreamViewModel(
  workstream: WorkstreamDocument,
  githubSnapshot?: WorkstreamGithubSnapshot,
  now = new Date(),
  options: BuildWorkstreamViewModelOptions = {},
): WorkstreamViewModel {
  const freshness = describeFreshness(workstream.updatedAt, now);

  if (!githubSnapshot) {
    return buildArtifactOnlyViewModel(workstream, freshness, options);
  }

  const issueSnapshots = buildIssueSnapshotMap(githubSnapshot);
  const nodeById = new Map(workstream.nodes.map((node) => [node.id, node]));
  const completionMemo = new Map<string, "artifact" | "github" | null>();

  const completionSourceOf = (nodeId: string): "artifact" | "github" | null => {
    const memoized = completionMemo.get(nodeId);
    if (typeof memoized !== "undefined") {
      return memoized;
    }

    const node = nodeById.get(nodeId);
    if (!node) {
      return null;
    }

    if (node.status === "completed") {
      completionMemo.set(nodeId, "artifact");
      return "artifact";
    }
    // Retired nodes count as "satisfied" for downstream dependency gating.
    // Treating them as artifact-completed unblocks dependents but is
    // distinguishable in the UI via operationalStatus.
    if (node.status === "retired") {
      completionMemo.set(nodeId, "artifact");
      return "artifact";
    }

    const issueRef = githubIssueOf(node.tracker);
    const issueSnapshot = issueRef
      ? issueSnapshots.get(issueKey(issueRef))
      : undefined;
    if (freshness.stale && isIssueCompleted(issueSnapshot)) {
      completionMemo.set(nodeId, "github");
      return "github";
    }

    completionMemo.set(nodeId, null);
    return null;
  };

  const derivedNodes = workstream.nodes.map<WorkstreamDerivedNode>((node) => {
    const issueRef = githubIssueOf(node.tracker);
    const githubIssue = issueRef
      ? issueSnapshots.get(issueKey(issueRef))
      : undefined;
    const completionSource = completionSourceOf(node.id);
    const localDependencyReady = node.dependsOn.every(
      (dependencyId) => completionSourceOf(dependencyId) !== null,
    );
    const externalDependencies = externalDependencyViewsForNode(
      node,
      options.externalDependencyResolutions,
    );
    const externalDependencyReady = externalDependencies.every(
      (dependency) => dependency.satisfied,
    );
    const dependencyReady = localDependencyReady && externalDependencyReady;
    const dependencyUnblockedByGithub =
      dependencyReady &&
      node.dependsOn.some(
        (dependencyId) => completionSourceOf(dependencyId) === "github",
      );
    const activePullRequest = selectActionablePullRequest(
      githubIssue?.linkedPullRequests ?? [],
    );

    let operationalStatus: WorkstreamOperationalStatus = node.status;
    if (node.status === "retired") {
      // Retired nodes preserve their status in the UI (distinct from completed)
      // even though completionSource is set so that downstream dependents are
      // unblocked. Skip the completion / waiting transitions below.
      operationalStatus = "retired";
    } else if (completionSource !== null) {
      operationalStatus = "completed";
    } else if (activePullRequest && needsReview(activePullRequest)) {
      operationalStatus = "waiting-for-review";
    } else if (activePullRequest && waitsForValidation(activePullRequest)) {
      operationalStatus = "waiting-for-validation";
    } else if (
      node.status === "planned" &&
      dependencyUnblockedByGithub &&
      dependencyReady
    ) {
      operationalStatus = "ready";
    } else if (
      externalDependencies.length > 0 &&
      (node.status === "ready" || node.status === "planned" || node.status === "blocked")
    ) {
      operationalStatus = dependencyReady ? "ready" : "blocked";
    }

    return {
      node,
      operationalStatus,
      dependencyReady,
      completionSource,
      externalDependencies,
      githubIssue,
      activePullRequest,
    };
  });

  const readyNow = derivedNodes
    .filter((entry) => entry.operationalStatus === "ready")
    .map((entry) => entry.node);
  const inFlight = derivedNodes
    .filter((entry) => entry.operationalStatus === "in-progress")
    .map((entry) => entry.node);
  const waitingForReview = derivedNodes.filter(
    (entry) => entry.operationalStatus === "waiting-for-review",
  );
  const waitingForValidation = derivedNodes.filter(
    (entry) => entry.operationalStatus === "waiting-for-validation",
  );
  const attentionEligibleNodes = derivedNodes.filter(
    (entry) =>
      entry.operationalStatus !== "completed" &&
      entry.operationalStatus !== "retired",
  );
  const readyIds = new Set(readyNow.map((node) => node.id));
  const inFlightIds = new Set(inFlight.map((node) => node.id));
  const waitingIds = new Set(
    [...waitingForReview, ...waitingForValidation].map(
      (entry) => entry.node.id,
    ),
  );
  // Retired nodes also satisfy checkpoint completion for downstream filtering;
  // a checkpoint that lists a retired node should not count as "still has
  // work" simply because that node was retired rather than completed.
  const completedOrRetiredNodeIds = new Set(
    derivedNodes
      .filter(
        (entry) =>
          entry.operationalStatus === "completed" ||
          entry.operationalStatus === "retired",
      )
      .map((entry) => entry.node.id),
  );
  const blockedOrAttention = derivedNodes
    .filter(
      ({ node, operationalStatus }) =>
        operationalStatus === "blocked" ||
        (node.attention !== "parked" &&
          operationalStatus !== "completed" &&
          operationalStatus !== "retired" &&
          !readyIds.has(node.id) &&
          !inFlightIds.has(node.id) &&
          !waitingIds.has(node.id)),
    )
    .map((entry) => entry.node);
  const gateNodes = workstream.nodes.filter((node) => node.type === "gate");
  const focusNodes = attentionEligibleNodes
    .filter(({ node }) => node.attention === "focus")
    .map(({ node }) => node.title);
  const watchNodes = attentionEligibleNodes
    .filter(({ node }) => node.attention === "watch")
    .map(({ node }) => node.title);
  const nextValidationGate = derivedNodes.find(
    (entry) =>
      entry.node.type === "gate" &&
      entry.operationalStatus !== "completed" &&
      entry.operationalStatus !== "retired",
  )?.node;
  const nextValidationCheckpoint = workstream.checkpoints.find((checkpoint) => {
    if (checkpoint.status === "completed") {
      return false;
    }
    if (checkpoint.nodeIds.length === 0) {
      return true;
    }

    return !checkpoint.nodeIds.every((nodeId) =>
      completedOrRetiredNodeIds.has(nodeId),
    );
  });
  const nextValidationItem = nextValidationGate ?? nextValidationCheckpoint;

  const signals: WorkstreamSignal[] = [
    {
      label: "Artifact freshness",
      value: freshness.label,
      tone: freshness.stale ? "amber" : "accent",
    },
    {
      label: "In flight",
      value: formatList(
        inFlight.map((node) => node.title),
        "No nodes are currently in progress.",
      ),
      tone: inFlight.length > 0 ? "green" : "muted",
    },
    {
      label: "Focus now",
      value: formatList(focusNodes, "No nodes are marked as focus."),
      tone: focusNodes.length > 0 ? "accent" : "muted",
    },
    {
      label: "Watching",
      value: formatList(watchNodes, "No nodes are currently in watch state."),
      tone: watchNodes.length > 0 ? "amber" : "muted",
    },
    {
      label: "Next validation item",
      value: nextValidationItem
        ? nextValidationItem.title
        : "All validation items are currently completed.",
      tone: nextValidationItem ? "accent" : "muted",
    },
  ];

  const checkpoints = buildCheckpointProgress(workstream, completedOrRetiredNodeIds);

  return {
    readyNow,
    inFlight,
    blockedOrAttention,
    gateNodes,
    waitingForReview,
    waitingForValidation,
    derivedNodes,
    freshness,
    signals,
    checkpoints,
  };
}
