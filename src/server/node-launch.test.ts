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
  launchManagedSdkNode,
  launchPreparedNode,
  NodeLaunchError,
} from "./node-launch";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import {
  DuplicateActiveNodeLaunchOperationError,
  NodeLaunchRecordStore,
} from "./node-launch-record-store";
import type { ManagedSdkRunner, ManagedSdkRunnerStartInput } from "./managed-sdk-runner";

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
  it("creates a claim before launching Copilot CLI with trusted-hook env", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalCalls: unknown[] = [];

    const result = await launchPreparedNode(
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

  it("marks the claim failed when terminal spawn fails", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });

    await expect(
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
    ).rejects.toThrow(NodeLaunchError);

    const [entry] = claimStore.listClaims();
    const claim = claimStore.getClaim(entry.launchClaimId);
    expect(claim).toEqual(expect.objectContaining({
      status: "failed",
      failureCode: "terminal-spawn-failed",
      failureReason: "spawn exploded",
    }));
    expect(registryStore.listSessions()).toEqual([]);
  });

  it("reports claim transition errors when terminal spawn failure cleanup fails", async () => {
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

    await expect(
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
    ).rejects.toThrow(/spawn exploded; also failed to mark launch claim failed: claim store write failed/);

    const [entry] = claimStore.listClaims();
    expect(claimStore.getClaim(entry.launchClaimId)).toEqual(expect.objectContaining({
      status: "pending",
      failureCode: null,
    }));
  });

  it("rejects duplicate active launches before creating another claim", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });

    await launchPreparedNode(
      registryStore,
      claimStore,
      fakeHandoff(root),
      { launchTerminal: () => ({ method: "powershell", pid: 1 }) },
    );

    await expect(
      launchPreparedNode(
        registryStore,
        claimStore,
        fakeHandoff(root),
        { launchTerminal: () => ({ method: "powershell", pid: 2 }) },
      )
    ).rejects.toThrow(NodeLaunchError);
    expect(claimStore.listClaims()).toHaveLength(1);
  });

  it("atomically rejects duplicate active launch operation reservations", async () => {
    const root = createRootDir();
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const handoff = fakeHandoff(root, { runtimeKind: "managed-sdk" });

    const results = await Promise.allSettled([
      nodeLaunchRecordStore.markManagedStarting(handoff),
      nodeLaunchRecordStore.markManagedStarting(handoff),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual(expect.objectContaining({
      reason: expect.any(DuplicateActiveNodeLaunchOperationError),
    }));
    const operation = await nodeLaunchRecordStore.getOperation(
      handoff.launchMetadata.graphPath,
      handoff.launchMetadata.nodeId,
    );
    expect(operation).toEqual(expect.objectContaining({
      status: "managed_starting",
    }));
  });

  it("reports managed start cleanup failures after preserving claim failure", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const runner: ManagedSdkRunner = {
      start: async (input) => {
        registryStore.archiveSession(input.registryId);
        throw new Error("sdk exploded");
      },
    };

    await expect(launchManagedSdkNode(
      registryStore,
      claimStore,
      fakeHandoff(root, { runtimeKind: "managed-sdk" }),
      { managedSdkRunner: runner },
    )).rejects.toThrow(/sdk exploded; also failed to record managed runtime failure/);

    const [claimEntry] = claimStore.listClaims();
    expect(claimEntry).toEqual(expect.objectContaining({ status: "failed" }));
    expect(claimStore.getClaim(claimEntry.launchClaimId)).toEqual(expect.objectContaining({
      failureCode: "internal-error",
    }));
  });

  it("allows unconfigured prepared handoffs when the graph is no longer readable", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    rmSync(handoff.launchMetadata.graphPath, { force: true });
    const terminalCalls: unknown[] = [];

    const result = await launchPreparedNode(
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

  it("fails closed when a prepared handoff had a launch policy but the graph is unreadable", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    handoff.launchMetadata.launchPolicy = { requiredTracker: "github-issue" };
    rmSync(handoff.launchMetadata.graphPath, { force: true });

    let blockedError: unknown;
    try {
      await launchPreparedNode(
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

  it("blocks stale prepared handoffs before creating a launch claim", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const handoff = fakeHandoff(root);
    writeNodeLaunchGraph(root, {
      launchPolicy: { requiredTracker: "github-issue" },
    });
    const terminalCalls: unknown[] = [];

    await expect(
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
    ).rejects.toThrow(NodeLaunchError);

    let blockedError: unknown;
    try {
      await launchPreparedNode(
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

describe("launchManagedSdkNode", () => {
  it("reserves a canonical row and starts the SDK runner with launch-claim env", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const startInputs: ManagedSdkRunnerStartInput[] = [];
    const runner: ManagedSdkRunner = {
      start: async (input) => {
        startInputs.push(input);
        input.onProgress({
          type: "tool_started",
          message: "Tool started.",
          data: {
            toolName: "powershell",
            args: "raw command should not persist",
          },
        });
        input.onEvidence({
          kind: "pr_ready",
          source: "test-runner",
          url: "https://github.com/lossyrob/streamliner/pull/73",
          repo: "lossyrob/streamliner",
          number: 73,
          summary: "PR ready.",
        });
        const result = {
          registryId: input.registryId,
          sdkSessionId: "sdk-session-73",
          sdkWorkspacePath: normalizePath(join(root, "sdk", "workspace.yaml")),
          sdkStateRoot: normalizePath(join(root, "sdk")),
        };
        input.onStarted(result);
        return result;
      },
    };

    const result = await launchManagedSdkNode(
      registryStore,
      claimStore,
      fakeHandoff(root, { runtimeKind: "managed-sdk" }),
      {
        now: () => new Date("2026-05-07T12:00:00.000Z"),
        managedSdkRunner: runner,
      },
    );

    expect(result.runtimeKind).toBe("managed-sdk");
    expect(result.managedSdk).toEqual(expect.objectContaining({
      registryId: result.launchClaim.reservedRegistryId,
      sdkSessionId: "sdk-session-73",
      permissionProfile: "managed-autonomous",
    }));
    expect(startInputs).toHaveLength(1);
    expect(startInputs[0].environment).toEqual(expect.objectContaining({
      STREAMLINER_LOG_LEVEL: "debug",
      STREAMLINER_LAUNCH_CLAIM_ID: result.launchClaim.launchClaimId,
      STREAMLINER_MANAGED_RUNTIME_KIND: "managed-sdk",
      STREAMLINER_MANAGED_PERMISSION_PROFILE: "managed-autonomous",
    }));
    expect(startInputs[0].prompt).toContain(
      `Streamliner launch claim: ${result.launchClaim.launchClaimId}`,
    );

    const record = registryStore.getSession(result.managedSdk.registryId);
    expect(record?.runtime).toEqual(expect.objectContaining({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: result.launchClaim.launchClaimId,
      launchNonce: claimStore.getClaim(result.launchClaim.launchClaimId)?.launchNonce,
      sdkSessionId: "sdk-session-73",
    }));
    expect(record?.runtime?.progressEvents.some((event) =>
      event.type === "tool_started" && event.data?.toolName === "powershell"
    )).toBe(true);
    expect(record?.runtime?.progressEvents.some((event) =>
      Object.prototype.hasOwnProperty.call(event.data ?? {}, "args")
    )).toBe(false);
    expect(record?.runtime?.evidence).toEqual([
      expect.objectContaining({
        kind: "pr_ready",
        number: 73,
      }),
    ]);
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

  it("launches a managed SDK handoff through POST /api/node-launches", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const runner: ManagedSdkRunner = {
      start: async (input) => {
        const result = {
          registryId: input.registryId,
          sdkSessionId: "sdk-route-session",
          sdkWorkspacePath: normalizePath(join(root, "sdk", "workspace.yaml")),
          sdkStateRoot: normalizePath(join(root, "sdk")),
        };
        input.onStarted(result);
        return result;
      },
    };
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        managedSdkRunner: runner,
      },
    });
    activeApps.push(api);
    const handoff = fakeHandoff(root, { runtimeKind: "managed-sdk" });

    const response = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff })
      .expect(201);

    expect(response.body).toEqual(expect.objectContaining({
      runtimeKind: "managed-sdk",
      managedSdk: expect.objectContaining({
        sdkSessionId: "sdk-route-session",
        permissionProfile: "managed-autonomous",
      }),
    }));
    expect(response.body).not.toHaveProperty("terminal");

    const operation = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath: handoff.launchMetadata.graphPath,
        nodeId: "terminal-launch",
      })
      .expect(200);
    expect(operation.body.operation).toEqual(expect.objectContaining({
      status: "managed_running",
      managedLaunch: expect.objectContaining({
        sdkSessionId: "sdk-route-session",
        registryId: response.body.managedSdk.registryId,
      }),
      latestClaim: expect.objectContaining({
        status: "pending",
        blocksLaunch: true,
      }),
    }));
  });

  it("allows relaunch after a managed operation reaches a terminal lifecycle state", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    let now = new Date();
    let startCount = 0;
    const runner: ManagedSdkRunner = {
      start: async (input) => {
        startCount += 1;
        const result = {
          registryId: input.registryId,
          sdkSessionId: `sdk-relaunch-${startCount}`,
          sdkWorkspacePath: normalizePath(join(root, "sdk", `workspace-${startCount}.yaml`)),
          sdkStateRoot: normalizePath(join(root, "sdk")),
        };
        input.onStarted(result);
        input.onLifecycleState("completed", "Managed SDK worker completed.");
        return result;
      },
    };
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        managedSdkRunner: runner,
        now: () => now,
      },
    });
    activeApps.push(api);
    const handoff = fakeHandoff(root, { runtimeKind: "managed-sdk" });

    const firstResponse = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff })
      .expect(201);
    now = new Date(Date.now() + 10 * 60 * 1000);
    const secondResponse = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff })
      .expect(201);

    expect(startCount).toBe(2);
    expect(firstResponse.body.managedSdk.sdkSessionId).toBe("sdk-relaunch-1");
    expect(secondResponse.body.managedSdk.sdkSessionId).toBe("sdk-relaunch-2");
  });

  it("does not let archived managed runtime metadata block a replacement launch", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const runner: ManagedSdkRunner = {
      start: async (input) => {
        const result = {
          registryId: input.registryId,
          sdkSessionId: "sdk-after-archive",
          sdkWorkspacePath: normalizePath(join(root, "sdk", "workspace.yaml")),
          sdkStateRoot: normalizePath(join(root, "sdk")),
        };
        input.onStarted(result);
        return result;
      },
    };
    const staleRecord = registryStore.upsertSession({
      id: "archived-running-managed-row",
      title: "Archived running managed row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "stale-claim" },
      graphBinding: {
        workstreamId: "api-test",
        nodeId: "terminal-launch",
        launchClaimId: "stale-claim",
      },
    });
    registryStore.patchRuntimeMetadata(staleRecord.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "stale-claim",
      launchNonce: "stale-nonce",
    });
    registryStore.archiveSession(staleRecord.id);
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        managedSdkRunner: runner,
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launches")
      .send({ handoff: fakeHandoff(root, { runtimeKind: "managed-sdk" }) })
      .expect(201);

    expect(response.body.managedSdk).toEqual(expect.objectContaining({
      sdkSessionId: "sdk-after-archive",
    }));
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
    const terminalLaunch = await launchPreparedNode(
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

  it("does not let a later managed failure clobber a successful launch operation", async () => {
    const root = createRootDir();
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const handoff = fakeHandoff(root, { runtimeKind: "managed-sdk" });
    const now = new Date().toISOString();

    await nodeLaunchRecordStore.markManagedStarting(handoff);
    await nodeLaunchRecordStore.markManagedRunning(handoff, {
      launchClaim: {
        launchClaimId: "claim-managed-success",
        status: "pending",
        launchedAt: now,
        updatedAt: now,
        bindingWindowExpiresAt: now,
        reservedRegistryId: "registry-managed-success",
        boundRegistryId: null,
        boundCopilotSessionId: null,
        failureCode: null,
        failureReason: null,
        blocksLaunch: true,
        retryable: false,
      },
      runtimeKind: "managed-sdk",
      registryId: "registry-managed-success",
      sdkSessionId: "sdk-managed-success",
      sdkWorkspacePath: null,
      sdkStateRoot: null,
      permissionProfile: "managed-autonomous",
    });
    await nodeLaunchRecordStore.markManagedFailed({
      handoff,
      error: {
        code: "managed_sdk_start_failed",
        error: "late losing request failed",
      },
    });

    const operation = await nodeLaunchRecordStore.getOperation(
      handoff.launchMetadata.graphPath,
      handoff.launchMetadata.nodeId,
    );
    expect(operation).toEqual(expect.objectContaining({
      status: "managed_running",
      managedLaunch: expect.objectContaining({
        sdkSessionId: "sdk-managed-success",
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

describe("managed runtime session API routes", () => {
  it("records evidence and interrupts managed SDK sessions", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const runner: ManagedSdkRunner = {
      start: async (input) => ({
        registryId: input.registryId,
        sdkSessionId: null,
        sdkWorkspacePath: null,
        sdkStateRoot: null,
      }),
      interrupt: async (input) => ({
        ok: true,
        evidenceState: "interrupted",
        message: input.reason ?? "Interrupted.",
      }),
    };
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        managedSdkRunner: runner,
      },
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-route-row",
      title: "Managed route row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-route" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-1",
        launchClaimId: "claim-route",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-route",
      launchNonce: "nonce-route",
    });

    const evidenceResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/evidence`)
      .send({
        kind: "review_ready",
        source: "test",
        summary: "Ready for review.",
      })
      .expect(200);

    expect(evidenceResponse.body.runtime).toEqual(expect.objectContaining({
      lifecycleState: "review_ready",
      evidence: [
        expect.objectContaining({
          kind: "review_ready",
          source: "test",
          summary: "Ready for review.",
        }),
      ],
    }));

    const interruptResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/interrupt`)
      .send({ reason: "Need builder review." })
      .expect(200);

    expect(interruptResponse.body).toEqual(expect.objectContaining({
      outcome: {
        ok: true,
        evidenceState: "interrupted",
        message: "Need builder review.",
      },
      session: expect.objectContaining({
        runtime: expect.objectContaining({
          lifecycleState: "interrupted",
        }),
      }),
    }));
  });

  it("rejects malformed managed runtime evidence input", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-evidence-validation-row",
      title: "Managed evidence validation row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-evidence-validation" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-1",
        launchClaimId: "claim-evidence-validation",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-evidence-validation",
      launchNonce: "nonce-evidence-validation",
    });

    await request(api.app)
      .post(`/api/sessions/${record.id}/managed/evidence`)
      .send({ kind: "pr_ready", source: "test", number: "123" })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toContain("number must be a positive safe integer");
      });

    await request(api.app)
      .post(`/api/sessions/${record.id}/managed/evidence`)
      .send({ kind: "pr_ready", source: "test", detectedAt: "not-a-date" })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toContain("detectedAt must be a valid timestamp");
      });

    await request(api.app)
      .post(`/api/sessions/${record.id}/managed/evidence`)
      .send({ kind: "pr_ready", source: "test", sha: "" })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toContain("sha must be non-empty");
      });

    await request(api.app)
      .post(`/api/sessions/${record.id}/managed/evidence`)
      .send({ kind: "pr_ready", source: "x".repeat(1025) })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toContain("source is too long");
      });
  });

  it("returns a canceled outcome when cancel persists the canceled lifecycle", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const runner: ManagedSdkRunner = {
      start: async (input) => ({
        registryId: input.registryId,
        sdkSessionId: null,
        sdkWorkspacePath: null,
        sdkStateRoot: null,
      }),
      interrupt: async () => ({
        ok: true,
        evidenceState: "interrupted",
        message: "Interrupted.",
      }),
    };
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        managedSdkRunner: runner,
      },
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-cancel-row",
      title: "Managed cancel row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-cancel" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-cancel",
        launchClaimId: "claim-cancel",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-cancel",
      launchNonce: "nonce-cancel",
    });

    const cancelResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/cancel`)
      .send({})
      .expect(200);

    expect(cancelResponse.body).toEqual(expect.objectContaining({
      outcome: {
        ok: true,
        evidenceState: "canceled",
        message: "Managed SDK run canceled by builder action.",
      },
      session: expect.objectContaining({
        runtime: expect.objectContaining({
          lifecycleState: "canceled",
        }),
      }),
    }));
  });

  it("opens visible terminal takeover for the exact SDK session", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const interrupts: string[] = [];
    let launchedCommand: string | undefined;
    const runner: ManagedSdkRunner = {
      start: async (input) => ({
        registryId: input.registryId,
        sdkSessionId: "sdk-session-123",
        sdkWorkspacePath: null,
        sdkStateRoot: null,
      }),
      interrupt: async (input) => {
        interrupts.push(input.registryId);
        return {
          ok: true,
          evidenceState: "interrupted",
          message: input.reason ?? "Interrupted.",
        };
      },
    };
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      now: () => new Date("2026-05-07T12:00:00.000Z"),
      relaunchDeps: {
        launchTerminal: (options) => {
          launchedCommand = options.command;
          return { method: "powershell", pid: 4242 };
        },
      },
      nodeLaunchDeps: {
        managedSdkRunner: runner,
      },
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-takeover-row",
      title: "Managed takeover row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-takeover" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-takeover",
        launchClaimId: "claim-takeover",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-takeover",
      launchNonce: "nonce-takeover",
      sdkSessionId: "sdk-session-123",
    });

    const takeoverResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/takeover`)
      .send({})
      .expect(200);

    expect(interrupts).toEqual([record.id]);
    expect(launchedCommand).toContain("sdk-session-123");
    expect(takeoverResponse.body).toEqual(expect.objectContaining({
      outcome: expect.objectContaining({
        ok: true,
        evidenceState: "terminal_takeover",
      }),
      terminal: expect.objectContaining({
        copilotResumed: true,
        pid: 4242,
      }),
      session: expect.objectContaining({
        copilotSessionId: "sdk-session-123",
        copilotProcessState: "live",
        runtime: expect.objectContaining({
          runtimeOwner: "builder-terminal",
          lifecycleState: "terminal_takeover",
        }),
      }),
    }));

    const resumedSignalRecord = registryStore.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "sdk-session-123",
      timestamp: "2026-05-07T12:00:05.000Z",
      cwd: normalizePath(root),
      repo: "lossyrob/streamliner",
      branch: "feature/takeover",
      hookSource: "resume",
      executionKind: "copilot_cli",
    });
    expect(resumedSignalRecord.id).toBe(record.id);
    expect(registryStore.listSessions({ includeArchived: false })).toHaveLength(1);
    expect(registryStore.getSession(record.id)).toEqual(expect.objectContaining({
      copilotSessionId: "sdk-session-123",
      runtime: expect.objectContaining({
        runtimeOwner: "builder-terminal",
        lifecycleState: "terminal_takeover",
      }),
    }));
  });

  it("opens terminal takeover when SDK interruption is inconclusive", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      relaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 4243 }),
      },
      nodeLaunchDeps: {
        managedSdkRunner: {
          start: async (input) => ({
            registryId: input.registryId,
            sdkSessionId: "sdk-session-inconclusive",
            sdkWorkspacePath: null,
            sdkStateRoot: null,
          }),
          interrupt: async () => ({
            ok: false,
            evidenceState: "waiting_for_builder",
            message: "SDK abort timed out.",
          }),
        },
      },
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-takeover-inconclusive-interrupt-row",
      title: "Managed takeover inconclusive interrupt row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-takeover-inconclusive" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-takeover-inconclusive",
        launchClaimId: "claim-takeover-inconclusive",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-takeover-inconclusive",
      launchNonce: "nonce-takeover-inconclusive",
      sdkSessionId: "sdk-session-inconclusive",
    });

    const takeoverResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/takeover`)
      .send({})
      .expect(200);

    expect(takeoverResponse.body).toEqual(expect.objectContaining({
      outcome: expect.objectContaining({
        ok: true,
        evidenceState: "terminal_takeover",
        interrupt: expect.objectContaining({
          ok: false,
          message: "SDK abort timed out.",
        }),
      }),
      session: expect.objectContaining({
        copilotSessionId: "sdk-session-inconclusive",
        runtime: expect.objectContaining({
          runtimeOwner: "builder-terminal",
          lifecycleState: "terminal_takeover",
          progressEvents: expect.arrayContaining([
            expect.objectContaining({
              type: "terminal_takeover",
              message: expect.stringContaining("SDK interruption was inconclusive"),
            }),
          ]),
        }),
      }),
    }));
  });

  it("fails terminal takeover closed when no SDK session id is known", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-takeover-missing-sdk-row",
      title: "Managed takeover missing SDK row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-takeover-missing-sdk" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-takeover-missing-sdk",
        launchClaimId: "claim-takeover-missing-sdk",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-takeover-missing-sdk",
      launchNonce: "nonce-takeover-missing-sdk",
    });

    const takeoverResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/takeover`)
      .send({})
      .expect(409);

    expect(takeoverResponse.body.error).toContain("requires an SDK session id");
    expect(takeoverResponse.body.session.runtime.lifecycleState).toBe("failed");
  });

  it("runs guarded cleanup after merged PR verification", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const gitCalls: string[] = [];
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      managedCleanupDeps: {
        cwd: normalizePath(join(root, "api")),
        existsSync: () => true,
        runGh: () => ({
          status: 0,
          stdout: JSON.stringify({
            state: "MERGED",
            mergedAt: "2026-05-07T12:00:00Z",
            headRefOid: "abc123",
            url: "https://github.com/lossyrob/streamliner/pull/75",
          }),
          stderr: "",
        }),
        runGit: (cwd, args) => {
          gitCalls.push(`${normalizePath(cwd)} git ${args.join(" ")}`);
          if (args.join(" ") === "rev-parse --show-toplevel") {
            return { status: 0, stdout: normalizePath(root), stderr: "" };
          }
          if (args.join(" ") === "worktree list --porcelain") {
            return {
              status: 0,
              stdout: [
                `worktree ${normalizePath(root)}`,
                "HEAD abc123",
                "branch refs/heads/feature/cleanup",
                "",
              ].join("\n"),
              stderr: "",
            };
          }
          if (args.join(" ") === "status --porcelain=v1 --untracked-files=normal") {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (args.join(" ") === "rev-parse feature/cleanup") {
            return { status: 0, stdout: "abc123\n", stderr: "" };
          }
          if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/cleanup") {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (args.join(" ") === `worktree remove ${normalizePath(root)}`) {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (args.join(" ") === "branch -d feature/cleanup") {
            return { status: 0, stdout: "", stderr: "" };
          }
          return { status: 1, stdout: "", stderr: `Unexpected git command: ${args.join(" ")}` };
        },
      },
    });
    activeApps.push(api);
    const record = registryStore.upsertSession({
      id: "managed-cleanup-row",
      title: "Managed cleanup row",
      description: "",
      cwd: normalizePath(root),
      branch: "feature/cleanup",
      origin: { kind: "launched", launchClaimId: "claim-cleanup" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-cleanup",
        launchClaimId: "claim-cleanup",
      },
    });
    registryStore.patchRuntimeMetadata(record.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "builder-terminal",
      lifecycleState: "cleanup_ready",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-cleanup",
      launchNonce: "nonce-cleanup",
      evidence: [{
        kind: "cleanup_ready",
        source: "test",
        repo: "lossyrob/streamliner",
        number: 75,
        sha: "abc123",
        url: "https://github.com/lossyrob/streamliner/pull/75",
        summary: "PR merged.",
      }],
    });

    const cleanupResponse = await request(api.app)
      .post(`/api/sessions/${record.id}/managed/cleanup`)
      .send({})
      .expect(200);

    expect(cleanupResponse.body).toEqual(expect.objectContaining({
      outcome: expect.objectContaining({
        ok: true,
        evidenceState: "cleaned_up",
        removedWorktree: true,
        deletedBranch: true,
      }),
      session: expect.objectContaining({
        runtime: expect.objectContaining({
          lifecycleState: "cleaned_up",
          evidence: expect.arrayContaining([
            expect.objectContaining({ kind: "cleaned_up", number: 75 }),
          ]),
        }),
      }),
    }));
    expect(gitCalls.some((call) => call.endsWith("git branch -d feature/cleanup"))).toBe(true);
  });

  it("settles managed interrupt and cancel failures to terminal states", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const runner: ManagedSdkRunner = {
      start: async (input) => ({
        registryId: input.registryId,
        sdkSessionId: null,
        sdkWorkspacePath: null,
        sdkStateRoot: null,
      }),
      interrupt: async () => {
        throw new Error("SDK abort failed.");
      },
    };
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        managedSdkRunner: runner,
      },
    });
    activeApps.push(api);
    const interruptRecord = registryStore.upsertSession({
      id: "managed-interrupt-failure-row",
      title: "Managed interrupt failure row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-interrupt-failure" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-interrupt-failure",
        launchClaimId: "claim-interrupt-failure",
      },
    });
    const cancelRecord = registryStore.upsertSession({
      id: "managed-cancel-absent-runner-row",
      title: "Managed cancel absent runner row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-cancel-absent-runner" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-cancel-absent-runner",
        launchClaimId: "claim-cancel-absent-runner",
      },
    });
    for (const record of [interruptRecord, cancelRecord]) {
      registryStore.patchRuntimeMetadata(record.id, {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        permissionProfile: "managed-autonomous",
        launchClaimId: record.graphBinding?.launchClaimId ?? null,
        launchNonce: "nonce-route",
      });
    }

    const interruptResponse = await request(api.app)
      .post(`/api/sessions/${interruptRecord.id}/managed/interrupt`)
      .send({})
      .expect(200);
    expect(interruptResponse.body).toEqual(expect.objectContaining({
      outcome: expect.objectContaining({
        ok: false,
        evidenceState: "failed",
        message: "SDK abort failed.",
      }),
      session: expect.objectContaining({
        runtime: expect.objectContaining({
          lifecycleState: "failed",
        }),
      }),
    }));

    const noInterruptRunnerApi = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records-2.json"),
      nodeLaunchDeps: {
        managedSdkRunner: {
          start: async (input) => ({
            registryId: input.registryId,
            sdkSessionId: null,
            sdkWorkspacePath: null,
            sdkStateRoot: null,
          }),
        },
      },
    });
    activeApps.push(noInterruptRunnerApi);
    const cancelResponse = await request(noInterruptRunnerApi.app)
      .post(`/api/sessions/${cancelRecord.id}/managed/cancel`)
      .send({})
      .expect(200);
    expect(cancelResponse.body).toEqual(expect.objectContaining({
      outcome: {
        ok: false,
        evidenceState: "canceled",
        message: "No managed SDK runner is attached to this API process.; recorded cancellation.",
      },
      session: expect.objectContaining({
        runtime: expect.objectContaining({
          lifecycleState: "canceled",
        }),
      }),
    }));
  });

  it("rejects managed runtime actions for missing, archived, and non-managed sessions", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
    });
    activeApps.push(api);
    const nonManagedRecord = registryStore.upsertSession({
      id: "terminal-route-row",
      title: "Terminal route row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-terminal" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-terminal",
        launchClaimId: "claim-terminal",
      },
    });
    const archivedRecord = registryStore.upsertSession({
      id: "archived-managed-route-row",
      title: "Archived managed route row",
      description: "",
      cwd: normalizePath(root),
      origin: { kind: "launched", launchClaimId: "claim-archived" },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-archived",
        launchClaimId: "claim-archived",
      },
    });
    registryStore.patchRuntimeMetadata(archivedRecord.id, {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      lifecycleState: "running",
      permissionProfile: "managed-autonomous",
      launchClaimId: "claim-archived",
      launchNonce: "nonce-archived",
    });
    registryStore.archiveSession(archivedRecord.id);

    const nonManagedResponse = await request(api.app)
      .post(`/api/sessions/${nonManagedRecord.id}/managed/evidence`)
      .send({ kind: "completed" })
      .expect(409);
    const missingResponse = await request(api.app)
      .post("/api/sessions/missing-managed-row/managed/evidence")
      .send({ kind: "completed" })
      .expect(404);
    const archivedResponse = await request(api.app)
      .post(`/api/sessions/${archivedRecord.id}/managed/interrupt`)
      .send({})
      .expect(409);

    expect(nonManagedResponse.body.error).toContain("not a Streamliner-managed SDK runtime");
    expect(missingResponse.body.error).toContain("does not exist");
    expect(archivedResponse.body.error).toContain("Archived session");
    expect(registryStore.getSession(nonManagedRecord.id)?.runtime ?? null).toBeNull();
  });

  it("rejects managed runtime actions from non-loopback or non-JSON requests", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
    });
    activeApps.push(api);
    const paths = [
      "/api/sessions/guarded-managed-row/managed/interrupt",
      "/api/sessions/guarded-managed-row/managed/cancel",
      "/api/sessions/guarded-managed-row/managed/takeover",
      "/api/sessions/guarded-managed-row/managed/cleanup",
      "/api/sessions/guarded-managed-row/managed/evidence",
    ];

    for (const path of paths) {
      const nonLoopbackResponse = await request(api.app)
        .post(path)
        .set("X-Forwarded-For", "203.0.113.10")
        .send({})
        .expect(403);
      expect(nonLoopbackResponse.body.error).toContain("loopback");

      const contentTypeResponse = await request(api.app)
        .post(path)
        .set("Content-Type", "text/plain")
        .send("not-json")
        .expect(415);
      expect(contentTypeResponse.body.error).toContain("Content-Type must be application/json");
    }
  });
});
