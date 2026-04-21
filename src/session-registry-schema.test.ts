import { describe, expect, it } from "vitest";

import {
  SESSION_REGISTRY_LIFECYCLE_STATUSES,
  SESSION_REGISTRY_ORIGIN_KINDS,
  SESSION_REGISTRY_SCHEMA_VERSION,
  type SessionRegistryRecord,
} from "./session-registry-schema";
import {
  SESSION_REGISTRY_CHANGE_EVENT_KINDS,
  type SessionRegistryChangeEvent,
  type SessionRegistryListItem,
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
    expect(SESSION_REGISTRY_CHANGE_EVENT_KINDS).toEqual([
      "upsert",
      "delete",
      "rebuild",
    ]);
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
    expect(store.patchSession(record.id, patch).lifecycleStatus).toBe("paused");
    expect(store.archiveSession(record.id).lifecycleStatus).toBe("archived");

    const unsubscribe = store.subscribe((event) => events.push(event));
    unsubscribe();
    expect(events.map((event) => event.kind)).toEqual(["upsert", "upsert"]);
  });
});
