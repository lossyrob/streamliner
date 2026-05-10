import type {
  GraphNodeSessionStatusState,
  GraphNodeSessionStatusSummary,
} from "./graph-node-session-status";
import type {
  ManagedRuntimeLifecycleState,
  ManagedRuntimeProjection,
} from "./managed-runtime-contract";
import {
  formatManagedRuntimeLabel,
  MANAGED_RUNTIME_LIFECYCLE_STATES,
  managedRuntimeProjectionFromMetadata,
  managedRuntimeProgressEvents,
} from "./managed-runtime-contract";
import type {
  NodeLaunchClaimState,
  NodeLaunchRecord,
} from "./node-launch-record-contract";
import type { SessionRegistryListItem } from "./session-registry-contract";
import type {
  WorkstreamGithubIssueSnapshot,
  WorkstreamGithubPullRequestSnapshot,
  WorkstreamNode,
  WorkstreamTracker,
} from "./workstream-schema";
import type {
  WorkstreamDerivedNode,
  WorkstreamOperationalStatus,
  WorkstreamViewModel,
} from "./workstream-view-model";

export type WorkstreamRuntimeGateStatus =
  | "usable"
  | "degraded"
  | "not-usable";

export type WorkstreamRuntimeIssueSeverity = "info" | "warning" | "error";

export type WorkstreamRuntimeReadinessImpact =
  | "none"
  | "degraded"
  | "not-usable";

export type WorkstreamRuntimeOverlayReasonCode =
  | "session-registry-loading"
  | "session-registry-error"
  | "launch-records-loading"
  | "launch-records-error"
  | "launch-claim-unresolved"
  | "bound-session-missing"
  | "ambiguous-bound-sessions"
  | "session-activity-unknown"
  | "session-interrupted"
  | "session-stale-process"
  | "session-ended-unpromoted"
  | "managed-runtime-failed"
  | "managed-runtime-waiting-for-builder"
  | "paw-evidence-unavailable"
  | "paw-evidence-unknown"
  | "paw-not-streamliner-launched"
  | "tracker-snapshot-error"
  | "tracker-snapshot-missing";

export type WorkstreamRuntimeNodeStatus =
  | WorkstreamOperationalStatus
  | "launching"
  | "active"
  | "needs-input"
  | "interrupted"
  | "ended"
  | "unresolved";

export type WorkstreamRuntimePawStatus =
  | "none"
  | "recognized"
  | "unavailable"
  | "unknown";

export type WorkstreamRuntimeTrackerStatus =
  | "none"
  | "linked"
  | "snapshot"
  | "degraded";

type SessionRegistryPawWorkflow = NonNullable<
  SessionRegistryListItem["pawWorkflow"]
>;

export type WorkstreamRuntimeOverlayNodeSource =
  | {
      viewModel: WorkstreamViewModel;
    }
  | {
      derivedNodes: readonly WorkstreamDerivedNode[];
    };

export type WorkstreamRuntimeOverlaySessionStatusInput =
  | ReadonlyMap<string, GraphNodeSessionStatusSummary>
  | readonly GraphNodeSessionStatusSummary[];

export type WorkstreamRuntimeOverlayLaunchRecordInput =
  | ReadonlyMap<string, NodeLaunchRecord | null | undefined>
  | readonly NodeLaunchRecord[];

export type WorkstreamRuntimeOverlaySourceState =
  | "ready"
  | "loading"
  | "error";

export type WorkstreamRuntimeOverlayInput =
  WorkstreamRuntimeOverlayNodeSource & {
    nodeSessionStatuses?: WorkstreamRuntimeOverlaySessionStatusInput;
    sessionStatusState: GraphNodeSessionStatusState;
    sessionStatusError?: Error | string | null;
    nodeLaunchRecords?: WorkstreamRuntimeOverlayLaunchRecordInput;
    launchRecordsState?: WorkstreamRuntimeOverlaySourceState;
    launchRecordsError?: Error | string | null;
  };

