import { describe, expect, it } from "vitest";

import type { GraphNodeSessionStatusSummary } from "./graph-node-session-status";
import type {
  NodeLaunchClaimState,
  NodeLaunchRecord,
} from "./node-launch-record-contract";
import type { SessionRegistryListItem } from "./session-registry-contract";
import {
  buildSessionRegistryActivityEvidence,
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
} from "./session-registry-schema";
import {
  MANAGED_RUNTIME_LIFECYCLE_STATES,
  managedLifecycleStatusClass,
} from "./managed-runtime-contract";
import type {
  WorkstreamGithubIssueSnapshot,
  WorkstreamNode,
} from "./workstream-schema";
import type {
  WorkstreamDerivedNode,
  WorkstreamOperationalStatus,
} from "./workstream-view-model";
import {
  buildWorkstreamRuntimeOverlay,
  MANAGED_RUNTIME_LIFECYCLE_OVERLAY_STATUSES,
} from "./workstream-runtime-overlay";

const TEST_TIMESTAMP = "2026-05-05T12:00:00.000Z";

function buildNode(overrides: Partial<WorkstreamNode> = {}): WorkstreamNode {
  return {
    id: "runtime-overlay-node",
    type: "task",
    title: "Runtime overlay node",
    summary: "Compose runtime evidence without mutating graph artifacts.",
    status: "planned",
    attention: "focus",
    repoIds: ["app"],
    dependsOn: [],
    ...overrides,
  };
}

function buildDerivedNode(
  overrides: {
    node?: Partial<WorkstreamNode>;
    operationalStatus?: WorkstreamOperationalStatus;
    githubIssue?: WorkstreamGithubIssueSnapshot;
  } = {},
): WorkstreamDerivedNode {
  const node = buildNode(overrides.node);
  return {
    node,
    operationalStatus: overrides.operationalStatus ?? node.status,
    dependencyReady: true,
    completionSource: node.status === "completed" ? "artifact" : null,
    githubIssue: overrides.githubIssue,
  };
}

function buildSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "session-a",
    version: 0,
    title: "Session A",
    titleSource: "user",
    description: "",
    lifecycleStatus: "active",
    lastSeenAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    color: null,
    cwd: "C:\\work\\streamliner",
    repo: "lossyrob/streamliner",
    branch: "feature/runtime-overlay",
    tags: [],
    originKind: "launched",
    launchCliArgs: null,
    graphBinding: {
      workstreamId: "runtime-overlay-ui",
      nodeId: "runtime-overlay-node",
      launchClaimId: "claim-a",
    },
    pawLaunch: null,
    copilotSessionId: "copilot-a",
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: null,
    copilotProcessState: "live",
    copilotProcessId: 123,
    activityStatus: "working",
    activityStatusUpdatedAt: TEST_TIMESTAMP,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: TEST_TIMESTAMP,
    trustedEndedAt: null,
    trustedLastSignalAt: TEST_TIMESTAMP,
    trustedStartSource: "new",
    trustedEndReason: null,
    trustedExecutionKind: "copilot_cli",
    trustedInitialPromptLength: null,
    trustedLastPromptLength: null,
    derivedWorktreePath: null,
    derivedBranch: null,
    derivedGithubRefs: [],
    derivedContextUpdatedAt: null,
    derivedContextEventsOffset: 0,
    derivedContextEventsSize: 0,
    derivedContextEventsMtimeMs: null,
    ...overrides,
  };
}

function buildManagedRuntime(
  overrides: Partial<NonNullable<SessionRegistryListItem["runtime"]>> = {},
): NonNullable<SessionRegistryListItem["runtime"]> {
  return {
    runtimeKind: "managed-sdk",
    runtimeOwner: "streamliner-sdk",
    lifecycleState: "running",
    permissionProfile: "managed-autonomous",
    launchClaimId: "claim-managed",
    launchNonce: "nonce-managed",
    sdkSessionId: null,
    sdkWorkspacePath: null,
    sdkStateRoot: null,
    startedAt: TEST_TIMESTAMP,
    lastStateChangedAt: TEST_TIMESTAMP,
    progressEvents: [],
    evidence: [],
    ...overrides,
  };
}

