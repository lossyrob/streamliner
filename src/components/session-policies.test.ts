import { describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "../session-registry-schema";
import {
  buildRestartCommand,
  canManuallyStop,
  canRelaunch,
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
    launchCliArgs: null,
    graphBinding: null,
    pawLaunch: null,
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
    expect(buildRestartCommand(trusted, [], "powershell")).toBe(
      "Set-Location -LiteralPath 'C:\\repo\\worktree'; copilot '--resume=copilot-session-id'",
    );
  });

  it("builds restart commands with recorded launch args before defaults", () => {
    const session = buildSession({
      copilotSessionId: "copilot-session-id",
      launchCliArgs: ["--model=gpt-5.5"],
    });

    expect(buildRestartCommand(session, ["--yolo"], "powershell")).toBe(
      "Set-Location -LiteralPath 'C:\\repo'; copilot '--model=gpt-5.5' '--resume=copilot-session-id'",
    );
  });

  it("builds restart commands with configured defaults when recorded args are missing", () => {
    const session = buildSession({
      copilotSessionId: "copilot-session-id",
      launchCliArgs: null,
    });

    expect(buildRestartCommand(session, ["--yolo"], "powershell")).toBe(
      "Set-Location -LiteralPath 'C:\\repo'; copilot '--yolo' '--resume=copilot-session-id'",
    );
  });

  it("builds POSIX restart commands when requested", () => {
    const session = buildSession({
      cwd: "/Users/rob/project's worktree",
      copilotSessionId: "copilot-session-id",
      launchCliArgs: ["--model=gpt-5.5"],
    });

    expect(buildRestartCommand(session, [], "posix")).toBe(
      "cd '/Users/rob/project'\\''s worktree' && copilot '--model=gpt-5.5' '--resume=copilot-session-id'",
    );
  });

  it("omits the directory change in POSIX restart commands without a cwd", () => {
    const session = buildSession({
      cwd: "",
      derivedWorktreePath: null,
      copilotSessionId: "copilot-session-id",
    });

    expect(buildRestartCommand(session, ["--yolo"], "posix")).toBe(
      "copilot '--yolo' '--resume=copilot-session-id'",
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

  describe("canRelaunch", () => {
    it("returns true for active session with cwd", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotProcessState: null,
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(true);
    });

    it("returns true for paused session with cwd", () => {
      const session = buildSession({
        lifecycleStatus: "paused",
        copilotProcessState: null,
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(true);
    });

    it("returns true for ended session with cwd", () => {
      const session = buildSession({
        lifecycleStatus: "ended",
        copilotProcessState: null,
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(true);
    });

    it("returns false for archived session", () => {
      const session = buildSession({
        lifecycleStatus: "archived",
        copilotProcessState: null,
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(false);
    });

    it("returns false for trusted-active session", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotProcessState: "live",
        trustedSignalSource: "copilot-cli-hook",
        trustedEndedAt: null,
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(false);
    });

    it("returns true when copilotProcessState is live but no trusted signal source", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotProcessState: "live",
        trustedSignalSource: null,
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(true);
    });

    it("returns false for session with empty cwd and no derivedWorktreePath", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotProcessState: null,
        cwd: "",
        derivedWorktreePath: null,
      });
      expect(canRelaunch(session)).toBe(false);
    });

    it("returns true for session with derivedWorktreePath but empty cwd", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotProcessState: null,
        cwd: "",
        derivedWorktreePath: "C:\\repo\\worktree",
      });
      expect(canRelaunch(session)).toBe(true);
    });
  });

  describe("canManuallyStop", () => {
    it("returns true for an interrupted session with copilotSessionId", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        activityStatus: "interrupted",
        copilotSessionId: "sess-1",
      });
      expect(canManuallyStop(session)).toBe(true);
    });

    it("returns true for an active session with copilotSessionId", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotSessionId: "sess-1",
      });
      expect(canManuallyStop(session)).toBe(true);
    });

    it("returns false for archived sessions", () => {
      const session = buildSession({
        lifecycleStatus: "archived",
        copilotSessionId: "sess-1",
      });
      expect(canManuallyStop(session)).toBe(false);
    });

    it("returns false for sessions already ended via trusted signal", () => {
      const session = buildSession({
        lifecycleStatus: "ended",
        trustedEndedAt: "2026-04-29T19:59:00.000Z",
        copilotSessionId: "sess-1",
      });
      expect(canManuallyStop(session)).toBe(false);
    });

    it("returns false for sessions without a copilotSessionId", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotSessionId: null,
      });
      expect(canManuallyStop(session)).toBe(false);
    });
  });
});