export interface WorkstreamRuntimeOverlayIssue {
  code: WorkstreamRuntimeOverlayReasonCode;
  severity: WorkstreamRuntimeIssueSeverity;
  readinessImpact: WorkstreamRuntimeReadinessImpact;
  message: string;
  nodeId?: string;
  sessionId?: string;
  launchClaimId?: string;
}

export interface WorkstreamRuntimeGateReadinessReason {
  code: WorkstreamRuntimeOverlayReasonCode;
  severity: WorkstreamRuntimeIssueSeverity;
  message: string;
  nodeId?: string;
  sessionId?: string;
  launchClaimId?: string;
}

export interface WorkstreamRuntimeGateReadiness {
  status: WorkstreamRuntimeGateStatus;
  reasons: WorkstreamRuntimeGateReadinessReason[];
}

export interface WorkstreamRuntimeSessionOverlay {
  summary: GraphNodeSessionStatusSummary | null;
  primarySession: SessionRegistryListItem | null;
  sessions: readonly SessionRegistryListItem[];
  nonEndedSessionCount: number;
  ambiguous: boolean;
}

export interface WorkstreamRuntimeLaunchOverlay {
  record: NodeLaunchRecord | null;
  latestClaim: NodeLaunchClaimState | null;
  unresolved: boolean;
}

export interface WorkstreamRuntimePawOverlay {
  status: WorkstreamRuntimePawStatus;
  sessionId: string | null;
  workId: string | null;
  workTitle: string | null;
  workflowKind: SessionRegistryPawWorkflow["workflowKind"] | null;
  stage: SessionRegistryPawWorkflow["stage"];
  artifactCount: number;
  latestArtifactPath: string | null;
  diagnostics: readonly string[];
}

export interface WorkstreamManagedRuntimeOverlay {
  projection: ManagedRuntimeProjection;
  source: "session" | "launch-record";
  lifecycleState: ManagedRuntimeLifecycleState;
  lifecycleLabel: string;
  progress: NonNullable<ManagedRuntimeProjection["progress"]>;
}

export interface WorkstreamRuntimeTrackerOverlay {
  status: WorkstreamRuntimeTrackerStatus;
  tracker: WorkstreamTracker | null;
  githubIssue: WorkstreamGithubIssueSnapshot | null;
  activePullRequest: WorkstreamGithubPullRequestSnapshot | null;
}

export interface WorkstreamRuntimeNodeOverlay {
  nodeId: string;
  node: WorkstreamNode;
  committedStatus: WorkstreamNode["status"];
  operationalStatus: WorkstreamOperationalStatus;
  runtimeStatus: WorkstreamRuntimeNodeStatus;
  hasRuntimeEvidence: boolean;
  session: WorkstreamRuntimeSessionOverlay;
  launch: WorkstreamRuntimeLaunchOverlay;
  managedRuntime: WorkstreamManagedRuntimeOverlay | null;
  paw: WorkstreamRuntimePawOverlay;
  tracker: WorkstreamRuntimeTrackerOverlay;
  issues: readonly WorkstreamRuntimeOverlayIssue[];
  degradationReasons: readonly WorkstreamRuntimeOverlayIssue[];
}

export interface WorkstreamRuntimeOverlayCounts {
  totalNodes: number;
  runtimeEvidenceNodes: number;
  degradedNodes: number;
  notUsableIssueCount: number;
  ambiguousNodes: number;
  unresolvedLaunches: number;
  pawEnrichedNodes: number;
  trackerDegradedNodes: number;
  byStatus: Record<WorkstreamRuntimeNodeStatus, number>;
}

export interface WorkstreamRuntimeOverlaySummary {
  counts: WorkstreamRuntimeOverlayCounts;
  issues: readonly WorkstreamRuntimeOverlayIssue[];
}

export interface WorkstreamRuntimeOverlay {
  nodes: readonly WorkstreamRuntimeNodeOverlay[];
  nodesById: ReadonlyMap<string, WorkstreamRuntimeNodeOverlay>;
  summary: WorkstreamRuntimeOverlaySummary;
  gateReadiness: WorkstreamRuntimeGateReadiness;
}

