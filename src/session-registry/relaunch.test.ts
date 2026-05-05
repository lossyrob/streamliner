import { describe, expect, it } from "vitest";

import type { SessionRegistryStore, SessionRegistryTrustedSignalInput } from "../session-registry-contract";
import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  type SessionRegistryRecord,
} from "../session-registry-schema";
import type { TerminalLaunchOptions, TerminalLaunchResult } from "../server/terminal-launch";
import {
  type RelaunchDeps,
  buildRelaunchParams,
  relaunchSession,
  validateSessionForRelaunch,
} from "./relaunch";

function buildRecord(
  overrides: Partial<SessionRegistryRecord> = {},
): SessionRegistryRecord {
  return {
    schemaVersion: 1,
    id: "test-session",
    version: 0,
    title: "Test Session",
    titleSource: "user",
    description: "",
    color: null,
    cwd: "C:\\repo",
    repo: "lossyrob/streamliner",
    branch: "main",
    copilotSessionId: null,
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-27T12:00:00.000Z",
    createdAt: "2026-04-27T12:00:00.000Z",
    updatedAt: "2026-04-27T12:00:00.000Z",
    tags: [],
    origin: { kind: "manual" },
    graphBinding: null,
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

function fakeLaunchTerminal(options: TerminalLaunchOptions): TerminalLaunchResult {
  void options;
  return { method: "windows-terminal", pid: 12345 };
}

function fakeDeps(
  sessions: Record<string, SessionRegistryRecord>,
  overrides: Partial<RelaunchDeps> = {},
): { store: SessionRegistryStore; recordedSignals: SessionRegistryTrustedSignalInput[]; deps: Partial<RelaunchDeps> } {
  const recordedSignals: SessionRegistryTrustedSignalInput[] = [];
  return {
    store: {
      getSession: (id: string) => sessions[id] ?? null,
      recordTrustedSessionSignal: (input: SessionRegistryTrustedSignalInput) => {
        recordedSignals.push(input);
        return sessions[Object.keys(sessions)[0] ?? ""] ?? null;
      },
    } as unknown as SessionRegistryStore,
    recordedSignals,
    deps: {
      existsSync: () => true,
      launchTerminal: fakeLaunchTerminal,
      ...overrides,
    },
  };
}

describe("validateSessionForRelaunch", () => {
  it("returns null for a valid active session", () => {
    const session = buildRecord();
    expect(validateSessionForRelaunch(session, () => true)).toBeNull();
  });

  it("rejects archived sessions", () => {
    const session = buildRecord({ lifecycleStatus: "archived" });
    const error = validateSessionForRelaunch(session, () => true);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("session_archived");
  });

  it("rejects trusted-active sessions (all three signals present)", () => {
    const session = buildRecord({
      copilotProcessState: "live",
      trustedSignalSource: "copilot-cli-hook",
      trustedEndedAt: null,
    });
    const error = validateSessionForRelaunch(session, () => true);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("session_live");
  });

  it("allows relaunch when copilotProcessState is live but no trusted signal source", () => {
    const session = buildRecord({ copilotProcessState: "live" });
    expect(validateSessionForRelaunch(session, () => true)).toBeNull();
  });

  it("rejects sessions with empty cwd and no worktree path", () => {
    const session = buildRecord({ cwd: "", derivedWorktreePath: null });
    const error = validateSessionForRelaunch(session, () => true);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("no_cwd");
  });

  it("rejects sessions when cwd directory does not exist", () => {
    const session = buildRecord();
    const error = validateSessionForRelaunch(session, () => false);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("cwd_not_found");
  });

  it("allows ended sessions with valid cwd", () => {
    const session = buildRecord({ lifecycleStatus: "ended" });
    expect(validateSessionForRelaunch(session, () => true)).toBeNull();
  });

  it("allows paused sessions with valid cwd", () => {
    const session = buildRecord({ lifecycleStatus: "paused" });
    expect(validateSessionForRelaunch(session, () => true)).toBeNull();
  });

  it("prefers derivedWorktreePath for existence check", () => {
    const session = buildRecord({
      cwd: "C:\\repo",
      derivedWorktreePath: "C:\\worktree",
    });
    const checked: string[] = [];
    validateSessionForRelaunch(session, (path) => {
      checked.push(path);
      return true;
    });
    expect(checked).toEqual(["C:\\worktree"]);
  });
});

describe("buildRelaunchParams", () => {
  it("builds cwd-only params for session without copilotSessionId", () => {
    const session = buildRecord();
    const params = buildRelaunchParams(session);
    expect(params.cwd).toBe("C:\\repo");
    expect(params.command).toBeUndefined();
    expect(params.title).toBe("Test Session");
    expect(params.tabColor).toBeUndefined();
  });

  it("includes resume command when copilotSessionId is present", () => {
    const session = buildRecord({ copilotSessionId: "abc-123" });
    const params = buildRelaunchParams(session);
    expect(params.command).toBe("copilot '--resume=abc-123'");
  });

  it("includes tabColor when session has color", () => {
    const session = buildRecord({ color: "#FF0000" });
    const params = buildRelaunchParams(session);
    expect(params.tabColor).toBe("#FF0000");
  });

  it("prefers derivedWorktreePath over cwd", () => {
    const session = buildRecord({
      cwd: "C:\\repo",
      derivedWorktreePath: "C:\\worktree",
    });
    const params = buildRelaunchParams(session);
    expect(params.cwd).toBe("C:\\worktree");
  });

  it("escapes single quotes in copilotSessionId", () => {
    const session = buildRecord({ copilotSessionId: "it's-a-session" });
    const params = buildRelaunchParams(session);
    expect(params.command).toBe("copilot '--resume=it''s-a-session'");
  });
});

describe("relaunchSession", () => {
  it("returns session_not_found for missing session", () => {
    const { store, deps } = fakeDeps({});
    const result = relaunchSession(store, "nonexistent", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("session_not_found");
    }
  });

  it("returns validation error for archived session", () => {
    const session = buildRecord({ lifecycleStatus: "archived" });
    const { store, deps } = fakeDeps({ [session.id]: session });
    const result = relaunchSession(store, session.id, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("session_archived");
    }
  });

  it("returns success with launch details for valid session", () => {
    const session = buildRecord({ copilotSessionId: "sess-42", color: "#00FF00" });
    const { store, deps } = fakeDeps({ [session.id]: session });
    const result = relaunchSession(store, session.id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.sessionId).toBe(session.id);
      expect(result.result.cwd).toBe("C:\\repo");
      expect(result.result.method).toBe("windows-terminal");
      expect(result.result.copilotResumed).toBe(true);
      expect(result.result.colorApplied).toBe(true);
      expect(result.result.pid).toBe(12345);
    }
  });

  it("synthesizes a session.started signal on success when copilotSessionId exists", () => {
    const session = buildRecord({
      copilotSessionId: "sess-42",
      repo: "lossyrob/streamliner",
      branch: "main",
      trustedExecutionKind: "copilot_cli",
    });
    const { store, recordedSignals, deps } = fakeDeps({ [session.id]: session });
    relaunchSession(store, session.id, deps);
    expect(recordedSignals).toHaveLength(1);
    expect(recordedSignals[0]).toEqual(
      expect.objectContaining({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "sess-42",
        cwd: "C:\\repo",
        repo: "lossyrob/streamliner",
        branch: "main",
        hookSource: "resume",
        executionKind: "copilot_cli",
      }),
    );
  });

  it("does not synthesize a signal when no copilotSessionId", () => {
    const session = buildRecord();
    const { store, recordedSignals, deps } = fakeDeps({ [session.id]: session });
    relaunchSession(store, session.id, deps);
    expect(recordedSignals).toHaveLength(0);
  });

  it("still returns success when synthesized-signal recording throws", () => {
    const session = buildRecord({ copilotSessionId: "sess-42" });
    const store = {
      getSession: (id: string) => (id === session.id ? session : null),
      recordTrustedSessionSignal: () => {
        throw new Error("registry locked");
      },
    } as unknown as SessionRegistryStore;
    const result = relaunchSession(store, session.id, {
      existsSync: () => true,
      launchTerminal: fakeLaunchTerminal,
    });
    expect(result.ok).toBe(true);
  });

  it("reports copilotResumed as false when no copilotSessionId", () => {
    const session = buildRecord();
    const { store, deps } = fakeDeps({ [session.id]: session });
    const result = relaunchSession(store, session.id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.copilotResumed).toBe(false);
    }
  });

  it("reports colorApplied as false for powershell method", () => {
    const session = buildRecord({ color: "#FF0000" });
    const { store, deps } = fakeDeps({ [session.id]: session }, {
      launchTerminal: () => ({ method: "powershell", pid: 999 }),
    });
    const result = relaunchSession(store, session.id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.colorApplied).toBe(false);
      expect(result.result.method).toBe("powershell");
    }
  });

  it("returns spawn_failed when launchTerminal throws", () => {
    const session = buildRecord();
    const { store, deps } = fakeDeps({ [session.id]: session }, {
      launchTerminal: () => { throw new Error("wt.exe not found"); },
    });
    const result = relaunchSession(store, session.id, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("spawn_failed");
      expect(result.error.message).toContain("wt.exe not found");
    }
  });

  it("returns cwd_not_found when directory does not exist", () => {
    const session = buildRecord();
    const { store, deps } = fakeDeps({ [session.id]: session }, {
      existsSync: () => false,
    });
    const result = relaunchSession(store, session.id, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("cwd_not_found");
    }
  });
});
