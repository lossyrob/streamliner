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

import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import { NodeLaunchRecordStore } from "./node-launch-record-store";
import {
  LaunchContextPreparationError,
  type LaunchContextPackage,
  type PrepareLaunchContextPackageOptions,
  type PreparedLaunchContextPackage,
} from "./launch-context";
import {
  buildStreamlinerContextSavePrompt,
  completePawInitToolParameters,
  preparePawLaunch,
  resolvePawWorkDirForLaunch,
  validatePawWorktreePolicy,
  type LaunchContextPreparer,
  type PawInitRunner,
  type PawInitRunnerInput,
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
      sourceReferences,
      unavailableInputs: [],
    },
    contextPackagePath,
    contextFilePath,
    overwriteContextFile: false,
  };
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
  });

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
  });

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

  it("passes an existing prepared launch record into repeat PAW initialization", async () => {
    const root = createRootDir();
    const graphPath = normalizePath(join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json"));
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
        graphPath: normalizePath(join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "graph.json")),
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
