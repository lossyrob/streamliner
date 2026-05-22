import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type { LaunchClaimStatus } from "../../launch-claim-schema";
import type {
  NodeLaunchClaimState,
  NodeLaunchOperation,
  NodeLaunchRecord,
} from "../../node-launch-record-contract";
import { runLaunchClaimSweep } from "../../session-registry/launch-claim-sweep";
import { LaunchClaimFileStore } from "../../session-registry/launch-claim-store";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "../app";
import { ApiLogger } from "../logger";
import { NodeLaunchRecordStore } from "../node-launch-record-store";

type StoredRecordFixture = Omit<NodeLaunchRecord, "pathStatus" | "latestClaim">;

const TEST_ROOT = join(process.cwd(), "node_modules", ".tmp", "node-launch-records-tests");
const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];

function createRootDir(): string {
  const root = join(TEST_ROOT, randomUUID());
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function buildStoredRecord(overrides: Partial<StoredRecordFixture> = {}): StoredRecordFixture {
  const graphPath = overrides.graphPath ?? "C:\\repo\\.streamliner\\workstreams\\example\\graph.json";
  const nodeId = overrides.nodeId ?? "node-a";
  return {
    id: `${nodeId}-record`,
    graphPath,
    nodeId,
    projectKey: "example-project",
    workstreamId: "example-workstream",
    branch: `feature/${nodeId}`,
    workId: nodeId,
    workTitle: `Work for ${nodeId}`,
    cwd: "",
    pawWorkDir: "",
    workflowContextPath: "",
    streamlinerContextPath: "",
    contextPackagePath: "",
    contextFilePath: "",
    launchNonce: null,
    launchClaimRef: null,
    trackerUrl: null,
    createdAt: "2026-05-04T12:00:00.000Z",
    updatedAt: "2026-05-04T12:00:00.000Z",
    ...overrides,
  };
}

function writeRecordDocument(
  recordsPath: string,
  records: StoredRecordFixture[],
  operations: NodeLaunchOperation[] = [],
): void {
  mkdirSync(dirname(recordsPath), { recursive: true });
  writeFileSync(
    recordsPath,
    `${JSON.stringify({ version: 1, records, operations }, null, 2)}\n`,
    "utf8",
  );
}

function buildLaunchClaimState(
  launchClaimId: string,
  overrides: Partial<NodeLaunchClaimState> = {},
): NodeLaunchClaimState {
  return {
    launchClaimId,
    status: "pending",
    launchedAt: "2026-05-04T12:00:00.000Z",
    updatedAt: "2026-05-04T12:00:00.000Z",
    bindingWindowExpiresAt: "2026-05-04T12:01:00.000Z",
    reservedRegistryId: null,
    boundRegistryId: null,
    boundCopilotSessionId: null,
    failureCode: null,
    failureReason: null,
    blocksLaunch: true,
    retryable: false,
    ...overrides,
  };
}

function buildPendingBindingOperation(input: {
  graphPath: string;
  nodeId: string;
  workstreamId?: string;
  launchClaimId?: string;
}): NodeLaunchOperation {
  const launchClaimId = input.launchClaimId ?? `claim-${input.nodeId}`;
  const workstreamId = input.workstreamId ?? "example-workstream";
  const timestamp = "2026-05-04T12:02:00.000Z";
  return {
    id: `${input.nodeId}-operation`,
    graphPath: input.graphPath,
    nodeId: input.nodeId,
    status: "launched_pending_binding",
    preparationRunId: "run-1",
    startedAt: "2026-05-04T12:00:00.000Z",
    updatedAt: timestamp,
    completedAt: timestamp,
    handoff: {
      cwd: "C:\\repo",
      branch: `feature/${input.nodeId}`,
      runtimeKind: "terminal-cli",
      pawWorkDir: "C:\\repo\\.paw\\work\\example",
      workflowContextPath: "C:\\repo\\.paw\\work\\example\\WorkflowContext.md",
      streamlinerContextPath: "C:\\repo\\INDEX.md",
      kickoffPrompt: "Start PAW.",
      cliArgs: ["copilot"],
      terminal: { launchMode: "manual", preferredTerminal: "windows-terminal" },
      environment: {},
      sessionStateRoot: "C:\\state",
      launchMetadata: {
        launchNonce: `nonce-${launchClaimId}`,
        launchClaimRef: launchClaimId,
        projectKey: "example-project",
        workstreamId,
        nodeId: input.nodeId,
        targetRepoIds: ["lossyrob/streamliner"],
        graphPath: input.graphPath,
        branch: `feature/${input.nodeId}`,
        workId: input.nodeId,
        workTitle: `Work for ${input.nodeId}`,
        trackerUrl: null,
      },
      contextPackage: {
        contextId: "context-1",
        contextPackagePath: "C:\\repo\\.paw\\work\\example\\context.json",
        contextFilePath: "C:\\repo\\.paw\\work\\example\\context.md",
        metadata: {},
        unavailableInputs: [],
      },
    },
    postPreparation: null,
    terminalLaunch: {
      launchClaim: buildLaunchClaimState(launchClaimId),
      terminal: { method: "windows-terminal", pid: 1234 },
      cwd: "C:\\repo",
      branch: `feature/${input.nodeId}`,
      command: {
        cliArgs: ["copilot"],
        promptNonceLine: `STREAMLINER_LAUNCH_NONCE=nonce-${launchClaimId}`,
      },
    },
    managedLaunch: null,
    companionLaunch: null,
    companionError: null,
    error: null,
    progressEvents: [],
  };
}

function retryableFsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code} during replace`), { code });
}

function createClaim(
  claimStore: LaunchClaimFileStore,
  input: {
    launchClaimId: string;
    nodeId: string;
    launchedAt: string;
    status?: LaunchClaimStatus;
    reservedRegistryId?: string | null;
  },
): void {
  claimStore.createClaim({
    launchClaimId: input.launchClaimId,
    workstreamId: "example-workstream",
    nodeId: input.nodeId,
    launchNonce: `nonce-${input.launchClaimId}`,
    expectedCwd: "C:\\repo",
    expectedBranch: `feature/${input.nodeId}`,
    expectedRepo: "lossyrob/streamliner",
    contextId: null,
    launchedAt: input.launchedAt,
    bindingWindowMs: 60_000,
    retentionWindowMs: 3_600_000,
    reservedRegistryId: input.reservedRegistryId ?? null,
    lineageMetadata: null,
  });
  const status = input.status;
  if (status && status !== "pending") {
    claimStore.updateClaim(input.launchClaimId, (claim) => ({
      ...claim,
      status,
      boundRegistryId: status === "bound" ? `registry-${input.launchClaimId}` : null,
      boundCopilotSessionId: status === "bound" ? `session-${input.launchClaimId}` : null,
      failureCode: status === "failed" ? "terminal-spawn-failed" : null,
      failureReason: status === "failed" ? "Terminal launch failed." : null,
    }));
  }
}

describe("NodeLaunchRecordStore", () => {
  it("lists records by normalized graph path", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    writeRecordDocument(recordsPath, [
      buildStoredRecord({ graphPath, nodeId: "node-a" }),
      buildStoredRecord({ graphPath: graphPath.toUpperCase(), nodeId: "node-b" }),
      buildStoredRecord({ graphPath: join(root, "other", "graph.json"), nodeId: "node-c" }),
    ]);

    const store = new NodeLaunchRecordStore({ recordsPath });
    const records = await store.listByGraphPath(graphPath.toUpperCase());

    expect(records.map((record) => record.nodeId)).toEqual(["node-a", "node-b"]);
    await expect(store.get(graphPath.toUpperCase(), "node-a")).resolves.toEqual(
      expect.objectContaining({ nodeId: "node-a" }),
    );
  });

  it("retries transient Windows replace failures when writing records", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    let replaceAttempts = 0;
    const store = new NodeLaunchRecordStore({
      recordsPath,
      atomicReplaceRetryDelaysMs: [0, 0],
      replaceFile: async (source, destination) => {
        replaceAttempts += 1;
        if (replaceAttempts < 3) {
          throw retryableFsError("EPERM");
        }
        await rename(source, destination);
      },
    });

    await store.startPreparationOperation({
      graphPath,
      nodeId: "node-a",
      runId: "run-a",
      now: new Date("2026-05-07T21:30:00.000Z"),
    });

    expect(replaceAttempts).toBe(3);
    const document = JSON.parse(readFileSync(recordsPath, "utf8")) as {
      operations: Array<{ nodeId: string; status: string }>;
    };
    expect(document.operations).toEqual([
      expect.objectContaining({ nodeId: "node-a", status: "preparing" }),
    ]);
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("marks and releases stale pending-binding operations", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    writeRecordDocument(
      recordsPath,
      [],
      [
        buildPendingBindingOperation({
          graphPath,
          nodeId: "node-bound",
          launchClaimId: "claim-bound",
        }),
        buildPendingBindingOperation({
          graphPath,
          nodeId: "node-release",
          launchClaimId: "claim-release",
        }),
      ],
    );
    const store = new NodeLaunchRecordStore({ recordsPath });

    await expect(store.markLaunchedPendingBindingBound({
      graphPath,
      nodeId: "node-bound",
      now: new Date("2026-05-04T12:03:00.000Z"),
    })).resolves.toEqual(expect.objectContaining({
      status: "bound",
      error: null,
    }));
    await expect(store.releaseLaunchedPendingBindingOperation({
      graphPath,
      nodeId: "node-release",
      reason: "No verified binding evidence remains.",
      now: new Date("2026-05-04T12:04:00.000Z"),
    })).resolves.toEqual(expect.objectContaining({
      status: "preparation_failed",
      terminalLaunch: null,
      error: expect.objectContaining({
        code: "operation_released_by_user",
        error: "No verified binding evidence remains.",
      }),
    }));
  });
});

describe("GET /api/node-launch-records", () => {
  it("preserves selected-node response compatibility", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    writeRecordDocument(recordsPath, [
      buildStoredRecord({ graphPath, nodeId: "node-a" }),
      buildStoredRecord({ graphPath, nodeId: "node-b" }),
    ]);
    const api = createStreamlinerApiApp({
      store: new SessionRegistryFileStore({ rootDir: join(root, "registry") }),
      nodeLaunchRecordsPath: recordsPath,
    });
    activeApps.push(api);

    const response = await request(api.app)
      .get("/api/node-launch-records")
      .query({ graphPath, nodeId: "node-a" })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      record: expect.objectContaining({
        graphPath,
        nodeId: "node-a",
        latestClaim: null,
      }),
    }));
    expect(response.body).not.toHaveProperty("records");
  });

  it("lists graph-wide records with latest launch-claim summaries without mutating graph.json", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    mkdirSync(dirname(graphPath), { recursive: true });
    writeFileSync(graphPath, "{\"nodes\":[]}\n", "utf8");
    const graphBefore = readFileSync(graphPath, "utf8");
    const graphStatBefore = statSync(graphPath);
    writeRecordDocument(recordsPath, [
      buildStoredRecord({ graphPath, nodeId: "node-a" }),
      buildStoredRecord({ graphPath, nodeId: "node-b" }),
      buildStoredRecord({ graphPath: join(root, "other", "graph.json"), nodeId: "node-c" }),
    ]);
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    createClaim(claimStore, {
      launchClaimId: "claim-a-bound",
      nodeId: "node-a",
      launchedAt: "2026-05-04T12:01:00.000Z",
      status: "bound",
    });
    createClaim(claimStore, {
      launchClaimId: "claim-b-old",
      nodeId: "node-b",
      launchedAt: "2026-05-04T12:01:00.000Z",
      status: "failed",
    });
    createClaim(claimStore, {
      launchClaimId: "claim-b-new",
      nodeId: "node-b",
      launchedAt: "2026-05-04T12:02:00.000Z",
      status: "failed",
    });
    const api = createStreamlinerApiApp({
      store: new SessionRegistryFileStore({ rootDir: join(root, "registry") }),
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: recordsPath,
    });
    activeApps.push(api);

    const response = await request(api.app)
      .get("/api/node-launch-records")
      .query({ graphPath })
      .expect(200);

    expect(response.body).not.toHaveProperty("record");
    expect(response.body.records).toHaveLength(2);
    expect(response.body.records).toEqual([
      expect.objectContaining({
        nodeId: "node-a",
        latestClaim: expect.objectContaining({
          launchClaimId: "claim-a-bound",
          status: "bound",
          blocksLaunch: true,
          retryable: false,
        }),
      }),
      expect.objectContaining({
        nodeId: "node-b",
        latestClaim: expect.objectContaining({
          launchClaimId: "claim-b-new",
          status: "failed",
          blocksLaunch: false,
          retryable: true,
        }),
      }),
    ]);
    expect(readFileSync(graphPath, "utf8")).toBe(graphBefore);
    expect(statSync(graphPath).mtimeMs).toBe(graphStatBefore.mtimeMs);
  });
});

describe("POST /api/node-launch-records/operations/release", () => {
  it("restores verified graph binding for a stale launched_pending_binding operation", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    registryStore.upsertSession({
      id: "registry-stale",
      title: "Stale launch",
      description: "",
      cwd: "C:/repo",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "claim-stale" },
      lifecycleStatus: "active",
      graphBinding: null,
    });
    registryStore.attachObservedSession("registry-stale", {
      copilotSessionId: "session-stale",
      cwd: "C:/repo",
      lastSeenAt: "2026-05-04T12:03:00.000Z",
    });
    writeRecordDocument(
      recordsPath,
      [
        buildStoredRecord({
          graphPath,
          nodeId: "node-stale",
          workstreamId: "example-workstream",
          launchClaimRef: "claim-stale",
        }),
      ],
      [
        buildPendingBindingOperation({
          graphPath,
          nodeId: "node-stale",
          launchClaimId: "claim-stale",
        }),
      ],
    );
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    createClaim(claimStore, {
      launchClaimId: "claim-stale",
      nodeId: "node-stale",
      launchedAt: "2026-05-04T12:01:00.000Z",
      status: "failed",
      reservedRegistryId: "registry-stale",
    });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: recordsPath,
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launch-records/operations/release")
      .set("Content-Type", "application/json")
      .send({ graphPath, nodeId: "node-stale" })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      graphBindingRestored: true,
      registryId: "registry-stale",
      operation: expect.objectContaining({ status: "bound" }),
    }));
    expect(registryStore.getSession("registry-stale")?.graphBinding).toEqual({
      workstreamId: "example-workstream",
      nodeId: "node-stale",
      launchClaimId: "claim-stale",
    });
    expect(claimStore.getClaim("claim-stale")).toEqual(expect.objectContaining({
      status: "bound",
      boundRegistryId: "registry-stale",
      boundCopilotSessionId: "session-stale",
      failureCode: null,
      failureReason: null,
    }));
    const logger = new ApiLogger({
      logDir: join(root, "logs"),
      mirrorConsole: false,
      purgeOnStart: false,
    }).withScope("test");
    const sweepResult = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date("2026-05-04T14:00:00.000Z"),
      logger,
    });
    expect(sweepResult.reservedRowsGraphBindingCleared).toBe(0);
    expect(registryStore.getSession("registry-stale")?.graphBinding).toEqual({
      workstreamId: "example-workstream",
      nodeId: "node-stale",
      launchClaimId: "claim-stale",
    });
    await expect(
      new NodeLaunchRecordStore({ recordsPath }).getOperation(graphPath, "node-stale"),
    ).resolves.toEqual(expect.objectContaining({ status: "bound" }));
  });

  it("releases stale launched_pending_binding operations when registry evidence is insufficient", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    writeRecordDocument(
      recordsPath,
      [
        buildStoredRecord({
          graphPath,
          nodeId: "node-missing",
          workstreamId: "example-workstream",
          launchClaimRef: "claim-missing",
        }),
      ],
      [
        buildPendingBindingOperation({
          graphPath,
          nodeId: "node-missing",
          launchClaimId: "claim-missing",
        }),
      ],
    );
    const api = createStreamlinerApiApp({
      store: new SessionRegistryFileStore({ rootDir: join(root, "registry") }),
      launchClaimStore: new LaunchClaimFileStore({ rootDir: join(root, "claims") }),
      nodeLaunchRecordsPath: recordsPath,
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launch-records/operations/release")
      .set("Content-Type", "application/json")
      .send({
        graphPath,
        nodeId: "node-missing",
        reason: "No registry evidence remains.",
      })
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      graphBindingRestored: false,
      operation: expect.objectContaining({
        status: "preparation_failed",
        terminalLaunch: null,
        error: expect.objectContaining({
          code: "operation_released_by_user",
          error: "No registry evidence remains.",
        }),
      }),
    }));
  });

  it("does not release launched_pending_binding operations while a latest claim is still blocking", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "node-launch-records.json");
    const graphPath = join(root, ".streamliner", "workstreams", "example", "graph.json");
    writeRecordDocument(
      recordsPath,
      [
        buildStoredRecord({
          graphPath,
          nodeId: "node-active",
          workstreamId: "",
          launchClaimRef: "claim-active",
        }),
      ],
      [
        buildPendingBindingOperation({
          graphPath,
          nodeId: "node-active",
          launchClaimId: "claim-active",
        }),
      ],
    );
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    createClaim(claimStore, {
      launchClaimId: "claim-active",
      nodeId: "node-active",
      launchedAt: new Date().toISOString(),
      status: "pending",
    });
    const api = createStreamlinerApiApp({
      store: new SessionRegistryFileStore({ rootDir: join(root, "registry") }),
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: recordsPath,
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launch-records/operations/release")
      .set("Content-Type", "application/json")
      .send({ graphPath, nodeId: "node-active" })
      .expect(409);

    expect(response.body).toEqual(expect.objectContaining({
      code: "operation_claim_still_active",
      operation: expect.objectContaining({
        status: "launched_pending_binding",
        latestClaim: expect.objectContaining({
          launchClaimId: "claim-active",
          status: "pending",
          blocksLaunch: true,
        }),
      }),
    }));
    await expect(
      new NodeLaunchRecordStore({ recordsPath }).getOperation(graphPath, "node-active"),
    ).resolves.toEqual(expect.objectContaining({ status: "launched_pending_binding" }));
  });
});
