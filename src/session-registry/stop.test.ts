import { describe, expect, it } from "vitest";

import type {
  SessionRegistryStore,
  SessionRegistryTrustedSignalInput,
} from "../session-registry-contract";
import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  type SessionRegistryRecord,
} from "../session-registry-schema";
import { stopSession } from "./stop";

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
    copilotSessionId: "copilot-test",
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-29T20:02:00.000Z",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-29T20:04:49.000Z",
    tags: [],
    origin: { kind: "manual" },
    graphBinding: null,
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: "none",
    copilotProcessId: null,
    activityStatus: "interrupted",
    activityStatusUpdatedAt: "2026-04-29T20:07:16.000Z",
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: "2026-04-29T20:02:39.000Z",
    trustedEndedAt: null,
    trustedLastSignalAt: "2026-04-29T20:02:39.000Z",
    trustedStartSource: "resume",
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

function fakeStore(
  initial: SessionRegistryRecord | null,
): { store: SessionRegistryStore; signals: SessionRegistryTrustedSignalInput[]; current: () => SessionRegistryRecord | null } {
  let record = initial ? { ...initial } : null;
  const signals: SessionRegistryTrustedSignalInput[] = [];
  const store = {
    getSession: (id: string) => (record && record.id === id ? record : null),
    recordTrustedSessionSignal: (input: SessionRegistryTrustedSignalInput) => {
      signals.push(input);
      if (record && input.event === "session.ended") {
        record = {
          ...record,
          lifecycleStatus: "ended",
          trustedEndedAt: input.timestamp,
          trustedEndReason: input.endReason ?? null,
          trustedLastSignalAt: input.timestamp,
          activityStatus: "exited",
          copilotProcessState: "none",
        };
      }
      return record!;
    },
  } as unknown as SessionRegistryStore;
  return { store, signals, current: () => record };
}

describe("stopSession", () => {
  it("returns session_not_found for missing session", () => {
    const { store } = fakeStore(null);
    const result = stopSession(store, "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("session_not_found");
    }
  });

  it("rejects archived sessions", () => {
    const session = buildRecord({ lifecycleStatus: "archived" });
    const { store } = fakeStore(session);
    const result = stopSession(store, session.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("session_archived");
    }
  });

  it("rejects sessions that are already ended via trusted signal", () => {
    const session = buildRecord({
      lifecycleStatus: "ended",
      trustedEndedAt: "2026-04-29T19:59:14.000Z",
    });
    const { store } = fakeStore(session);
    const result = stopSession(store, session.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("session_already_ended");
    }
  });

  it("rejects sessions without a copilotSessionId", () => {
    const session = buildRecord({ copilotSessionId: null });
    const { store } = fakeStore(session);
    const result = stopSession(store, session.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("no_copilot_session_id");
    }
  });

  it("synthesizes a session.ended signal for an interrupted session", () => {
    const session = buildRecord({
      copilotSessionId: "copilot-abc",
      activityStatus: "interrupted",
      lifecycleStatus: "active",
      repo: "owner/repo",
      branch: "main",
      trustedExecutionKind: "copilot_cli",
    });
    const { store, signals, current } = fakeStore(session);

    const result = stopSession(store, session.id);

    expect(result.ok).toBe(true);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual(
      expect.objectContaining({
        event: "session.ended",
        source: "copilot-cli-hook",
        sessionId: "copilot-abc",
        cwd: "C:\\repo",
        repo: "owner/repo",
        branch: "main",
        endReason: "user_exit",
        executionKind: "copilot_cli",
      }),
    );
    if (result.ok) {
      expect(result.result.lifecycleStatus).toBe("ended");
      expect(result.result.trustedEndedAt).not.toBeNull();
    }
    expect(current()?.lifecycleStatus).toBe("ended");
  });

  it("returns stop_failed when recordTrustedSessionSignal throws", () => {
    const session = buildRecord();
    const store = {
      getSession: (id: string) => (id === session.id ? session : null),
      recordTrustedSessionSignal: () => {
        throw new Error("registry locked");
      },
    } as unknown as SessionRegistryStore;
    const result = stopSession(store, session.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("stop_failed");
      expect(result.error.message).toContain("registry locked");
    }
  });
});
