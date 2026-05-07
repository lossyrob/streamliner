import type {
  WorkstreamAttention,
  WorkstreamCheckpoint,
  WorkstreamCheckpointStatus,
  WorkstreamDesignReference,
  WorkstreamDocument,
  WorkstreamGithubIssueSnapshot,
  WorkstreamGithubPullRequestSnapshot,
  WorkstreamGithubSnapshot,
  WorkstreamIssue,
  WorkstreamLaunchPolicy,
  WorkstreamLaunchRequiredTracker,
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
  WORKSTREAM_LAUNCH_REQUIRED_TRACKERS,
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
  githubIssue?: WorkstreamGithubIssueSnapshot;
  activePullRequest?: WorkstreamGithubPullRequestSnapshot;
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

function parseNode(value: unknown, label: string): WorkstreamNode {
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
    status: asEnum<WorkstreamNodeStatus>(
      record.status,
      `${label}.status`,
      WORKSTREAM_NODE_STATUSES,
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

export function parseWorkstreamDocument(rawJson: string): WorkstreamDocument {
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
    repos: parseArray(record.repos, "workstream.repos", parseRepo),
    designRefs:
      typeof designRefs === "undefined"
        ? []
        : parseArray(
            designRefs,
            "workstream.designRefs",
            parseDesignReference,
          ),
    nodes: parseArray(record.nodes, "workstream.nodes", parseNode),
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

function buildArtifactOnlyViewModel(
  workstream: WorkstreamDocument,
  freshness: WorkstreamFreshness,
): WorkstreamViewModel {
  const readyNow = workstream.nodes.filter((node) => node.status === "ready");
  const inFlight = workstream.nodes.filter(
    (node) => node.status === "in-progress",
  );
  const attentionEligibleNodes = workstream.nodes.filter(
    (node) => node.status !== "completed",
  );
  const readyIds = new Set(readyNow.map((node) => node.id));
  const inFlightIds = new Set(inFlight.map((node) => node.id));
  const blockedOrAttention = workstream.nodes.filter(
    (node) =>
      node.status === "blocked" ||
      (node.attention !== "parked" &&
        node.status !== "completed" &&
        !readyIds.has(node.id) &&
        !inFlightIds.has(node.id)),
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
      (node) => node.type === "gate" && node.status !== "completed",
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
  const derivedNodes: WorkstreamDerivedNode[] = workstream.nodes.map(
    (node) => ({
      node,
      operationalStatus: node.status,
      dependencyReady: node.dependsOn.length === 0,
      completionSource:
        node.status === "completed" ? ("artifact" as const) : null,
    }),
  );
  const artifactCompletedNodeIds = new Set(
    derivedNodes
      .filter((entry) => entry.node.status === "completed")
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
): WorkstreamViewModel {
  const freshness = describeFreshness(workstream.updatedAt, now);

  if (!githubSnapshot) {
    return buildArtifactOnlyViewModel(workstream, freshness);
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
    const dependencyReady = node.dependsOn.every(
      (dependencyId) => completionSourceOf(dependencyId) !== null,
    );
    const dependencyUnblockedByGithub =
      dependencyReady &&
      node.dependsOn.some(
        (dependencyId) => completionSourceOf(dependencyId) === "github",
      );
    const activePullRequest = selectActionablePullRequest(
      githubIssue?.linkedPullRequests ?? [],
    );

    let operationalStatus: WorkstreamOperationalStatus = node.status;
    if (completionSource !== null) {
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
    }

    return {
      node,
      operationalStatus,
      dependencyReady,
      completionSource,
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
    (entry) => entry.operationalStatus !== "completed",
  );
  const readyIds = new Set(readyNow.map((node) => node.id));
  const inFlightIds = new Set(inFlight.map((node) => node.id));
  const waitingIds = new Set(
    [...waitingForReview, ...waitingForValidation].map(
      (entry) => entry.node.id,
    ),
  );
  const completedNodeIds = new Set(
    derivedNodes
      .filter((entry) => entry.operationalStatus === "completed")
      .map((entry) => entry.node.id),
  );
  const blockedOrAttention = derivedNodes
    .filter(
      ({ node, operationalStatus }) =>
        operationalStatus === "blocked" ||
        (node.attention !== "parked" &&
          operationalStatus !== "completed" &&
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
      entry.node.type === "gate" && entry.operationalStatus !== "completed",
  )?.node;
  const nextValidationCheckpoint = workstream.checkpoints.find((checkpoint) => {
    if (checkpoint.status === "completed") {
      return false;
    }
    if (checkpoint.nodeIds.length === 0) {
      return true;
    }

    return !checkpoint.nodeIds.every((nodeId) => completedNodeIds.has(nodeId));
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

  const checkpoints = buildCheckpointProgress(workstream, completedNodeIds);

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