function emptyStatusCounts(): Record<WorkstreamRuntimeNodeStatus, number> {
  return {
    planned: 0,
    ready: 0,
    "in-progress": 0,
    blocked: 0,
    completed: 0,
    "waiting-for-review": 0,
    "waiting-for-validation": 0,
    launching: 0,
    active: 0,
    "needs-input": 0,
    interrupted: 0,
    ended: 0,
    unresolved: 0,
  };
}

function sessionStatusesToMap(
  input: WorkstreamRuntimeOverlaySessionStatusInput | undefined,
): ReadonlyMap<string, GraphNodeSessionStatusSummary> {
  if (!input) {
    return new Map<string, GraphNodeSessionStatusSummary>();
  }
  if (isSessionStatusArray(input)) {
    return new Map(input.map((summary) => [summary.nodeId, summary]));
  }
  return input;
}

function isSessionStatusArray(
  input: WorkstreamRuntimeOverlaySessionStatusInput,
): input is readonly GraphNodeSessionStatusSummary[] {
  return Array.isArray(input);
}

function launchRecordsToMap(
  input: WorkstreamRuntimeOverlayLaunchRecordInput | undefined,
): ReadonlyMap<string, NodeLaunchRecord> {
  const records = new Map<string, NodeLaunchRecord>();
  if (!input) {
    return records;
  }
  if (isLaunchRecordArray(input)) {
    for (const record of input) {
      records.set(record.nodeId, record);
    }
    return records;
  }
  for (const [nodeId, record] of input) {
    if (record) {
      records.set(nodeId, record);
    }
  }
  return records;
}

function isLaunchRecordArray(
  input: WorkstreamRuntimeOverlayLaunchRecordInput,
): input is readonly NodeLaunchRecord[] {
  return Array.isArray(input);
}

function formatError(error: Error | string | null | undefined): string {
  if (!error) {
    return "Session registry status is unavailable.";
  }
  return error instanceof Error ? error.message : error;
}

function graphIssue(
  code: WorkstreamRuntimeOverlayReasonCode,
  severity: WorkstreamRuntimeIssueSeverity,
  readinessImpact: WorkstreamRuntimeReadinessImpact,
  message: string,
): WorkstreamRuntimeOverlayIssue {
  return {
    code,
    severity,
    readinessImpact,
    message,
  };
}

function nodeIssue(
  nodeId: string,
  code: WorkstreamRuntimeOverlayReasonCode,
  severity: WorkstreamRuntimeIssueSeverity,
  readinessImpact: WorkstreamRuntimeReadinessImpact,
  message: string,
  details: {
    sessionId?: string | null;
    launchClaimId?: string | null;
  } = {},
): WorkstreamRuntimeOverlayIssue {
  const issue: WorkstreamRuntimeOverlayIssue = {
    nodeId,
    code,
    severity,
    readinessImpact,
    message,
  };
  if (details.sessionId) {
    issue.sessionId = details.sessionId;
  }
  if (details.launchClaimId) {
    issue.launchClaimId = details.launchClaimId;
  }
  return issue;
}

function isNonEndedSession(session: SessionRegistryListItem): boolean {
  return (
    session.activityStatus !== "exited" &&
    session.lifecycleStatus !== "ended" &&
    session.trustedEndedAt === null
  );
}

function hasStaleProcessEvidence(session: SessionRegistryListItem): boolean {
  return session.copilotProcessState === "stale_lock";
}

function hasInterruptedEvidence(session: SessionRegistryListItem): boolean {
  return (
    session.activityStatus === "interrupted" ||
    hasStaleProcessEvidence(session) ||
    (session.trustedSignalSource !== null &&
      session.trustedStartedAt !== null &&
      session.trustedEndedAt === null &&
      session.copilotProcessState !== "live" &&
      session.activityStatus !== "exited")
  );
}

function hasEndedEvidence(session: SessionRegistryListItem): boolean {
  return (
    session.activityStatus === "exited" ||
    session.lifecycleStatus === "ended" ||
    session.trustedEndedAt !== null
  );
}

