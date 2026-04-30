import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import {
  prepareLaunchContextPackage,
  type LaunchContextGenerationInput,
  type LaunchContextGenerator,
  type LaunchContextTrackerResolver,
} from "./launch-context";

const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];

function createRootDir(): string {
  const root = join(
    tmpdir(),
    `streamliner-launch-context-${process.pid}-${createdRoots.length}`,
  );
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

function writeText(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function buildFixture(root: string): { graphPath: string; stateRoot: string } {
  const workstreamDir = join(
    root,
    ".streamliner",
    "workstreams",
    "session-launching-and-tracking",
  );
  const graphPath = join(workstreamDir, "graph.json");
  const stateRoot = join(root, "state");

  mkdirSync(workstreamDir, { recursive: true });
  mkdirSync(join(root, "docs", "design"), { recursive: true });
  writeText(
    join(workstreamDir, "brief.md"),
    [
      "# Session launching and tracking",
      "",
      "## Purpose",
      "Launch Copilot worker sessions from graph nodes.",
      "",
      "## Approach",
      "Build context assembly before launch profiles.",
      "",
      "## Design References",
      "- `streamliner:docs/design/index.md`",
      "- `streamliner:docs/design/session-system.md`",
      "",
      "## Boundaries",
      "Do not bind launch claims or start terminals here.",
      "",
      "## Current State",
      "Wave 2 is complete; Wave 3 is ready.",
      "",
      "## Decisions",
      "Use file-based context packages.",
      "",
      "## Open Questions",
      "Retention remains deferred.",
    ].join("\n"),
  );
  writeText(
    join(root, "docs", "design", "index.md"),
    "# Design Index\n\nRead session-system next.\n",
  );
  writeText(
    join(root, "docs", "design", "session-system.md"),
    "# Session System\n\nContext assembly builds Layer 0-3 packages.\n",
  );

  writeText(
    graphPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "session-launching-and-tracking",
        projectKey: "streamliner",
        title: "Session launching and tracking",
        summary: "Launch and track sessions from graph nodes.",
        status: "active",
        attention: "focus",
        createdAt: "2026-04-10T15:37:14.125Z",
        updatedAt: "2026-04-30T02:46:00.000Z",
        repos: [
          {
            id: "streamliner",
            owner: "lossyrob",
            name: "streamliner",
            role: "primary",
          },
        ],
        designRefs: [
          { repoId: "streamliner", path: "docs/design/session-system.md" },
        ],
        nodes: [
          {
            id: "manual-session-registry-ui",
            type: "task",
            title: "Manual session registry UI",
            summary: "Completed registry UI.",
            status: "completed",
            attention: "focus",
            repoIds: ["streamliner"],
            tracker: {
              type: "github",
              owner: "lossyrob",
              repo: "streamliner",
              number: 13,
            },
            dependsOn: [],
          },
          {
            id: "session-relaunch",
            type: "task",
            title: "Session relaunch",
            summary: "Completed relaunch work.",
            status: "completed",
            attention: "focus",
            repoIds: ["streamliner"],
            dependsOn: [],
          },
          {
            id: "backend-context-assembly",
            type: "task",
            title: "Backend context assembly",
            summary: "Assemble Layer 0-3 launch context.",
            status: "ready",
            attention: "watch",
            repoIds: ["streamliner"],
            tracker: {
              type: "github",
              owner: "lossyrob",
              repo: "streamliner",
              number: 31,
            },
            dependsOn: ["manual-session-registry-ui", "session-relaunch"],
          },
          {
            id: "launch-claim-binding",
            type: "task",
            title: "Launch claim binding",
            summary: "Bind launched sessions.",
            status: "ready",
            attention: "focus",
            repoIds: ["streamliner"],
            dependsOn: ["manual-session-registry-ui", "session-relaunch"],
          },
          {
            id: "terminal-launch-integration",
            type: "task",
            title: "Terminal launch integration",
            summary: "Launch a visible Copilot CLI session.",
            status: "planned",
            attention: "focus",
            repoIds: ["streamliner"],
            dependsOn: ["backend-context-assembly"],
          },
        ],
        checkpoints: [
          {
            id: "launch-from-graph",
            title: "Launch from graph works",
            summary: "Context, profile, claim, and launch work together.",
            status: "planned",
            nodeIds: [
              "backend-context-assembly",
              "launch-claim-binding",
              "terminal-launch-integration",
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  return { graphPath, stateRoot };
}

afterEach(() => {
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const trackerResolver: LaunchContextTrackerResolver = async (issue) => ({
  content: `# Issue ${issue.number}\n\nPrepared tracker context for the selected worker node.`,
});

function createContextGenerator(
  inputs: LaunchContextGenerationInput[] = [],
): LaunchContextGenerator {
  return async (input) => {
    inputs.push(input);
    const unavailable = input.unavailableInputs.length > 0
      ? [
        "## Unavailable Inputs",
        "",
        ...input.unavailableInputs.map((item) => `- ${item.kind}: ${item.source} - ${item.reason}`),
        "",
      ]
      : [];
    const oddBriefLine = input.briefSource.content?.includes("This brief has useful content without standard headings.")
      ? "This brief has useful content without standard headings."
      : "";
    return [
      `# Launch Context - ${input.node.title}`,
      "",
      "## Layer 0 - Design Context References",
      "",
      "### Design Documents to Read",
      "",
      ...input.designSelection.map((entry) => `- read: \`${entry.repoId}:${entry.path}\` - ${entry.rationale}`),
      "",
      "## Layer 1 - Worker Mission",
      "",
      input.trackerReference ?? "No selected node spec was available.",
      input.node.summary,
      oddBriefLine,
      "",
      "## Layer 2 - Relevant State",
      "",
      `Selected node: ${input.node.id}`,
      "",
      "## Layer 3 - Coordination Context",
      "",
      ...input.workstream.nodes.map((node) => `- ${node.title}`),
      "",
      ...unavailable,
    ].join("\n");
  };
}

describe("prepareLaunchContextPackage", () => {
  it("writes one worker-facing context file and returns system metadata", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const generationInputs: LaunchContextGenerationInput[] = [];

    const result = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      now: () => new Date("2026-04-30T03:30:00.000Z"),
      createContextId: () => "ctx-fixed",
      trackerResolver,
      contextGenerator: createContextGenerator(generationInputs),
    });

    expect(result.contextId).toBe("ctx-fixed");
    expect(result.metadata).toEqual(
      expect.objectContaining({
        contextId: "ctx-fixed",
        launchNonce: null,
        launchClaimRef: null,
        projectKey: "streamliner",
        workstreamId: "session-launching-and-tracking",
        nodeId: "backend-context-assembly",
        targetRepoIds: ["streamliner"],
      }),
    );
    expect(result.metadata.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "graph", role: "workstream-graph" }),
        expect.objectContaining({ kind: "brief", role: "workstream-brief" }),
        expect.objectContaining({ kind: "tracker", role: "selected-node-spec" }),
      ]),
    );

    expect(existsSync(result.contextFilePath)).toBe(true);
    expect(existsSync(join(result.contextPackagePath, "manifest.json"))).toBe(false);
    expect(existsSync(join(result.contextPackagePath, "context"))).toBe(false);

    const context = readFileSync(result.contextFilePath, "utf8");
    expect(context).toContain("# Launch Context - Backend context assembly");
    expect(context).toContain("## Layer 0 - Design Context References");
    expect(context).toContain("## Layer 1 - Worker Mission");
    expect(context).toContain("## Layer 2 - Relevant State");
    expect(context).toContain("## Layer 3 - Coordination Context");
    expect(context).toContain("Manual session registry UI");
    expect(context).toContain("Launch claim binding");
    expect(context).toContain("Terminal launch integration");
    expect(context).toContain("https://github.com/lossyrob/streamliner/issues/31");
    expect(context).toContain("Design Documents to Read");
    expect(context).toContain("`streamliner:docs/design/session-system.md`");
    expect(context).not.toContain("<!--");
    expect(context).not.toContain("Generated by Streamliner");
    expect(context).not.toContain("Session System");
    expect(generationInputs).toHaveLength(1);
    expect(generationInputs[0]?.briefSource.content).toContain("Launch Copilot worker sessions");
    expect(generationInputs[0]?.trackerSource?.content).toContain("Prepared tracker context");
    expect(generationInputs[0]?.designSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: expect.objectContaining({ path: "docs/design/session-system.md" }),
          content: expect.stringContaining("Context assembly builds Layer 0-3 packages."),
        }),
      ]),
    );
  });

  it("records unavailable optional inputs while still producing a package", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const graph = JSON.parse(readFileSync(graphPath, "utf8")) as {
      designRefs: Array<{ repoId: string; path: string }>;
    };
    graph.designRefs.push({
      repoId: "streamliner",
      path: "docs/design/missing.md",
    });
    writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

    const result = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => "ctx-degraded",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });

    expect(result.unavailableInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "design",
          source: "docs/design/missing.md",
          reason: "missing",
        }),
      ]),
    );
    expect(existsSync(result.contextFilePath)).toBe(true);
    const context = readFileSync(result.contextFilePath, "utf8");
    expect(context).toContain("## Unavailable Inputs");
    expect(context).toContain("docs/design/missing.md");
  });

  it("normalizes a single markdown fence from the generated context", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);

    const result = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => "ctx-fenced",
      trackerResolver,
      contextGenerator: async (input) => [
        "```markdown",
        `# Launch Context - ${input.node.title}`,
        "",
        "## Layer 0 - Design Context References",
        "",
        "Read the linked design docs.",
        "",
        "## Layer 1 - Worker Mission",
        "",
        input.node.summary,
        "",
        "## Layer 2 - Relevant State",
        "",
        "Use the selected node state.",
        "",
        "## Layer 3 - Coordination Context",
        "",
        "Coordinate with adjacent nodes as background.",
        "```",
      ].join("\n"),
    });

    const context = readFileSync(result.contextFilePath, "utf8");
    expect(context.startsWith("# Launch Context - Backend context assembly")).toBe(true);
    expect(context).not.toContain("```markdown");
  });

  it("rejects generated context that does not match the required worker structure", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);

    await expect(
      prepareLaunchContextPackage({
        graphPath,
        nodeId: "backend-context-assembly",
        stateRoot,
        createContextId: () => "ctx-invalid-generated",
        trackerResolver,
        contextGenerator: async (input) => [
          "Here is the context file you requested:",
          "",
          `# Launch Context - ${input.node.title}`,
          "",
          "## Layer 0 - Design Context References",
          "",
          "## Layer 1 - Worker Mission",
          "",
          "## Layer 2 - Relevant State",
          "",
          "## Layer 3 - Coordination Context",
        ].join("\n"),
      }),
    ).rejects.toMatchObject({
      code: "context_generation_failed",
      statusCode: 500,
    });
  });

  it("uses a fresh context id for each preparation and does not overwrite prior packages", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const ids = ["ctx-one", "ctx-two"];

    const first = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => ids.shift() ?? "ctx-extra",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });
    const second = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => ids.shift() ?? "ctx-extra",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });

    expect(first.contextPackagePath).not.toBe(second.contextPackagePath);
    expect(existsSync(first.contextFilePath)).toBe(true);
    expect(existsSync(second.contextFilePath)).toBe(true);
  });

  it("treats outputDir as a reusable parent for per-context packages", async () => {
    const root = createRootDir();
    const { graphPath } = buildFixture(root);
    const outputDir = join(root, "prepared-contexts");
    mkdirSync(outputDir, { recursive: true });
    const ids = ["ctx-output-one", "ctx-output-two"];

    const first = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      outputDir,
      createContextId: () => ids.shift() ?? "ctx-extra",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });
    const second = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      outputDir,
      createContextId: () => ids.shift() ?? "ctx-extra",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });

    expect(first.contextPackagePath).toBe(normalizePath(join(outputDir, "ctx-output-one")));
    expect(second.contextPackagePath).toBe(normalizePath(join(outputDir, "ctx-output-two")));
    expect(existsSync(join(outputDir, "ctx-output-one", "context.md"))).toBe(true);
    expect(existsSync(join(outputDir, "ctx-output-two", "context.md"))).toBe(true);
  });

  it("falls back to raw brief content when canonical sections are absent", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    writeText(
      join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "brief.md"),
      "# Odd Brief\n\nThis brief has useful content without standard headings.\n",
    );

    const result = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => "ctx-odd-brief",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });

    const context = readFileSync(result.contextFilePath, "utf8");
    expect(context).toContain("This brief has useful content without standard headings.");
  });

  it("records repo-root and cross-repo design degradations explicitly", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const looseGraphPath = join(root, "loose-graph.json");
    const graph = JSON.parse(readFileSync(graphPath, "utf8")) as {
      repos: Array<{ id: string; owner: string; name: string; role?: string }>;
      designRefs: Array<{ repoId: string; path: string }>;
    };
    graph.repos.push({
      id: "other-repo",
      owner: "lossyrob",
      name: "other-repo",
    });
    graph.designRefs.push({ repoId: "other-repo", path: "docs/design/remote.md" });
    writeFileSync(looseGraphPath, `${JSON.stringify(graph, null, 2)}\n`);

    const result = await prepareLaunchContextPackage({
      graphPath: looseGraphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => "ctx-loose",
      trackerResolver,
      contextGenerator: createContextGenerator(),
    });

    expect(result.unavailableInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "graph",
          reason: "repo_root_not_found",
        }),
        expect.objectContaining({
          kind: "design",
          source: "other-repo:docs/design/remote.md",
          reason: "cross_repo_unavailable",
        }),
      ]),
    );
  });

  it("references local tracker specs without copying their contents", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const graph = JSON.parse(readFileSync(graphPath, "utf8")) as {
      nodes: Array<{ id: string; tracker?: unknown }>;
    };
    const node = graph.nodes.find((entry) => entry.id === "backend-context-assembly");
    if (!node) {
      throw new Error("Expected fixture node.");
    }
    node.tracker = { type: "local", path: "node-spec.md" };
    writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
    writeText(
      join(root, ".streamliner", "workstreams", "session-launching-and-tracking", "node-spec.md"),
      "# Local Node Spec\n\nAssemble context from a local spec.\n",
    );

    const result = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => "ctx-local-tracker",
      contextGenerator: createContextGenerator(),
    });
    const context = readFileSync(result.contextFilePath, "utf8");
    expect(context).toContain("node-spec.md");
    expect(context).not.toContain("Assemble context from a local spec.");
    expect(result.metadata.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "local-tracker", role: "selected-node-spec" }),
      ]),
    );
  });
});

