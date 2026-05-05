import { describe, expect, it } from "vitest";

import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "./session-registry-schema";
import type { SessionRegistryListItem } from "./session-registry-contract";
import { buildGraphNodeSessionStatusMap } from "./graph-node-session-status";

const DEFAULT_TEST_SESSION_TIMESTAMP = "2026-05-05T12:00:00.000Z";

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
    lastSeenAt: DEFAULT_TEST_SESSION_TIMESTAMP,
    updatedAt: DEFAULT_TEST_SESSION_TIMESTAMP,
    color: null,
    cwd: "C:\\work\\streamliner",
    repo: "lossyrob/streamliner",
    branch: "feature/session-a",
    tags: [],
    originKind: "launched",
    graphBinding: {
      workstreamId: "session-launching-and-tracking",
      nodeId: "graph-node-session-status-ui",
      launchClaimId: "claim-a",
    },
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
    activityStatusUpdatedAt: DEFAULT_TEST_SESSION_TIMESTAMP,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: DEFAULT_TEST_SESSION_TIMESTAMP,
    trustedEndedAt: null,
    trustedLastSignalAt: DEFAULT_TEST_SESSION_TIMESTAMP,
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

describe("buildGraphNodeSessionStatusMap", () => {
  it("chooses the highest-attention bound session and counts non-manual rows", () => {
    const summary = buildGraphNodeSessionStatusMap(
      [
        buildSession({
          id: "working-session",
          title: "Working session",
          activityStatus: "working",
        }),
        buildSession({
          id: "waiting-session",
          title: "Waiting session",
          activityStatus: "waiting_for_input",
        }),
        buildSession({
          id: "manual-bound-session",
          title: "Manual bound session",
          originKind: "manual",
          activityStatus: "waiting_for_input",
        }),
        buildSession({
          id: "unbound-session",
          graphBinding: null,
          activityStatus: "waiting_for_input",
        }),
      ],
      "session-launching-and-tracking",
    ).get("graph-node-session-status-ui");

    expect(summary?.count).toBe(2);
    expect(summary?.primarySession.id).toBe("waiting-session");
    expect(summary?.sessions.map((session) => session.id)).toEqual([
      "waiting-session",
      "working-session",
    ]);
  });

  it("keeps exited and unknown sessions in the lowest attention tier", () => {
    const summary = buildGraphNodeSessionStatusMap(
      [
        buildSession({
          id: "unknown-session",
          activityStatus: "unknown",
          updatedAt: "2026-05-05T12:02:00.000Z",
        }),
        buildSession({
          id: "exited-session",
          activityStatus: "exited",
          updatedAt: "2026-05-05T12:01:00.000Z",
        }),
      ],
      "session-launching-and-tracking",
    ).get("graph-node-session-status-ui");

    expect(summary?.count).toBe(2);
    expect(summary?.primarySession.id).toBe("unknown-session");
  });
});
