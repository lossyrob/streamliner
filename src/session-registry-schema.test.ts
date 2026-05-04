import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  SESSION_REGISTRY_ACTIVITY_CONFIDENCES,
  SESSION_REGISTRY_ACTIVITY_DIAGNOSTIC_CODES,
  SESSION_REGISTRY_ACTIVITY_STATUS_REASONS,
  SESSION_REGISTRY_AI_SUMMARY_STATUSES,
  SESSION_REGISTRY_ACTIVITY_STATUSES,
  SESSION_REGISTRY_COPILOT_PROCESS_STATES,
  SESSION_REGISTRY_GITHUB_REF_TYPES,
  SESSION_REGISTRY_LIFECYCLE_STATUSES,
  SESSION_REGISTRY_OBSERVED_SESSION_KINDS,
  SESSION_REGISTRY_ORIGIN_KINDS,
  SESSION_REGISTRY_SCHEMA_VERSION,
  SESSION_REGISTRY_TITLE_SOURCES,
  SESSION_REGISTRY_TRUSTED_END_REASONS,
  SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS,
  SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES,
  SESSION_REGISTRY_TRUSTED_START_SOURCES,
  type SessionRegistryRecord,
} from "./session-registry-schema";
import {
  SESSION_REGISTRY_CHANGE_EVENT_KINDS,
  SESSION_REGISTRY_TRUSTED_SIGNAL_EVENTS,
  type SessionRegistryChangeEvent,
  type SessionRegistryListItem,
  type SessionRegistryObservedLinkInput,
  type SessionRegistryPatch,
  type SessionRegistryStore,
  type SessionRegistryUpsertInput,
} from "./session-registry-contract";

function buildRecord(): SessionRegistryRecord {
  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    id: "session-registry-model",
    version: 0,
    title: "Session registry model",
    titleSource: "user",
    description: "Design the session registry contract.",
    color: "#5b7fff",
    cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\streamliner-session-registry-model",
    repo: "lossyrob/streamliner",
    branch: "feature/session-registry-model",
    copilotSessionId: "copilot-session-123",
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-21T20:30:00.000Z",
    createdAt: "2026-04-21T20:00:00.000Z",
    updatedAt: "2026-04-21T20:30:00.000Z",
    tags: ["wave-2", "registry"],
    origin: {
      kind: "manual",
    },
    graphBinding: {
      workstreamId: "wave-2",
      nodeId: "session-registry-model",
      launchClaimId: "launch-claim-123",
    },
    aiSummary: "Designing the session registry contract surface",
    aiSummaryModel: "gpt-5.4-mini",
    aiSummaryUpdatedAt: "2026-04-21T20:31:00.000Z",
    aiSummaryEventsFingerprint: "1:100",
    aiSummaryStatus: "ready",
    aiSummaryError: null,
    observedSessionKind: null,
    copilotProcessState: null,
    copilotProcessId: null,
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
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
  };
}