function buildSessionSummary(
  nodeId: string,
  sessions: readonly SessionRegistryListItem[],
): GraphNodeSessionStatusSummary {
  const primarySession = sessions[0];
  if (!primarySession) {
    throw new Error("A session summary needs at least one session.");
  }
  return {
    nodeId,
    sessions: [...sessions],
    primarySession,
    count: sessions.length,
  };
}

function buildClaim(
  overrides: Partial<NodeLaunchClaimState> = {},
): NodeLaunchClaimState {
  return {
    launchClaimId: "claim-a",
    status: "pending",
    launchedAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    bindingWindowExpiresAt: "2026-05-05T12:05:00.000Z",
    reservedRegistryId: "reserved-a",
    boundRegistryId: null,
    boundCopilotSessionId: null,
    failureCode: null,
    failureReason: null,
    blocksLaunch: true,
    retryable: false,
    ...overrides,
  };
}

function buildLaunchRecord(
  nodeId: string,
  latestClaim: NodeLaunchClaimState | null = buildClaim(),
): NodeLaunchRecord {
  return {
    id: `launch-${nodeId}`,
    graphPath: "C:\\work\\streamliner\\.streamliner\\workstreams\\runtime\\graph.json",
    nodeId,
    projectKey: "streamliner",
    workstreamId: "runtime-overlay-ui",
    branch: "feature/runtime-overlay",
    workId: "runtime-overlay-ui",
    workTitle: "Runtime Overlay UI",
    cwd: "C:\\work\\streamliner",
    pawWorkDir: "C:\\work\\streamliner\\.paw\\work\\runtime-overlay-ui",
    workflowContextPath:
      "C:\\work\\streamliner\\.paw\\work\\runtime-overlay-ui\\WorkflowContext.md",
    streamlinerContextPath:
      "C:\\work\\streamliner\\.paw\\work\\runtime-overlay-ui\\streamliner\\context.md",
    contextPackagePath:
      "C:\\work\\streamliner\\.paw\\work\\runtime-overlay-ui\\context.json",
    contextFilePath:
      "C:\\work\\streamliner\\.paw\\work\\runtime-overlay-ui\\context.md",
    launchNonce: "nonce-a",
    launchClaimRef: "claim-a",
    trackerUrl: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    pathStatus: {
      cwdExists: true,
      pawWorkDirExists: true,
      workflowContextExists: true,
      streamlinerContextExists: true,
      contextPackageExists: true,
      contextFileExists: true,
    },
    latestClaim,
  };
}

function buildOverlay(
  derivedNodes: readonly WorkstreamDerivedNode[],
  options: {
    sessions?: ReadonlyMap<string, GraphNodeSessionStatusSummary>;
    launchRecords?: ReadonlyMap<string, NodeLaunchRecord>;
    state?: "loading" | "ready" | "error";
    error?: Error | string | null;
    launchRecordsState?: "loading" | "ready" | "error";
    launchRecordsError?: Error | string | null;
  } = {},
) {
  return buildWorkstreamRuntimeOverlay({
    derivedNodes,
    nodeSessionStatuses: options.sessions,
    nodeLaunchRecords: options.launchRecords,
    sessionStatusState: options.state ?? "ready",
    sessionStatusError: options.error,
    launchRecordsState: options.launchRecordsState,
    launchRecordsError: options.launchRecordsError,
  });
}