function statusFromSession(
  nodeId: string,
  committedStatus: WorkstreamNode["status"],
  session: SessionRegistryListItem,
  issues: WorkstreamRuntimeOverlayIssue[],
): WorkstreamRuntimeNodeStatus {
  if (
    session.activityStatus === "waiting_for_input" ||
    session.activityEvidence.pendingInputRequest
  ) {
    if (hasStaleProcessEvidence(session)) {
      issues.push(
        nodeIssue(
          nodeId,
          "session-stale-process",
          "warning",
          "degraded",
          "The primary bound session is waiting for input but its process evidence is stale.",
          { sessionId: session.id },
        ),
      );
    }
    return "needs-input";
  }

  if (hasInterruptedEvidence(session)) {
    issues.push(
      nodeIssue(
        nodeId,
        hasStaleProcessEvidence(session)
          ? "session-stale-process"
          : "session-interrupted",
        "warning",
        "degraded",
        hasStaleProcessEvidence(session)
          ? "The primary bound session has stale process evidence."
          : "The primary bound session appears interrupted or resumable.",
        { sessionId: session.id },
      ),
    );
    return "interrupted";
  }

  if (hasEndedEvidence(session)) {
    if (committedStatus !== "completed") {
      issues.push(
        nodeIssue(
          nodeId,
          "session-ended-unpromoted",
          "info",
          "degraded",
          "The primary bound session ended before the committed node was marked completed.",
          { sessionId: session.id },
        ),
      );
    }
    return "ended";
  }

  if (session.activityStatus === "working") {
    return "active";
  }

  issues.push(
    nodeIssue(
      nodeId,
      "session-activity-unknown",
      "warning",
      "degraded",
      "The primary bound session exists, but its activity status is unknown.",
      { sessionId: session.id },
    ),
  );
  return "unresolved";
}

function statusFromManagedRuntime(
  nodeId: string,
  managedRuntime: WorkstreamManagedRuntimeOverlay | null,
  issues: WorkstreamRuntimeOverlayIssue[],
): WorkstreamRuntimeNodeStatus | null {
  if (!managedRuntime) {
    return null;
  }
  switch (managedRuntime.lifecycleState) {
    case "preparing":
    case "starting":
      return "launching";
    case "waiting_for_builder":
      issues.push(
        nodeIssue(
          nodeId,
          "managed-runtime-waiting-for-builder",
          "warning",
          "degraded",
          "The background session is waiting for builder action.",
        ),
      );
      return "needs-input";
    case "interrupt_requested":
    case "interrupted":
    case "canceled":
      return "interrupted";
    case "failed":
      issues.push(
        nodeIssue(
          nodeId,
          "managed-runtime-failed",
          "warning",
          "degraded",
            managedRuntime.projection.errorSummary ??
            "The background session reported a failed lifecycle state.",
        ),
      );
      return "interrupted";
    case "completed":
    case "cleaned_up":
    case "terminal_takeover":
      return "ended";
    case "running":
    case "idle":
    case "pr_ready":
    case "review_ready":
    case "cleanup_ready":
    case "cleaning_up":
      return "active";
    default: {
      const _exhaustive: never = managedRuntime.lifecycleState;
      throw new Error(`unhandled managed lifecycle state: ${String(_exhaustive)}`);
    }
  }
}

