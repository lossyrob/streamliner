import { describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import {
  buildRestartCommand,
  filterEndedSessions,
  getDisplaySessionId,
} from "./session-policies";

function buildSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "registry-row",
    version: 0,
    title: "Registry row",
    titleSource: "user",
    description: "",
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-27T12:00:00.000Z",
    updatedAt: "2026-04-27T12:00:00.000Z",
    color: null,
    cwd: "C:\\repo",
    repo: "lossyrob/streamliner",
    branch: "main",
    tags: [],
    originKind: "manual",
    graphBinding: null,
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

describe("session policies", () => {
  it("only builds restart commands for rows with a Copilot session id", () => {
    const manual = buildSession({ id: "manual-registry-id", copilotSessionId: null });
    const trusted = buildSession({
      id: "registry-id",
      copilotSessionId: "copilot-session-id",
      derivedWorktreePath: "C:/repo/worktree",
    });

    expect(getDisplaySessionId(manual)).toBe("manual-registry-id");
    expect(buildRestartCommand(manual)).toBeNull();
    expect(buildRestartCommand(trusted)).toBe(
      "Set-Location -LiteralPath 'C:\\repo\\worktree'; copilot --resume 'copilot-session-id'",
    );
  });

  it("hides cleanly ended sessions by default but keeps interrupted sessions visible", () => {
    const working = buildSession({ id: "working", activityStatus: "working" });
    const ended = buildSession({
      id: "ended",
      lifecycleStatus: "ended",
      activityStatus: "exited",
      trustedEndedAt: "2026-04-27T12:10:00.000Z",
      trustedSignalSource: "copilot-cli-hook",
    });
    const interrupted = buildSession({
      id: "interrupted",
      activityStatus: "interrupted",
      trustedSignalSource: "copilot-cli-hook",
      trustedStartedAt: "2026-04-27T12:00:00.000Z",
      trustedEndedAt: null,
      copilotProcessState: "none",
    });

    expect(filterEndedSessions([working, ended, interrupted], false).map((row) => row.id)).toEqual([
      "working",
      "interrupted",
    ]);
    expect(filterEndedSessions([working, ended, interrupted], true).map((row) => row.id)).toEqual([
      "working",
      "ended",
      "interrupted",
    ]);
  });
});
