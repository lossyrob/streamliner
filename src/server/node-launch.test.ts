import { mkdirSync, rmSync } from "node:fs";
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

function fakeHandoff(root: string, overrides: Partial<PawLaunchHandoff> = {}): PawLaunchHandoff {
  const graphPath = normalizePath(join(root, ".streamliner", "workstreams", "api-test", "graph.json"));
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
    terminal: { launchMode: "manual", preferredTerminal: "powershell" },
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
});

describe("node launch API route", () => {
  it("rejects non-loopback callers", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
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
  });

  it("returns the blocking claim summary on duplicate launches", async () => {
    const root = createRootDir();
    const registryStore = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const api = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
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
});
