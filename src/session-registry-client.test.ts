import { describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "./session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "./session-registry-schema";
import {
  runtimeUpdatedPayload,
  sessionMatchesQuery,
} from "./session-registry-client";

function buildSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "session-registry-client-test",
    version: 0,
    title: "Client test session",
    titleSource: "user",
    description: "",
    lifecycleStatus: "active",
    lastSeenAt: null,
    updatedAt: "2026-05-07T12:00:00.000Z",
    color: null,
    cwd: "C:\\repo",
    repo: "lossyrob/streamliner",
    branch: "feature/client-test",
    tags: [],
    originKind: "launched",
    launchCliArgs: [],
    graphBinding: null,
    pawLaunch: null,
    runtime: null,
    copilotSessionId: null,
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: null,
    copilotProcessState: null,
    copilotProcessId: null,
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
    trustedSignalSource: null,
    trustedStartedAt: null,
    trustedEndedAt: null,
    trustedLastSignalAt: null,
    trustedStartSource: null,
    trustedEndReason: null,
    trustedExecutionKind: null,
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

describe("session registry client helpers", () => {
  it("matches origin kind in query text filters", () => {
    expect(sessionMatchesQuery(buildSession({ originKind: "launched" }), {
      text: "launched",
    })).toBe(true);
    expect(sessionMatchesQuery(buildSession({ originKind: "manual" }), {
      text: "launched",
    })).toBe(false);
  });

  it("rejects runtime update payloads with unsupported runtime enums", () => {
    expect(runtimeUpdatedPayload({
      registryId: "managed-row",
      runtime: {
        runtimeKind: "managed-sdk",
        runtimeOwner: "unexpected-owner",
        lifecycleState: "running",
        permissionProfile: "managed-autonomous",
        launchClaimId: "claim",
        launchNonce: "nonce",
        sdkSessionId: "sdk",
        sdkWorkspacePath: null,
        sdkStateRoot: null,
        startedAt: null,
        lastStateChangedAt: null,
        progressEvents: [],
        evidence: [],
      },
      version: 1,
    })).toBeNull();
  });
});
