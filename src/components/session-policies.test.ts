import { describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import {
  buildRestartCommand,
  buildRelaunchCommand,
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

  describe("buildRelaunchCommand", () => {
    it("returns a Set-Location + resume command when copilotSessionId is present", () => {
      const session = buildSession({
        copilotSessionId: "copilot-session-id",
        cwd: "C:\\repo",
      });
      expect(buildRelaunchCommand(session)).toBe(
        "Set-Location -LiteralPath 'C:\\repo'; copilot --resume 'copilot-session-id'",
      );
    });

    it("returns a Set-Location command (cwd-only) when copilotSessionId is absent", () => {
      const session = buildSession({
        copilotSessionId: null,
        cwd: "C:\\repo",
      });
      expect(buildRelaunchCommand(session)).toBe("Set-Location -LiteralPath 'C:\\repo'");
    });

    it("prefers derivedWorktreePath over cwd", () => {
      const session = buildSession({
        copilotSessionId: "copilot-session-id",
        cwd: "C:\\repo",
        derivedWorktreePath: "C:\\repo\\worktree",
      });
      expect(buildRelaunchCommand(session)).toBe(
        "Set-Location -LiteralPath 'C:\\repo\\worktree'; copilot --resume 'copilot-session-id'",
      );
    });

    it("uses cwd when derivedWorktreePath is null", () => {
      const session = buildSession({
        copilotSessionId: "copilot-session-id",
        cwd: "C:\\repo",
        derivedWorktreePath: null,
      });
      expect(buildRelaunchCommand(session)).toBe(
        "Set-Location -LiteralPath 'C:\\repo'; copilot --resume 'copilot-session-id'",
      );
    });

    it("handles cwd with single quotes (escaping)", () => {
      const session = buildSession({
        copilotSessionId: null,
        cwd: "C:\\repo's folder",
      });
      expect(buildRelaunchCommand(session)).toBe("Set-Location -LiteralPath 'C:\\repo''s folder'");
    });

    it("returns just the resume command when both path sources are empty but copilotSessionId exists", () => {
      const session = buildSession({
        copilotSessionId: "copilot-session-id",
        cwd: "",
        derivedWorktreePath: null,
      });
      expect(buildRelaunchCommand(session)).toBe("copilot --resume 'copilot-session-id'");
    });

    it("returns empty string when no paths and no copilotSessionId", () => {
      const session = buildSession({
        copilotSessionId: null,
        cwd: "",
        derivedWorktreePath: null,
      });
      expect(buildRelaunchCommand(session)).toBe("");
    });
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

    it("returns false for live session (copilotProcessState === 'live')", () => {
      const session = buildSession({
        lifecycleStatus: "active",
        copilotProcessState: "live",
        cwd: "C:\\repo",
      });
      expect(canRelaunch(session)).toBe(false);
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
});
