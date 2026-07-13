import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SESSION_REGISTRY_SCHEMA_VERSION } from "../session-registry-schema";
import { SessionRegistryFileStore } from "./file-store";
import {
  SESSION_REGISTRY_API_BASE_PATH,
  handleSessionRegistryApiRequest,
} from "./http-api";

const createdRoots: string[] = [];

function createRootDir(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-session-registry-api-"));
}

afterEach(() => {
  for (const rootDir of createdRoots.splice(0)) {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("handleSessionRegistryApiRequest", () => {
  it("lists sessions and supports includeArchived", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const active = store.upsertSession({
      title: "Active row",
      cwd: "C:\\active",
      origin: { kind: "manual" },
    });
    const archived = store.upsertSession({
      title: "Archived row",
      cwd: "C:\\archived",
      origin: { kind: "manual" },
    });
    store.archiveSession(archived.id);

    const defaultResponse = handleSessionRegistryApiRequest(store, {
      method: "GET",
      url: SESSION_REGISTRY_API_BASE_PATH,
    });
    const archivedResponse = handleSessionRegistryApiRequest(store, {
      method: "GET",
      url: `${SESSION_REGISTRY_API_BASE_PATH}?includeArchived=true`,
    });

    expect(defaultResponse?.statusCode).toBe(200);
    expect(defaultResponse?.body).toEqual([
      expect.objectContaining({ id: active.id }),
    ]);
    expect(archivedResponse?.statusCode).toBe(200);
    expect(archivedResponse?.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active.id }),
        expect.objectContaining({ id: archived.id }),
      ]),
    );
  });

  it("creates, reads, patches, archives, and deletes sessions", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const createResponse = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: SESSION_REGISTRY_API_BASE_PATH,
      body: {
        title: "Created row",
        cwd: "C:\\created",
        origin: { kind: "manual" },
      },
    });
    expect(createResponse?.statusCode).toBe(200);
    const createdId = (createResponse?.body as { id: string }).id;

    const getResponse = handleSessionRegistryApiRequest(store, {
      method: "GET",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${createdId}`,
    });
    expect(getResponse?.statusCode).toBe(200);

    const patchResponse = handleSessionRegistryApiRequest(store, {
      method: "PATCH",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${createdId}`,
      body: { description: "Updated" },
    });
    expect(patchResponse?.statusCode).toBe(200);
    expect((patchResponse?.body as { description: string }).description).toBe(
      "Updated",
    );

    const archiveResponse = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${createdId}/archive`,
    });
    expect(archiveResponse?.statusCode).toBe(200);
    expect(
      (archiveResponse?.body as { lifecycleStatus: string }).lifecycleStatus,
    ).toBe("archived");

    const deleteResponse = handleSessionRegistryApiRequest(store, {
      method: "DELETE",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${createdId}`,
    });
    expect(deleteResponse?.statusCode).toBe(204);

    const missingResponse = handleSessionRegistryApiRequest(store, {
      method: "GET",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${createdId}`,
    });
    expect(missingResponse?.statusCode).toBe(404);
  });

  it("ingests trusted session signals", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const response = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/signals`,
      body: {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "trusted-api-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
        hookSource: "resume",
        executionKind: "agency",
      },
    });

    expect(response?.statusCode).toBe(200);
    expect(response?.body).toEqual(
      expect.objectContaining({
        id: "trusted-api-session",
        copilotSessionId: "trusted-api-session",
        lifecycleStatus: "active",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartSource: "resume",
        trustedExecutionKind: "agency",
      }),
    );
  });

  it("ignores Streamliner SDK helper hook signals", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const response = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/signals`,
      body: {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "sdk-helper-api-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\Users\\robemanuele\\.streamliner\\state\\copilot-sdk-session-fs",
        hookSource: "new",
        executionKind: "copilot_cli",
      },
    });

    expect(response?.statusCode).toBe(202);
    expect(response?.body).toEqual({
      ignored: true,
      reason: "copilot-sdk-session-fs",
    });
    expect(store.listSessions({ includeArchived: true })).toEqual([]);
  });

  it("ignores Copilot CLI subagent hook signals", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const response = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/signals`,
      body: {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "call_I4jAXfET9zZZNc23C2qdmG4s",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
        hookSource: "new",
        executionKind: "copilot_cli",
      },
    });

    expect(response?.statusCode).toBe(202);
    expect(response?.body).toEqual({
      ignored: true,
      reason: "copilot-cli-subagent",
    });
    expect(store.listSessions({ includeArchived: true })).toEqual([]);
  });

  it("maps lock errors and bad request bodies", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir, writeLockWaitTimeoutMs: 0 });
    writeFileSync(join(rootDir, "registry.lock"), "locked", "utf8");

    const lockResponse = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: SESSION_REGISTRY_API_BASE_PATH,
      body: {
        title: "Blocked",
        cwd: "C:\\blocked",
        origin: { kind: "manual" },
      },
    });
    const badBodyResponse = handleSessionRegistryApiRequest(store, {
      method: "PATCH",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/missing`,
      body: "not-an-object",
    });

    expect(lockResponse?.statusCode).toBe(423);
    expect(badBodyResponse?.statusCode).toBe(400);
  });

  it("rejects invalid mutation bodies before they can corrupt stored rows", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const created = store.upsertSession({
      title: "Created row",
      cwd: "C:\\created",
      origin: { kind: "manual" },
    });

    const invalidPatchResponse = handleSessionRegistryApiRequest(store, {
      method: "PATCH",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${created.id}`,
      body: {
        title: "",
        lifecycleStatus: "ended",
      },
    });
    const invalidObservedCreateResponse = handleSessionRegistryApiRequest(store, {
      method: "POST",
      url: SESSION_REGISTRY_API_BASE_PATH,
      body: {
        title: "Observed row",
        cwd: "C:\\observed",
        origin: { kind: "observed" },
      },
    });

    expect(invalidPatchResponse?.statusCode).toBe(400);
    expect(invalidObservedCreateResponse?.statusCode).toBe(400);
    expect(store.getSession(created.id)).toEqual(
      expect.objectContaining({ title: "Created row" }),
    );
  });

  it("returns conflict details for stale builder patches", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const created = store.upsertSession({
      title: "Created row",
      cwd: "C:\\created",
      origin: { kind: "manual" },
    });
    store.patchSession(created.id, {
      expectedVersion: created.version,
      title: "Updated elsewhere",
    });

    const stalePatchResponse = handleSessionRegistryApiRequest(store, {
      method: "PATCH",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/${created.id}`,
      body: {
        expectedVersion: created.version,
        description: "Stale description",
      },
    });

    expect(stalePatchResponse?.statusCode).toBe(409);
    expect(stalePatchResponse?.body).toEqual(
      expect.objectContaining({
        conflictingFields: ["description"],
        latest: expect.objectContaining({
          title: "Updated elsewhere",
          version: created.version + 1,
        }),
      }),
    );
  });

  it("passes through unknown-field preservation for externally written rows", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const entriesDir = join(rootDir, "entries");
    const entryPath = join(entriesDir, "external.json");
    mkdirSync(entriesDir, { recursive: true });
    writeFileSync(
      entryPath,
      JSON.stringify(
        {
          schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
          id: "external",
          title: "External row",
          description: "",
          color: null,
          cwd: "C:\\external",
          repo: null,
          branch: null,
          copilotSessionId: null,
          lifecycleStatus: "active",
          lastSeenAt: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z",
          tags: [],
          origin: { kind: "manual" },
          graphBinding: null,
          extraField: "keep-me",
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new SessionRegistryFileStore({ rootDir });
    const patchResponse = handleSessionRegistryApiRequest(store, {
      method: "PATCH",
      url: `${SESSION_REGISTRY_API_BASE_PATH}/external`,
      body: { description: "Updated externally backed row" },
    });

    expect(patchResponse?.statusCode).toBe(200);
    expect(
      JSON.parse(readFileSync(entryPath, "utf8")) as { extraField?: string },
    ).toEqual(expect.objectContaining({ extraField: "keep-me" }));
  });
});
