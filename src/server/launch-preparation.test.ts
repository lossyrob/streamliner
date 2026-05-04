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
import {
  LaunchContextPreparationError,
  type LaunchContextPackage,
  type PrepareLaunchContextPackageOptions,
} from "./launch-context";
import {
  preparePawLaunch,
  type LaunchContextPreparer,
  type PawInitRunner,
  type PawInitRunnerInput,
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
      pawInitRunner: createPawInitRunner(),
      contextPreparer: createContextPreparer(root),
    });

    expect(result.kickoffPrompt).toContain(
      `- PAW workflow context: ${result.workflowContextPath}`,
    );
    expect(result.kickoffPrompt).toContain(
      `- Streamliner launch context: ${result.streamlinerContextPath}`,
    );
    expect(result.kickoffPrompt).toContain("recorded as an Additional Input");
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
    expect(response.body.kickoffPrompt).toContain("recorded as an Additional Input");
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