function isTerminalManagedRuntimeLifecycle(
  state: ManagedRuntimeLifecycleState,
): boolean {
  switch (state) {
    case "completed":
    case "cleaned_up":
    case "terminal_takeover":
      return true;
    case "failed":
    case "canceled":
    case "preparing":
    case "starting":
    case "running":
    case "idle":
    case "waiting_for_builder":
    case "interrupt_requested":
    case "interrupted":
    case "pr_ready":
    case "review_ready":
    case "cleanup_ready":
    case "cleaning_up":
      return false;
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled managed lifecycle state: ${String(_exhaustive)}`);
    }
  }
}

function unresolvedLaunchStatus(
  claim: NodeLaunchClaimState | null,
  hasBoundSession: boolean,
): WorkstreamRuntimeNodeStatus | null {
  if (!claim?.blocksLaunch || hasBoundSession) {
    return null;
  }
  return claim.status === "pending" ? "launching" : "unresolved";
}

function buildManagedRuntimeOverlay(
  session: SessionRegistryListItem | null,
): WorkstreamManagedRuntimeOverlay | null {
  const projection = managedRuntimeProjectionFromMetadata(session?.runtime);
  if (!projection) {
    return null;
  }
  return {
    projection,
    source: "session",
    lifecycleState: projection.lifecycleState,
    lifecycleLabel: formatManagedRuntimeLabel(projection.lifecycleState),
    progress: managedRuntimeProgressEvents(projection.progress),
  };
}

export function managedRuntimeLifecycleOverlayStatus(
  state: ManagedRuntimeLifecycleState,
): WorkstreamRuntimeNodeStatus {
  const status = statusFromManagedRuntime(
    "managed-runtime-contract",
    {
      projection: {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        permissionProfile: "managed-autonomous",
        lifecycleState: state,
      },
      source: "session",
      lifecycleState: state,
      lifecycleLabel: formatManagedRuntimeLabel(state),
      progress: [],
    },
    [],
  );
  if (!status) {
    throw new Error(`managed lifecycle state produced no status: ${state}`);
  }
  return status;
}

export const MANAGED_RUNTIME_LIFECYCLE_OVERLAY_STATUSES = Object.fromEntries(
  MANAGED_RUNTIME_LIFECYCLE_STATES.map((state) => [
    state,
    managedRuntimeLifecycleOverlayStatus(state),
  ]),
) as Record<ManagedRuntimeLifecycleState, WorkstreamRuntimeNodeStatus>;

function buildSessionOverlay(
  summary: GraphNodeSessionStatusSummary | undefined,
): WorkstreamRuntimeSessionOverlay {
  if (!summary) {
    return {
      summary: null,
      primarySession: null,
      sessions: [],
      nonEndedSessionCount: 0,
      ambiguous: false,
    };
  }
  const sessions = [...summary.sessions];
  const nonEndedSessionCount = sessions.filter(isNonEndedSession).length;
  return {
    summary,
    primarySession: summary.primarySession,
    sessions,
    nonEndedSessionCount,
    ambiguous: nonEndedSessionCount > 1,
  };
}

function buildLaunchOverlay(
  record: NodeLaunchRecord | undefined,
  unresolved: boolean,
): WorkstreamRuntimeLaunchOverlay {
  return {
    record: record ?? null,
    latestClaim: record?.latestClaim ?? null,
    unresolved,
  };
}

function buildPawOverlay(
  nodeId: string,
  session: SessionRegistryListItem | null,
  issues: WorkstreamRuntimeOverlayIssue[],
): WorkstreamRuntimePawOverlay {
  if (!session) {
    return {
      status: "none",
      sessionId: null,
      workId: null,
      workTitle: null,
      workflowKind: null,
      stage: null,
      artifactCount: 0,
      latestArtifactPath: null,
      diagnostics: [],
    };
  }

  const workflow = session.pawWorkflow;
  const streamlinerLaunchedPaw =
    session.originKind === "launched" && session.pawLaunch !== null;

  if (streamlinerLaunchedPaw && workflow?.status === "recognized") {
    return {
      status: "recognized",
      sessionId: session.id,
      workId: workflow.workId ?? session.pawLaunch?.workId ?? null,
      workTitle: workflow.workTitle ?? session.pawLaunch?.workTitle ?? null,
      workflowKind: workflow.workflowKind,
      stage: workflow.stage,
      artifactCount: workflow.artifactCount,
      latestArtifactPath: workflow.latestArtifactPath,
      diagnostics: workflow.diagnostics,
    };
  }

  if (streamlinerLaunchedPaw) {
    const unknown = workflow?.status === "unknown";
    issues.push(
      nodeIssue(
        nodeId,
        unknown ? "paw-evidence-unknown" : "paw-evidence-unavailable",
        "warning",
        "degraded",
        unknown
          ? "The Streamliner-launched PAW workflow could not be classified."
          : "The Streamliner-launched PAW workflow has no available artifact evidence.",
        { sessionId: session.id },
      ),
    );
    return {
      status: unknown ? "unknown" : "unavailable",
      sessionId: session.id,
      workId: workflow?.workId ?? session.pawLaunch?.workId ?? null,
      workTitle: workflow?.workTitle ?? session.pawLaunch?.workTitle ?? null,
      workflowKind: workflow?.workflowKind ?? session.pawLaunch?.workflowKind ?? null,
      stage: workflow?.stage ?? null,
      artifactCount: workflow?.artifactCount ?? 0,
      latestArtifactPath: workflow?.latestArtifactPath ?? null,
      diagnostics: workflow?.diagnostics ?? [],
    };
  }

  if (workflow?.status === "recognized") {
    issues.push(
      nodeIssue(
        nodeId,
        "paw-not-streamliner-launched",
        "warning",
        "degraded",
        "PAW artifacts were detected, but the bound session is not a recognized Streamliner-launched PAW session.",
        { sessionId: session.id },
      ),
    );
  } else if (workflow?.status === "unknown" || workflow?.status === "unavailable") {
    issues.push(
      nodeIssue(
        nodeId,
        workflow.status === "unknown"
          ? "paw-evidence-unknown"
          : "paw-evidence-unavailable",
        "warning",
        "degraded",
        workflow.status === "unknown"
          ? "The bound session has unknown PAW artifact evidence."
          : "The bound session has unavailable PAW artifact evidence.",
        { sessionId: session.id },
      ),
    );
  } else if (!workflow) {
    return {
      status: "none",
      sessionId: null,
      workId: null,
      workTitle: null,
      workflowKind: null,
      stage: null,
      artifactCount: 0,
      latestArtifactPath: null,
      diagnostics: [],
    };
  }

  return {
    status: workflow?.status === "unknown" ? "unknown" : "unavailable",
    sessionId: session.id,
    workId: workflow?.workId ?? null,
    workTitle: workflow?.workTitle ?? null,
    workflowKind: workflow?.workflowKind ?? null,
    stage: workflow?.stage ?? null,
    artifactCount: workflow?.artifactCount ?? 0,
    latestArtifactPath: workflow?.latestArtifactPath ?? null,
    diagnostics: workflow?.diagnostics ?? [],
  };
}

function buildTrackerOverlay(
  entry: WorkstreamDerivedNode,
  issues: WorkstreamRuntimeOverlayIssue[],
): WorkstreamRuntimeTrackerOverlay {
  if (!entry.node.tracker) {
    return {
      status: "none",
      tracker: null,
      githubIssue: null,
      activePullRequest: entry.activePullRequest ?? null,
    };
  }

  if (entry.githubIssue) {
    if (entry.githubIssue.error) {
      issues.push(
        nodeIssue(
          entry.node.id,
          "tracker-snapshot-error",
          "warning",
          "degraded",
          `The node's GitHub tracker snapshot is degraded: ${entry.githubIssue.error}`,
        ),
      );
      return {
        status: "degraded",
        tracker: entry.node.tracker,
        githubIssue: entry.githubIssue,
        activePullRequest: entry.activePullRequest ?? null,
      };
    }
    return {
      status: "snapshot",
      tracker: entry.node.tracker,
      githubIssue: entry.githubIssue,
      activePullRequest: entry.activePullRequest ?? null,
    };
  }

  if (entry.node.tracker.type === "github") {
    issues.push(
      nodeIssue(
        entry.node.id,
        "tracker-snapshot-missing",
        "info",
        "none",
        "The node has a GitHub tracker reference, but no tracker snapshot was provided.",
      ),
    );
    return {
      status: "linked",
      tracker: entry.node.tracker,
      githubIssue: null,
      activePullRequest: entry.activePullRequest ?? null,
    };
  }

  return {
    status: "none",
    tracker: entry.node.tracker,
    githubIssue: null,
    activePullRequest: entry.activePullRequest ?? null,
  };
}

