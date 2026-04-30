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

const trackerResolver: LaunchContextTrackerResolver = async (issue) => ({
  content: `# Issue ${issue.number}\n\nPrepared tracker context.`,
});

afterEach(() => {
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("prepareLaunchContextPackage", () => {
  it("writes a manifest and Layer 0-3 context files for a selected node", async () => {
    const root = createRootDir();
    const { graphPath, stateRoot } = buildFixture(root);

    const result = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      now: () => new Date("2026-04-30T03:30:00.000Z"),
      createContextId: () => "ctx-fixed",
      trackerResolver,
    });

    expect(result.contextId).toBe("ctx-fixed");
    expect(result.manifest).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        generatorVersion: 1,
        contextId: "ctx-fixed",
        launchNonce: null,
        launchClaimRef: null,
        projectKey: "streamliner",
        workstreamId: "session-launching-and-tracking",
        nodeId: "backend-context-assembly",
        targetRepoIds: ["streamliner"],
      }),
    );
    expect(result.manifest.layer0Selection).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/design/index.md",
          included: true,
        }),
        expect.objectContaining({
          path: "docs/design/session-system.md",
          included: true,
        }),
      ]),
    );
    expect(result.manifest.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "graph", role: "workstream-graph" }),
        expect.objectContaining({ kind: "brief", role: "workstream-brief" }),
        expect.objectContaining({ kind: "tracker", role: "selected-node-spec" }),
      ]),
    );

    const manifest = JSON.parse(
      readFileSync(result.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.contextId).toBe("ctx-fixed");
    for (const fileName of [
      "layer-0-design.md",
      "layer-1-intent.md",
      "layer-2-state.md",
      "layer-3-node.md",
    ]) {
      expect(existsSync(join(result.contextPackagePath, "context", fileName))).toBe(true);
    }

    const layer3 = readFileSync(
      join(result.contextPackagePath, "context", "layer-3-node.md"),
      "utf8",
    );
    expect(layer3).toContain("Manual session registry UI");
    expect(layer3).toContain("Launch claim binding");
    expect(layer3).toContain("Terminal launch integration");
    expect(layer3).toContain("Prepared tracker context");
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
      trackerResolver: async () => ({
        unavailableInputs: [
          {
            kind: "tracker",
            source: "https://github.com/lossyrob/streamliner/issues/31",
            reason: "github_issue_unavailable",
          },
        ],
      }),
    });

    expect(result.unavailableInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "design",
          source: "docs/design/missing.md",
          reason: "missing",
        }),
        expect.objectContaining({
          kind: "tracker",
          reason: "github_issue_unavailable",
        }),
      ]),
    );
    expect(existsSync(result.manifestPath)).toBe(true);
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
    });
    const second = await prepareLaunchContextPackage({
      graphPath,
      nodeId: "backend-context-assembly",
      stateRoot,
      createContextId: () => ids.shift() ?? "ctx-extra",
      trackerResolver,
    });

    expect(first.contextPackagePath).not.toBe(second.contextPackagePath);
    expect(existsSync(first.manifestPath)).toBe(true);
    expect(existsSync(second.manifestPath)).toBe(true);
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
        manifest: expect.objectContaining({
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
      launchContextDeps: { stateRoot, trackerResolver },
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
      launchContextDeps: { stateRoot: join(root, "state"), trackerResolver },
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

