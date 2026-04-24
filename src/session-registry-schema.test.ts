import { describe, expect, it } from "vitest";

import {
  SESSION_REGISTRY_AI_SUMMARY_STATUSES,
  SESSION_REGISTRY_LIFECYCLE_STATUSES,
  SESSION_REGISTRY_ORIGIN_KINDS,
  SESSION_REGISTRY_SCHEMA_VERSION,
  type SessionRegistryRecord,
} from "./session-registry-schema";
import {
  SESSION_REGISTRY_CHANGE_EVENT_KINDS,
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
    title: "Session registry model",
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
    expect(SESSION_REGISTRY_AI_SUMMARY_STATUSES).toEqual([
      "missing",
      "pending",
      "ready",
      "error",
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
      title: record.title,
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
        copilotSessionId: observation.copilotSessionId,
        cwd: observation.cwd,
        repo: observation.repo ?? record.repo,
        branch: observation.branch ?? record.branch,
        lastSeenAt: observation.lastSeenAt ?? record.lastSeenAt,
        lifecycleStatus:
          observation.lifecycleStatus ?? record.lifecycleStatus,
      }),
      patchSession: (id, nextPatch) => ({
        ...record,
        id,
        title: nextPatch.title ?? record.title,
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
      // @ts-expect-error observation attach may only promote a row into ended.
      lifecycleStatus: "paused",
    };

    void invalidObservedLink;
    expect(true).toBe(true);
  });
});