function buildNodeOverlay(
  entry: WorkstreamDerivedNode,
  sessionSummary: GraphNodeSessionStatusSummary | undefined,
  launchRecord: NodeLaunchRecord | undefined,
): WorkstreamRuntimeNodeOverlay {
  const issues: WorkstreamRuntimeOverlayIssue[] = [];
  const sessionOverlay = buildSessionOverlay(sessionSummary);
  const primarySession = sessionOverlay.primarySession;
  const latestClaim = launchRecord?.latestClaim ?? null;
  const launchStatus = unresolvedLaunchStatus(
    latestClaim,
    primarySession !== null,
  );

  if (launchStatus) {
    const boundSessionMissing = latestClaim?.boundRegistryId && !primarySession;
    issues.push(
      nodeIssue(
        entry.node.id,
        boundSessionMissing ? "bound-session-missing" : "launch-claim-unresolved",
        "warning",
        "degraded",
        boundSessionMissing
          ? "A launch claim references a bound session, but no bound session is visible for this node."
          : latestClaim?.status === "pending"
            ? "A blocking launch claim is pending, but no bound session is visible for this node."
            : "A blocking launch claim is unresolved, but no bound session is visible for this node.",
        { launchClaimId: latestClaim?.launchClaimId ?? null },
      ),
    );
  }

  if (sessionOverlay.ambiguous) {
    issues.push(
      nodeIssue(
        entry.node.id,
        "ambiguous-bound-sessions",
        "warning",
        "degraded",
        "Multiple non-ended bound sessions target this node; the highest-attention session is primary.",
        { sessionId: primarySession?.id ?? null },
      ),
    );
  }

  const managedRuntimeOverlay = buildManagedRuntimeOverlay(primarySession);
  const managedRuntimeStatus = statusFromManagedRuntime(
    entry.node.id,
    managedRuntimeOverlay,
    issues,
  );
  const shouldUsePrimaryRuntimeStatus = Boolean(
    managedRuntimeStatus &&
      managedRuntimeOverlay &&
      isTerminalManagedRuntimeLifecycle(managedRuntimeOverlay.lifecycleState) &&
      (primarySession || launchStatus !== null),
  );
  const primaryRuntimeStatus = shouldUsePrimaryRuntimeStatus || !managedRuntimeStatus
    ? primarySession
      ? statusFromSession(entry.node.id, entry.node.status, primarySession, issues)
      : launchStatus ?? entry.operationalStatus
    : null;
  const runtimeStatus: WorkstreamRuntimeNodeStatus = shouldUsePrimaryRuntimeStatus
    ? primaryRuntimeStatus ?? managedRuntimeStatus ?? entry.operationalStatus
    : managedRuntimeStatus ?? primaryRuntimeStatus ?? entry.operationalStatus;

  const launchOverlay = buildLaunchOverlay(launchRecord, launchStatus !== null);
  const pawOverlay = buildPawOverlay(entry.node.id, primarySession, issues);
  const trackerOverlay = buildTrackerOverlay(entry, issues);
  const degradationReasons = issues.filter(
    (issue) => issue.readinessImpact !== "none",
  );

  return {
    nodeId: entry.node.id,
    node: entry.node,
    committedStatus: entry.node.status,
    operationalStatus: entry.operationalStatus,
    runtimeStatus,
    hasRuntimeEvidence:
      primarySession !== null ||
      launchOverlay.latestClaim !== null ||
      managedRuntimeOverlay !== null ||
      pawOverlay.status === "recognized",
    session: sessionOverlay,
    launch: launchOverlay,
    managedRuntime: managedRuntimeOverlay,
    paw: pawOverlay,
    tracker: trackerOverlay,
    issues,
    degradationReasons,
  };
}

