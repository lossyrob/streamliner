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
import type { NodeLaunchRecord } from "../../node-launch-record-contract";
import { LaunchClaimFileStore } from "../../session-registry/launch-claim-store";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "../app";
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

function writeRecordDocument(recordsPath: string, records: StoredRecordFixture[]): void {
  mkdirSync(dirname(recordsPath), { recursive: true });
  writeFileSync(
    recordsPath,
    `${JSON.stringify({ version: 1, records }, null, 2)}\n`,
    "utf8",
  );
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
    reservedRegistryId: null,
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
