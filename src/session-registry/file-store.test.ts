import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionRegistryPatch, SessionRegistryUpsertInput } from "../session-registry-contract";
import { SESSION_REGISTRY_SCHEMA_VERSION } from "../session-registry-schema";
import { SessionRegistryFileStore } from "./file-store";

function createRootDir(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-session-registry-"));
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const createdRoots: string[] = [];

afterEach(() => {
  for (const rootDir of createdRoots.splice(0)) {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("SessionRegistryFileStore", () => {
  it("creates a manual session and persists entry and index files", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const events: string[] = [];
    store.subscribe((event) => events.push(event.kind));

    const record = store.upsertSession({
      title: "Manual session",
      description: "Track this work",
      color: "#5b7fff",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/manual-session-registry",
      tags: ["wave-2", "registry"],
      origin: { kind: "manual" },
    });

    expect(record.schemaVersion).toBe(SESSION_REGISTRY_SCHEMA_VERSION);
    expect(record.lifecycleStatus).toBe("active");
    expect(record.origin.kind).toBe("manual");
    expect(events).toEqual(["upsert"]);
    expect(store.listSessions()).toHaveLength(1);
    expect(
      existsSync(join(rootDir, "entries", `${record.id}.json`)),
    ).toBe(true);
    expect(existsSync(join(rootDir, "index.json"))).toBe(true);
  });

  it("sorts and filters list results by freshness, text, repo, and graph binding", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const alpha = store.upsertSession({
      title: "Alpha",
      cwd: "C:\\alpha",
      repo: "lossyrob/streamliner",
      branch: "main",
      tags: ["alpha"],
      origin: { kind: "manual" },
    });
    const beta = store.upsertSession({
      title: "Beta",
      cwd: "C:\\beta",
      copilotSessionId: "copilot-beta",
      lifecycleStatus: "ended",
      lastSeenAt: "2026-04-23T12:00:00.000Z",
      repo: "lossyrob/streamliner",
      branch: "feature/beta",
      tags: ["beta"],
      origin: { kind: "observed" },
      graphBinding: { workstreamId: "wave-2", nodeId: "beta-node" },
    });
    const gamma = store.upsertSession({
      title: "Gamma",
      cwd: "C:\\gamma",
      tags: ["gamma"],
      origin: { kind: "manual" },
    });
    store.archiveSession(gamma.id);

    const listed = store.listSessions();
    expect(listed.map((item) => item.id)).toEqual([beta.id, alpha.id]);
    expect(store.listSessions({ includeArchived: true })).toHaveLength(3);
    expect(store.listSessions({ text: "beta" }).map((item) => item.id)).toEqual([
      beta.id,
    ]);
    expect(
      store.listSessions({
        repo: "lossyrob/streamliner",
        workstreamId: "wave-2",
        nodeId: "beta-node",
      }),
    ).toHaveLength(1);
  });

  it("preserves unknown fields across rewrites", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const entriesDir = join(rootDir, "entries");
    const entryPath = join(entriesDir, "manual-entry.json");
    mkdirSync(entriesDir, { recursive: true });
    writeFileSync(
      entryPath,
      JSON.stringify(
        {
          schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
          id: "manual-entry",
          title: "Manual entry",
          description: "",
          color: null,
          cwd: "C:\\repo",
          repo: null,
          branch: null,
          copilotSessionId: null,
          lifecycleStatus: "active",
          lastSeenAt: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z",
          tags: [],
          origin: {
            kind: "manual",
            extraOriginField: "keep-me",
          },
          graphBinding: null,
          extraTopLevelField: "persist-me",
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new SessionRegistryFileStore({ rootDir });
    const updated = store.patchSession("manual-entry", {
      description: "Updated description",
    });
    expect(updated.description).toBe("Updated description");

    const persisted = readJsonFile<Record<string, unknown>>(entryPath);
    expect(persisted.extraTopLevelField).toBe("persist-me");
    expect((persisted.origin as Record<string, unknown>).extraOriginField).toBe(
      "keep-me",
    );
  });

  it("attachs observed sessions without rewriting manual origin or builder fields", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const manual = store.upsertSession({
      title: "Manual row",
      description: "Builder-owned description",
      color: "#123456",
      cwd: "C:\\repo",
      tags: ["builder"],
      origin: { kind: "manual" },
      lifecycleStatus: "paused",
    });

    const attached = store.attachObservedSession(manual.id, {
      copilotSessionId: "copilot-123",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/attach",
      lastSeenAt: "2026-04-23T12:30:00.000Z",
      lifecycleStatus: "ended",
    });

    expect(attached.origin.kind).toBe("manual");
    expect(attached.description).toBe("Builder-owned description");
    expect(attached.color).toBe("#123456");
    expect(attached.lifecycleStatus).toBe("ended");
    expect(attached.copilotSessionId).toBe("copilot-123");
  });

  it("quarantines malformed entries and emits rebuild on external changes", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const entriesDir = join(rootDir, "entries");
    const indexPath = join(rootDir, "index.json");
    const quarantineDir = join(rootDir, "quarantine");
    mkdirSync(entriesDir, { recursive: true });
    writeFileSync(join(entriesDir, "broken.json"), "{not json", "utf8");

    const store = new SessionRegistryFileStore({ rootDir });
    expect(store.listSessions()).toEqual([]);
    expect(existsSync(quarantineDir)).toBe(true);
    expect(readdirSync(quarantineDir)).toHaveLength(1);

    const rebuilds: string[][] = [];
    store.subscribe((event) => {
      if (event.kind === "rebuild") {
        rebuilds.push(event.registryIds);
      }
    });

    writeFileSync(
      join(entriesDir, "external-entry.json"),
      JSON.stringify(
        {
          schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
          id: "external-entry",
          title: "External entry",
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
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(store.listSessions().map((item) => item.id)).toEqual(["external-entry"]);
    expect(rebuilds).toEqual([["external-entry"]]);
    expect(readJsonFile<{ entries: Array<{ id: string }> }>(indexPath).entries).toEqual([
      expect.objectContaining({ id: "external-entry" }),
    ]);
  });

  it("blocks writes when an advisory lock already exists", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    writeFileSync(join(rootDir, "registry.lock"), "locked", "utf8");

    expect(() =>
      store.upsertSession({
        title: "Blocked",
        cwd: "C:\\repo",
        origin: { kind: "manual" },
      }),
    ).toThrow();
  });

  it("enforces lifecycle restrictions by source", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const invalidManualInput = {
      title: "Bad manual",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
      lifecycleStatus: "ended",
    } as unknown as SessionRegistryUpsertInput;

    expect(() =>
      store.upsertSession(invalidManualInput),
    ).toThrow(/active or paused/);

    expect(() =>
      store.upsertSession({
        title: "Observed ended",
        cwd: "C:\\repo",
        origin: { kind: "observed" },
        copilotSessionId: "copilot-456",
        lifecycleStatus: "ended",
      }),
    ).not.toThrow();

    const missingObservedCopilotSessionId = {
      title: "Observed missing id",
      cwd: "C:\\repo",
      origin: { kind: "observed" },
    } as unknown as SessionRegistryUpsertInput;
    expect(() =>
      store.upsertSession(missingObservedCopilotSessionId),
    ).toThrow(/copilotSessionId/);

    const manual = store.upsertSession({
      title: "Manual row",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });
    const invalidPatch = { title: "" } as unknown as SessionRegistryPatch;
    expect(() => store.patchSession(manual.id, invalidPatch)).toThrow(/patch\.title/);
  });
});
