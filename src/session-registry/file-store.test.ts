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
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import type {
  SessionRegistryChangeEvent,
  SessionRegistryPatch,
  SessionRegistryUpsertInput,
} from "../session-registry-contract";
import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  SESSION_REGISTRY_SCHEMA_VERSION,
  buildSessionRegistryActivityEvidence,
  type SessionRegistryRecord,
} from "../session-registry-schema";
import { SessionRegistryFileStore } from "./file-store";

function createRootDir(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-session-registry-"));
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const createdRoots: string[] = [];

function waitForChildExit(
  child: ReturnType<typeof spawn>,
  stderr: Buffer[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Lock holder exited with ${code ?? signal}: ${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    });
  });
}

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
    expect(record.version).toBe(0);
    expect(record.lifecycleStatus).toBe("active");
    expect(record.origin.kind).toBe("manual");
    expect(record.titleSource).toBe("user");
    expect(events).toEqual(["upsert"]);
    expect(store.listSessions()).toHaveLength(1);
    expect(
      existsSync(join(rootDir, "entries", `${record.id}.json`)),
    ).toBe(true);
    expect(existsSync(join(rootDir, "index.json"))).toBe(true);
  });

  it("persists launched origin cliArgs without normalizing argv order or duplicates", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const record = store.upsertSession({
      title: "Launched session",
      description: "",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/launch",
      tags: [],
      origin: {
        kind: "launched",
        launchClaimId: "claim-cli",
        cliArgs: ["--yolo", "--model=gpt-5.5", "--yolo"],
      },
    });

    expect(record.origin).toEqual({
      kind: "launched",
      launchClaimId: "claim-cli",
      cliArgs: ["--yolo", "--model=gpt-5.5", "--yolo"],
    });
    const reloaded = new SessionRegistryFileStore({ rootDir }).getSession(record.id);
    expect(reloaded?.origin).toEqual(record.origin);
  });

  it("persists managed runtime metadata in entries, index, and list items", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const record = store.upsertSession({
      id: "managed-row",
      title: "Managed row",
      description: "",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/managed",
      tags: [],
      origin: { kind: "launched", launchClaimId: "claim-managed" },
      graphBinding: {
        workstreamId: "sdk-managed-worker-runtime",
        nodeId: "managed-node",
        launchClaimId: "claim-managed",
      },
    });

    const updated = store.patchRuntimeMetadata(
      record.id,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        permissionProfile: "managed-autonomous",
        launchClaimId: "claim-managed",
        launchNonce: "nonce-managed",
        sdkSessionId: "sdk-session-1",
        sdkWorkspacePath: "C:\\Users\\rob\\.copilot\\sessions\\sdk-session-1\\workspace.yaml",
        sdkStateRoot: "C:\\Users\\rob\\.copilot\\sessions\\sdk-session-1",
        startedAt: "2026-05-07T12:00:00.000Z",
        progressEvents: [{
          type: "tool_started",
          message: "Tool started.",
          data: {
            toolName: "powershell",
            args: "raw command must not persist",
          },
        }],
      },
      new Date("2026-05-07T12:00:01.000Z"),
    );

    expect(updated.runtime).toEqual(expect.objectContaining({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-managed",
      launchNonce: "nonce-managed",
      sdkSessionId: "sdk-session-1",
      lastStateChangedAt: "2026-05-07T12:00:01.000Z",
    }));
    expect(updated.runtime?.progressEvents[0].data).toEqual({
      toolName: "powershell",
    });

    const entry = readJsonFile<SessionRegistryRecord>(
      join(rootDir, "entries", "managed-row.json"),
    );
    expect(entry.runtime?.lifecycleState).toBe("running");

    const index = readJsonFile<{ entries: Array<{ runtime?: unknown }> }>(
      join(rootDir, "index.json"),
    );
    expect(index.entries[0].runtime).toEqual(expect.objectContaining({
      lifecycleState: "running",
    }));

    expect(store.listSessions()[0].runtime).toEqual(expect.objectContaining({
      lifecycleState: "running",
      sdkSessionId: "sdk-session-1",
    }));
  });

  it("marks only runtime metadata patches as runtime-scoped change events", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const events: SessionRegistryChangeEvent[] = [];
    store.subscribe((event) => events.push(event));

    const record = store.upsertSession({
      id: "runtime-scope-row",
      title: "Runtime scope row",
      description: "",
      cwd: "C:\\repo",
      origin: { kind: "launched", launchClaimId: "claim-runtime-scope" },
    });
    store.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
    });
    store.attachObservedSession(record.id, {
      copilotSessionId: "copilot-runtime-scope",
      cwd: "C:\\repo",
      lastSeenAt: "2026-05-07T12:00:00.000Z",
      lifecycleStatus: "active",
    });

    expect(events.map((event) => event.kind)).toEqual(["upsert", "upsert", "upsert"]);
    expect(events.map((event) =>
      event.kind === "rebuild" ? null : event.registryId,
    )).toEqual([
      record.id,
      record.id,
      record.id,
    ]);
    expect(events.map((event) =>
      event.kind === "upsert" ? event.changeScope : undefined,
    )).toEqual([undefined, "runtime", undefined]);
  });

  it("matches origin kind consistently in session list text filters", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    store.upsertSession({
      id: "launched-origin-row",
      title: "Origin row",
      description: "",
      cwd: "C:\\repo",
      origin: { kind: "launched", launchClaimId: "claim-origin" },
    });
    store.upsertSession({
      id: "manual-origin-row",
      title: "Origin row",
      description: "",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });

    expect(store.listSessions({ text: "launched" }).map((session) => session.id))
      .toEqual(["launched-origin-row"]);
    expect(store.listSessions({ text: "manual" }).map((session) => session.id))
      .toEqual(["manual-origin-row"]);
  });

  it("keeps runtime-scoped metadata patches to runtime-only top-level fields", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const record = store.upsertSession({
      id: "runtime-only-row",
      title: "Runtime only row",
      description: "Description must not change",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/runtime-only",
      tags: ["stable"],
      origin: { kind: "launched", launchClaimId: "claim-runtime-only" },
    });
    const updated = store.patchRuntimeMetadata(
      record.id,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
      },
      new Date("2026-05-07T12:00:01.000Z"),
    );
    const changedKeys = Object.keys(updated).filter((key) =>
      JSON.stringify(updated[key as keyof SessionRegistryRecord]) !==
      JSON.stringify(record[key as keyof SessionRegistryRecord])
    );

    expect(changedKeys.sort()).toEqual(["runtime", "updatedAt"]);
  });

  it("preserves additive runtime metadata when older-style upserts omit the field", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const record = store.upsertSession({
      id: "mixed-version-runtime-row",
      title: "Mixed version runtime row",
      description: "",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/managed",
      tags: [],
      origin: { kind: "launched", launchClaimId: "claim-mixed-version" },
      graphBinding: {
        workstreamId: "sdk-managed-worker-runtime",
        nodeId: "managed-node",
        launchClaimId: "claim-mixed-version",
      },
    });
    store.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-mixed-version",
      launchNonce: "nonce-mixed-version",
      sdkSessionId: "sdk-session-mixed-version",
    });

    const rewritten = store.upsertSession({
      id: record.id,
      title: "Older writer title update",
      description: "",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/managed",
      tags: [],
      origin: { kind: "launched", launchClaimId: "claim-mixed-version" },
      graphBinding: {
        workstreamId: "sdk-managed-worker-runtime",
        nodeId: "managed-node",
        launchClaimId: "claim-mixed-version",
      },
    });

    expect(rewritten.runtime).toEqual(expect.objectContaining({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      sdkSessionId: "sdk-session-mixed-version",
    }));
    const entry = readJsonFile<SessionRegistryRecord>(
      join(rootDir, "entries", "mixed-version-runtime-row.json"),
    );
    expect(entry.runtime?.sdkSessionId).toBe("sdk-session-mixed-version");
  });

  it("preserves long managed SDK identifiers and paths after reloading from disk", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    const sdkSessionId = `sdk-${"s".repeat(300)}`;
    const sdkWorkspacePath = `C:\\${"very-long-directory-name\\".repeat(30)}workspace.yaml`;
    const sdkStateRoot = sdkWorkspacePath.slice(0, -"\\workspace.yaml".length);

    const record = store.upsertSession({
      id: "managed-long-path-row",
      title: "Managed long path row",
      description: "",
      cwd: "C:\\repo",
      origin: { kind: "launched", launchClaimId: "claim-managed-long" },
    });

    store.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: `claim-${"c".repeat(300)}`,
      launchNonce: `nonce-${"n".repeat(300)}`,
      sdkSessionId,
      sdkWorkspacePath,
      sdkStateRoot,
    });

    const reloadedStore = new SessionRegistryFileStore({ rootDir });
    const reloaded = reloadedStore.getSession(record.id);

    expect(reloaded?.runtime?.sdkSessionId).toBe(sdkSessionId);
    expect(reloaded?.runtime?.sdkWorkspacePath).toBe(sdkWorkspacePath);
    expect(reloaded?.runtime?.sdkStateRoot).toBe(sdkStateRoot);
  });

  it("ranks list freshness by trustedLastSignalAt when it is newer than lastSeenAt", () => {
    // Discovery sets lastSeenAt from workspace.yaml mtime, which lags real
    // user activity. A session that just received a prompt.submitted hook
    // signal should rank above a quiet session whose workspace was touched
    // more recently.
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    // "Stale active" — workspace was touched recently (lastSeenAt) but no
    // hook signal in a long time.
    store.upsertSession({
      title: "Stale active",
      cwd: "C:\\stale",
      origin: { kind: "observed" },
      copilotSessionId: "stale-session",
      lastSeenAt: "2026-04-29T19:00:00.000Z",
    });

    // "Currently typing" — workspace mtime is hours older than the most
    // recent hook signal arrived for this session.
    store.upsertSession({
      title: "Currently typing",
      cwd: "C:\\typing",
      origin: { kind: "observed" },
      copilotSessionId: "typing-session",
      lastSeenAt: "2026-04-29T15:22:00.000Z",
    });
    store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "typing-session",
      timestamp: "2026-04-29T20:00:00.000Z",
      cwd: "C:\\typing",
      promptLength: 12,
    });

    const titles = store.listSessions().map((session) => session.title);
    expect(titles).toEqual(["Currently typing", "Stale active"]);
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
    expect(beta.titleSource).toBe("auto");
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
    expect(store.listSessions({ text: "feature/beta" }).map((item) => item.id)).toEqual([
      beta.id,
    ]);
    expect(store.listSessions({ text: "c:\\beta" }).map((item) => item.id)).toEqual([
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
    expect(updated.activityEvidence).toEqual(
      DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    );

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

  it("preserves edited observed session identity during rediscovery", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const observed = store.upsertSession({
      title: "Workspace summary",
      description: "lossyrob/streamliner · main",
      color: null,
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "main",
      copilotSessionId: "copilot-edited",
      lastSeenAt: "2026-04-23T12:00:00.000Z",
      origin: { kind: "observed" },
      tags: ["initial"],
      graphBinding: { workstreamId: "sessions", nodeId: "node-a" },
    });
    store.patchSession(observed.id, {
      title: "My custom title",
      description: "Custom description",
      color: "#ff00aa",
      tags: ["custom"],
      graphBinding: { workstreamId: "custom", nodeId: "node-b" },
    });

    const rediscovered = store.upsertSession({
      title: "Rediscovered workspace summary",
      description: "lossyrob/streamliner · feature",
      color: null,
      cwd: "C:\\repo\\worktree",
      repo: "lossyrob/streamliner",
      branch: "feature/manual-session-registry",
      copilotSessionId: "copilot-edited",
      lastSeenAt: "2026-04-23T13:00:00.000Z",
      lifecycleStatus: "ended",
      origin: { kind: "observed" },
      tags: ["rediscovered"],
      graphBinding: null,
    });

    expect(rediscovered).toEqual(
      expect.objectContaining({
        title: "My custom title",
        titleSource: "user",
        description: "Custom description",
        color: "#ff00aa",
        cwd: "C:\\repo\\worktree",
        branch: "feature/manual-session-registry",
        lastSeenAt: "2026-04-23T13:00:00.000Z",
        lifecycleStatus: "ended",
        tags: ["custom"],
        graphBinding: expect.objectContaining({
          workstreamId: "custom",
          nodeId: "node-b",
        }),
      }),
    );
  });

  it("rejects builder graphBinding patches that would clobber a launch claim binding", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const launched = store.upsertSession({
      title: "Launched worker",
      description: "",
      color: null,
      cwd: "C:\\repo",
      origin: { kind: "launched", launchClaimId: "claim-1" },
      graphBinding: {
        workstreamId: "sessions",
        nodeId: "node-a",
        launchClaimId: "claim-1",
      },
    });

    expect(() =>
      store.patchSession(launched.id, {
        graphBinding: { workstreamId: "sessions", nodeId: null },
      })
    ).toThrow(/changed before this update/);
    expect(store.getSession(launched.id)?.graphBinding).toEqual({
      workstreamId: "sessions",
      nodeId: "node-a",
      launchClaimId: "claim-1",
    });
  });

  it("updates auto-managed observed titles during rediscovery", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const observed = store.upsertSession({
      title: "planning",
      description: "lossyrob/planning · main",
      cwd: "C:\\repo\\planning",
      repo: "lossyrob/planning",
      branch: "main",
      copilotSessionId: "copilot-auto-title",
      lastSeenAt: "2026-04-23T12:00:00.000Z",
      origin: { kind: "observed" },
    });
    expect(observed.titleSource).toBe("auto");

    const rediscovered = store.upsertSession({
      title: "Plan Session Registry Fix",
      description: "lossyrob/planning · main",
      cwd: "C:\\repo\\planning",
      repo: "lossyrob/planning",
      branch: "main",
      copilotSessionId: "copilot-auto-title",
      lastSeenAt: "2026-04-23T12:05:00.000Z",
      origin: { kind: "observed" },
    });

    expect(rediscovered).toEqual(
      expect.objectContaining({
        title: "Plan Session Registry Fix",
        titleSource: "auto",
      }),
    );
  });

  it("patches derived AI summary state without changing updatedAt", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const manual = store.upsertSession({
      title: "Manual row",
      description: "Builder-owned description",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });

    const patched = store.patchDerivedSessionState(manual.id, {
      aiSummary: "Implementing a persistent session worker",
      aiSummaryModel: "gpt-5.4-mini",
      aiSummaryUpdatedAt: "2026-04-23T22:00:00.000Z",
      aiSummaryEventsFingerprint: "10:2048",
      aiSummaryStatus: "ready",
      aiSummaryError: null,
    });

    expect(patched).toEqual(
      expect.objectContaining({
        description: "Builder-owned description",
        aiSummary: "Implementing a persistent session worker",
        aiSummaryModel: "gpt-5.4-mini",
        aiSummaryStatus: "ready",
        updatedAt: manual.updatedAt,
        version: manual.version,
      }),
    );
    expect(store.listSessions()[0]).toEqual(
      expect.objectContaining({
        aiSummary: "Implementing a persistent session worker",
        aiSummaryStatus: "ready",
      }),
    );
  });

  it("patches derived PAW workflow state without changing builder fields", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const manual = store.upsertSession({
      title: "Manual row",
      description: "Builder-owned description",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });

    const patched = store.patchDerivedSessionState(manual.id, {
      pawWorkflow: {
        status: "recognized",
        stage: "implementation",
        workflowKind: "paw-lite",
        workId: "paw-artifact-status-observation",
        workTitle: "PAW Artifact Status Observation",
        workDir: "C:\\repo\\.paw\\work\\paw-artifact-status-observation",
        artifacts: [
          {
            path: "Plan.md",
            kind: "planning",
            stage: "planning",
            mtimeMs: 1_778_002_000_000,
          },
          {
            path: "implementation/phase-1.md",
            kind: "implementation",
            stage: "implementation",
            mtimeMs: 1_778_003_000_000,
          },
        ],
        artifactCount: 2,
        latestArtifactPath: "implementation/phase-1.md",
        latestArtifactMtimeMs: 1_778_003_000_000,
        scannedAt: "2026-05-05T13:05:00.000Z",
        diagnostics: [],
      },
    });

    expect(patched).toEqual(
      expect.objectContaining({
        description: "Builder-owned description",
        updatedAt: manual.updatedAt,
        version: manual.version,
        pawWorkflow: expect.objectContaining({
          status: "recognized",
          stage: "implementation",
          workflowKind: "paw-lite",
          workId: "paw-artifact-status-observation",
        }),
      }),
    );
    expect(store.listSessions({ text: "paw-artifact-status-observation" })).toEqual([
      expect.objectContaining({
        id: manual.id,
        pawWorkflow: expect.objectContaining({
          latestArtifactPath: "implementation/phase-1.md",
        }),
      }),
    ]);

    const attached = store.attachObservedSession(manual.id, {
      copilotSessionId: "copilot-session",
      cwd: "C:\\repo",
    });
    expect(attached.pawWorkflow).toEqual(patched.pawWorkflow);

    const cleared = store.patchDerivedSessionState(manual.id, {
      pawWorkflow: null,
    });
    expect(cleared.pawWorkflow).toBeNull();
  });

  it("rejects stale builder patches while allowing derived patches to bypass builder version", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const created = store.upsertSession({
      title: "Concurrent row",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });
    const afterDerived = store.patchDerivedSessionState(created.id, {
      aiSummary: "Derived update",
      aiSummaryStatus: "ready",
    });
    expect(afterDerived.version).toBe(created.version);

    const patched = store.patchSession(created.id, {
      expectedVersion: created.version,
      title: "Builder update",
    });
    expect(patched.version).toBe(created.version + 1);

    expect(() =>
      store.patchSession(created.id, {
        expectedVersion: created.version,
        description: "Stale update",
      }),
    ).toThrow("changed before this update could be saved");
  });

  it("records trusted hook signals idempotently and preserves prompt privacy", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const started = store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "trusted-session-1",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/manual-session-registry",
      hookSource: "new",
      executionKind: "copilot_cli",
      initialPromptLength: 54,
    });

    expect(started).toEqual(
      expect.objectContaining({
        id: "trusted-session-1",
        titleSource: "auto",
        lifecycleStatus: "active",
        observedSessionKind: "interactive",
        copilotProcessState: "live",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: "2026-04-24T20:00:00.000Z",
        trustedLastSignalAt: "2026-04-24T20:00:00.000Z",
        trustedStartSource: "new",
        trustedExecutionKind: "copilot_cli",
        trustedInitialPromptLength: 54,
        trustedLastPromptLength: null,
        activityStatus: "working",
        activityStatusUpdatedAt: "2026-04-24T20:00:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "trusted_start",
          confidence: "high",
          diagnostics: [],
          lastActivityEventAt: "2026-04-24T20:00:00.000Z",
        }),
      }),
    );

    const prompted = store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "trusted-session-1",
      timestamp: "2026-04-24T20:01:00.000Z",
      cwd: "C:\\repo",
      promptLength: 1234,
    });
    const ended = store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "trusted-session-1",
      timestamp: "2026-04-24T20:02:00.000Z",
      cwd: "C:\\repo",
      endReason: "user_exit",
    });

    expect(prompted).toEqual(
      expect.objectContaining({
        trustedLastSignalAt: "2026-04-24T20:01:00.000Z",
        trustedStartedAt: "2026-04-24T20:00:00.000Z",
        trustedInitialPromptLength: 54,
        trustedLastPromptLength: 1234,
        activityStatus: "working",
        activityStatusUpdatedAt: "2026-04-24T20:01:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "trusted_prompt",
          confidence: "high",
          lastActivityEventAt: "2026-04-24T20:01:00.000Z",
        }),
      }),
    );
    expect(ended).toEqual(
      expect.objectContaining({
        lifecycleStatus: "ended",
        copilotProcessState: "none",
        trustedEndedAt: "2026-04-24T20:02:00.000Z",
        trustedEndReason: "user_exit",
        activityStatus: "exited",
        activityStatusUpdatedAt: "2026-04-24T20:02:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "trusted_end",
          confidence: "high",
          lastActivityEventAt: "2026-04-24T20:02:00.000Z",
        }),
      }),
    );
    expect(readJsonFile<Record<string, unknown>>(join(rootDir, "entries", "trusted-session-1.json"))).not.toHaveProperty(
      "prompt",
    );
  });

  it("preserves prior turn evidence when trusted prompt signals update status", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const observed = store.upsertSession({
      title: "Observed activity",
      cwd: "C:\\repo",
      origin: { kind: "observed" },
      copilotSessionId: "trusted-preserve-session",
    });
    store.patchDerivedSessionState(observed.id, {
      activityEvidence: buildSessionRegistryActivityEvidence({
        statusReason: "assistant_message",
        confidence: "high",
        lastUserMessageAt: "2026-04-24T19:59:00.000Z",
        lastAssistantTurnStartedAt: "2026-04-24T20:00:00.000Z",
        userMessageCount: 4,
        assistantTurnCount: 3,
      }),
    });

    const prompted = store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "trusted-preserve-session",
      timestamp: "2026-04-24T20:01:00.000Z",
      cwd: "C:\\repo",
      promptLength: 12,
    });

    expect(prompted.activityEvidence).toEqual(
      expect.objectContaining({
        statusReason: "trusted_prompt",
        confidence: "high",
        diagnostics: [],
        lastActivityEventAt: "2026-04-24T20:01:00.000Z",
        lastUserMessageAt: "2026-04-24T19:59:00.000Z",
        lastAssistantTurnStartedAt: "2026-04-24T20:00:00.000Z",
        userMessageCount: 4,
        assistantTurnCount: 3,
      }),
    );
  });

  it("clears pending input evidence when trusted signals update status", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const promptedSession = store.upsertSession({
      title: "Pending prompt",
      cwd: "C:\\repo",
      origin: { kind: "observed" },
      copilotSessionId: "trusted-clear-prompt-session",
    });
    store.patchDerivedSessionState(promptedSession.id, {
      activityEvidence: buildSessionRegistryActivityEvidence({
        statusReason: "pending_input",
        confidence: "high",
        pendingInputRequest: true,
        pendingInputRequestCount: 1,
        lastUserMessageAt: "2026-04-24T19:59:00.000Z",
        userMessageCount: 2,
      }),
    });

    const prompted = store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "trusted-clear-prompt-session",
      timestamp: "2026-04-24T20:01:00.000Z",
      cwd: "C:\\repo",
      promptLength: 12,
    });

    expect(prompted.activityEvidence).toEqual(
      expect.objectContaining({
        statusReason: "trusted_prompt",
        pendingInputRequest: false,
        pendingInputRequestCount: 0,
        lastUserMessageAt: "2026-04-24T19:59:00.000Z",
        userMessageCount: 2,
      }),
    );

    const endedSession = store.upsertSession({
      title: "Pending end",
      cwd: "C:\\repo",
      origin: { kind: "observed" },
      copilotSessionId: "trusted-clear-end-session",
    });
    store.patchDerivedSessionState(endedSession.id, {
      activityEvidence: buildSessionRegistryActivityEvidence({
        statusReason: "pending_input",
        confidence: "high",
        pendingInputRequest: true,
        pendingInputRequestCount: 2,
        lastAssistantTurnStartedAt: "2026-04-24T20:00:00.000Z",
        assistantTurnCount: 3,
      }),
    });

    const ended = store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "trusted-clear-end-session",
      timestamp: "2026-04-24T20:02:00.000Z",
      cwd: "C:\\repo",
      endReason: "complete",
    });

    expect(ended.activityEvidence).toEqual(
      expect.objectContaining({
        statusReason: "trusted_end",
        pendingInputRequest: false,
        pendingInputRequestCount: 0,
        lastAssistantTurnStartedAt: "2026-04-24T20:00:00.000Z",
        assistantTurnCount: 3,
      }),
    );
  });

  it("clears stale copilotProcessId on session.started so activity indexer does not see a dead PID", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    // Establish a session that observation has linked to a real PID.
    const initial = store.upsertSession({
      title: "Resumable",
      cwd: "C:\\repo",
      origin: { kind: "observed" },
      copilotSessionId: "resumable-session",
      copilotProcessState: "live",
      copilotProcessId: 5092,
    });
    expect(initial.copilotProcessId).toBe(5092);

    // The original process exits and a session.ended signal arrives.
    store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "resumable-session",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
      endReason: "user_exit",
    });

    // The user (or relaunch endpoint synthesis) issues a new session.started
    // for the resume. The previous PID is no longer valid; leaving it in the
    // record would trip the activity indexer's "process disappeared" branch
    // and flash activityStatus to "interrupted" until discovery picks up the
    // new PID.
    const restarted = store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "resumable-session",
      timestamp: "2026-04-24T20:01:00.000Z",
      cwd: "C:\\repo",
      hookSource: "resume",
    });

    expect(restarted.copilotProcessId).toBeNull();
    expect(restarted.copilotProcessState).toBe("live");
    expect(restarted.trustedStartSource).toBe("resume");
    expect(restarted.trustedEndedAt).toBeNull();
  });

  it("ignores stale trusted signals and preserves chronological end metadata", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "chronological-session",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
      hookSource: "new",
      initialPromptLength: 20,
    });
    store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "chronological-session",
      timestamp: "2026-04-24T20:01:00.000Z",
      cwd: "C:\\repo",
      promptLength: 33,
    });
    store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "chronological-session",
      timestamp: "2026-04-24T20:03:00.000Z",
      cwd: "C:\\repo",
      endReason: "complete",
    });

    const stalePrompt = store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "chronological-session",
      timestamp: "2026-04-24T20:02:00.000Z",
      cwd: "C:\\repo",
      promptLength: 99,
    });
    const staleStart = store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "chronological-session",
      timestamp: "2026-04-24T20:00:30.000Z",
      cwd: "C:\\repo",
      hookSource: "resume",
      initialPromptLength: 44,
    });

    for (const record of [stalePrompt, staleStart]) {
      expect(record).toEqual(
        expect.objectContaining({
          lifecycleStatus: "ended",
          copilotProcessState: "none",
          trustedStartedAt: "2026-04-24T20:00:00.000Z",
          trustedEndedAt: "2026-04-24T20:03:00.000Z",
          trustedLastSignalAt: "2026-04-24T20:03:00.000Z",
          trustedEndReason: "complete",
          trustedInitialPromptLength: 20,
          trustedLastPromptLength: 33,
          activityStatus: "exited",
          activityStatusUpdatedAt: "2026-04-24T20:03:00.000Z",
        }),
      );
    }

    const resumed = store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "chronological-session",
      timestamp: "2026-04-24T20:04:00.000Z",
      cwd: "C:\\repo",
      hookSource: "resume",
      initialPromptLength: 55,
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        lifecycleStatus: "active",
        copilotProcessState: "live",
        trustedStartedAt: "2026-04-24T20:04:00.000Z",
        trustedEndedAt: null,
        trustedLastSignalAt: "2026-04-24T20:04:00.000Z",
        trustedStartSource: "resume",
        trustedEndReason: null,
        trustedInitialPromptLength: 55,
        trustedLastPromptLength: 33,
        activityStatus: "working",
        activityStatusUpdatedAt: "2026-04-24T20:04:00.000Z",
      }),
    );
  });

  it("records trusted prompt signals before a trusted session start exists", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    const prompted = store.recordTrustedSessionSignal({
      event: "prompt.submitted",
      source: "copilot-cli-hook",
      sessionId: "unknown-prompt-session",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
      promptLength: 12,
    });
    expect(prompted).toEqual(
      expect.objectContaining({
        id: "unknown-prompt-session",
        lifecycleStatus: "active",
        lastSeenAt: "2026-04-24T20:00:00.000Z",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: null,
        trustedLastSignalAt: "2026-04-24T20:00:00.000Z",
        trustedLastPromptLength: 12,
        copilotProcessState: "live",
        activityStatus: "working",
        activityStatusUpdatedAt: "2026-04-24T20:00:00.000Z",
      }),
    );

    const started = store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "unknown-prompt-session",
      timestamp: "2026-04-24T20:00:02.000Z",
      cwd: "C:\\repo",
      hookSource: "resume",
      initialPromptLength: 34,
    });
    expect(started).toEqual(
      expect.objectContaining({
        trustedStartedAt: "2026-04-24T20:00:02.000Z",
        trustedStartSource: "resume",
        trustedInitialPromptLength: 34,
        trustedLastPromptLength: 12,
      }),
    );
  });

  it("does not reactivate archived sessions from trusted signals", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "archived-trusted-session",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
    });
    store.archiveSession("archived-trusted-session");

    expect(() =>
      store.recordTrustedSessionSignal({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "archived-trusted-session",
        timestamp: "2026-04-24T20:05:00.000Z",
        cwd: "C:\\repo",
      }),
    ).toThrow(/Archived session archived-trusted-session/);
    expect(store.getSession("archived-trusted-session")).toEqual(
      expect.objectContaining({ lifecycleStatus: "archived" }),
    );
  });

  it("allows builder-owned fields to be patched after a trusted session ends", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "ended-trusted-session",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
    });
    store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "ended-trusted-session",
      timestamp: "2026-04-24T20:05:00.000Z",
      cwd: "C:\\repo",
      endReason: "complete",
    });

    expect(
      store.patchSession("ended-trusted-session", {
        title: "Named after completion",
      }),
    ).toEqual(
      expect.objectContaining({
        title: "Named after completion",
        lifecycleStatus: "ended",
      }),
    );
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

    const externalPath = join(entriesDir, "external-entry.json");
    const externalRecord = readJsonFile<SessionRegistryRecord>(externalPath);
    writeFileSync(
      externalPath,
      JSON.stringify({ ...externalRecord, title: "Externally renamed" }, null, 2),
      "utf8",
    );

    expect(store.listSessions()[0]).toEqual(
      expect.objectContaining({ title: "Externally renamed" }),
    );
    expect(rebuilds).toEqual([["external-entry"], ["external-entry"]]);
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

  it("waits briefly for an active advisory lock to clear", async () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({
      rootDir,
      writeLockWaitTimeoutMs: 2_000,
    });
    const lockPath = join(rootDir, "registry.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );
    const script = `
const { rmSync } = require("node:fs");
const lockPath = process.argv[1];
const holdMs = Number(process.argv[2]);
setTimeout(() => {
  rmSync(lockPath, { force: true });
}, holdMs);
setTimeout(() => process.exit(0), holdMs + 50);
`;
    const stderr: Buffer[] = [];
    const child = spawn(process.execPath, ["-e", script, lockPath, "250"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const childExit = waitForChildExit(child, stderr);

    const created = store.upsertSession({
      title: "Recovered after wait",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });

    expect(created.title).toBe("Recovered after wait");
    await childExit;
  });

  it("recovers stale advisory locks from exited processes", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });
    writeFileSync(
      join(rootDir, "registry.lock"),
      JSON.stringify({ pid: 999999999, acquiredAt: "2026-04-23T12:00:00.000Z" }),
      "utf8",
    );

    const created = store.upsertSession({
      title: "Recovered",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });

    expect(created.title).toBe("Recovered");
    expect(existsSync(join(rootDir, "registry.lock"))).toBe(false);
  });

  it("does not acquire the registry lock during active stale-lock recovery", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({
      rootDir,
      writeLockWaitTimeoutMs: 0,
    });
    writeFileSync(
      join(rootDir, "registry.lock.recovery"),
      JSON.stringify({ pid: process.pid, acquiredAt: "2026-04-23T12:00:00.000Z" }),
      "utf8",
    );

    expect(() =>
      store.upsertSession({
        title: "Blocked by recovery",
        cwd: "C:\\repo",
        origin: { kind: "manual" },
      }),
    ).toThrow();
    expect(existsSync(join(rootDir, "registry.lock"))).toBe(false);
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

    const manualWithPawLaunch = {
      title: "Manual with PAW launch metadata",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
      pawLaunch: {
        workId: "work-1",
        workTitle: "Work 1",
        workflowKind: "paw-lite",
        pawWorkDir: "C:\\repo\\.paw\\work\\work-1",
        workflowContextPath: null,
        streamlinerContextPath: null,
      },
    } as unknown as SessionRegistryUpsertInput;
    expect(() =>
      store.upsertSession(manualWithPawLaunch),
    ).toThrow(/Unexpected input field\(s\): pawLaunch/);

    const manual = store.upsertSession({
      title: "Manual row",
      cwd: "C:\\repo",
      origin: { kind: "manual" },
    });
    const invalidPatch = { title: "" } as unknown as SessionRegistryPatch;
    expect(() => store.patchSession(manual.id, invalidPatch)).toThrow(/patch\.title/);

    expect(() =>
      store.upsertSession({
        title: "Bad pid",
        cwd: "C:\\repo",
        origin: { kind: "observed" },
        copilotSessionId: "bad-pid",
        copilotProcessId: -1,
      }),
    ).toThrow(/non-negative integer/);
  });

  it("rejects caller-provided ids that are unsafe as registry filenames", () => {
    const rootDir = createRootDir();
    createdRoots.push(rootDir);
    const store = new SessionRegistryFileStore({ rootDir });

    expect(() =>
      store.upsertSession({
        id: "..\\escape",
        title: "Unsafe manual",
        cwd: "C:\\repo",
        origin: { kind: "manual" },
      }),
    ).toThrow(/safe registry id/);

    expect(() =>
      store.upsertSession({
        id: "CON",
        title: "Reserved manual",
        cwd: "C:\\repo",
        origin: { kind: "manual" },
      }),
    ).toThrow(/safe registry id/);

    expect(() =>
      store.recordTrustedSessionSignal({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "..\\escape",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
      }),
    ).toThrow(/safe registry id/);
  });
});