describe("buildWorkstreamRuntimeOverlay", () => {
  it("projects planned and ready committed states without runtime evidence", () => {
    const planned = buildDerivedNode({
      node: { id: "planned-node", status: "planned" },
    });
    const ready = buildDerivedNode({
      node: { id: "ready-node", status: "ready" },
      operationalStatus: "ready",
    });

    const overlay = buildOverlay([planned, ready]);

    expect(overlay.nodesById.get("planned-node")?.runtimeStatus).toBe("planned");
    expect(overlay.nodesById.get("ready-node")?.runtimeStatus).toBe("ready");
    expect(overlay.summary.counts.byStatus.planned).toBe(1);
    expect(overlay.summary.counts.byStatus.ready).toBe(1);
    expect(overlay.gateReadiness.status).toBe("usable");
  });

  it("marks a pending blocking launch claim with no bound session as launching", () => {
    const entry = buildDerivedNode({
      node: { id: "launching-node", status: "ready" },
      operationalStatus: "ready",
    });
    const record = buildLaunchRecord("launching-node", buildClaim());

    const overlay = buildOverlay([entry], {
      launchRecords: new Map([[entry.node.id, record]]),
    });
    const node = overlay.nodesById.get("launching-node");

    expect(node?.committedStatus).toBe("ready");
    expect(node?.runtimeStatus).toBe("launching");
    expect(node?.launch.unresolved).toBe(true);
    expect(overlay.summary.counts.unresolvedLaunches).toBe(1);
    expect(overlay.gateReadiness.status).toBe("degraded");
    expect(overlay.gateReadiness.reasons.map((reason) => reason.code)).toContain(
      "launch-claim-unresolved",
    );
  });

  it("renders a working bound session as active runtime work", () => {
    const entry = buildDerivedNode({
      node: { id: "active-node", status: "planned" },
    });
    const session = buildSession({
      id: "active-session",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "active-node",
        launchClaimId: null,
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });

    expect(overlay.nodesById.get("active-node")?.runtimeStatus).toBe("active");
    expect(overlay.nodesById.get("active-node")?.committedStatus).toBe("planned");
    expect(overlay.nodesById.get("active-node")?.paw.status).toBe("none");
    expect(overlay.gateReadiness.status).toBe("usable");
  });

  it("renders waiting_for_input or pending input evidence as needs-input", () => {
    const entry = buildDerivedNode({
      node: { id: "needs-input-node", status: "in-progress" },
      operationalStatus: "in-progress",
    });
    const session = buildSession({
      id: "needs-input-session",
      activityStatus: "working",
      activityEvidence: buildSessionRegistryActivityEvidence({
        pendingInputRequest: true,
        pendingInputRequestCount: 1,
      }),
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "needs-input-node",
        launchClaimId: null,
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });

    expect(overlay.nodesById.get("needs-input-node")?.runtimeStatus).toBe(
      "needs-input",
    );
    expect(overlay.summary.counts.byStatus["needs-input"]).toBe(1);
  });

  it("renders interrupted or stale process evidence as degraded interrupted state", () => {
    const entry = buildDerivedNode({
      node: { id: "stale-node", status: "in-progress" },
      operationalStatus: "in-progress",
    });
    const session = buildSession({
      id: "stale-session",
      activityStatus: "working",
      copilotProcessState: "stale_lock",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "stale-node",
        launchClaimId: null,
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });
    const node = overlay.nodesById.get("stale-node");

    expect(node?.runtimeStatus).toBe("interrupted");
    expect(node?.degradationReasons.map((reason) => reason.code)).toContain(
      "session-stale-process",
    );
    expect(overlay.gateReadiness.status).toBe("degraded");
  });

  it("renders ended session evidence while retaining the committed status", () => {
    const entry = buildDerivedNode({
      node: { id: "ended-node", status: "in-progress" },
      operationalStatus: "in-progress",
    });
    const session = buildSession({
      id: "ended-session",
      lifecycleStatus: "ended",
      activityStatus: "exited",
      copilotProcessState: "none",
      trustedEndedAt: TEST_TIMESTAMP,
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "ended-node",
        launchClaimId: null,
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });
    const node = overlay.nodesById.get("ended-node");

    expect(node?.runtimeStatus).toBe("ended");
    expect(node?.committedStatus).toBe("in-progress");
    expect(node?.degradationReasons.map((reason) => reason.code)).toContain(
      "session-ended-unpromoted",
    );
  });

  it("adds PAW enrichment for recognized Streamliner-launched workflows", () => {
    const entry = buildDerivedNode({
      node: { id: "paw-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      id: "paw-session",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "paw-node",
        launchClaimId: "claim-paw",
      },
      pawLaunch: {
        workId: "runtime-overlay-ui",
        workTitle: "Runtime Overlay UI",
        workflowKind: "paw-lite",
        pawWorkDir: "C:\\work\\.paw\\work\\runtime-overlay-ui",
        workflowContextPath:
          "C:\\work\\.paw\\work\\runtime-overlay-ui\\WorkflowContext.md",
        streamlinerContextPath: null,
      },
      pawWorkflow: {
        status: "recognized",
        stage: "implementation",
        workflowKind: "paw-lite",
        workId: "runtime-overlay-ui",
        workTitle: "Runtime Overlay UI",
        workDir: "C:\\work\\.paw\\work\\runtime-overlay-ui",
        artifacts: [
          {
            path: "C:\\work\\.paw\\work\\runtime-overlay-ui\\Plan.md",
            kind: "planning",
            stage: "planning",
            mtimeMs: 1,
          },
        ],
        artifactCount: 1,
        latestArtifactPath: "C:\\work\\.paw\\work\\runtime-overlay-ui\\Plan.md",
        latestArtifactMtimeMs: 1,
        scannedAt: TEST_TIMESTAMP,
        diagnostics: [],
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });
    const node = overlay.nodesById.get("paw-node");

    expect(node?.runtimeStatus).toBe("active");
    expect(node?.paw.status).toBe("recognized");
    expect(node?.paw.stage).toBe("implementation");
    expect(overlay.summary.counts.pawEnrichedNodes).toBe(1);
    expect(overlay.gateReadiness.status).toBe("usable");
  });

  it("degrades when expected PAW workflow evidence is unknown", () => {
    const entry = buildDerivedNode({
      node: { id: "paw-unknown-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      id: "paw-unknown-session",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "paw-unknown-node",
        launchClaimId: "claim-paw-unknown",
      },
      pawLaunch: {
        workId: "runtime-overlay-ui",
        workTitle: "Runtime Overlay UI",
        workflowKind: "paw-lite",
        pawWorkDir: "C:\\work\\.paw\\work\\runtime-overlay-ui",
        workflowContextPath: null,
        streamlinerContextPath: null,
      },
      pawWorkflow: {
        status: "unknown",
        stage: null,
        workflowKind: "unknown",
        workId: null,
        workTitle: null,
        workDir: null,
        artifacts: [],
        artifactCount: 0,
        latestArtifactPath: null,
        latestArtifactMtimeMs: null,
        scannedAt: TEST_TIMESTAMP,
        diagnostics: ["paw_artifact_layout_unknown"],
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });
    const node = overlay.nodesById.get("paw-unknown-node");

    expect(node?.paw.status).toBe("unknown");
    expect(node?.degradationReasons.map((reason) => reason.code)).toContain(
      "paw-evidence-unknown",
    );
    expect(overlay.gateReadiness.status).toBe("degraded");
  });

  it("treats tracker references without snapshots as linked metadata", () => {
    const entry = buildDerivedNode({
      node: {
        id: "tracker-node",
        status: "ready",
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 52,
        },
      },
      operationalStatus: "ready",
    });

    const overlay = buildOverlay([entry]);
    const node = overlay.nodesById.get("tracker-node");

    expect(node?.tracker.status).toBe("linked");
    expect(node?.degradationReasons.map((reason) => reason.code)).not.toContain(
      "tracker-snapshot-missing",
    );
    expect(overlay.summary.counts.degradedNodes).toBe(0);
    expect(overlay.summary.counts.trackerDegradedNodes).toBe(0);
    expect(overlay.gateReadiness.status).toBe("usable");
    expect(overlay.summary.issues.map((issue) => issue.code)).toContain(
      "tracker-snapshot-missing",
    );
  });

  it("degrades tracker overlays when a GitHub snapshot has a fetch error", () => {
    const entry = buildDerivedNode({
      node: {
        id: "tracker-error-node",
        status: "ready",
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 69,
        },
      },
      operationalStatus: "ready",
      githubIssue: {
        owner: "lossyrob",
        repo: "streamliner",
        number: 69,
        state: "unknown",
        title: "Show live GitHub status",
        url: "https://github.com/lossyrob/streamliner/issues/69",
        linkedPullRequests: [],
        fetchedAt: TEST_TIMESTAMP,
        error: "GitHub rate limit reached while fetching issue #69.",
      },
    });

    const overlay = buildOverlay([entry]);
    const node = overlay.nodesById.get("tracker-error-node");

    expect(node?.tracker.status).toBe("degraded");
    expect(node?.degradationReasons.map((reason) => reason.code)).toContain(
      "tracker-snapshot-error",
    );
    expect(overlay.summary.counts.degradedNodes).toBe(1);
    expect(overlay.summary.counts.trackerDegradedNodes).toBe(1);
    expect(overlay.gateReadiness.status).toBe("degraded");
  });

  it("marks a bound blocking launch claim without a visible session as bound-session-missing", () => {
    const entry = buildDerivedNode({
      node: { id: "unresolved-node", status: "ready" },
      operationalStatus: "ready",
    });
    const record = buildLaunchRecord(
      "unresolved-node",
      buildClaim({
        status: "bound",
        boundRegistryId: "missing-registry-row",
        boundCopilotSessionId: "missing-copilot-session",
      }),
    );

    const overlay = buildOverlay([entry], {
      launchRecords: new Map([[entry.node.id, record]]),
    });

    expect(overlay.nodesById.get("unresolved-node")?.runtimeStatus).toBe(
      "unresolved",
    );
    expect(overlay.gateReadiness.reasons.map((reason) => reason.code)).toContain(
      "bound-session-missing",
    );
  });

  it("degrades gate readiness while launch records load or fail", () => {
    const entry = buildDerivedNode({
      node: { id: "launch-source-node", status: "ready" },
      operationalStatus: "ready",
    });

    const loading = buildOverlay([entry], {
      launchRecordsState: "loading",
    });
    expect(loading.gateReadiness.status).toBe("degraded");
    expect(loading.gateReadiness.reasons.map((reason) => reason.code)).toContain(
      "launch-records-loading",
    );

    const failed = buildOverlay([entry], {
      launchRecordsState: "error",
      launchRecordsError: "Launch record API unavailable.",
    });
    expect(failed.gateReadiness.status).toBe("degraded");
    expect(failed.gateReadiness.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "launch-records-error",
          message: "Launch record API unavailable.",
        }),
      ]),
    );
  });

  it("keeps the highest-attention primary session while marking ambiguity", () => {
    const entry = buildDerivedNode({
      node: { id: "ambiguous-node", status: "in-progress" },
      operationalStatus: "in-progress",
    });
    const waitingSession = buildSession({
      id: "waiting-session",
      activityStatus: "waiting_for_input",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "ambiguous-node",
        launchClaimId: null,
      },
    });
    const workingSession = buildSession({
      id: "working-session",
      activityStatus: "working",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "ambiguous-node",
        launchClaimId: null,
      },
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [
          entry.node.id,
          buildSessionSummary(entry.node.id, [waitingSession, workingSession]),
        ],
      ]),
    });
    const node = overlay.nodesById.get("ambiguous-node");

    expect(node?.runtimeStatus).toBe("needs-input");
    expect(node?.session.primarySession?.id).toBe("waiting-session");
    expect(node?.session.ambiguous).toBe(true);
    expect(overlay.summary.counts.ambiguousNodes).toBe(1);
    expect(overlay.gateReadiness.reasons.map((reason) => reason.code)).toContain(
      "ambiguous-bound-sessions",
    );
  });

  it("projects managed runtime lifecycle without promoting committed graph status", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      id: "managed-session",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-node",
        launchClaimId: "claim-managed",
      },
      runtime: buildManagedRuntime({
        lifecycleState: "completed",
        evidence: [{
          id: "evidence-completed",
          kind: "completed",
          source: "test",
          detectedAt: TEST_TIMESTAMP,
          url: null,
          repo: null,
          number: null,
          sha: null,
          summary: "Managed worker finished and opened a PR.",
        }],
        progressEvents: Array.from({ length: 12 }, (_, index) => ({
          id: `progress-${index}`,
          sequence: index,
          timestamp: `2026-05-05T12:${String(index).padStart(2, "0")}:00.000Z`,
          type: "lifecycle",
          message: `Safe progress ${index}`,
        })),
      }),
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
    });
    const node = overlay.nodesById.get("managed-node");

    expect(node?.committedStatus).toBe("ready");
    expect(node?.runtimeStatus).toBe("active");
    expect(node?.managedRuntime?.lifecycleState).toBe("completed");
    expect(node?.managedRuntime?.progress).toHaveLength(8);
    expect(node?.managedRuntime?.progress.at(-1)?.summary).toBe("Safe progress 11");
  });

  it("uses canonical session runtime metadata for managed lifecycle state", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-latest-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-latest-node",
        launchClaimId: "claim-managed",
      },
      runtime: buildManagedRuntime({
        lifecycleState: "failed",
        lastStateChangedAt: "2026-05-05T12:01:00.000Z",
        progressEvents: [{
          id: "progress-failed",
          sequence: 1,
          type: "error",
          message: "Managed worker failed after the session poll.",
          timestamp: "2026-05-05T12:01:00.000Z",
        }],
      }),
    });
    const record = buildLaunchRecord("managed-latest-node", null);

    const overlay = buildOverlay([entry], {
      sessions: new Map([[entry.node.id, buildSessionSummary(entry.node.id, [session])]]),
      launchRecords: new Map([[entry.node.id, record]]),
    });
    const node = overlay.nodesById.get("managed-latest-node");

    expect(node?.managedRuntime?.source).toBe("session");
    expect(node?.managedRuntime?.lifecycleState).toBe("failed");
    expect(node?.degradationReasons.map((reason) => reason.code)).toContain(
      "managed-runtime-failed",
    );
  });

  it("lets primary runtime evidence win over terminal managed lifecycle states", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-terminal-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-terminal-node",
        launchClaimId: "claim-managed",
      },
      activityStatus: "waiting_for_input",
      runtime: buildManagedRuntime({
        lifecycleState: "terminal_takeover",
      }),
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([[entry.node.id, buildSessionSummary(entry.node.id, [session])]]),
    });
    const node = overlay.nodesById.get("managed-terminal-node");

    expect(node?.managedRuntime?.lifecycleState).toBe("terminal_takeover");
    expect(node?.runtimeStatus).toBe("needs-input");
    expect(node?.degradationReasons.map((reason) => reason.code)).not.toContain(
      "managed-runtime-failed",
    );
  });

  it("surfaces failed managed runtime lifecycle when no primary runtime supersedes it", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-failed-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-failed-node",
        launchClaimId: "claim-managed",
      },
      runtime: buildManagedRuntime({
        lifecycleState: "failed",
        progressEvents: [{
          id: "progress-failed",
          sequence: 1,
          type: "error",
          message: "Managed worker exited with review errors.",
          timestamp: TEST_TIMESTAMP,
        }],
      }),
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([[entry.node.id, buildSessionSummary(entry.node.id, [session])]]),
    });
    const node = overlay.nodesById.get("managed-failed-node");

    expect(node?.runtimeStatus).toBe("interrupted");
    expect(node?.degradationReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "managed-runtime-failed",
          message: "Managed worker exited with review errors.",
        }),
      ]),
    );
  });

  it("surfaces terminal takeover without a managed failure issue", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-takeover-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-takeover-node",
        launchClaimId: "claim-managed",
      },
      activityStatus: "exited",
      runtime: buildManagedRuntime({
        lifecycleState: "terminal_takeover",
      }),
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([[entry.node.id, buildSessionSummary(entry.node.id, [session])]]),
    });
    const node = overlay.nodesById.get("managed-takeover-node");

    expect(node?.runtimeStatus).toBe("ended");
    expect(node?.degradationReasons.map((reason) => reason.code)).not.toContain(
      "managed-runtime-failed",
    );
  });

  it("keeps lifecycle pill and overlay status families compatible for every managed state", () => {
    for (const state of MANAGED_RUNTIME_LIFECYCLE_STATES) {
      const statusClass = managedLifecycleStatusClass(state);
      const overlayStatus = MANAGED_RUNTIME_LIFECYCLE_OVERLAY_STATUSES[state];
      expect(overlayStatus).toBeDefined();
      if (overlayStatus === "ended") {
        expect(statusClass).not.toBe("green");
      }
      if (overlayStatus === "active") {
        expect(statusClass).not.toBe("muted");
      }
    }
  });

  it("surfaces waiting managed runtime lifecycle as builder input without changing graph status", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-waiting-node", status: "ready" },
      operationalStatus: "ready",
    });
    const session = buildSession({
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-waiting-node",
        launchClaimId: "claim-managed",
      },
      runtime: buildManagedRuntime({
        lifecycleState: "waiting_for_builder",
        progressEvents: [{
          id: "progress-waiting",
          sequence: 1,
          type: "permission_decision",
          message: "Needs builder confirmation for PR cleanup.",
          timestamp: TEST_TIMESTAMP,
        }],
      }),
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([[entry.node.id, buildSessionSummary(entry.node.id, [session])]]),
    });
    const node = overlay.nodesById.get("managed-waiting-node");

    expect(node?.committedStatus).toBe("ready");
    expect(node?.runtimeStatus).toBe("needs-input");
    expect(node?.hasRuntimeEvidence).toBe(true);
    expect(node?.degradationReasons.map((reason) => reason.code)).toContain(
      "managed-runtime-waiting-for-builder",
    );
  });

  it("surfaces startup-reconciled managed runtime rows as interrupted diagnostics, not active work", () => {
    const entry = buildDerivedNode({
      node: { id: "managed-reconciled-node", status: "ready" },
      operationalStatus: "ready",
    });
    const diagnosticMessage =
      "Managed SDK startup reconciliation marked this background session interrupted because no live SDK owner could be verified.";
    const session = buildSession({
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "managed-reconciled-node",
        launchClaimId: "claim-managed",
      },
      runtime: buildManagedRuntime({
        lifecycleState: "interrupted",
        lastStateChangedAt: TEST_TIMESTAMP,
        progressEvents: [{
          id: "progress-startup-reconciliation",
          sequence: 1,
          type: "lifecycle",
          message: diagnosticMessage,
          timestamp: TEST_TIMESTAMP,
          data: {
            reason: "startup-reconciliation-sdk-owner-unverified",
            action: "marked-interrupted-for-builder-recovery",
            previousLifecycleState: "running",
          },
        }],
      }),
    });

    const overlay = buildOverlay([entry], {
      sessions: new Map([[entry.node.id, buildSessionSummary(entry.node.id, [session])]]),
    });
    const node = overlay.nodesById.get("managed-reconciled-node");

    expect(node?.runtimeStatus).toBe("interrupted");
    expect(node?.managedRuntime?.lifecycleState).toBe("interrupted");
    expect(node?.managedRuntime?.projection.summary).toBe(diagnosticMessage);
    expect(node?.managedRuntime?.progress.at(-1)?.summary).toBe(diagnosticMessage);
    expect(overlay.summary.counts.byStatus.active).toBe(0);
  });

  it("reports registry loading as degraded and registry errors as not-usable", () => {
    const entry = buildDerivedNode();

    const loading = buildOverlay([entry], { state: "loading" });
    const errored = buildOverlay([entry], {
      state: "error",
      error: "Registry request failed.",
    });

    expect(loading.gateReadiness.status).toBe("degraded");
    expect(loading.gateReadiness.reasons.map((reason) => reason.code)).toContain(
      "session-registry-loading",
    );
    expect(errored.gateReadiness.status).toBe("not-usable");
    expect(errored.summary.counts.notUsableIssueCount).toBe(1);
    expect(errored.gateReadiness.reasons.map((reason) => reason.code)).toContain(
      "session-registry-error",
    );
  });

  it("is a pure projection that does not mutate graph, session, or launch inputs", () => {
    const entry = buildDerivedNode({
      node: {
        id: "pure-node",
        status: "planned",
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 52,
        },
      },
    });
    const session = buildSession({
      id: "pure-session",
      graphBinding: {
        workstreamId: "runtime-overlay-ui",
        nodeId: "pure-node",
        launchClaimId: "claim-pure",
      },
    });
    const record = buildLaunchRecord("pure-node", buildClaim());
    const nodeBefore = structuredClone(entry.node);
    const sessionBefore = structuredClone(session);
    const recordBefore = structuredClone(record);

    const first = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
      launchRecords: new Map([[entry.node.id, record]]),
    });
    const second = buildOverlay([entry], {
      sessions: new Map([
        [entry.node.id, buildSessionSummary(entry.node.id, [session])],
      ]),
      launchRecords: new Map([[entry.node.id, record]]),
    });

    expect(entry.node).toEqual(nodeBefore);
    expect(session).toEqual(sessionBefore);
    expect(record).toEqual(recordBefore);
    expect(first.nodesById.get("pure-node")?.committedStatus).toBe("planned");
    expect(second.nodesById.get("pure-node")?.runtimeStatus).toBe(
      first.nodesById.get("pure-node")?.runtimeStatus,
    );
  });
});
