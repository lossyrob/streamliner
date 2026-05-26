import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { LaunchClaimFileStore } from "../session-registry/launch-claim-store";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import type { NodeTerminalLaunchResponse } from "../node-launch-record-contract";
import { NodeLaunchRecordStore } from "./node-launch-record-store";
import type { TerminalLaunchOptions } from "./terminal-launch";
import {
  LaunchContextPreparationError,
  type LaunchContextPackage,
  type LaunchContextRepoInstructions,
  type PrepareLaunchContextPackageOptions,
  type PreparedLaunchContextPackage,
} from "./launch-context";
import {
  buildPawInitPrompt,
  buildStreamlinerContextSavePrompt,
  completePawInitToolParameters,
  preparePawLaunch,
  resolvePawWorkDirForLaunch,
  validatePawWorktreePolicy,
  type LaunchContextPreparer,
  type PawInitRunner,
  type PawInitRunnerInput,
  type PawLaunchHandoff,
  type PawLaunchSessionRunnerInput,
} from "./launch-preparation";

const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];

function createRootDir(): string {
  const root = join(
    tmpdir(),
    `streamliner-launch-preparation-${process.pid}-${createdRoots.length}`,
  );
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function fakeRepoInstructions(
  root: string,
  overrides: Partial<LaunchContextRepoInstructions> = {},
): LaunchContextRepoInstructions {
  return {
    repoId: "streamliner",
    repoRoot: normalizePath(root),
    path: ".github/copilot-instructions.md",
    exists: true,
    content: [
      "# Repo Instructions",
      "",
      "- Create sibling worktrees with `script/worktree-new <name>`.",
      "- Run the repo worktree environment helper before validation.",
    ].join("\n"),
    freshness: { kind: "sha256", value: "repo-instructions-hash" },
    ...overrides,
  };
}

function createGitRepo(root: string, originUrl: string): void {
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", originUrl], { cwd: root, stdio: "ignore" });
}

function fakeContextPackage(
  root: string,
  options: PrepareLaunchContextPackageOptions,
  overrides: Partial<Omit<LaunchContextPackage, "metadata">> & {
    metadata?: Partial<LaunchContextPackage["metadata"]>;
  } = {},
): LaunchContextPackage {
  const contextPackagePath = options.outputDir
    ? join(options.outputDir, "streamliner")
    : join(
      options.stateRoot ?? root,
      "streamliner",
      "session-launching-and-tracking",
      "launch-contexts",
      "ctx-prepared",
    );
  const contextFilePath = join(contextPackagePath, "context.md");
  mkdirSync(contextPackagePath, { recursive: true });
  writeFileSync(contextFilePath, "# Streamliner Context\n\nPrepared context.\n", "utf8");
  const launchNonce = options.launchNonce === undefined ? null : options.launchNonce;
  const base: LaunchContextPackage = {
    contextId: "ctx-prepared",
    contextPackagePath: normalizePath(contextPackagePath),
    contextFilePath: normalizePath(contextFilePath),
    metadata: {
      contextId: "ctx-prepared",
      launchNonce,
      launchClaimRef: null,
      projectKey: "streamliner",
      workstreamId: "session-launching-and-tracking",
      nodeId: options.nodeId,
      targetRepoIds: ["streamliner"],
      graphPath: normalizePath(options.graphPath ?? join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json")),
      workstreamDir: normalizePath(join(root, ".streamliner", "workstreams", "session-launching-and-tracking")),
      repoRoot: normalizePath(root),
      generatedAt: "2026-05-02T07:00:00.000Z",
      contextPackagePath: normalizePath(contextPackagePath),
      contextFilePath: normalizePath(contextFilePath),
      contextModel: "test-model",
      repoInstructions: fakeRepoInstructions(root),
      sourceReferences: [
        {
          kind: "tracker",
          role: "selected-node-spec",
          url: "https://github.com/lossyrob/streamliner/issues/33",
        },
      ],
      unavailableInputs: [],
    },
    unavailableInputs: [],
  };
  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...overrides.metadata,
    },
  };
}

async function waitForLaunchPreparationRun(
  api: StreamlinerApiApp,
  runId: string,
  status: "succeeded" | "failed" = "succeeded",
): Promise<request.Response> {
  let snapshot = await request(api.app)
    .get(`/api/launch-preparations/runs/${runId}`)
    .expect(200);
  for (let attempt = 0; attempt < 20 && snapshot.body.status !== status; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    snapshot = await request(api.app)
      .get(`/api/launch-preparations/runs/${runId}`)
      .expect(200);
  }
  expect(snapshot.body.status).toBe(status);
  return snapshot;
}

function fakePreparedContext(root: string): PreparedLaunchContextPackage {
  const node = {
    id: "launch-prompt-profiles",
    type: "task" as const,
    title: "Launch prompt profiles",
    summary: "Configure launch prompt profile behavior.",
    status: "ready" as const,
    attention: "focus" as const,
    repoIds: ["streamliner"],
    tracker: {
      type: "github" as const,
      owner: "lossyrob",
      repo: "streamliner",
      number: 33,
    },
    dependsOn: [],
  };
  const workstream = {
    schemaVersion: 1 as const,
    id: "session-launching-and-tracking",
    projectKey: "streamliner",
    title: "Session launching and tracking",
    summary: "Launch and track worker sessions.",
    status: "active" as const,
    attention: "focus" as const,
    createdAt: "2026-05-02T07:00:00.000Z",
    updatedAt: "2026-05-02T08:00:00.000Z",
    repos: [{
      id: "streamliner",
      owner: "lossyrob",
      name: "streamliner",
      role: "primary" as const,
    }],
    designRefs: [{ repoId: "streamliner", path: "docs/design/session-system.md" }],
    nodes: [node],
    checkpoints: [],
  };
  const contextPackagePath = join(root, "state", "streamliner", "session-launching-and-tracking", "launch-contexts", "ctx-sdk");
  const contextFilePath = join(contextPackagePath, "context.md");
  const graphPath = join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json");
  const workstreamDir = join(root, ".streamliner", "workstreams", "session-launching-and-tracking");
  const repoInstructions = fakeRepoInstructions(root);
  const sourceReferences = [
    {
      kind: "graph" as const,
      role: "workstream-graph",
      path: ".streamliner/workstreams/session-launching-and-tracking/graph.json",
      freshness: { kind: "sha256" as const, value: "graph-hash" },
    },
    {
      kind: "design" as const,
      role: "layer-0-design",
      path: "docs/design/session-system.md",
      repoId: "streamliner",
      freshness: { kind: "git-object" as const, value: "design-hash" },
    },
    {
      kind: "tracker" as const,
      role: "selected-node-spec",
      url: "https://github.com/lossyrob/streamliner/issues/33",
    },
  ];
  return {
    generationInput: {
      contextId: "ctx-sdk",
      generatedAt: "2026-05-02T07:00:00.000Z",
      repoRoot: root,
      workstream,
      node,
      graphSource: {
        reference: sourceReferences[0],
        content: "GRAPH_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT",
      },
      briefSource: {
        reference: {
          kind: "brief",
          role: "workstream-brief",
          path: ".streamliner/workstreams/session-launching-and-tracking/brief.md",
        },
        content: "BRIEF_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT",
      },
      designSources: [{
        reference: sourceReferences[1],
        content: "DESIGN_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT",
      }],
      trackerSource: {
        reference: sourceReferences[2],
        content: "TRACKER_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT",
      },
      repoInstructions,
      designSelection: [{
        repoId: "streamliner",
        path: "docs/design/session-system.md",
        rationale: "workstream designRefs",
        included: true,
      }],
      trackerReference: "- GitHub issue: https://github.com/lossyrob/streamliner/issues/33",
      sourceReferences,
      unavailableInputs: [],
    },
    metadata: {
      contextId: "ctx-sdk",
      launchNonce: "nonce-sdk",
      launchClaimRef: null,
      projectKey: "streamliner",
      workstreamId: "session-launching-and-tracking",
      nodeId: "launch-prompt-profiles",
      targetRepoIds: ["streamliner"],
      graphPath: normalizePath(graphPath),
      workstreamDir: normalizePath(workstreamDir),
      repoRoot: normalizePath(root),
      generatedAt: "2026-05-02T07:00:00.000Z",
      contextPackagePath: normalizePath(contextPackagePath),
      contextFilePath: normalizePath(contextFilePath),
      contextModel: "gpt-5.5",
      repoInstructions,
      sourceReferences,
      unavailableInputs: [],
    },
    contextPackagePath,
    contextFilePath,
    overwriteContextFile: false,
  };
}

