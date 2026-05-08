import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { LaunchClaimFileStore } from "../session-registry/launch-claim-store";
import type { LaunchClaimStore } from "../launch-claim-contract";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import type { PawLaunchHandoff } from "./launch-preparation";
import {
  appendLaunchBindingPromptLines,
  launchPreparedNode,
  NodeLaunchError,
} from "./node-launch";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import { NodeLaunchRecordStore } from "./node-launch-record-store";

const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];

function createRootDir(): string {
  const root = join(tmpdir(), `streamliner-node-launch-${process.pid}-${createdRoots.length}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function writeNodeLaunchGraph(
  root: string,
  options: {
    launchPolicy?: Record<string, unknown>;
    tracker?: Record<string, unknown>;
  } = {},
): string {
  const graphDir = join(root, ".streamliner", "workstreams", "api-test");
  const graphPath = join(graphDir, "graph.json");
  const node: Record<string, unknown> = {
    id: "terminal-launch",
    type: "task",
    title: "Terminal Launch",
    summary: "Launch a terminal session.",
    status: "ready",
    attention: "focus",
    repoIds: ["streamliner"],
    dependsOn: [],
  };
  if (options.tracker !== undefined) {
    node.tracker = options.tracker;
  }
  const graph: Record<string, unknown> = {
    schemaVersion: 1,
    id: "api-test",
    projectKey: "streamliner",
    title: "API Test",
    summary: "Test workstream graph.",
    status: "active",
    attention: "focus",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    repos: [
      {
        id: "streamliner",
        owner: "lossyrob",
        name: "streamliner",
      },
    ],
    designRefs: [],
    nodes: [node],
    checkpoints: [],
  };
  if (options.launchPolicy !== undefined) {
    graph.launchPolicy = options.launchPolicy;
  }
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(graphPath, JSON.stringify(graph), "utf8");
  return graphPath;
}

function fakeHandoff(root: string, overrides: Partial<PawLaunchHandoff> = {}): PawLaunchHandoff {
  const graphPath = normalizePath(writeNodeLaunchGraph(root, {
    tracker: {
      type: "github",
      owner: "lossyrob",
      repo: "streamliner",
      number: 44,
    },
  }));
  const contextPackagePath = normalizePath(join(root, "state", "launch-contexts", "ctx"));
  const contextFilePath = normalizePath(join(root, "state", "launch-contexts", "ctx", "context.md"));
  const base: PawLaunchHandoff = {
    cwd: normalizePath(root),
    branch: "feature/terminal-launch",
    pawWorkDir: normalizePath(join(root, ".paw", "work", "terminal-launch")),
    workflowContextPath: normalizePath(join(root, ".paw", "work", "terminal-launch", "WorkflowContext.md")),
    streamlinerContextPath: normalizePath(join(root, ".paw", "work", "terminal-launch", "streamliner", "context.md")),
    kickoffPrompt: [
      "Start this Streamliner worker.",
      "",
      "Streamliner launch metadata:",
      "- Launch nonce: nonce-123",
      "- Launch claim: not-created",
      "",
    ].join("\n"),
    cliArgs: ["--yolo"],
    terminal: {
      launchMode: "manual",
      preferredTerminal: "powershell",
      title: "Terminal Launch",
      tabColor: "#4891c8",
    },
    environment: { STREAMLINER_LOG_LEVEL: "debug" },
    sessionStateRoot: normalizePath(join(root, "state")),
    launchMetadata: {
      launchNonce: "nonce-123",
      launchClaimRef: null,
      projectKey: "streamliner",
      workstreamId: "api-test",
      nodeId: "terminal-launch",
      targetRepoIds: ["streamliner"],
      graphPath,
      branch: "feature/terminal-launch",
      workId: "terminal-launch",
      workTitle: "Terminal Launch",
      trackerUrl: "https://github.com/lossyrob/streamliner/issues/44",
      launchPolicy: null,
    },
    contextPackage: {
      contextId: "ctx",
      contextPackagePath,
      contextFilePath,
      metadata: {
        contextId: "ctx",
        launchNonce: "nonce-123",
        launchClaimRef: null,
        projectKey: "streamliner",
        workstreamId: "api-test",
        nodeId: "terminal-launch",
        targetRepoIds: ["streamliner"],
        graphPath,
        workstreamDir: normalizePath(join(root, ".streamliner", "workstreams", "api-test")),
        repoRoot: normalizePath(root),
        generatedAt: "2026-05-04T00:00:00.000Z",
        contextPackagePath,
        contextFilePath,
        contextModel: "test",
        sourceReferences: [],
        unavailableInputs: [],
      },
      unavailableInputs: [],
    },
    ...overrides,
  };
  return base;
}

afterEach(() => {
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("appendLaunchBindingPromptLines", () => {
  it("replaces descriptive metadata and appends the canonical nonce line once", () => {
    const prompt = appendLaunchBindingPromptLines(
      "- Launch nonce: old\n- Launch claim: not-created\n",
      "nonce-123",
      "claim-1",
    );

    expect(prompt).toContain("- Launch nonce: nonce-123");
    expect(prompt).toContain("- Launch claim: claim-1");
    expect(prompt).toContain("Streamliner launch nonce: nonce-123");
    expect(prompt).toContain("Streamliner launch claim: claim-1");
    expect(prompt.match(/Streamliner launch nonce: nonce-123/g)).toHaveLength(1);
  });

  it("updates repeated descriptive metadata and rewrites canonical binding lines", () => {
    const prompt = appendLaunchBindingPromptLines(
      [
        "- Launch nonce: old",
        "- Launch claim: not-created",
        "Streamliner launch nonce: old",
        "Streamliner launch claim: not-created",
        "- Launch nonce: older",
        "- Launch claim: older-claim",
        "",
      ].join("\n"),
      "nonce-123",
      "claim-1",
    );

    expect(prompt.match(/- Launch nonce: nonce-123/g)).toHaveLength(2);
    expect(prompt.match(/- Launch claim: claim-1/g)).toHaveLength(2);
    expect(prompt.match(/Streamliner launch nonce: nonce-123/g)).toHaveLength(1);
    expect(prompt.match(/Streamliner launch claim: claim-1/g)).toHaveLength(1);
    expect(prompt).not.toContain("Streamliner launch nonce: old");
    expect(prompt).not.toContain("Streamliner launch claim: not-created");
  });

  it("normalizes CRLF prompt metadata before appending binding lines", () => {
    const prompt = appendLaunchBindingPromptLines(
      "- Launch nonce: old\r\n- Launch claim: not-created\r\n",
      "nonce-123",
      "claim-1",
    );

    expect(prompt).toBe([
      "- Launch nonce: nonce-123",
      "- Launch claim: claim-1",
      "",
      "Streamliner launch nonce: nonce-123",
      "Streamliner launch claim: claim-1",
      "",
    ].join("\n"));
  });

  it("rejects invalid multiline binding tokens", () => {
    expect(() =>
      appendLaunchBindingPromptLines("Start\n", "bad\nnonce", "claim-1")
    ).toThrow(/launch nonce/);
    expect(() =>
      appendLaunchBindingPromptLines("Start\n", "nonce-123", "bad claim")
    ).toThrow(/launch claim id/);
  });
});

describe("launchPreparedNode", () => {
  it("creates a claim before launching Copilot CLI with trusted-hook env", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalCalls: unknown[] = [];

    const result = launchPreparedNode(
      registryStore,
      claimStore,
      fakeHandoff(root),
      {
        now: () => new Date("2026-05-04T00:00:00.000Z"),
        launchTerminal: (options) => {
          terminalCalls.push(options);
          expect(claimStore.listClaims({ status: "pending" })).toHaveLength(1);
          return { method: "powershell", pid: 1234 };
        },
      },
    );

    expect(result.launchClaim.status).toBe("pending");
    expect(result.launchClaim.blocksLaunch).toBe(true);
    expect(result.command.promptNonceLine).toBe("Streamliner launch nonce: nonce-123");
    expect(terminalCalls).toHaveLength(1);
    expect(terminalCalls[0]).toEqual(expect.objectContaining({
      preferredTerminal: "powershell",
      title: "Terminal Launch",
      tabColor: "#4891c8",
      env: expect.objectContaining({
        STREAMLINER_LOG_LEVEL: "debug",
        STREAMLINER_LAUNCH_CLAIM_ID: result.launchClaim.launchClaimId,
      }),
    }));
    const claim = claimStore.getClaim(result.launchClaim.launchClaimId);
    expect(claim).toEqual(expect.objectContaining({
      launchNonce: "nonce-123",
      expectedCwd: normalizePath(root),
      expectedBranch: "feature/terminal-launch",
      status: "pending",
    }));
    expect(registryStore.listSessions()).toEqual([
      expect.objectContaining({
        title: "Terminal Launch",
        color: "#4891c8",
        originKind: "launched",
        graphBinding: expect.objectContaining({
          launchClaimId: result.launchClaim.launchClaimId,
          nodeId: "terminal-launch",
        }),
      }),
    ]);
  });

  it("marks the claim failed when terminal spawn fails", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });

    expect(() =>
      launchPreparedNode(
        registryStore,
        claimStore,
        fakeHandoff(root),
        {
          launchTerminal: () => {
            throw new Error("spawn exploded");
          },
        },
      )
    ).toThrow(NodeLaunchError);

    const [entry] = claimStore.listClaims();
    const claim = claimStore.getClaim(entry.launchClaimId);
    expect(claim).toEqual(expect.objectContaining({
      status: "failed",
      failureCode: "terminal-spawn-failed",
      failureReason: "spawn exploded",
    }));
    expect(registryStore.listSessions()).toEqual([]);
  });

  it("reports claim transition errors when terminal spawn failure cleanup fails", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const failingClaimStore: LaunchClaimStore = {
      createClaim: claimStore.createClaim.bind(claimStore),
      getClaim: claimStore.getClaim.bind(claimStore),
      listClaims: claimStore.listClaims.bind(claimStore),
      updateClaim: () => {
        throw new Error("claim store write failed");
      },
      deleteClaim: claimStore.deleteClaim.bind(claimStore),
      subscribe: claimStore.subscribe.bind(claimStore),
    };

    expect(() =>
      launchPreparedNode(
        registryStore,
        failingClaimStore,
        fakeHandoff(root),
        {
          launchTerminal: () => {
            throw new Error("spawn exploded");
          },
        },
      )
    ).toThrow(/spawn exploded; also failed to mark launch claim failed: claim store write failed/);

    const [entry] = claimStore.listClaims();
    expect(claimStore.getClaim(entry.launchClaimId)).toEqual(expect.objectContaining({
      status: "pending",
      failureCode: null,
    }));
  });

  it("rejects duplicate active launches before creating another claim", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });

    launchPreparedNode(
      registryStore,
      claimStore,
      fakeHandoff(root),
      { launchTerminal: () => ({ method: "powershell", pid: 1 }) },
    );

    expect(() =>
      launchPreparedNode(
        registryStore,
        claimStore,
        fakeHandoff(root),
        { launchTerminal: () => ({ method: "powershell", pid: 2 }) },
      )
    ).toThrow(NodeLaunchError);
    expect(claimStore.listClaims()).toHaveLength(1);
  });

  it("allows unconfigured prepared handoffs when the graph is no longer readable", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    rmSync(handoff.launchMetadata.graphPath, { force: true });
    const terminalCalls: unknown[] = [];

    const result = launchPreparedNode(
      registryStore,
      claimStore,
      handoff,
      {
        launchTerminal: (options) => {
          terminalCalls.push(options);
          return { method: "powershell", pid: 2 };
        },
      },
    );

    expect(result.launchClaim.status).toBe("pending");
    expect(terminalCalls).toHaveLength(1);
    expect(claimStore.listClaims()).toHaveLength(1);
  });

  it("fails closed when a prepared handoff had a launch policy but the graph is unreadable", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    handoff.launchMetadata.launchPolicy = { requiredTracker: "github-issue" };
    rmSync(handoff.launchMetadata.graphPath, { force: true });

    let blockedError: unknown;
    try {
      launchPreparedNode(
        registryStore,
        claimStore,
        handoff,
        { launchTerminal: () => ({ method: "powershell", pid: 2 }) },
      );
    } catch (error: unknown) {
      blockedError = error;
    }

    expect(blockedError).toBeInstanceOf(NodeLaunchError);
    expect(blockedError).toMatchObject({
      code: "launch_policy_unavailable",
      details: expect.objectContaining({
        reason: "graph_not_found",
        nodeId: "terminal-launch",
      }),
    });
    expect(claimStore.listClaims()).toHaveLength(0);
    expect(registryStore.listSessions()).toEqual([]);
  });

  it("blocks stale prepared handoffs before creating a launch claim", () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    writeNodeLaunchGraph(root, {
      launchPolicy: { requiredTracker: "github-issue" },
    });
    const terminalCalls: unknown[] = [];

    expect(() =>
      launchPreparedNode(
        registryStore,
        claimStore,
        handoff,
        {
          launchTerminal: (options) => {
            terminalCalls.push(options);
            return { method: "powershell", pid: 2 };
          },
        },
      )
    ).toThrow(NodeLaunchError);

    let blockedError: unknown;
    try {
      launchPreparedNode(
        registryStore,
        claimStore,
        handoff,
        { launchTerminal: () => ({ method: "powershell", pid: 3 }) },
      );
    } catch (error: unknown) {
      blockedError = error;
    }
    expect(blockedError).toMatchObject({
      code: "launch_policy_blocked",
      statusCode: 412,
      details: expect.objectContaining({
        policyCode: "github_issue_tracker_required",
        requiredTracker: "github-issue",
        nodeId: "terminal-launch",
      }),
    });
    expect(terminalCalls).toHaveLength(0);
    expect(claimStore.listClaims()).toHaveLength(0);
    expect(registryStore.listSessions()).toEqual([]);
  });
});

describe("node launch API route", () => {
  it("rejects non-loopback callers", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 777 }),
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launches")
      .set("x-forwarded-for", "8.8.8.8")
      .send({ handoff: fakeHandoff(root) })
      .expect(403);

    expect(response.body).toEqual({
      error: "Node launch must originate from loopback.",
    });
    expect(claimStore.listClaims()).toHaveLength(0);
  });

  it("launches a prepared handoff through POST /api/node-launches", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 777 }),
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff: fakeHandoff(root) })
      .expect(201);

    expect(response.body).toEqual(expect.objectContaining({
      launchClaim: expect.objectContaining({
        status: "pending",
        blocksLaunch: true,
      }),
      terminal: {
        method: "powershell",
        pid: 777,
      },
    }));
    expect(registryStore.listSessions()).toEqual([
      expect.objectContaining({
        title: "Terminal Launch",
        color: "#4891c8",
      }),
    ]);
    const operation = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath: fakeHandoff(root).launchMetadata.graphPath,
        nodeId: "terminal-launch",
      })
      .expect(200);
    expect(operation.body.operation).toEqual(expect.objectContaining({
      status: "launched_pending_binding",
      terminalLaunch: expect.objectContaining({
        terminal: {
          method: "powershell",
          pid: 777,
        },
      }),
      latestClaim: expect.objectContaining({
        status: "pending",
        blocksLaunch: true,
      }),
    }));
  });

  it("clears stale managed runtime metadata when a node is prepared for terminal launch", async () => {
    const root = createRootDir();
    const recordsPath = join(root, "state", "node-launch-records.json");
    mkdirSync(join(root, "state"), { recursive: true });
    const handoff = fakeHandoff(root);
    const managedRuntime = {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "running",
      lifecycleUpdatedAt: "2026-05-05T12:00:00.000Z",
    };
    writeFileSync(
      recordsPath,
      JSON.stringify({
        version: 1,
        records: [
          {
            id: "existing-managed-record",
            graphPath: handoff.launchMetadata.graphPath,
            nodeId: handoff.launchMetadata.nodeId,
            projectKey: handoff.launchMetadata.projectKey,
            workstreamId: handoff.launchMetadata.workstreamId,
            branch: handoff.branch,
            workId: handoff.launchMetadata.workId,
            workTitle: handoff.launchMetadata.workTitle,
            cwd: handoff.cwd,
            pawWorkDir: handoff.pawWorkDir,
            workflowContextPath: handoff.workflowContextPath,
            streamlinerContextPath: handoff.streamlinerContextPath,
            contextPackagePath: handoff.contextPackage.contextPackagePath,
            contextFilePath: handoff.contextPackage.contextFilePath,
            runtimeKind: "managed-sdk",
            permissionProfile: "managed-autonomous",
            managedRuntime,
            launchNonce: handoff.launchMetadata.launchNonce,
            launchClaimRef: handoff.launchMetadata.launchClaimRef,
            trackerUrl: handoff.launchMetadata.trackerUrl,
            createdAt: "2026-05-05T12:00:00.000Z",
            updatedAt: "2026-05-05T12:00:00.000Z",
          },
        ],
        operations: [
          {
            id: "existing-managed-record",
            graphPath: handoff.launchMetadata.graphPath,
            nodeId: handoff.launchMetadata.nodeId,
            status: "bound",
            preparationRunId: null,
            startedAt: "2026-05-05T12:00:00.000Z",
            updatedAt: "2026-05-05T12:00:00.000Z",
            completedAt: "2026-05-05T12:00:00.000Z",
            handoff: {
              ...handoff,
              runtimeKind: "managed-sdk",
              permissionProfile: "managed-autonomous",
            },
            terminalLaunch: null,
            managedRuntime,
            error: null,
            progressEvents: [],
          },
        ],
      }),
      "utf8",
    );
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({ recordsPath });

    await nodeLaunchRecordStore.markPreparationSucceeded(handoff);

    const record = await nodeLaunchRecordStore.get(
      handoff.launchMetadata.graphPath,
      handoff.launchMetadata.nodeId,
    );
    const operation = await nodeLaunchRecordStore.getOperation(
      handoff.launchMetadata.graphPath,
      handoff.launchMetadata.nodeId,
    );
    expect(record?.runtimeKind).toBe("terminal-cli");
    expect(record?.managedRuntime).toBeNull();
    expect(operation?.managedRuntime).toBeNull();
  });

  it("does not let a later terminal failure clobber a successful launch operation", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const handoff = fakeHandoff(root);

    await nodeLaunchRecordStore.markTerminalLaunching(handoff);
    const terminalLaunch = launchPreparedNode(
      registryStore,
      claimStore,
      handoff,
      {
        launchTerminal: () => ({ method: "powershell", pid: 777 }),
      },
    );
    await nodeLaunchRecordStore.markTerminalLaunched(handoff, terminalLaunch);
    await nodeLaunchRecordStore.markTerminalFailed({
      handoff,
      error: {
        code: "terminal_spawn_failed",
        error: "late losing request failed",
      },
    });

    const operation = await nodeLaunchRecordStore.getOperation(
      handoff.launchMetadata.graphPath,
      handoff.launchMetadata.nodeId,
    );
    expect(operation).toEqual(expect.objectContaining({
      status: "launched_pending_binding",
      terminalLaunch: expect.objectContaining({
        terminal: {
          method: "powershell",
          pid: 777,
        },
      }),
      error: null,
    }));
  });

  it("returns the blocking claim summary on duplicate launches", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 777 }),
      },
    });
    activeApps.push(api);

    const firstResponse = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff: fakeHandoff(root) })
      .expect(201);
    const duplicateResponse = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff: fakeHandoff(root) })
      .expect(409);

    expect(duplicateResponse.body).toEqual(expect.objectContaining({
      code: "duplicate_active_launch",
      launchClaim: expect.objectContaining({
        launchClaimId: firstResponse.body.launchClaim.launchClaimId,
        blocksLaunch: true,
        retryable: false,
        status: "pending",
      }),
    }));
    expect(claimStore.listClaims()).toHaveLength(1);
  });

  it("returns a typed policy error through POST /api/node-launches", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    writeNodeLaunchGraph(root, {
      launchPolicy: { requiredTracker: "github-issue" },
    });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 777 }),
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff })
      .expect(412);

    expect(response.body).toEqual(expect.objectContaining({
      code: "launch_policy_blocked",
      error: expect.stringContaining("requires a GitHub issue tracker"),
      details: expect.objectContaining({
        policyCode: "github_issue_tracker_required",
        requiredTracker: "github-issue",
        nodeId: "terminal-launch",
      }),
    }));
    expect(claimStore.listClaims()).toHaveLength(0);
    expect(registryStore.listSessions()).toEqual([]);
  });
});
