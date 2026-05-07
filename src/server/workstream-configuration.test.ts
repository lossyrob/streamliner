import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  updateWorkstreamConfigurationFile,
  type WorkstreamConfigurationUpdateInput,
} from "./workstream-configuration";

const createdRoots: string[] = [];

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-workstream-config-"));
  createdRoots.push(root);
  return root;
}

function buildGraph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "config-test",
    projectKey: "streamliner",
    title: "Config Test",
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
        role: "primary",
      },
    ],
    designRefs: [],
    nodes: [],
    checkpoints: [],
    ...overrides,
  };
}

function writeGraph(rootDir: string, graph: Record<string, unknown> = buildGraph()): string {
  const graphPath = join(rootDir, "graph.json");
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return graphPath;
}

function readGraph(graphPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(graphPath, "utf8")) as Record<string, unknown>;
}

function updateConfiguration(
  graphPath: string,
  configuration: WorkstreamConfigurationUpdateInput,
) {
  return updateWorkstreamConfigurationFile({
    graphPath,
    content: readFileSync(graphPath, "utf8"),
    projectKey: "streamliner",
    workstreamId: "config-test",
    configuration,
    now: () => new Date("2026-05-07T18:22:44.000Z"),
  });
}

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("updateWorkstreamConfigurationFile", () => {
  it("normalizes persisted launch configuration and clears empty defaults", async () => {
    const graphPath = writeGraph(createRootDir());

    const result = await updateConfiguration(graphPath, {
      launchPolicy: { requiredTracker: "github-issue" },
      launchDefaults: {
        terminal: {
          preferredTerminal: "windows-terminal",
          tabColor: "#FF8C0A",
        },
      },
    });

    expect(result.workstream.launchPolicy).toEqual({ requiredTracker: "github-issue" });
    expect(result.workstream.launchDefaults).toEqual({
      terminal: {
        preferredTerminal: "windows-terminal",
        tabColor: "#ff8c0a",
      },
    });
    expect(readGraph(graphPath)).toEqual(expect.objectContaining({
      updatedAt: "2026-05-07T18:22:44.000Z",
      launchPolicy: { requiredTracker: "github-issue" },
      launchDefaults: {
        terminal: {
          preferredTerminal: "windows-terminal",
          tabColor: "#ff8c0a",
        },
      },
    }));

    await updateConfiguration(graphPath, {
      launchPolicy: null,
      launchDefaults: {
        terminal: {
          preferredTerminal: "default",
          tabColor: "",
        },
      },
    });

    const cleared = readGraph(graphPath);
    expect(cleared.launchPolicy).toBeUndefined();
    expect(cleared.launchDefaults).toBeUndefined();
  });

  it("rejects invalid configuration values without rewriting the graph", async () => {
    const invalidConfigurations: Array<{
      label: string;
      configuration: unknown;
    }> = [
      {
        label: "required tracker",
        configuration: { launchPolicy: { requiredTracker: "local-file" } },
      },
      {
        label: "terminal preference",
        configuration: { launchDefaults: { terminal: { preferredTerminal: "zsh" } } },
      },
      {
        label: "tab color",
        configuration: { launchDefaults: { terminal: { tabColor: "orange" } } },
      },
    ];

    for (const { configuration, label } of invalidConfigurations) {
      const graphPath = writeGraph(createRootDir());
      const before = readFileSync(graphPath, "utf8");

      await expect(updateConfiguration(
        graphPath,
        configuration as WorkstreamConfigurationUpdateInput,
      ), label).rejects.toMatchObject({ code: "EINVALIDCONFIG" });
      expect(readFileSync(graphPath, "utf8")).toBe(before);
    }
  });

  it("rejects malformed graphs and identity mismatches", async () => {
    const malformedGraphPath = join(createRootDir(), "graph.json");
    writeFileSync(malformedGraphPath, "{", "utf8");

    await expect(updateWorkstreamConfigurationFile({
      graphPath: malformedGraphPath,
      content: readFileSync(malformedGraphPath, "utf8"),
      projectKey: "streamliner",
      workstreamId: "config-test",
      configuration: { launchPolicy: { requiredTracker: "github-issue" } },
    })).rejects.toMatchObject({ code: "EINVALIDGRAPH" });

    const mismatchedGraphPath = writeGraph(createRootDir(), buildGraph({ id: "other-workstream" }));

    await expect(updateWorkstreamConfigurationFile({
      graphPath: mismatchedGraphPath,
      content: readFileSync(mismatchedGraphPath, "utf8"),
      projectKey: "streamliner",
      workstreamId: "config-test",
      configuration: { launchPolicy: { requiredTracker: "github-issue" } },
    })).rejects.toMatchObject({ code: "EIDMISMATCH" });
  });
});