function toGateReason(
  issue: WorkstreamRuntimeOverlayIssue,
): WorkstreamRuntimeGateReadinessReason {
  const reason: WorkstreamRuntimeGateReadinessReason = {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
  };
  if (issue.nodeId) {
    reason.nodeId = issue.nodeId;
  }
  if (issue.sessionId) {
    reason.sessionId = issue.sessionId;
  }
  if (issue.launchClaimId) {
    reason.launchClaimId = issue.launchClaimId;
  }
  return reason;
}

export function selectWorkstreamRuntimeGateReadiness(
  issues: readonly WorkstreamRuntimeOverlayIssue[],
): WorkstreamRuntimeGateReadiness {
  const actionableIssues = issues.filter(
    (issue) => issue.readinessImpact !== "none",
  );
  const status = actionableIssues.some(
    (issue) => issue.readinessImpact === "not-usable",
  )
    ? "not-usable"
    : actionableIssues.length > 0
      ? "degraded"
      : "usable";

  return {
    status,
    reasons: actionableIssues.map(toGateReason),
  };
}

function buildSummary(
  nodes: readonly WorkstreamRuntimeNodeOverlay[],
  graphIssues: readonly WorkstreamRuntimeOverlayIssue[],
): WorkstreamRuntimeOverlaySummary {
  const byStatus = emptyStatusCounts();
  const issues = [
    ...graphIssues,
    ...nodes.flatMap((node) => node.issues),
  ];
  for (const node of nodes) {
    byStatus[node.runtimeStatus] += 1;
  }

  return {
    counts: {
      totalNodes: nodes.length,
      runtimeEvidenceNodes: nodes.filter((node) => node.hasRuntimeEvidence).length,
      degradedNodes: nodes.filter((node) => node.degradationReasons.length > 0)
        .length,
      notUsableIssueCount: issues.filter(
        (issue) => issue.readinessImpact === "not-usable",
      ).length,
      ambiguousNodes: nodes.filter((node) => node.session.ambiguous).length,
      unresolvedLaunches: nodes.filter((node) => node.launch.unresolved).length,
      pawEnrichedNodes: nodes.filter((node) => node.paw.status === "recognized")
        .length,
      trackerDegradedNodes: nodes.filter(
        (node) => node.tracker.status === "degraded",
      ).length,
      byStatus,
    },
    issues,
  };
}

