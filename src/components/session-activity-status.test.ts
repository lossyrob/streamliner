import { describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "../session-registry-schema";
import type { ManagedRuntimeLifecycleState } from "../managed-runtime-contract";
import { filterEndedSessions } from "./session-policies";
import {
  getActivityStatusLabel,
  getEffectiveActivityStatus,
} from "./session-activity-status";

const TEST_TIMESTAMP = "2026-05-09T12:00:00.000Z";

function managedRuntime(lifecycleState: ManagedRuntimeLifecycleState) {
  return {
    runtimeKind: "managed-sdk" as const,
    runtimeOwner: "streamliner-sdk" as const,
    lifecycleState,
    permissionProfile: "managed-autonomous" as const,
    launchClaimId: "claim-1",
    launchNonce: "nonce-1",
    sdkSessionId: "sdk-session-1",
    sdkWorkspacePath: null,
    sdkStateRoot: null,
    startedAt: TEST_TIMESTAMP,
    lastStateChangedAt: TEST_TIMESTAMP,
    progressEvents: [],
    evidence: [],
  };
}

function buildSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "session-1",
    version: 0,
    title: "Session 1",
    titleSource: "user",
    description: "",
    lifecycleStatus: "ended",
    lastSeenAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    color: null,
    cwd: "C:\\work\\streamliner",
    repo: "lossyrob/streamliner",
    branch: "feature/background-session",
    tags: [],
    originKind: "launched",
    launchCliArgs: null,
    graphBinding: {
      workstreamId: "sdk-managed-worker-runtime",
      nodeId: "managed-session-console",
      launchClaimId: "claim-1",
    },
    pawLaunch: null,
    runtime: null,
    copilotSessionId: "sdk-session-1",
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: "none",
    copilotProcessId: null,
    activityStatus: "exited",
    activityStatusUpdatedAt: TEST_TIMESTAMP,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: "2026-05-09T11:00:00.000Z",
    trustedEndedAt: TEST_TIMESTAMP,
    trustedLastSignalAt: TEST_TIMESTAMP,
    trustedStartSource: "resume",
    trustedEndReason: "user_exit",
    trustedExecutionKind: "agency",
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

describe("managed background session activity display", () => {
  it("treats a running managed runtime as active even when observed session fields are stale", () => {
    const session = buildSession({
      runtime: managedRuntime("running"),
    });

    expect(getEffectiveActivityStatus(session)).toBe("working");
    expect(getActivityStatusLabel(session)).toBe("working");
    expect(filterEndedSessions([session], false)).toEqual([session]);
  });

  it("keeps failed managed runtimes visible for recovery", () => {
    const session = buildSession({
      runtime: managedRuntime("failed"),
    });

    expect(getEffectiveActivityStatus(session)).toBe("exited");
    expect(filterEndedSessions([session], false)).toEqual([session]);
  });

  it("still hides cleanly completed managed runtimes with ended session fields", () => {
    const session = buildSession({
      runtime: managedRuntime("completed"),
    });

    expect(getEffectiveActivityStatus(session)).toBe("exited");
    expect(filterEndedSessions([session], false)).toEqual([]);
  });
});