function writeLaunchPolicyGraph(
  root: string,
  options: {
    nodeId?: string;
    tracker?: Record<string, unknown>;
    launchPolicy?: Record<string, unknown>;
    launchDefaults?: Record<string, unknown>;
  } = {},
): string {
  const nodeId = options.nodeId ?? "launch-prompt-profiles";
  const graphPath = join(
    root,
    ".streamliner",
    "workstreams",
    "session-launching-and-tracking",
    "graph.json",
  );
  mkdirSync(dirname(graphPath), { recursive: true });
  const node: Record<string, unknown> = {
    id: nodeId,
    type: "task",
    title: "Launch prompt profiles",
    summary: "Configure launch prompt profile behavior.",
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
    id: "session-launching-and-tracking",
    projectKey: "streamliner",
    title: "Session launching and tracking",
    summary: "Launch and track worker sessions.",
    status: "active",
    attention: "focus",
    createdAt: "2026-05-02T07:00:00.000Z",
    updatedAt: "2026-05-02T08:00:00.000Z",
    repos: [{
      id: "streamliner",
      owner: "lossyrob",
      name: "streamliner",
      role: "primary",
    }],
    designRefs: [],
    nodes: [node],
    checkpoints: [],
  };
  if (options.launchPolicy !== undefined) {
    graph.launchPolicy = options.launchPolicy;
  }
  if (options.launchDefaults !== undefined) {
    graph.launchDefaults = options.launchDefaults;
  }
  writeFileSync(graphPath, JSON.stringify(graph), "utf8");
  return graphPath;
}

function createPawInitRunner(
  calls: PawInitRunnerInput[] = [],
): PawInitRunner {
  return async (input) => {
    calls.push(input);
    const workId = "launch-prompt-profiles";
    const pawWorkDir = join(input.cwd, ".paw", "work", workId);
    const workflowContextPath = join(pawWorkDir, "WorkflowContext.md");
    const streamlinerContextPath = join(pawWorkDir, "streamliner", "context.md");
    mkdirSync(dirname(streamlinerContextPath), { recursive: true });
    writeFileSync(workflowContextPath, "# WorkflowContext\nAdditional Inputs: streamliner-context=streamliner/context.md\n", "utf8");
    writeFileSync(streamlinerContextPath, "# Streamliner Context\n", "utf8");
    return {
      cwd: normalizePath(input.cwd),
      branch: "feature/launch-prompt-profiles",
      workId,
      workTitle: "Launch Prompt Profiles",
      pawWorkDir: normalizePath(pawWorkDir),
      workflowContextPath: normalizePath(workflowContextPath),
      streamlinerContextPath: normalizePath(streamlinerContextPath),
      environment: { ...input.configuration.environment },
      sessionStateRoot: normalizePath(input.sessionStateRoot),
      kickoffAdditionalInstructions: "Only pause for blockers before the final PR.",
    };
  };
}

function createContextPreparer(
  root: string,
  calls: PrepareLaunchContextPackageOptions[] = [],
): LaunchContextPreparer {
  return async (options) => {
    calls.push(options);
    return fakeContextPackage(root, options);
  };
}

async function prepareTestHandoff(root: string, graphPath: string) {
  return await preparePawLaunch({
    nodeId: "launch-prompt-profiles",
    graphPath,
    cwd: root,
    stateRoot: join(root, "state"),
    pawInitRunner: createPawInitRunner(),
    contextPreparer: createContextPreparer(root),
  });
}

function fakeTerminalLaunch(handoff: PawLaunchHandoff): NodeTerminalLaunchResponse {
  return {
    launchClaim: {
      launchClaimId: "claim-1",
      status: "pending",
      launchedAt: "2026-05-03T18:00:03.000Z",
      updatedAt: "2026-05-03T18:00:03.000Z",
      bindingWindowExpiresAt: "2026-05-03T18:05:03.000Z",
      reservedRegistryId: "reserved-1",
      boundRegistryId: null,
      boundCopilotSessionId: null,
      failureCode: null,
      failureReason: null,
      blocksLaunch: true,
      retryable: false,
    },
    terminal: { method: "powershell", pid: 733 },
    cwd: handoff.cwd,
    branch: handoff.branch,
    command: {
      cliArgs: [...handoff.cliArgs],
      promptNonceLine: "STREAMLINER_LAUNCH_NONCE=nonce-1",
    },
  };
}

