import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type {
  LaunchContextPackage,
  PrepareLaunchContextPackageOptions,
} from "./launch-context";
import {
  buildPawInitPrompt,
  preparePawLaunch,
  type PawInitRunner,
  type PawInitRunnerInput,
} from "./launch-preparation";
import { NodeLaunchRecordStore } from "./node-launch-record-store";
import {
  launchManagedSdkNode,
  launchPreparedNode,
  resumeManagedSdkNode,
} from "./node-launch";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import type { ManagedSdkRunner } from "./managed-sdk-runner";
import { ManagedRuntimePatchCoalescer } from "./managed-runtime-patch-coalescer";
import { parseWorkstreamDocument } from "../workstream-view-model";
import { LaunchClaimFileStore } from "../session-registry/launch-claim-store";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { bindClaimViaTrustedSignal } from "../session-registry/launch-claims";

const TEST_ROOT = join(
  process.cwd(),
  "node_modules",
  ".tmp",
  "shared-branch-launch-tests",
);
const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];

interface SharedRepo {
  root: string;
  branch: string;
  sha: string;
}

function createRootDir(): string {
  const root = join(TEST_ROOT, `${process.pid}-${createdRoots.length}-${Date.now()}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createSharedRepo(root: string): SharedRepo {
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const branch = "personal/shared-contribution";
  mkdirSync(remote, { recursive: true });
  mkdirSync(work, { recursive: true });
  git(remote, "init", "--bare");
  git(work, "init", "-b", branch);
  git(work, "config", "user.email", "streamliner@example.test");
  git(work, "config", "user.name", "Streamliner Test");
  writeFileSync(join(work, "README.md"), "# Shared branch\n", "utf8");
  git(work, "add", "README.md");
  git(work, "commit", "-m", "Initial shared branch");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-u", "origin", branch);
  return {
    root: work,
    branch,
    sha: git(work, "rev-parse", "HEAD").toLowerCase(),
  };
}

function sharedLaunch(
  repo: SharedRepo,
  branchLeaseKey = `test-repo:${repo.branch}`,
): Record<string, unknown> {
  return {
    mode: "existing-shared-azure-devops",
    targetBranch: repo.branch,
    requiredStartSha: repo.sha,
    existingPullRequest: {
      provider: "azure-devops",
      id: 2129154,
    },
    completionMode: "branch-contribution",
    branchLeaseKey,
  };
}

function writeGraph(
  repo: SharedRepo,
  nodes: Array<Record<string, unknown>>,
): string {
  const graphPath = join(repo.root, ".streamliner", "workstreams", "shared", "graph.json");
  mkdirSync(dirname(graphPath), { recursive: true });
  writeFileSync(
    graphPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "shared-workstream",
      projectKey: "test-project",
      title: "Shared workstream",
      summary: "Test shared branch launches.",
      status: "active",
      attention: "focus",
      createdAt: "2026-07-30T12:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z",
      repos: [{
        id: "target-repo",
        owner: "example",
        name: "target-repo",
      }],
      designRefs: [],
      nodes,
      checkpoints: [],
    }),
    "utf8",
  );
  return graphPath;
}

function node(
  id: string,
  launch?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: "task",
    title: id,
    summary: `Work for ${id}.`,
    status: "ready",
    attention: "focus",
    repoIds: ["target-repo"],
    ...(launch ? { launch } : {}),
    dependsOn: [],
  };
}

function contextPackage(
  root: string,
  options: PrepareLaunchContextPackageOptions,
): LaunchContextPackage {
  const contextPackagePath = join(root, "state", "contexts", options.nodeId);
  const contextFilePath = join(contextPackagePath, "context.md");
  mkdirSync(contextPackagePath, { recursive: true });
  writeFileSync(contextFilePath, "# Context\n", "utf8");
  return {
    contextId: `ctx-${options.nodeId}`,
    contextPackagePath: normalizePath(contextPackagePath),
    contextFilePath: normalizePath(contextFilePath),
    metadata: {
      contextId: `ctx-${options.nodeId}`,
      launchNonce: options.launchNonce ?? null,
      launchClaimRef: null,
      projectKey: "test-project",
      workstreamId: "shared-workstream",
      nodeId: options.nodeId,
      targetRepoIds: ["target-repo"],
      graphPath: normalizePath(options.graphPath!),
      workstreamDir: normalizePath(dirname(options.graphPath!)),
      repoRoot: normalizePath(root),
      generatedAt: "2026-07-30T12:00:00.000Z",
      contextPackagePath: normalizePath(contextPackagePath),
      contextFilePath: normalizePath(contextFilePath),
      contextModel: "test",
      repoInstructions: {
        repoId: "target-repo",
        repoRoot: normalizePath(root),
        path: ".github/copilot-instructions.md",
        exists: false,
        unavailableReason: "missing",
      },
      sourceReferences: [],
      unavailableInputs: [],
    },
    unavailableInputs: [],
  };
}

function pawRunner(repo: SharedRepo): PawInitRunner {
  return async (input) => {
    const pawWorkDir = join(repo.root, ".paw", "work", input.nodeId);
    const workflowContextPath = join(pawWorkDir, "WorkflowContext.md");
    const streamlinerContextPath = join(pawWorkDir, "streamliner", "context.md");
    mkdirSync(dirname(streamlinerContextPath), { recursive: true });
    writeFileSync(
      workflowContextPath,
      "# WorkflowContext\nAdditional Inputs: streamliner-context=streamliner/context.md\n",
      "utf8",
    );
    writeFileSync(streamlinerContextPath, "# Context\n", "utf8");
    return {
      cwd: normalizePath(repo.root),
      branch: repo.branch,
      workId: input.nodeId,
      workTitle: input.nodeId,
      pawWorkDir: normalizePath(pawWorkDir),
      workflowContextPath: normalizePath(workflowContextPath),
      streamlinerContextPath: normalizePath(streamlinerContextPath),
    };
  };
}

function sharedConfiguration(repo: SharedRepo, branchLeaseKey?: string) {
  return {
    cwd: repo.root,
    launchMode: "existing-shared-azure-devops" as const,
    targetBranch: repo.branch,
    requiredStartSha: repo.sha,
    existingPullRequest: {
      provider: "azure-devops" as const,
      id: 2129154,
    },
    completionMode: "branch-contribution" as const,
    branchLeaseKey: branchLeaseKey ?? `test-repo:${repo.branch}`,
  };
}

async function waitForRun(
  api: StreamlinerApiApp,
  runId: string,
): Promise<request.Response> {
  let response = await request(api.app)
    .get(`/api/launch-preparations/runs/${runId}`)
    .expect(200);
  for (
    let attempt = 0;
    attempt < 400 && response.body.status === "running";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    response = await request(api.app)
      .get(`/api/launch-preparations/runs/${runId}`)
      .expect(200);
  }
  expect(response.body.status).not.toBe("running");
  return response;
}

afterEach(() => {
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("durable node launch modes", () => {
  it("preserves compatibility for nodes without launch metadata", () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [node("standard-node")]);

    const parsed = parseWorkstreamDocument(readFileSync(graphPath, "utf8"));

    expect(parsed.nodes[0]?.launch).toBeUndefined();
  });

  it("rejects missing shared fields at graph parse time", () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", {
        mode: "existing-shared-azure-devops",
        targetBranch: repo.branch,
      }),
    ]);

    expect(() =>
      parseWorkstreamDocument(readFileSync(graphPath, "utf8"))
    ).toThrow("workstream.nodes[0].launch.requiredStartSha");
  });
});

describe("shared launch preparation", () => {
  it("refuses launch-mode mismatch and missing preparation fields", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const base = {
      nodeId: "shared-node",
      graphPath,
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options: PrepareLaunchContextPackageOptions) =>
        contextPackage(repo.root, options),
      branchLeaseCoordinator: store,
    };

    await expect(preparePawLaunch({
      ...base,
      configuration: { cwd: repo.root },
    })).rejects.toMatchObject({ code: "launch_mode_mismatch" });

    await expect(preparePawLaunch({
      ...base,
      configuration: {
        cwd: repo.root,
        launchMode: "existing-shared-azure-devops",
      },
    })).rejects.toMatchObject({
      code: "invalid_launch_configuration",
      input: "configuration.targetBranch",
    });

    const standardGraphPath = writeGraph(repo, [node("standard-node")]);
    await expect(preparePawLaunch({
      ...base,
      nodeId: "standard-node",
      graphPath: standardGraphPath,
      configuration: sharedConfiguration(repo),
    })).rejects.toMatchObject({ code: "launch_mode_mismatch" });
  });

  it("refuses stale SHA and duplicate cross-node branch launches", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const key = `test-repo:${repo.branch}`;
    const staleRepo = { ...repo, sha: "0".repeat(40) };
    const staleGraphPath = writeGraph(repo, [
      node("stale-node", sharedLaunch(staleRepo, key)),
    ]);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });

    await expect(preparePawLaunch({
      nodeId: "stale-node",
      graphPath: staleGraphPath,
      configuration: sharedConfiguration(staleRepo, key),
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: store,
    })).rejects.toMatchObject({ code: "shared_branch_stale" });

    const graphPath = writeGraph(repo, [
      node("node-a", sharedLaunch(repo, key)),
      node("node-b", sharedLaunch(repo, key)),
    ]);
    const prepare = (nodeId: string) =>
      preparePawLaunch({
        nodeId,
        graphPath,
        configuration: sharedConfiguration(repo, key),
        pawInitRunner: pawRunner(repo),
        contextPreparer: async (options) => contextPackage(repo.root, options),
        branchLeaseCoordinator: store,
      });

    await expect(prepare("node-a")).resolves.toMatchObject({
      launchMetadata: {
        launchMode: "existing-shared-azure-devops",
        requiredStartSha: repo.sha,
        existingPullRequest: {
          provider: "azure-devops",
          id: 2129154,
        },
        branchLease: {
          status: "active",
          nodeId: "node-a",
        },
      },
    });
    await expect(prepare("node-b")).rejects.toMatchObject({
      code: "branch_lease_conflict",
    });
  });

  it("uses the existing branch without creating another branch", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const branchesBefore = git(repo.root, "for-each-ref", "--format=%(refname)", "refs/heads");

    const handoff = await preparePawLaunch({
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(repo),
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: store,
    });

    expect(handoff.branch).toBe(repo.branch);
    expect(handoff.cwd).toBe(normalizePath(repo.root));
    expect(git(repo.root, "for-each-ref", "--format=%(refname)", "refs/heads"))
      .toBe(branchesBefore);
    expect(handoff.kickoffPrompt).toContain("Do not create or switch branches");
  });

  it("prepares shared branches for an external session without acquiring a lease", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const pawInitCalls: PawInitRunnerInput[] = [];
    const initialize = pawRunner(repo);

    const handoff = await preparePawLaunch({
      target: "external-session",
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(repo),
      pawInitRunner: async (input) => {
        pawInitCalls.push(input);
        return await initialize(input);
      },
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: store,
    });

    expect(handoff).toEqual(expect.objectContaining({
      target: "external-session",
      cwd: normalizePath(repo.root),
      branch: repo.branch,
      recommendedWorkspaceType: "branch",
      launchMetadata: expect.objectContaining({
        launchMode: "existing-shared-azure-devops",
        requiredStartSha: repo.sha,
        branchLease: null,
      }),
    }));
    expect(handoff.kickoffPrompt).toContain(
      "Branch coordination: external session caller (no Streamliner branch lease).",
    );
    expect(handoff.kickoffPrompt).not.toContain("Branch lease: missing");
    expect(pawInitCalls[0]?.configuration.workflowInstructions).toContain(
      "The external session caller owns writer exclusivity and lifecycle coordination",
    );
    expect(buildPawInitPrompt(pawInitCalls[0]!)).toContain(
      "The external session caller owns writer exclusivity and lifecycle coordination",
    );
    expect(buildPawInitPrompt(pawInitCalls[0]!)).not.toContain(
      "backend branch lease key",
    );
    await expect(store.listBranchLeases({})).resolves.toEqual([]);
  });

  it("rejects a stale exact shared branch SHA before external PAW initialization", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const staleRepo = { ...repo, sha: "0".repeat(40) };
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(staleRepo)),
    ]);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });

    await expect(preparePawLaunch({
      target: "external-session",
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(staleRepo),
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: store,
    })).rejects.toMatchObject({
      code: "shared_branch_stale",
      input: "configuration.requiredStartSha",
    });
    await expect(store.listBranchLeases({})).resolves.toEqual([]);
  });

  it("revalidates the exact shared branch SHA after external PAW initialization", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const initialize = pawRunner(repo);
    const advancingRunner: PawInitRunner = async (input) => {
      const result = await initialize(input);
      writeFileSync(join(repo.root, "advanced-during-init.txt"), "advanced\n", "utf8");
      git(repo.root, "add", "advanced-during-init.txt");
      git(repo.root, "commit", "-m", "Advance during PAW init");
      return result;
    };

    await expect(preparePawLaunch({
      target: "external-session",
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(repo),
      pawInitRunner: advancingRunner,
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: store,
    })).rejects.toMatchObject({
      code: "shared_branch_stale",
      input: "configuration.requiredStartSha",
    });
    await expect(store.listBranchLeases({})).resolves.toEqual([]);
  });

  it("records shared launch metadata on the launch record, claim lineage, and session", { timeout: 20_000 }, async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const recordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const handoff = await preparePawLaunch({
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(repo),
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: recordStore,
    });
    await recordStore.markPreparationSucceeded(handoff);
    const registryStore = new SessionRegistryFileStore({
      rootDir: join(root, "state", "session-registry"),
    });
    const claimStore = new LaunchClaimFileStore({
      rootDir: join(root, "state", "launch-claims"),
    });

    const launched = await launchPreparedNode(
      registryStore,
      claimStore,
      handoff,
      {
        branchLeaseCoordinator: recordStore,
        launchTerminal: () => ({ method: "powershell", pid: 42 }),
      },
    );

    const claim = claimStore.getClaim(launched.launchClaim.launchClaimId);
    expect(claim?.lineageMetadata).toEqual(expect.objectContaining({
      launchMode: "existing-shared-azure-devops",
      completionMode: "branch-contribution",
      requiredStartSha: repo.sha,
      existingPullRequest: {
        provider: "azure-devops",
        id: 2129154,
      },
      branchLeaseId: handoff.launchMetadata.branchLease?.leaseId,
    }));
    const session = registryStore.getSession(launched.launchClaim.reservedRegistryId!);
    expect(session?.pawLaunch).toEqual(expect.objectContaining({
      launchMode: "existing-shared-azure-devops",
      completionMode: "branch-contribution",
      targetBranch: repo.branch,
      requiredStartSha: repo.sha,
      branchLeaseId: handoff.launchMetadata.branchLease?.leaseId,
    }));
    await expect(recordStore.get(graphPath, "shared-node")).resolves.toEqual(
      expect.objectContaining({
        launchMode: "existing-shared-azure-devops",
        completionMode: "branch-contribution",
        requiredStartSha: repo.sha,
        launchClaimRef: launched.launchClaim.launchClaimId,
        branchLease: expect.objectContaining({
          launchClaimId: launched.launchClaim.launchClaimId,
          registryId: launched.launchClaim.reservedRegistryId,
        }),
      }),
    );
  });

  it("revalidates the required start SHA immediately before worker launch", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const recordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const handoff = await preparePawLaunch({
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(repo),
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: recordStore,
    });
    writeFileSync(join(repo.root, "after-preparation.txt"), "advanced\n", "utf8");
    git(repo.root, "add", "after-preparation.txt");
    git(repo.root, "commit", "-m", "Advance shared branch");
    git(repo.root, "push", "origin", repo.branch);
    const registryStore = new SessionRegistryFileStore({
      rootDir: join(root, "state", "session-registry"),
    });
    const claimStore = new LaunchClaimFileStore({
      rootDir: join(root, "state", "launch-claims"),
    });

    await expect(launchPreparedNode(
      registryStore,
      claimStore,
      handoff,
      {
        branchLeaseCoordinator: recordStore,
        launchTerminal: () => ({ method: "powershell", pid: 42 }),
      },
    )).rejects.toMatchObject({ code: "shared_branch_stale" });
    expect(claimStore.listClaims()).toEqual([]);
  });

  it("reclaims the lease when the same managed session resumes", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("shared-node", sharedLaunch(repo)),
    ]);
    const recordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const handoff = await preparePawLaunch({
      nodeId: "shared-node",
      graphPath,
      configuration: sharedConfiguration(repo),
      pawInitRunner: pawRunner(repo),
      contextPreparer: async (options) => contextPackage(repo.root, options),
      branchLeaseCoordinator: recordStore,
    });
    const registryStore = new SessionRegistryFileStore({
      rootDir: join(root, "state", "session-registry"),
    });
    const claimStore = new LaunchClaimFileStore({
      rootDir: join(root, "state", "launch-claims"),
    });
    const runner: ManagedSdkRunner = {
      start: async (input) => {
        const result = {
          registryId: input.registryId,
          sdkSessionId: "sdk-shared-resume",
          sdkWorkspacePath: null,
          sdkStateRoot: join(root, "sdk"),
        };
        input.onStarted(result);
        return result;
      },
      resume: async (input) => {
        const result = {
          registryId: input.registryId,
          sdkSessionId: input.sdkSessionId,
          sdkWorkspacePath: null,
          sdkStateRoot: join(root, "sdk"),
        };
        input.onStarted(result);
        return result;
      },
    };
    const runtimePatchCoalescer = new ManagedRuntimePatchCoalescer({
      patchRuntimeMetadata: registryStore.patchRuntimeMetadata.bind(registryStore),
    });
    const launched = await launchManagedSdkNode(
      registryStore,
      claimStore,
      { ...handoff, runtimeKind: "managed-sdk" },
      {
        managedSdkRunner: runner,
        runtimePatchCoalescer,
        branchLeaseCoordinator: recordStore,
      },
    );
    registryStore.upsertSession({
      id: "observed-shared-resume",
      title: "Observed shared session",
      description: "",
      cwd: handoff.cwd,
      repo: null,
      branch: handoff.branch,
      copilotSessionId: "sdk-shared-resume",
      lastSeenAt: "2026-07-30T12:01:00.000Z",
      origin: {
        kind: "observed",
        importedFromCopilotSessionId: "sdk-shared-resume",
      },
      lifecycleStatus: "active",
    });
    expect(bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: launched.launchClaim.launchClaimId,
      copilotSessionId: "sdk-shared-resume",
      cwd: handoff.cwd,
      branch: handoff.branch,
      at: "2026-07-30T12:01:01.000Z",
    }).ok).toBe(true);
    registryStore.patchRuntimeMetadata(launched.managedSdk.registryId, {
      lifecycleState: "interrupted",
      progressEvents: [{
        type: "lifecycle",
        message: "Interrupted for test.",
      }],
    });
    registryStore.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "sdk-shared-resume",
      timestamp: "2026-07-30T12:02:00.000Z",
      cwd: handoff.cwd,
      branch: handoff.branch,
      endReason: "user_exit",
      executionKind: "agency",
    });

    await expect(resumeManagedSdkNode(
      registryStore,
      claimStore,
      { ...handoff, runtimeKind: "managed-sdk" },
      launched.launchClaim.launchClaimId,
      {
        managedSdkRunner: runner,
        runtimePatchCoalescer,
        branchLeaseCoordinator: recordStore,
      },
    )).resolves.toMatchObject({
      managedSdk: {
        registryId: launched.managedSdk.registryId,
        sdkSessionId: "sdk-shared-resume",
      },
    });
    await expect(recordStore.getBranchLease(
      handoff.launchMetadata.branchLease!.leaseId,
    )).resolves.toMatchObject({
      launchClaimId: launched.launchClaim.launchClaimId,
      registryId: launched.managedSdk.registryId,
      reclaimCount: 1,
    });
  });
});

describe("branch lease lifecycle", () => {
  it("supports same-session reclaim, explicit release, and reviewed transfer", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const store = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const acquire = {
      branchLeaseKey: `test-repo:${repo.branch}`,
      projectKey: "test-project",
      workstreamId: "shared-workstream",
      graphPath: join(root, "graph.json"),
      nodeId: "node-a",
      targetRepoId: "target-repo",
      cwd: repo.root,
      targetBranch: repo.branch,
      requiredStartSha: repo.sha,
      existingPullRequest: {
        provider: "azure-devops" as const,
        id: 2129154,
      },
    };
    const lease = await store.acquireBranchLease(acquire);
    await store.bindBranchLeaseToLaunch({
      leaseId: lease.leaseId,
      branchLeaseKey: lease.branchLeaseKey,
      graphPath: lease.graphPath,
      nodeId: lease.nodeId,
      cwd: lease.cwd,
      targetBranch: lease.targetBranch,
      requiredStartSha: lease.requiredStartSha,
      launchClaimId: "claim-a",
      registryId: "registry-a",
    });
    const reclaimed = await store.reclaimBranchLeaseForSession({
      leaseId: lease.leaseId,
      branchLeaseKey: lease.branchLeaseKey,
      graphPath: lease.graphPath,
      nodeId: lease.nodeId,
      cwd: lease.cwd,
      targetBranch: lease.targetBranch,
      requiredStartSha: lease.requiredStartSha,
      launchClaimId: "claim-a",
      registryId: "registry-a",
    });
    expect(reclaimed.reclaimCount).toBe(1);

    await expect(store.transferBranchLease({
      leaseId: lease.leaseId,
      graphPath: lease.graphPath,
      nodeId: lease.nodeId,
      launchClaimId: "claim-wrong",
      registryId: "registry-a",
      target: {
        ...acquire,
        nodeId: "node-b",
      },
      reviewedBy: "orchestrator",
      reason: "Original session cannot resume.",
    })).rejects.toMatchObject({ code: "branch_lease_claim_mismatch" });

    const transfer = await store.transferBranchLease({
      leaseId: lease.leaseId,
      graphPath: lease.graphPath,
      nodeId: lease.nodeId,
      launchClaimId: "claim-a",
      registryId: "registry-a",
      target: {
        ...acquire,
        nodeId: "node-b",
      },
      reviewedBy: "orchestrator",
      reason: "Original session cannot resume.",
    });
    expect(transfer.previousLease.status).toBe("transferred");
    expect(transfer.branchLease).toMatchObject({
      status: "active",
      nodeId: "node-b",
      transferredFromLeaseId: lease.leaseId,
    });
    expect(transfer.branchLease.transferAudit).toEqual([
      expect.objectContaining({
        fromNodeId: "node-a",
        toNodeId: "node-b",
        reviewedBy: "orchestrator",
      }),
    ]);

    const released = await store.releaseBranchLease({
      leaseId: transfer.branchLease.leaseId,
      graphPath: transfer.branchLease.graphPath,
      nodeId: transfer.branchLease.nodeId,
      acceptedEndSha: repo.sha,
      acceptedBy: "orchestrator",
      reason: "Contribution accepted.",
    });
    expect(released).toMatchObject({
      status: "released",
      endSha: repo.sha,
      releasedBy: "orchestrator",
    });
  });

  it("releases and transfers leases through loopback APIs", async () => {
    const root = createRootDir();
    const repo = createSharedRepo(root);
    const graphPath = writeGraph(repo, [
      node("node-a", sharedLaunch(repo)),
      node("node-b", sharedLaunch(repo)),
    ]);
    const recordsPath = join(root, "state", "node-launch-records.json");
    const store = new NodeLaunchRecordStore({ recordsPath });
    const acquire = async (nodeId: string) =>
      store.acquireBranchLease({
        branchLeaseKey: `test-repo:${repo.branch}`,
        projectKey: "test-project",
        workstreamId: "shared-workstream",
        graphPath,
        nodeId,
        targetRepoId: "target-repo",
        cwd: repo.root,
        targetBranch: repo.branch,
        requiredStartSha: repo.sha,
        existingPullRequest: {
          provider: "azure-devops",
          id: 2129154,
        },
      });
    const releaseLease = await acquire("node-a");
    const api = createStreamlinerApiApp({
      store: new SessionRegistryFileStore({
        rootDir: join(root, "state", "api-session-registry"),
      }),
      nodeLaunchRecordsPath: recordsPath,
    });
    activeApps.push(api);

    await request(api.app)
      .get("/api/node-launch-records/branch-leases")
      .query({ graphPath, activeOnly: "true" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.branchLeases).toEqual([
          expect.objectContaining({ leaseId: releaseLease.leaseId, status: "active" }),
        ]);
      });

    await request(api.app)
      .post(`/api/node-launch-records/branch-leases/${releaseLease.leaseId}/release`)
      .set("Content-Type", "application/json")
      .send({
        graphPath,
        nodeId: "node-a",
        acceptedEndSha: repo.sha,
        acceptedBy: "orchestrator",
        reason: "Contribution accepted.",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.branchLease.status).toBe("released");
      });

    const transferLease = await acquire("node-a");
    await request(api.app)
      .post(`/api/node-launch-records/branch-leases/${transferLease.leaseId}/transfer`)
      .set("Content-Type", "application/json")
      .send({
        graphPath,
        nodeId: "node-a",
        targetGraphPath: graphPath,
        targetNodeId: "node-b",
        reviewedBy: "orchestrator",
        reason: "Reviewed replacement.",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.previousLease.status).toBe("transferred");
        expect(body.branchLease).toMatchObject({
          status: "active",
          nodeId: "node-b",
        });
      });
  });

      it("recovers a post-preparation terminal spawn failure for same-node retry", { timeout: 20_000 }, async () => {
        const root = createRootDir();
        const repo = createSharedRepo(root);
        const key = `test-repo:${repo.branch}`;
        const graphPath = writeGraph(repo, [
        node("node-a", sharedLaunch(repo, key)),
        node("node-b", sharedLaunch(repo, key)),
        ]);
        const recordsPath = join(root, "state", "node-launch-records.json");
        const registryStore = new SessionRegistryFileStore({
        rootDir: join(root, "state", "session-registry"),
        });
        const claimStore = new LaunchClaimFileStore({
        rootDir: join(root, "state", "launch-claims"),
        });
        const api = createStreamlinerApiApp({
        store: registryStore,
        launchClaimStore: claimStore,
        nodeLaunchRecordsPath: recordsPath,
        launchPreparationDeps: {
          pawInitRunner: pawRunner(repo),
          contextPreparer: async (options) => contextPackage(repo.root, options),
        },
        nodeLaunchDeps: {
          launchTerminal: () => {
            throw new Error("terminal spawn failed");
          },
        },
        });
        activeApps.push(api);

        const started = await request(api.app)
        .post("/api/launch-preparations/runs")
        .set("Content-Type", "application/json")
        .send({
          nodeId: "node-a",
          graphPath,
          configuration: sharedConfiguration(repo, key),
          postPreparation: {
            launchTerminal: {},
          },
        })
        .expect(202);
        const completed = await waitForRun(api, started.body.runId);
        expect(completed.body.status).toBe("succeeded");
        expect(completed.body.postPreparation?.terminal).toMatchObject({
        status: "failed",
        error: {
          code: "terminal_spawn_failed",
        },
        });

        const [claimEntry] = claimStore.listClaims();
        const failedClaim = claimStore.getClaim(claimEntry.launchClaimId);
        expect(failedClaim).toMatchObject({
        status: "failed",
        failureCode: "terminal-spawn-failed",
        });
        expect(registryStore.getSession(failedClaim!.reservedRegistryId!)).toBeNull();

        const recordStore = new NodeLaunchRecordStore({ recordsPath });
        const [lease] = await recordStore.listBranchLeases({
        graphPath,
        nodeId: "node-a",
        activeOnly: true,
        });
        expect(lease).toMatchObject({
        status: "active",
        launchClaimId: null,
        registryId: null,
        failedLaunches: [
          expect.objectContaining({
            launchClaimId: failedClaim!.launchClaimId,
            failureCode: "terminal-spawn-failed",
          }),
        ],
        });
        await expect(recordStore.getOperation(graphPath, "node-a")).resolves.toEqual(
        expect.objectContaining({
          status: "terminal_failed",
          handoff: expect.objectContaining({
            launchMetadata: expect.objectContaining({
              launchClaimRef: null,
              branchLease: expect.objectContaining({
                leaseId: lease.leaseId,
                launchClaimId: null,
                registryId: null,
              }),
            }),
          }),
        }),
        );

        await expect(recordStore.acquireBranchLease({
        branchLeaseKey: key,
        projectKey: "test-project",
        workstreamId: "shared-workstream",
        graphPath,
        nodeId: "node-b",
        targetRepoId: "target-repo",
        cwd: repo.root,
        targetBranch: repo.branch,
        requiredStartSha: repo.sha,
        existingPullRequest: {
          provider: "azure-devops",
          id: 2129154,
        },
        })).rejects.toMatchObject({ code: "branch_lease_conflict" });

        await request(api.app)
        .post("/api/node-launch-records/clear")
        .set("Content-Type", "application/json")
        .send({ graphPath, nodeId: "node-a" })
        .expect(409)
        .expect(({ body }) => {
          expect(body.code).toBe("branch_lease_still_active");
        });

        const retry = await preparePawLaunch({
        nodeId: "node-a",
        graphPath,
        configuration: sharedConfiguration(repo, key),
        pawInitRunner: pawRunner(repo),
        contextPreparer: async (options) => contextPackage(repo.root, options),
        branchLeaseCoordinator: recordStore,
        });
        expect(retry.launchMetadata.branchLease).toMatchObject({
        leaseId: lease.leaseId,
        launchClaimId: null,
        registryId: null,
        reclaimCount: 1,
        });
      });

      it("recovers a managed SDK start failure for same-node retry", { timeout: 20_000 }, async () => {
        const root = createRootDir();
        const repo = createSharedRepo(root);
        const key = `test-repo:${repo.branch}`;
        const graphPath = writeGraph(repo, [
        node("node-a", sharedLaunch(repo, key)),
        node("node-b", sharedLaunch(repo, key)),
        ]);
        const recordsPath = join(root, "state", "node-launch-records.json");
        const recordStore = new NodeLaunchRecordStore({ recordsPath });
        const handoff = await preparePawLaunch({
        nodeId: "node-a",
        graphPath,
        configuration: sharedConfiguration(repo, key),
        pawInitRunner: pawRunner(repo),
        contextPreparer: async (options) => contextPackage(repo.root, options),
        branchLeaseCoordinator: recordStore,
        });
        await recordStore.markPreparationSucceeded(handoff);
        const registryStore = new SessionRegistryFileStore({
        rootDir: join(root, "state", "session-registry"),
        });
        const claimStore = new LaunchClaimFileStore({
        rootDir: join(root, "state", "launch-claims"),
        });
        const runner: ManagedSdkRunner = {
        start: async () => {
          throw new Error("managed start failed");
        },
        };
        const api = createStreamlinerApiApp({
        store: registryStore,
        launchClaimStore: claimStore,
        nodeLaunchRecordsPath: recordsPath,
        nodeLaunchDeps: {
          managedSdkRunner: runner,
        },
        });
        activeApps.push(api);

        await request(api.app)
        .post("/api/node-launches")
        .set("Content-Type", "application/json")
        .send({
          handoff: {
            ...handoff,
            runtimeKind: "managed-sdk",
          },
        })
        .expect(500)
        .expect(({ body }) => {
          expect(body.code).toBe("managed_sdk_start_failed");
        });

        const [claimEntry] = claimStore.listClaims();
        const failedClaim = claimStore.getClaim(claimEntry.launchClaimId);
        expect(failedClaim).toMatchObject({
        status: "failed",
        failureCode: "internal-error",
        });
        expect(registryStore.getSession(failedClaim!.reservedRegistryId!)).toBeNull();
        const [lease] = await recordStore.listBranchLeases({
        graphPath,
        nodeId: "node-a",
        activeOnly: true,
        });
        expect(lease).toMatchObject({
        status: "active",
        launchClaimId: null,
        registryId: null,
        failedLaunches: [
          expect.objectContaining({
            launchClaimId: failedClaim!.launchClaimId,
            failureCode: "internal-error",
          }),
        ],
        });
        await expect(recordStore.getOperation(graphPath, "node-a")).resolves.toEqual(
        expect.objectContaining({
          status: "managed_failed",
          handoff: expect.objectContaining({
            launchMetadata: expect.objectContaining({
              launchClaimRef: null,
              branchLease: expect.objectContaining({
                leaseId: lease.leaseId,
                launchClaimId: null,
                registryId: null,
              }),
            }),
          }),
        }),
        );
        await expect(recordStore.acquireBranchLease({
        branchLeaseKey: key,
        projectKey: "test-project",
        workstreamId: "shared-workstream",
        graphPath,
        nodeId: "node-b",
        targetRepoId: "target-repo",
        cwd: repo.root,
        targetBranch: repo.branch,
        requiredStartSha: repo.sha,
        existingPullRequest: {
          provider: "azure-devops",
          id: 2129154,
        },
        })).rejects.toMatchObject({ code: "branch_lease_conflict" });

        await request(api.app)
        .post("/api/node-launch-records/clear")
        .set("Content-Type", "application/json")
        .send({ graphPath, nodeId: "node-a" })
        .expect(409)
        .expect(({ body }) => {
          expect(body.code).toBe("branch_lease_still_active");
        });

        const retry = await preparePawLaunch({
        nodeId: "node-a",
        graphPath,
        configuration: sharedConfiguration(repo, key),
        pawInitRunner: pawRunner(repo),
        contextPreparer: async (options) => contextPackage(repo.root, options),
        branchLeaseCoordinator: recordStore,
        });
        expect(retry.launchMetadata.branchLease).toMatchObject({
        leaseId: lease.leaseId,
        launchClaimId: null,
        registryId: null,
        reclaimCount: 1,
        });
      });
});