function derivedNodesFromInput(
  input: WorkstreamRuntimeOverlayNodeSource,
): readonly WorkstreamDerivedNode[] {
  if ("viewModel" in input) {
    return input.viewModel.derivedNodes;
  }
  return input.derivedNodes;
}

export function buildWorkstreamRuntimeOverlay(
  input: WorkstreamRuntimeOverlayInput,
): WorkstreamRuntimeOverlay {
  const derivedNodes = derivedNodesFromInput(input);
  const sessionStatuses = sessionStatusesToMap(input.nodeSessionStatuses);
  const launchRecords = launchRecordsToMap(input.nodeLaunchRecords);
  const graphIssues: WorkstreamRuntimeOverlayIssue[] = [];

  if (input.sessionStatusState === "loading") {
    graphIssues.push(
      graphIssue(
        "session-registry-loading",
        "warning",
        "degraded",
        "Session registry status is still loading; runtime session evidence may be incomplete.",
      ),
    );
  } else if (input.sessionStatusState === "error") {
    graphIssues.push(
      graphIssue(
        "session-registry-error",
        "error",
        "not-usable",
        formatError(input.sessionStatusError),
      ),
    );
  }

  if (input.launchRecordsState === "loading") {
    graphIssues.push(
      graphIssue(
        "launch-records-loading",
        "warning",
        "degraded",
        "Node launch records are still loading; launch-claim runtime evidence may be incomplete.",
      ),
    );
  } else if (input.launchRecordsState === "error") {
    graphIssues.push(
      graphIssue(
        "launch-records-error",
        "warning",
        "degraded",
        formatError(input.launchRecordsError),
      ),
    );
  }

  const nodes = derivedNodes.map((entry) =>
    buildNodeOverlay(
      entry,
      sessionStatuses.get(entry.node.id),
      launchRecords.get(entry.node.id),
    ),
  );
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const summary = buildSummary(nodes, graphIssues);

  return {
    nodes,
    nodesById,
    summary,
    gateReadiness: selectWorkstreamRuntimeGateReadiness(summary.issues),
  };
}