afterEach(() => {
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("preparePawLaunch", () => {
  it("allows PAW init to return kickoff-only guidance through the completion tool", () => {
    expect(completePawInitToolParameters().properties).toEqual(
      expect.objectContaining({
        additionalKickoffInstructions: { type: "string" },
      }),
    );
  });

  it("puts trusted builder instructions in the first SDK prompt without source bodies", () => {
    const root = createRootDir();
    const manifestPath = join(root, "state", "copilot-sdk", "launch-manifest.json");
    const workflowInstructions = [
      "Use paw-lite with final-pr-only review.",
      "I will only review the final PR; serious blockers should stop and ask.",
    ].join("\n");
    const prompt = buildStreamlinerContextSavePrompt(
      {
        nodeId: "launch-prompt-profiles",
        graphPath: join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"),
        cwd: join(root, "streamliner"),
        sessionStateRoot: join(root, "state"),
        issueUrl: "https://github.com/lossyrob/streamliner/issues/33",
        launchNonce: "nonce-sdk",
        configuration: {
          cwd: join(root, "streamliner"),
          cliArgs: ["--yolo"],
          environment: {},
          workflowInstructions,
          terminal: {
            launchMode: "manual",
            preferredTerminal: "default",
            title: null,
            tabColor: null,
          },
        },
        preparedContext: fakePreparedContext(root),
        existingLaunch: null,
      },
      {
        manifestPath,
        launchCwdInitialBranch: "feature/session-launching-and-tracking",
      },
    );

    expect(prompt).toContain("Builder launch instructions (trusted, high priority)");
    expect(prompt).toContain(workflowInstructions);
    expect(prompt).toContain("Selected target repo Copilot instructions (.github/copilot-instructions.md)");
    expect(prompt).toContain("script/worktree-new <name>");
    expect(prompt.indexOf("Builder launch instructions")).toBeLessThan(prompt.indexOf("Launch manifest:"));
    expect(prompt).toContain(normalizePath(manifestPath));
    expect(prompt).toContain("Do not check out the target node branch in the launch cwd.");
    expect(prompt).toContain("create or reuse a sibling worktree");
    expect(prompt).not.toContain("GRAPH_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT");
    expect(prompt).not.toContain("BRIEF_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT");
    expect(prompt).not.toContain("DESIGN_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT");
    expect(prompt).not.toContain("TRACKER_BODY_SHOULD_NOT_BE_IN_INITIAL_PROMPT");
    expect(prompt).not.toContain("Source blocks are delimited");
  });

  it("puts selected repo Copilot instructions in the PAW init prompt as worktree guidance", () => {
    const root = createRootDir();
    const contextPackage = fakeContextPackage(root, {
      nodeId: "launch-prompt-profiles",
      graphPath: join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"),
    });

    const prompt = buildPawInitPrompt({
      nodeId: "launch-prompt-profiles",
      graphPath: contextPackage.metadata.graphPath,
      cwd: root,
      sessionStateRoot: join(root, "state"),
      issueUrl: "https://github.com/lossyrob/streamliner/issues/33",
      launchNonce: "nonce-sdk",
      configuration: {
        cwd: root,
        cliArgs: ["--yolo"],
        environment: {},
        workflowInstructions: "Use paw-lite with final-pr-only review.",
        terminal: {
          launchMode: "manual",
          preferredTerminal: "default",
          title: null,
          tabColor: null,
        },
      },
      stagedContextPackage: contextPackage,
      existingLaunch: null,
    });

    expect(prompt).toContain("Selected target repo Copilot instructions (.github/copilot-instructions.md)");
    expect(prompt).toContain("Create sibling worktrees with `script/worktree-new <name>`.");
    expect(prompt).not.toContain("use that helper to satisfy Streamliner's sibling-worktree requirement");
    expect(prompt).not.toContain("Do not copy them into WorkflowContext.md");
  });

  it("omits repo Copilot instruction prompt text when no instructions file is loaded", () => {
    const root = createRootDir();
    const contextPackage = fakeContextPackage(
      root,
      {
        nodeId: "launch-prompt-profiles",
        graphPath: join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"),
      },
      {
        metadata: {
          repoInstructions: fakeRepoInstructions(root, {
            exists: false,
            content: undefined,
            freshness: undefined,
            unavailableReason: "missing",
            unavailableDetail: "ENOENT",
          }),
        },
      },
    );

    const prompt = buildPawInitPrompt({
      nodeId: "launch-prompt-profiles",
      graphPath: contextPackage.metadata.graphPath,
      cwd: root,
      sessionStateRoot: join(root, "state"),
      launchNonce: "nonce-sdk",
      configuration: {
        cwd: root,
        cliArgs: [],
        environment: {},
        workflowInstructions: "Use paw-lite with final-pr-only review.",
        terminal: {
          launchMode: "manual",
          preferredTerminal: "default",
          title: null,
          tabColor: null,
        },
      },
      stagedContextPackage: contextPackage,
      existingLaunch: null,
    });

    expect(prompt).not.toContain("Selected target repo Copilot instructions");
    expect(prompt).not.toContain(".github/copilot-instructions.md");
    expect(prompt).not.toContain("Status: unavailable");
  });

  it("rejects PAW work dirs inside the launch checkout when the target branch differs", () => {
    const root = createRootDir();
    const launchCwd = join(root, "streamliner-workstream");
    expect(() =>
      validatePawWorktreePolicy({
        launchCwd,
        launchCwdInitialBranch: "feature/session-launching-and-tracking",
        targetBranch: "feature/session-event-observation",
        pawWorkDir: join(launchCwd, ".paw", "work", "session-event-observation"),
      })
    ).toThrow("create or reuse a sibling worktree");

    expect(() =>
      validatePawWorktreePolicy({
        launchCwd,
        launchCwdInitialBranch: "feature/session-launching-and-tracking",
        targetBranch: "feature/session-event-observation",
        pawWorkDir: join(root, "streamliner-session-event-observation", ".paw", "work", "session-event-observation"),
      })
    ).not.toThrow();

    expect(() =>
      validatePawWorktreePolicy({
        launchCwd,
        launchCwdInitialBranch: "feature/session-event-observation",
        targetBranch: "feature/session-event-observation",
        pawWorkDir: join(launchCwd, ".paw", "work", "session-event-observation"),
      })
    ).not.toThrow();
  });

  it("accepts PAW work dirs in selected target repository checkouts", async () => {
    const root = createRootDir();
    const targetRoot = createRootDir();
    const launchCwd = join(root, "coordination-repo");
    const targetCheckout = join(targetRoot, "target-repo-worktree");
    createGitRepo(launchCwd, "https://github.com/acme/coordination.git");
    createGitRepo(targetCheckout, "git@github.com:acme/worker-target.git");

    const preparedContext = fakePreparedContext(launchCwd);
    preparedContext.generationInput.workstream.repos = [{
      id: "worker-target",
      owner: "acme",
      name: "worker-target",
      role: "primary" as const,
    }];
    preparedContext.generationInput.node.repoIds = ["worker-target"];
    preparedContext.metadata.targetRepoIds = ["worker-target"];
    const input: PawLaunchSessionRunnerInput = {
      nodeId: "launch-prompt-profiles",
      graphPath: join(launchCwd, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"),
      cwd: launchCwd,
      sessionStateRoot: join(root, "state"),
      launchNonce: "nonce-target",
      configuration: {
        cwd: launchCwd,
        cliArgs: ["--yolo"],
        environment: {},
        workflowInstructions: "Use PAW.",
        terminal: {
          launchMode: "manual",
          preferredTerminal: "default",
          title: null,
          tabColor: null,
        },
      },
      preparedContext,
      existingLaunch: null,
    };

    await expect(
      resolvePawWorkDirForLaunch(
        input,
        "launch-prompt-profiles",
        join(targetCheckout, ".paw", "work", "launch-prompt-profiles"),
      ),
    ).resolves.toBe(join(targetCheckout, ".paw", "work", "launch-prompt-profiles"));
  }, 15_000);

  it("rejects PAW work dirs in a launch checkout from a different repository than the selected target", async () => {
    const root = createRootDir();
    const launchCwd = join(root, "coordination-repo");
    createGitRepo(launchCwd, "https://github.com/acme/coordination.git");

    const preparedContext = fakePreparedContext(launchCwd);
    preparedContext.generationInput.workstream.repos = [{
      id: "worker-target",
      owner: "acme",
      name: "worker-target",
      role: "primary" as const,
    }];
    preparedContext.generationInput.node.repoIds = ["worker-target"];
    preparedContext.metadata.targetRepoIds = ["worker-target"];
    const input: PawLaunchSessionRunnerInput = {
      nodeId: "launch-prompt-profiles",
      graphPath: join(launchCwd, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"),
      cwd: launchCwd,
      sessionStateRoot: join(root, "state"),
      launchNonce: "nonce-target",
      configuration: {
        cwd: launchCwd,
        cliArgs: ["--yolo"],
        environment: {},
        workflowInstructions: "Use PAW.",
        terminal: {
          launchMode: "manual",
          preferredTerminal: "default",
          title: null,
          tabColor: null,
        },
      },
      preparedContext,
      existingLaunch: null,
    };

    await expect(
      resolvePawWorkDirForLaunch(
        input,
        "launch-prompt-profiles",
        join(launchCwd, ".paw", "work", "launch-prompt-profiles"),
      ),
    ).rejects.toThrow("selected node target repo");
  }, 15_000);

  it("rejects PAW work dirs outside launch and selected target repositories", async () => {
    const root = createRootDir();
    const unrelatedRoot = createRootDir();
    const launchCwd = join(root, "coordination-repo");
    const unrelatedCheckout = join(unrelatedRoot, "unrelated-repo-worktree");
    createGitRepo(launchCwd, "https://github.com/acme/coordination.git");
    createGitRepo(unrelatedCheckout, "https://github.com/acme/unrelated.git");

    const preparedContext = fakePreparedContext(launchCwd);
    preparedContext.generationInput.workstream.repos = [{
      id: "worker-target",
      owner: "acme",
      name: "worker-target",
      role: "primary" as const,
    }];
    preparedContext.generationInput.node.repoIds = ["worker-target"];
    preparedContext.metadata.targetRepoIds = ["worker-target"];
    const input: PawLaunchSessionRunnerInput = {
      nodeId: "launch-prompt-profiles",
      graphPath: join(launchCwd, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"),
      cwd: launchCwd,
      sessionStateRoot: join(root, "state"),
      launchNonce: "nonce-unrelated",
      configuration: {
        cwd: launchCwd,
        cliArgs: ["--yolo"],
        environment: {},
        workflowInstructions: "Use PAW.",
        terminal: {
          launchMode: "manual",
          preferredTerminal: "default",
          title: null,
          tabColor: null,
        },
      },
      preparedContext,
      existingLaunch: null,
    };

    await expect(
      resolvePawWorkDirForLaunch(
        input,
        "launch-prompt-profiles",
        join(unrelatedCheckout, ".paw", "work", "launch-prompt-profiles"),
      ),
    ).rejects.toThrow("selected node target repo");
  }, 15_000);

  it("prepares a structured PAW handoff with defaults", async () => {
    const root = createRootDir();
    const pawCalls: PawInitRunnerInput[] = [];
    const contextCalls: PrepareLaunchContextPackageOptions[] = [];
    const result = await preparePawLaunch({
      nodeId: "launch-prompt-profiles",
      cwd: root,
      stateRoot: join(root, "state"),
      launchNonce: "nonce-123",
      configuration: {
        workflowInstructions: "Use PAW final-pr-only with no intermediate pauses.",
        environment: { STREAMLINER_LOG_LEVEL: "debug" },
      },
      defaultCliArgs: ["--yolo"],
      pawInitRunner: createPawInitRunner(pawCalls),
      contextPreparer: createContextPreparer(root, contextCalls),
    });

    const expectedWorkDir = join(root, ".paw", "work", "launch-prompt-profiles");
    expect(contextCalls[0]).toEqual(
      expect.objectContaining({
        nodeId: "launch-prompt-profiles",
        launchNonce: "nonce-123",
      }),
    );
    expect(contextCalls[0]).not.toHaveProperty("outputDir");
    expect(pawCalls[0]).toEqual(
      expect.objectContaining({
        issueUrl: "https://github.com/lossyrob/streamliner/issues/33",
        stagedContextPackage: expect.objectContaining({
          contextFilePath: normalizePath(join(root, "state", "streamliner", "session-launching-and-tracking", "launch-contexts", "ctx-prepared", "context.md")),
        }),
        configuration: expect.objectContaining({
          workflowInstructions: "Use PAW final-pr-only with no intermediate pauses.",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        cwd: normalizePath(root),
        branch: "feature/launch-prompt-profiles",
        pawWorkDir: normalizePath(expectedWorkDir),
        workflowContextPath: normalizePath(join(expectedWorkDir, "WorkflowContext.md")),
        streamlinerContextPath: normalizePath(join(expectedWorkDir, "streamliner", "context.md")),
        cliArgs: ["--yolo"],
        terminal: {
          launchMode: "manual",
          preferredTerminal: "default",
          title: "Launch Prompt Profiles",
          tabColor: null,
        },
        environment: { STREAMLINER_LOG_LEVEL: "debug" },
        sessionStateRoot: normalizePath(join(root, "state")),
      }),
    );
    expect(result.launchMetadata).toEqual(
      expect.objectContaining({
        launchNonce: "nonce-123",
        launchClaimRef: null,
        projectKey: "streamliner",
        workstreamId: "session-launching-and-tracking",
        nodeId: "launch-prompt-profiles",
        targetRepoIds: ["streamliner"],
        trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
      }),
    );
  });

  it("defaults launch cwd to the graph repo root when the server cwd differs", async () => {
    const root = createRootDir();
    const serverRoot = join(root, "streamliner-server");
    const graphRepoRoot = join(root, "dbagent-worktree");
    const graphPath = join(
      graphRepoRoot,
      ".streamliner",
      "workstreams",
      "local-scenario-iteration-loop",
      "graph.json",
    );
    mkdirSync(dirname(graphPath), { recursive: true });
    writeFileSync(
      graphPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "local-scenario-iteration-loop",
        projectKey: "dbagent",
        title: "Local Scenario Iteration Loop",
        summary: "Exercise PAW launch cwd selection.",
        status: "active",
        attention: "focus",
        createdAt: "2026-05-04T19:00:00.000Z",
        updatedAt: "2026-05-04T19:00:00.000Z",
        repos: [
          {
            id: "dbagent",
            owner: "lossyrob",
            name: "dbagent",
            role: "primary",
          },
        ],
        designRefs: [],
        nodes: [
          {
            id: "runner-diagnostics-resume",
            type: "task",
            title: "Runner diagnostics resume",
            summary: "Initialize PAW from a graph outside the Streamliner server checkout.",
            status: "ready",
            attention: "focus",
            repoIds: ["dbagent"],
            dependsOn: [],
          },
        ],
        checkpoints: [],
      }),
      "utf8",
    );

    const runnerCalls: PawLaunchSessionRunnerInput[] = [];
    const result = await preparePawLaunch({
      nodeId: "runner-diagnostics-resume",
      graphPath,
      cwd: serverRoot,
      stateRoot: join(root, "state"),
      pawLaunchRunner: async (input) => {
        runnerCalls.push(input);
        const workId = "runner-diagnostics-resume";
        const pawWorkDir = join(input.cwd, ".paw", "work", workId);
        return {
          cwd: normalizePath(input.cwd),
          branch: "feature/runner-diagnostics-resume-2",
          workId,
          workTitle: "Runner Diagnostics Resume",
          pawWorkDir: normalizePath(pawWorkDir),
          workflowContextPath: normalizePath(join(pawWorkDir, "WorkflowContext.md")),
          streamlinerContextPath: normalizePath(join(pawWorkDir, "streamliner", "context.md")),
          sessionStateRoot: normalizePath(input.sessionStateRoot),
          contextPackage: {
            contextId: input.preparedContext.metadata.contextId,
            contextPackagePath: normalizePath(input.preparedContext.contextPackagePath),
            contextFilePath: normalizePath(input.preparedContext.contextFilePath),
            metadata: input.preparedContext.metadata,
            unavailableInputs: input.preparedContext.metadata.unavailableInputs,
          },
        };
      },
    });

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toEqual(
      expect.objectContaining({
        cwd: graphRepoRoot,
        configuration: expect.objectContaining({
          cwd: graphRepoRoot,
        }),
      }),
    );
    expect(result.cwd).toBe(normalizePath(graphRepoRoot));
    expect(result.pawWorkDir).toBe(
      normalizePath(join(graphRepoRoot, ".paw", "work", "runner-diagnostics-resume")),
    );
  });

  it("defaults launch cwd to the selected target repo from project config", async () => {
    const root = createRootDir();
    const serverRoot = join(root, "streamliner-server");
    const orchestrationRoot = join(root, "streamliner");
    const targetRepoRoot = join(root, "vs-code-postgresql");
    const workstreamDir = join(
      orchestrationRoot,
      ".streamliner",
      "workstreams",
      "edit-table-data-experience",
    );
    const graphPath = join(workstreamDir, "graph.json");
    mkdirSync(workstreamDir, { recursive: true });
    mkdirSync(join(targetRepoRoot, "docs", "design"), { recursive: true });
    mkdirSync(join(targetRepoRoot, ".github"), { recursive: true });
    writeFileSync(
      join(targetRepoRoot, ".github", "copilot-instructions.md"),
      [
        "# Extension repo instructions",
        "",
        "- Create worktrees with `script/worktree-new <name>`.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(orchestrationRoot, ".streamliner", "config.json"),
      JSON.stringify({
        version: 1,
        workstreamsDir: "workstreams",
        repos: {
          "vs-code-postgresql": {
            path: "../../vs-code-postgresql",
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(workstreamDir, "brief.md"),
      "# Edit table data experience\n\nTarget the extension repository.\n",
      "utf8",
    );
    writeFileSync(
      join(targetRepoRoot, "docs", "design", "index.md"),
      "# Target Repo Design\n",
      "utf8",
    );
    writeFileSync(
      graphPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "edit-table-data-experience",
        projectKey: "postgres-tools",
        title: "Edit table data experience",
        summary: "Exercise configured launch cwd selection.",
        status: "active",
        attention: "focus",
        createdAt: "2026-05-04T19:00:00.000Z",
        updatedAt: "2026-05-04T19:00:00.000Z",
        repos: [
          {
            id: "vs-code-postgresql",
            owner: "microsoft",
            name: "vscode-postgresql",
            role: "primary",
          },
        ],
        designRefs: [],
        nodes: [
          {
            id: "extension-table-editing",
            type: "task",
            title: "Extension table editing",
            summary: "Initialize PAW in the target extension repo.",
            status: "ready",
            attention: "focus",
            repoIds: ["vs-code-postgresql"],
            dependsOn: [],
          },
        ],
        checkpoints: [],
      }),
      "utf8",
    );

    const runnerCalls: PawLaunchSessionRunnerInput[] = [];
    const result = await preparePawLaunch({
      nodeId: "extension-table-editing",
      graphPath,
      cwd: serverRoot,
      stateRoot: join(root, "state"),
      pawLaunchRunner: async (input) => {
        runnerCalls.push(input);
        const workId = "extension-table-editing";
        const pawWorkDir = join(input.cwd, ".paw", "work", workId);
        return {
          cwd: normalizePath(input.cwd),
          branch: "feature/extension-table-editing",
          workId,
          workTitle: "Extension Table Editing",
          pawWorkDir: normalizePath(pawWorkDir),
          workflowContextPath: normalizePath(join(pawWorkDir, "WorkflowContext.md")),
          streamlinerContextPath: normalizePath(join(pawWorkDir, "streamliner", "context.md")),
          sessionStateRoot: normalizePath(input.sessionStateRoot),
          contextPackage: {
            contextId: input.preparedContext.metadata.contextId,
            contextPackagePath: normalizePath(input.preparedContext.contextPackagePath),
            contextFilePath: normalizePath(input.preparedContext.contextFilePath),
            metadata: input.preparedContext.metadata,
            unavailableInputs: input.preparedContext.metadata.unavailableInputs,
          },
        };
      },
    });

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toEqual(
      expect.objectContaining({
        cwd: targetRepoRoot,
        configuration: expect.objectContaining({
          cwd: targetRepoRoot,
        }),
      }),
    );
    expect(result.cwd).toBe(normalizePath(targetRepoRoot));
    expect(result.contextPackage.metadata.repoRoot).toBe(normalizePath(targetRepoRoot));
    expect(result.contextPackage.metadata.repoInstructions).toEqual(expect.objectContaining({
      repoId: "vs-code-postgresql",
      repoRoot: normalizePath(targetRepoRoot),
      path: ".github/copilot-instructions.md",
      content: expect.stringContaining("script/worktree-new <name>"),
    }));
    expect(result.pawWorkDir).toBe(
      normalizePath(join(targetRepoRoot, ".paw", "work", "extension-table-editing")),
    );
  });

  it("honors explicit empty CLI args instead of reapplying defaults", async () => {
    const root = createRootDir();
    const result = await preparePawLaunch({
      nodeId: "launch-prompt-profiles",
      cwd: root,
      stateRoot: join(root, "state"),
      configuration: {
        cliArgs: [],
      },
      pawInitRunner: createPawInitRunner(),
      contextPreparer: createContextPreparer(root),
    });

    expect(result.cliArgs).toEqual([]);
  });

  it("uses injected default CLI args when launch configuration omits them", async () => {
    const root = createRootDir();
    const result = await preparePawLaunch({
      nodeId: "launch-prompt-profiles",
      cwd: root,
      stateRoot: join(root, "state"),
      defaultCliArgs: ["--model=gpt-5.5", "--yolo"],
      pawInitRunner: createPawInitRunner(),
      contextPreparer: createContextPreparer(root),
    });

    expect(result.cliArgs).toEqual(["--model=gpt-5.5", "--yolo"]);
  });

  it("blocks PAW preparation before context work when policy requires a GitHub issue", async () => {
    const root = createRootDir();
    const graphPath = writeLaunchPolicyGraph(root, {
      launchPolicy: { requiredTracker: "github-issue" },
    });
    const contextCalls: PrepareLaunchContextPackageOptions[] = [];

    await expect(
      preparePawLaunch({
        nodeId: "launch-prompt-profiles",
        graphPath,
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root, contextCalls),
      }),
    ).rejects.toMatchObject({
      code: "launch_policy_blocked",
      statusCode: 412,
      step: "validation",
      input: "launchPolicy",
      details: expect.objectContaining({
        policyCode: "github_issue_tracker_required",
        requiredTracker: "github-issue",
        nodeId: "launch-prompt-profiles",
      }),
    });
    expect(contextCalls).toHaveLength(0);
  });

  it("allows PAW preparation when required GitHub issue tracker is present", async () => {
    const root = createRootDir();
    const graphPath = writeLaunchPolicyGraph(root, {
      launchPolicy: { requiredTracker: "github-issue" },
      tracker: {
        type: "github",
        owner: "lossyrob",
        repo: "streamliner",
        number: 33,
      },
    });

    const result = await preparePawLaunch({
      nodeId: "launch-prompt-profiles",
      graphPath,
      cwd: root,
      stateRoot: join(root, "state"),
      pawInitRunner: createPawInitRunner(),
      contextPreparer: createContextPreparer(root),
    });

    expect(result.launchMetadata.nodeId).toBe("launch-prompt-profiles");
  });

  it("uses workstream terminal defaults when launch configuration omits them", async () => {
    const root = createRootDir();
    const pawInitCalls: PawInitRunnerInput[] = [];
    const graphPath = writeLaunchPolicyGraph(root, {
      tracker: {
        type: "github",
        owner: "lossyrob",
        repo: "streamliner",
        number: 33,
      },
      launchDefaults: {
        terminal: {
          preferredTerminal: "windows-terminal",
          titleTemplate: "{githubIssue} - {nodeTitle}",
          tabColor: "#4891c8",
        },
      },
    });

    const result = await preparePawLaunch({
      nodeId: "launch-prompt-profiles",
      graphPath,
      cwd: root,
      stateRoot: join(root, "state"),
      configuration: {
        terminal: { tabColor: "#ff8c0a" },
      },
      pawInitRunner: createPawInitRunner(pawInitCalls),
      contextPreparer: createContextPreparer(root),
    });

    expect(result.terminal).toEqual(expect.objectContaining({
      preferredTerminal: "windows-terminal",
      title: "#33 - Launch prompt profiles",
      tabColor: "#ff8c0a",
    }));
    expect(pawInitCalls[0].configuration.terminal).toEqual(expect.objectContaining({
      preferredTerminal: "windows-terminal",
      title: "#33 - Launch prompt profiles",
      tabColor: "#ff8c0a",
    }));
  });

  it("validates launch configuration field types", async () => {
    const root = createRootDir();

    await expect(
      preparePawLaunch({
        nodeId: "launch-prompt-profiles",
        cwd: root,
        stateRoot: join(root, "state"),
        configuration: {
          workflowInstructions: 42 as unknown as string,
        },
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      }),
    ).rejects.toMatchObject({
      code: "invalid_launch_configuration",
      statusCode: 400,
      step: "validation",
      input: "configuration.workflowInstructions",
    });

    await expect(
      preparePawLaunch({
        nodeId: "launch-prompt-profiles",
        cwd: root,
        stateRoot: join(root, "state"),
        configuration: {
          terminal: { preferredTerminal: "fish" as never },
        },
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      }),
    ).rejects.toMatchObject({
      code: "invalid_launch_configuration",
      statusCode: 400,
      step: "validation",
      input: "configuration.terminal.preferredTerminal",
    });
  });

  it("builds kickoff prompts with prepared context paths", async () => {
    const root = createRootDir();
    const result = await preparePawLaunch({
      nodeId: "launch-prompt-profiles",
      cwd: root,
      stateRoot: join(root, "state"),
      configuration: {
        workflowInstructions: "Prefer final PR review only unless blocked.",
      },
      pawInitRunner: createPawInitRunner(),
      contextPreparer: createContextPreparer(root),
    });

    expect(result.kickoffPrompt).toContain("GitHub Issue: https://github.com/lossyrob/streamliner/issues/33");
    expect(result.kickoffPrompt).toContain(`PAW workflow context:\n${result.workflowContextPath}`);
    expect(result.kickoffPrompt).toContain(`Streamliner Launch Context:\n${result.streamlinerContextPath}`);
    expect(result.kickoffPrompt).toContain("Start by loading the paw-lite workflow");
    expect(result.kickoffPrompt).toContain("Only pause for blockers before the final PR.");
    expect(result.kickoffPrompt).not.toContain("Prefer final PR review only unless blocked.");
  });

  it("wraps PAW init failures with a typed preparation error", async () => {
    const root = createRootDir();

    await expect(
      preparePawLaunch({
        nodeId: "launch-prompt-profiles",
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: async () => {
          throw new Error("init exploded");
        },
        contextPreparer: createContextPreparer(root),
      }),
    ).rejects.toMatchObject({
      code: "paw_init_failed",
      statusCode: 500,
      step: "paw-init",
      input: "pawInitRunner",
      message: "init exploded",
    });
  });

  it("wraps context preparation failures with a typed preparation error", async () => {
    const root = createRootDir();

    await expect(
      preparePawLaunch({
        nodeId: "launch-prompt-profiles",
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: async () => {
          throw new LaunchContextPreparationError(
            "context_generation_failed",
            500,
            "context failed",
          );
        },
      }),
    ).rejects.toMatchObject({
      code: "context_preparation_failed",
      statusCode: 500,
      step: "context-preparation",
      input: "context_generation_failed",
      message: "context failed",
    });
  });

  it("rejects missing selected-node context packages explicitly", async () => {
    const root = createRootDir();

    await expect(
      preparePawLaunch({
        nodeId: "launch-prompt-profiles",
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: async (options) => fakeContextPackage(root, options, {
          contextPackagePath: "",
          contextFilePath: "",
          metadata: {
            contextPackagePath: "",
            contextFilePath: "",
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "missing_context_package",
      statusCode: 500,
      step: "context-preparation",
      input: "contextPackage",
    });
  });
});

describe("launch preparation API route", () => {
  it("prepares a PAW launch through POST /api/launch-preparations", async () => {
    const root = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/launch-preparations")
      .send({
        nodeId: "launch-prompt-profiles",
        launchNonce: "nonce-route",
        configuration: {
          cliArgs: [],
          workflowInstructions: "Use PAW with local final-pr-only review.",
        },
      })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        branch: "feature/launch-prompt-profiles",
        cliArgs: [],
        streamlinerContextPath: expect.stringContaining("streamliner/context.md"),
        launchMetadata: expect.objectContaining({
          launchNonce: "nonce-route",
          nodeId: "launch-prompt-profiles",
        }),
      }),
    );
    expect(response.body.kickoffPrompt).toContain("Start by loading the paw-lite workflow");
  });

  it("returns a typed policy error through POST /api/launch-preparations", async () => {
    const root = createRootDir();
    const graphPath = writeLaunchPolicyGraph(root, {
      launchPolicy: { requiredTracker: "github-issue" },
    });
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      graphPath,
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/launch-preparations")
      .send({ nodeId: "launch-prompt-profiles" })
      .expect(412);

    expect(response.body).toEqual(expect.objectContaining({
      code: "launch_policy_blocked",
      step: "validation",
      input: "launchPolicy",
      error: expect.stringContaining("requires a GitHub issue tracker"),
      details: expect.objectContaining({
        policyCode: "github_issue_tracker_required",
        requiredTracker: "github-issue",
        nodeId: "launch-prompt-profiles",
      }),
    }));
  });

  it("passes an existing prepared launch record into repeat PAW initialization", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root, {
      tracker: {
        type: "github",
        owner: "lossyrob",
        repo: "streamliner",
        number: 33,
      },
    }));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });
    const pawCalls: PawInitRunnerInput[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        nodeLaunchRecordStore,
        pawInitRunner: createPawInitRunner(pawCalls),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    await request(api.app)
      .post("/api/launch-preparations")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(200);
    await request(api.app)
      .post("/api/launch-preparations")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(200);

    expect(pawCalls).toHaveLength(2);
    expect(pawCalls[0].existingLaunch).toBeNull();
    expect(pawCalls[1].existingLaunch).toEqual(
      expect.objectContaining({
        graphPath,
        nodeId: "launch-prompt-profiles",
        branch: "feature/launch-prompt-profiles",
        workId: "launch-prompt-profiles",
        pawWorkDir: normalizePath(join(root, ".paw", "work", "launch-prompt-profiles")),
        pathStatus: expect.objectContaining({
          cwdExists: true,
          pawWorkDirExists: true,
          workflowContextExists: true,
          streamlinerContextExists: true,
        }),
      }),
    );
  });

  it("starts a PAW launch preparation run and exposes the completed result", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const started = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        configuration: {
          cliArgs: [],
          workflowInstructions: "Use PAW with local final-pr-only review.",
        },
      })
      .expect(202);

    expect(started.body).toEqual(expect.objectContaining({
      runId: expect.any(String),
    }));
    let snapshot = await request(api.app)
      .get(`/api/launch-preparations/runs/${started.body.runId}`)
      .expect(200);
    for (let attempt = 0; attempt < 20 && snapshot.body.status !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      snapshot = await request(api.app)
        .get(`/api/launch-preparations/runs/${started.body.runId}`)
        .expect(200);
    }

    expect(snapshot.body).toEqual(expect.objectContaining({
      runId: started.body.runId,
      status: "succeeded",
      result: expect.objectContaining({
        branch: "feature/launch-prompt-profiles",
        cliArgs: [],
      }),
      events: expect.arrayContaining([
        expect.objectContaining({ name: "completed" }),
      ]),
    }));

    const launchRecord = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath,
        nodeId: "launch-prompt-profiles",
      })
      .expect(200);

    expect(launchRecord.body.record).toEqual(expect.objectContaining({
      branch: "feature/launch-prompt-profiles",
      nodeId: "launch-prompt-profiles",
      pawWorkDir: expect.stringContaining(".paw"),
      workflowContextPath: expect.stringContaining("WorkflowContext.md"),
      streamlinerContextPath: expect.stringContaining("streamliner/context.md"),
      pathStatus: expect.objectContaining({
        workflowContextExists: true,
        streamlinerContextExists: true,
      }),
    }));
    expect(launchRecord.body.operation).toEqual(expect.objectContaining({
      status: "prepared",
      preparationRunId: started.body.runId,
      handoff: expect.objectContaining({
        branch: "feature/launch-prompt-profiles",
        workflowContextPath: expect.stringContaining("WorkflowContext.md"),
      }),
    }));
  });

  it("launches terminal and companion from a post-preparation run on the server", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalLaunches: TerminalLaunchOptions[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: (options) => {
          terminalLaunches.push(options);
          return { method: "powershell", pid: 700 + terminalLaunches.length };
        },
      },
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const started = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        configuration: {
          cliArgs: ["--yolo"],
          workflowInstructions: "Use PAW with local final-pr-only review.",
        },
        postPreparation: {
          launchTerminal: {
            terminalTitle: "Server Launch",
            terminalColor: "#123abc",
          },
          launchCompanion: {
            kickoffPrompt: "Review the prepared implementation.",
          },
        },
      })
      .expect(202);

    expect(started.body.operation).toEqual(expect.objectContaining({
      status: "preparing",
      postPreparation: expect.objectContaining({
        launchTerminal: expect.objectContaining({
          terminalTitle: "Server Launch",
          terminalColor: "#123abc",
        }),
        launchCompanion: {
          kickoffPrompt: "Review the prepared implementation.",
        },
      }),
    }));

    const snapshot = await waitForLaunchPreparationRun(api, started.body.runId);

    expect(terminalLaunches).toHaveLength(2);
    expect(terminalLaunches[0]).toEqual(expect.objectContaining({
      title: "Server Launch",
      tabColor: "#123abc",
      preferredTerminal: "default",
    }));
    expect(terminalLaunches[1]).toEqual(expect.objectContaining({
      title: "Server Launch REVIEW",
      tabColor: "#123abc",
    }));
    expect(String(terminalLaunches[1].command)).toContain("--agent=PAW-Review");
    expect(String(terminalLaunches[1].command)).toContain("Review the prepared implementation.");

    expect(snapshot.body).toEqual(expect.objectContaining({
      status: "succeeded",
      postPreparation: expect.objectContaining({
        terminal: expect.objectContaining({ status: "launched" }),
        companion: expect.objectContaining({ status: "launched" }),
        operation: expect.objectContaining({
          status: "launched_pending_binding",
          companionLaunch: expect.objectContaining({
            terminal: { method: "powershell", pid: 702 },
          }),
        }),
      }),
      events: expect.arrayContaining([
        expect.objectContaining({ name: "terminal_launched" }),
        expect.objectContaining({ name: "companion_launched" }),
        expect.objectContaining({ name: "completed" }),
      ]),
    }));

    const launchRecord = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath,
        nodeId: "launch-prompt-profiles",
      })
      .expect(200);
    expect(launchRecord.body.operation).toEqual(expect.objectContaining({
      status: "launched_pending_binding",
      terminalLaunch: expect.objectContaining({
        terminal: { method: "powershell", pid: 701 },
      }),
      companionLaunch: expect.objectContaining({
        terminal: { method: "powershell", pid: 702 },
      }),
      companionError: null,
    }));
  });

  it("launches an ad hoc post-preparation companion without PAW-Review agent injection", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalLaunches: TerminalLaunchOptions[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: (options) => {
          terminalLaunches.push(options);
          return { method: "powershell", pid: 720 + terminalLaunches.length };
        },
      },
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const started = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        configuration: {
          cliArgs: ["--yolo"],
          workflowInstructions: "Use PAW with local final-pr-only review.",
        },
        postPreparation: {
          launchTerminal: {
            terminalTitle: "Server Launch",
          },
          launchCompanion: {
            kickoffPrompt: "Review the prepared implementation.",
            usePawReviewAgent: false,
          },
        },
      })
      .expect(202);

    expect(started.body.operation).toEqual(expect.objectContaining({
      postPreparation: expect.objectContaining({
        launchCompanion: {
          kickoffPrompt: "Review the prepared implementation.",
          usePawReviewAgent: false,
        },
      }),
    }));

    const snapshot = await waitForLaunchPreparationRun(api, started.body.runId);

    expect(terminalLaunches).toHaveLength(2);
    expect(String(terminalLaunches[1].command)).not.toContain("--agent=PAW-Review");
    expect(String(terminalLaunches[1].command)).toContain("--yolo");
    expect(snapshot.body).toEqual(expect.objectContaining({
      status: "succeeded",
      postPreparation: expect.objectContaining({
        companion: expect.objectContaining({ status: "launched" }),
      }),
    }));

    const launchRecord = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath,
        nodeId: "launch-prompt-profiles",
      })
      .expect(200);
    expect(launchRecord.body.operation.postPreparation.launchCompanion).toEqual({
      kickoffPrompt: "Review the prepared implementation.",
      usePawReviewAgent: false,
    });
  });

  it("reports terminal post-preparation failures and skips companion launch", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalLaunches: TerminalLaunchOptions[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: (options) => {
          terminalLaunches.push(options);
          throw new Error("terminal unavailable");
        },
      },
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const started = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        postPreparation: {
          launchTerminal: {},
          launchCompanion: {
            kickoffPrompt: "Review should not start.",
          },
        },
      })
      .expect(202);

    const snapshot = await waitForLaunchPreparationRun(api, started.body.runId);

    expect(terminalLaunches).toHaveLength(1);
    expect(snapshot.body.postPreparation).toEqual(expect.objectContaining({
      terminal: expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({
          code: "terminal_spawn_failed",
          error: expect.stringContaining("terminal unavailable"),
        }),
      }),
      companion: { status: "skipped" },
      operation: expect.objectContaining({
        status: "terminal_failed",
      }),
    }));
    expect(snapshot.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "terminal_failed" }),
      expect.objectContaining({ name: "completed" }),
    ]));
    expect(snapshot.body.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "companion_launched" }),
    ]));
  });

  it("keeps terminal launch success when the post-preparation companion fails", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalLaunches: TerminalLaunchOptions[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: (options) => {
          terminalLaunches.push(options);
          if (terminalLaunches.length === 2) {
            throw new Error("companion unavailable");
          }
          return { method: "powershell", pid: 711 };
        },
      },
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const started = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        postPreparation: {
          launchTerminal: {},
          launchCompanion: {
            kickoffPrompt: "Review the launch.",
          },
        },
      })
      .expect(202);

    const snapshot = await waitForLaunchPreparationRun(api, started.body.runId);

    expect(terminalLaunches).toHaveLength(2);
    expect(snapshot.body.postPreparation).toEqual(expect.objectContaining({
      terminal: expect.objectContaining({ status: "launched" }),
      companion: expect.objectContaining({
        status: "failed",
        error: {
          code: "post_preparation_launch_failed",
          error: "companion unavailable",
        },
      }),
      operation: expect.objectContaining({
        status: "launched_pending_binding",
        companionError: expect.objectContaining({
          code: "post_preparation_launch_failed",
          error: "companion unavailable",
        }),
      }),
    }));
    expect(snapshot.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "terminal_launched" }),
      expect.objectContaining({ name: "companion_failed" }),
      expect.objectContaining({ name: "completed" }),
    ]));
  });

  it("does not run post-preparation launch when preparation fails", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalLaunches: TerminalLaunchOptions[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: (options) => {
          terminalLaunches.push(options);
          return { method: "powershell", pid: 711 };
        },
      },
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: () => {
          throw new LaunchContextPreparationError(
            "context_generation_failed",
            500,
            "Context exploded.",
          );
        },
      },
    });
    activeApps.push(api);

    const started = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        postPreparation: {
          launchTerminal: {},
        },
      })
      .expect(202);

    const snapshot = await waitForLaunchPreparationRun(api, started.body.runId, "failed");

    expect(terminalLaunches).toHaveLength(0);
    expect(snapshot.body.error).toEqual(expect.objectContaining({
      code: "context_preparation_failed",
      error: "Context exploded.",
    }));
    const launchRecord = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath,
        nodeId: "launch-prompt-profiles",
      })
      .expect(200);
    expect(launchRecord.body.operation).toEqual(expect.objectContaining({
      status: "preparation_failed",
      postPreparation: { launchTerminal: {} },
      terminalLaunch: null,
    }));
  });

  it("records duplicate active post-preparation terminal failures", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(root, "claims") });
    const terminalLaunches: TerminalLaunchOptions[] = [];
    const api = createStreamlinerApiApp({
      store,
      launchClaimStore: claimStore,
      nodeLaunchRecordsPath: join(root, "state", "node-launch-records.json"),
      nodeLaunchDeps: {
        launchTerminal: (options) => {
          terminalLaunches.push(options);
          return { method: "powershell", pid: 720 + terminalLaunches.length };
        },
      },
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    const first = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        postPreparation: { launchTerminal: {} },
      })
      .expect(202);
    await waitForLaunchPreparationRun(api, first.body.runId);
    expect(terminalLaunches).toHaveLength(1);

    const duplicate = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
        postPreparation: { launchTerminal: {} },
      })
      .expect(202);

    const snapshot = await waitForLaunchPreparationRun(api, duplicate.body.runId);

    expect(terminalLaunches).toHaveLength(1);
    expect(snapshot.body.postPreparation).toEqual(expect.objectContaining({
      terminal: expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({
          code: "duplicate_active_launch",
        }),
      }),
      operation: expect.objectContaining({
        status: "terminal_failed",
        error: expect.objectContaining({
          code: "duplicate_active_launch",
        }),
      }),
    }));
  });

  it("recovers prepared operations waiting for post-preparation terminal launch", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const handoff = await prepareTestHandoff(root, graphPath);
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });

    await nodeLaunchRecordStore.startPreparationOperation({
      graphPath,
      nodeId: "launch-prompt-profiles",
      runId: "run-orphaned",
      postPreparation: { launchTerminal: {} },
      now: new Date("2026-05-03T18:00:00.000Z"),
    });
    await nodeLaunchRecordStore.markPreparationSucceeded(
      handoff,
      new Date("2026-05-03T18:00:01.000Z"),
    );

    const recovered = await nodeLaunchRecordStore.recoverOrphanedOperations(
      new Date("2026-05-03T18:05:00.000Z"),
    );
    const operation = await nodeLaunchRecordStore.getOperation(graphPath, "launch-prompt-profiles");

    expect(recovered).toHaveLength(1);
    expect(operation).toEqual(expect.objectContaining({
      status: "preparation_failed",
      postPreparation: { launchTerminal: {} },
      error: expect.objectContaining({
        code: "operation_orphaned",
      }),
    }));
  });

  it("allows manual release of prepared operations waiting for post-preparation terminal launch", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const handoff = await prepareTestHandoff(root, graphPath);
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });

    await nodeLaunchRecordStore.startPreparationOperation({
      graphPath,
      nodeId: "launch-prompt-profiles",
      runId: "run-release",
      postPreparation: { launchTerminal: {} },
    });
    await nodeLaunchRecordStore.markPreparationSucceeded(handoff);

    const released = await nodeLaunchRecordStore.releaseActiveOperation({
      graphPath,
      nodeId: "launch-prompt-profiles",
      reason: "release pending post-preparation launch",
      now: new Date("2026-05-03T18:06:00.000Z"),
    });

    expect(released).toEqual(expect.objectContaining({
      status: "preparation_failed",
      error: expect.objectContaining({
        code: "operation_released_by_user",
        error: "release pending post-preparation launch",
      }),
    }));
  });

  it("recovers orphaned post-preparation companion launches without clearing terminal success", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const handoff = await prepareTestHandoff(root, graphPath);
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });

    await nodeLaunchRecordStore.startPreparationOperation({
      graphPath,
      nodeId: "launch-prompt-profiles",
      runId: "run-companion-orphaned",
      postPreparation: {
        launchTerminal: {},
        launchCompanion: { kickoffPrompt: "Review this." },
      },
    });
    await nodeLaunchRecordStore.markPreparationSucceeded(handoff);
    await nodeLaunchRecordStore.markPostPreparationTerminalLaunching(handoff);
    await nodeLaunchRecordStore.markTerminalLaunched(handoff, fakeTerminalLaunch(handoff));

    const recovered = await nodeLaunchRecordStore.recoverOrphanedOperations(
      new Date("2026-05-03T18:07:00.000Z"),
    );
    const operation = await nodeLaunchRecordStore.getOperation(graphPath, "launch-prompt-profiles");

    expect(recovered).toHaveLength(1);
    expect(operation).toEqual(expect.objectContaining({
      status: "launched_pending_binding",
      terminalLaunch: expect.objectContaining({
        terminal: { method: "powershell", pid: 733 },
      }),
      companionLaunch: null,
      companionError: expect.objectContaining({
        code: "companion_operation_orphaned",
      }),
    }));
  });

  it("blocks duplicate preparation runs for the same graph node while allowing the first to continue", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    let releaseContext!: () => void;
    const blockedContext = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: async (options) => {
          await blockedContext;
          return fakeContextPackage(root, options);
        },
      },
    });
    activeApps.push(api);

    const first = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(202);

    const duplicate = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(409);

    expect(duplicate.body).toEqual(expect.objectContaining({
      code: "duplicate_active_launch_operation",
      operation: expect.objectContaining({
        status: "preparing",
        preparationRunId: first.body.runId,
      }),
    }));

    releaseContext();
    let snapshot = await request(api.app)
      .get(`/api/launch-preparations/runs/${first.body.runId}`)
      .expect(200);
    for (let attempt = 0; attempt < 20 && snapshot.body.status !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      snapshot = await request(api.app)
        .get(`/api/launch-preparations/runs/${first.body.runId}`)
        .expect(200);
    }
    expect(snapshot.body.status).toBe("succeeded");
  });

  it("uses the same duplicate operation gate for synchronous launch preparation", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    let releaseContext!: () => void;
    const blockedContext = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: async (options) => {
          await blockedContext;
          return fakeContextPackage(root, options);
        },
      },
    });
    activeApps.push(api);

    const first = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(202);

    const duplicate = await request(api.app)
      .post("/api/launch-preparations")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(409);

    expect(duplicate.body).toEqual(expect.objectContaining({
      code: "duplicate_active_launch_operation",
      operation: expect.objectContaining({
        status: "preparing",
        preparationRunId: first.body.runId,
      }),
    }));

    releaseContext();
    let snapshot = await request(api.app)
      .get(`/api/launch-preparations/runs/${first.body.runId}`)
      .expect(200);
    for (let attempt = 0; attempt < 20 && snapshot.body.status !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      snapshot = await request(api.app)
        .get(`/api/launch-preparations/runs/${first.body.runId}`)
        .expect(200);
    }
    expect(snapshot.body.status).toBe("succeeded");
  });

  it("persists failed preparation operations and allows retry", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(writeLaunchPolicyGraph(root));
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    let failContext = true;
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: async (options) => {
          if (failContext) {
            throw new LaunchContextPreparationError(
              "context_generation_failed",
              500,
              "Context exploded.",
            );
          }
          return fakeContextPackage(root, options);
        },
      },
    });
    activeApps.push(api);

    const failedStart = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(202);

    let failedSnapshot = await request(api.app)
      .get(`/api/launch-preparations/runs/${failedStart.body.runId}`)
      .expect(200);
    for (let attempt = 0; attempt < 20 && failedSnapshot.body.status !== "failed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      failedSnapshot = await request(api.app)
        .get(`/api/launch-preparations/runs/${failedStart.body.runId}`)
        .expect(200);
    }
    expect(failedSnapshot.body.status).toBe("failed");

    const launchRecord = await request(api.app)
      .get("/api/node-launch-records")
      .query({
        graphPath,
        nodeId: "launch-prompt-profiles",
      })
      .expect(200);
    expect(launchRecord.body.operation).toEqual(expect.objectContaining({
      status: "preparation_failed",
      preparationRunId: failedStart.body.runId,
      handoff: null,
      error: expect.objectContaining({
        code: "context_preparation_failed",
        error: "Context exploded.",
      }),
    }));

    failContext = false;
    const retry = await request(api.app)
      .post("/api/launch-preparations/runs")
      .send({
        nodeId: "launch-prompt-profiles",
        graphPath,
      })
      .expect(202);
    expect(retry.body.operation).toEqual(expect.objectContaining({
      status: "preparing",
      preparationRunId: retry.body.runId,
      error: null,
    }));
    let retrySnapshot = await request(api.app)
      .get(`/api/launch-preparations/runs/${retry.body.runId}`)
      .expect(200);
    for (let attempt = 0; attempt < 20 && retrySnapshot.body.status !== "succeeded"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      retrySnapshot = await request(api.app)
        .get(`/api/launch-preparations/runs/${retry.body.runId}`)
        .expect(200);
    }
    expect(retrySnapshot.body.status).toBe("succeeded");
  });

  it("serializes concurrent operation writes for distinct graph nodes", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"));
    const nodeLaunchRecordStore = new NodeLaunchRecordStore({
      recordsPath: join(root, "state", "node-launch-records.json"),
    });

    await nodeLaunchRecordStore.startPreparationOperation({
      graphPath,
      nodeId: "launch-prompt-profiles",
      runId: "run-a",
      now: new Date("2026-05-03T18:00:00.000Z"),
    });
    await nodeLaunchRecordStore.startPreparationOperation({
      graphPath,
      nodeId: "runtime-overlay-ui",
      runId: "run-b",
      now: new Date("2026-05-03T18:00:00.000Z"),
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const nodeId = index % 2 === 0 ? "launch-prompt-profiles" : "runtime-overlay-ui";
        return nodeLaunchRecordStore.appendOperationProgress(graphPath, nodeId, {
          type: "agent.message",
          message: `${nodeId} progress ${index}`,
          timestamp: `2026-05-03T18:00:${String(index + 1).padStart(2, "0")}.000Z`,
        });
      }),
    );

    const operationA = await nodeLaunchRecordStore.getOperation(graphPath, "launch-prompt-profiles");
    const operationB = await nodeLaunchRecordStore.getOperation(graphPath, "runtime-overlay-ui");
    expect(operationA).toEqual(expect.objectContaining({
      status: "preparing",
      preparationRunId: "run-a",
    }));
    expect(operationB).toEqual(expect.objectContaining({
      status: "preparing",
      preparationRunId: "run-b",
    }));
    expect(operationA?.progressEvents).toHaveLength(10);
    expect(operationB?.progressEvents).toHaveLength(10);
    expect(operationA?.progressEvents.at(-1)?.message).toBe("launch-prompt-profiles progress 18");
    expect(operationB?.progressEvents.at(-1)?.message).toBe("runtime-overlay-ui progress 19");
  });

  it("returns client errors for invalid launch preparation requests", async () => {
    const root = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      store,
      launchPreparationDeps: {
        cwd: root,
        stateRoot: join(root, "state"),
        pawInitRunner: createPawInitRunner(),
        contextPreparer: createContextPreparer(root),
      },
    });
    activeApps.push(api);

    await request(api.app)
      .post("/api/launch-preparations")
      .send({})
      .expect(400, {
        code: "invalid_node_id",
        error: "nodeId is required.",
        step: "validation",
        input: "nodeId",
      });

    await request(api.app)
      .post("/api/launch-preparations")
      .send({
        nodeId: "launch-prompt-profiles",
        configuration: {
          cliArgs: ["--yolo", 42],
        },
      })
      .expect(400, {
        code: "invalid_launch_configuration",
        error: "configuration.cliArgs must be an array of strings.",
        step: "validation",
        input: "configuration.cliArgs",
      });
  });
});