describe("launch context API route", () => {
  it("prepares a launch context package through POST /api/launch-contexts", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      store,
      graphPath,
      launchContextDeps: {
        stateRoot,
        createContextId: () => "ctx-api",
        trackerResolver,
        contextGenerator: createContextGenerator(),
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/launch-contexts")
      .send({ nodeId: "backend-context-assembly" })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        contextId: "ctx-api",
        contextPackagePath: expect.stringContaining("ctx-api"),
        contextFilePath: expect.stringContaining("context.md"),
        metadata: expect.objectContaining({
          nodeId: "backend-context-assembly",
        }),
      }),
    );
  });

  it("returns client errors for invalid launch context requests", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      store,
      graphPath,
      launchContextDeps: { stateRoot, trackerResolver, contextGenerator: createContextGenerator() },
    });
    activeApps.push(api);

    await request(api.app)
      .post("/api/launch-contexts")
      .send({})
      .expect(400, {
        code: "invalid_node_id",
        error: "nodeId is required.",
      });

    await request(api.app)
      .post("/api/launch-contexts")
      .send({ nodeId: "does-not-exist" })
      .expect(404, {
        code: "unknown_node",
        error: "Unknown workstream node: does-not-exist",
      });

    await request(api.app)
      .post("/api/launch-contexts")
      .send({
        nodeId: "backend-context-assembly",
        outputDir: "relative-output",
      })
      .expect(400, {
        code: "invalid_output_dir",
        error: "outputDir must be an absolute path.",
      });
  });

  it("returns a client error when no graph is configured", async () => {
    const root = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
    const api = createStreamlinerApiApp({
      store,
      launchContextDeps: {
        stateRoot: join(root, "state"),
        trackerResolver,
        contextGenerator: createContextGenerator(),
      },
    });
    activeApps.push(api);

    await request(api.app)
      .post("/api/launch-contexts")
      .send({ nodeId: "backend-context-assembly" })
      .expect(400, {
        code: "graph_not_configured",
        error: "No graph configured. Provide graphPath or configure STREAMLINER_GRAPH.",
      });
  });
});