describe("session registry schema", () => {
  it("exports the expected literal runtime constants", () => {
    expect(SESSION_REGISTRY_SCHEMA_VERSION).toBe(1);
    expect(SESSION_REGISTRY_LIFECYCLE_STATUSES).toEqual([
      "active",
      "paused",
      "ended",
      "archived",
    ]);
    expect(SESSION_REGISTRY_ORIGIN_KINDS).toEqual([
      "manual",
      "observed",
      "launched",
    ]);
    expect(SESSION_REGISTRY_TITLE_SOURCES).toEqual(["auto", "user"]);
    expect(SESSION_REGISTRY_AI_SUMMARY_STATUSES).toEqual([
      "missing",
      "pending",
      "ready",
      "error",
    ]);
    expect(SESSION_REGISTRY_OBSERVED_SESSION_KINDS).toEqual([
      "interactive",
      "helper",
    ]);
    expect(SESSION_REGISTRY_COPILOT_PROCESS_STATES).toEqual([
      "live",
      "stale_lock",
      "none",
    ]);
    expect(SESSION_REGISTRY_ACTIVITY_STATUSES).toEqual([
      "unknown",
      "working",
      "waiting_for_input",
      "interrupted",
      "exited",
    ]);
    expect(SESSION_REGISTRY_ACTIVITY_CONFIDENCES).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
    expect(SESSION_REGISTRY_ACTIVITY_STATUS_REASONS).toEqual([
      "neutral_default",
      "trusted_start",
      "trusted_prompt",
      "trusted_end",
      "user_message",
      "assistant_message",
      "assistant_turn_start",
      "assistant_turn_end",
      "tool_user_requested",
      "tool_execution_start",
      "tool_execution_complete",
      "user_requested_tool_complete",
      "pending_input",
      "session_ended",
      "process_interrupted",
      "events_missing",
      "events_empty",
      "events_unrecognized",
    ]);
    expect(SESSION_REGISTRY_ACTIVITY_DIAGNOSTIC_CODES).toEqual([
      "events_missing",
      "events_empty",
      "events_tail_truncated",
      "events_parse_error",
      "events_unrecognized",
    ]);
    expect(SESSION_REGISTRY_GITHUB_REF_TYPES).toEqual(["issue", "pr", "unknown"]);
    expect(SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES).toEqual([
      "copilot-cli-hook",
    ]);
    expect(SESSION_REGISTRY_TRUSTED_START_SOURCES).toEqual([
      "new",
      "resume",
      "startup",
    ]);
    expect(SESSION_REGISTRY_TRUSTED_END_REASONS).toEqual([
      "complete",
      "error",
      "abort",
      "timeout",
      "user_exit",
    ]);
    expect(SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS).toEqual([
      "copilot_cli",
      "agency",
    ]);
    expect(SESSION_REGISTRY_TRUSTED_SIGNAL_EVENTS).toEqual([
      "session.started",
      "session.ended",
      "prompt.submitted",
    ]);
    expect(SESSION_REGISTRY_CHANGE_EVENT_KINDS).toEqual([
      "upsert",
      "delete",
      "rebuild",
    ]);

    const observedUpsertInput: SessionRegistryUpsertInput = {
      title: "Observed registry row",
      cwd: "C:\\repo",
      copilotSessionId: "copilot-session-999",
      lifecycleStatus: "active",
      origin: {
        kind: "observed",
        importedFromCopilotSessionId: "copilot-session-999",
      },
    };
    const observedLinkInput: SessionRegistryObservedLinkInput = {
      copilotSessionId: "copilot-session-999",
      cwd: "C:\\repo",
      lifecycleStatus: "ended",
    };
    expect(observedUpsertInput.origin.kind).toBe("observed");
    expect(observedLinkInput.lifecycleStatus).toBe("ended");
  });

  it("provides stable record and contract shapes for downstream modules", () => {
    const record = buildRecord();
    const listItem: SessionRegistryListItem = {
      id: record.id,
      version: record.version,
      title: record.title,
      titleSource: record.titleSource,
      description: record.description,
      lifecycleStatus: record.lifecycleStatus,
      lastSeenAt: record.lastSeenAt,
      updatedAt: record.updatedAt,
      color: record.color,
      cwd: record.cwd,
      repo: record.repo,
      branch: record.branch,
      tags: record.tags,
      originKind: record.origin.kind,
      graphBinding: record.graphBinding,
      copilotSessionId: record.copilotSessionId,
      aiSummary: record.aiSummary,
      aiSummaryModel: record.aiSummaryModel,
      aiSummaryUpdatedAt: record.aiSummaryUpdatedAt,
      aiSummaryEventsFingerprint: record.aiSummaryEventsFingerprint,
      aiSummaryStatus: record.aiSummaryStatus,
      aiSummaryError: record.aiSummaryError,
      observedSessionKind: record.observedSessionKind,
      copilotProcessState: record.copilotProcessState,
      copilotProcessId: record.copilotProcessId,
      activityStatus: record.activityStatus,
      activityStatusUpdatedAt: record.activityStatusUpdatedAt,
      activityEvidence: record.activityEvidence,
      trustedSignalSource: record.trustedSignalSource,
      trustedStartedAt: record.trustedStartedAt,
      trustedEndedAt: record.trustedEndedAt,
      trustedLastSignalAt: record.trustedLastSignalAt,
      trustedStartSource: record.trustedStartSource,
      trustedEndReason: record.trustedEndReason,
      trustedExecutionKind: record.trustedExecutionKind,
      trustedInitialPromptLength: record.trustedInitialPromptLength,
      trustedLastPromptLength: record.trustedLastPromptLength,
      derivedWorktreePath: record.derivedWorktreePath,
      derivedBranch: record.derivedBranch,
      derivedGithubRefs: record.derivedGithubRefs,
      derivedContextUpdatedAt: record.derivedContextUpdatedAt,
      derivedContextEventsOffset: record.derivedContextEventsOffset,
      derivedContextEventsSize: record.derivedContextEventsSize,
      derivedContextEventsMtimeMs: record.derivedContextEventsMtimeMs,
    };
    const upsertInput: SessionRegistryUpsertInput = {
      title: record.title,
      description: record.description,
      color: record.color,
      cwd: record.cwd,
      repo: record.repo,
      branch: record.branch,
      lifecycleStatus: "active",
      tags: record.tags,
      origin: {
        kind: "manual",
      },
      graphBinding: record.graphBinding,
    };
    const patch: SessionRegistryPatch = {
      title: "Renamed session",
      lifecycleStatus: "paused",
      tags: ["wave-2", "reviewed"],
    };
    const events: SessionRegistryChangeEvent[] = [];
    const store: SessionRegistryStore = {
      listSessions: () => [listItem],
      getSession: () => record,
      upsertSession: (input) => ({
        ...record,
        title: input.title,
      }),
      attachObservedSession: (id, observation) => ({
        ...record,
        id,
        title:
          observation.title && record.titleSource === "auto"
            ? observation.title
            : record.title,
        titleSource: record.titleSource,
        copilotSessionId: observation.copilotSessionId,
        cwd: observation.cwd,
        repo: observation.repo ?? record.repo,
        branch: observation.branch ?? record.branch,
        lastSeenAt: observation.lastSeenAt ?? record.lastSeenAt,
        lifecycleStatus:
          observation.lifecycleStatus ?? record.lifecycleStatus,
        observedSessionKind:
          observation.observedSessionKind ?? record.observedSessionKind,
        copilotProcessState:
          observation.copilotProcessState ?? record.copilotProcessState,
        copilotProcessId:
          observation.copilotProcessId ?? record.copilotProcessId,
        trustedSignalSource:
          observation.trustedSignalSource ?? record.trustedSignalSource,
        trustedStartedAt:
          observation.trustedStartedAt ?? record.trustedStartedAt,
        trustedEndedAt: observation.trustedEndedAt ?? record.trustedEndedAt,
        trustedLastSignalAt:
          observation.trustedLastSignalAt ?? record.trustedLastSignalAt,
        trustedStartSource:
          observation.trustedStartSource ?? record.trustedStartSource,
        trustedEndReason:
          observation.trustedEndReason ?? record.trustedEndReason,
        trustedExecutionKind:
          observation.trustedExecutionKind ?? record.trustedExecutionKind,
        trustedInitialPromptLength:
          observation.trustedInitialPromptLength ?? record.trustedInitialPromptLength,
        trustedLastPromptLength:
          observation.trustedLastPromptLength ?? record.trustedLastPromptLength,
      }),
      recordTrustedSessionSignal: (signal) => ({
        ...record,
        copilotSessionId: signal.sessionId,
        cwd: signal.cwd,
        lastSeenAt: signal.timestamp,
        lifecycleStatus:
          signal.event === "session.ended" ? "ended" : record.lifecycleStatus,
        activityStatus:
          signal.event === "session.ended"
            ? "exited"
            : signal.event === "prompt.submitted"
              ? "working"
              : record.activityStatus,
        activityStatusUpdatedAt: signal.timestamp,
        trustedSignalSource: signal.source,
        trustedLastSignalAt: signal.timestamp,
        trustedStartedAt:
          signal.event === "session.started"
            ? signal.timestamp
            : record.trustedStartedAt,
        trustedEndedAt:
          signal.event === "session.ended"
            ? signal.timestamp
            : record.trustedEndedAt,
        trustedStartSource: signal.hookSource ?? record.trustedStartSource,
        trustedEndReason: signal.endReason ?? record.trustedEndReason,
        trustedExecutionKind:
          signal.executionKind ?? record.trustedExecutionKind,
        trustedInitialPromptLength:
          signal.initialPromptLength ?? record.trustedInitialPromptLength,
        trustedLastPromptLength:
          signal.promptLength ?? record.trustedLastPromptLength,
      }),
      patchSession: (id, nextPatch) => ({
        ...record,
        id,
        title: nextPatch.title ?? record.title,
        titleSource: nextPatch.title ? "user" : record.titleSource,
        lifecycleStatus:
          nextPatch.lifecycleStatus ?? record.lifecycleStatus,
        tags: nextPatch.tags ?? record.tags,
      }),
      archiveSession: (id) => ({
        ...record,
        id,
        lifecycleStatus: "archived",
      }),
      deleteSession: () => undefined,
      subscribe: (listener) => {
        const event: SessionRegistryChangeEvent = {
          kind: "upsert",
          registryId: record.id,
          snapshot: record,
        };
        events.push(event);
        listener(event);
        return () => undefined;
      },
    };

    expect(upsertInput.origin.kind).toBe("manual");
    expect(store.listSessions({ includeArchived: true })[0].originKind).toBe(
      "manual",
    );
    expect(
      store.attachObservedSession(record.id, {
        copilotSessionId: "copilot-session-456",
        cwd: record.cwd,
        lifecycleStatus: "ended",
      }).copilotSessionId,
    ).toBe("copilot-session-456");
    expect(store.patchSession(record.id, patch).lifecycleStatus).toBe("paused");
    expect(store.archiveSession(record.id).lifecycleStatus).toBe("archived");

    const unsubscribe = store.subscribe((event) => events.push(event));
    unsubscribe();
    expect(events.map((event) => event.kind)).toEqual(["upsert", "upsert"]);
  });

  it("rejects observation-owned values that violate the design contract", () => {
    const invalidObservedLink: SessionRegistryObservedLinkInput = {
      copilotSessionId: "copilot-session-123",
      cwd: "C:\\repo",
      // @ts-expect-error observation attach may only use observed lifecycle states.
      lifecycleStatus: "paused",
    };

    void invalidObservedLink;
    expect(true).toBe(true);
  });
});
