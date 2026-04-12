import { describe, expect, it } from "vitest";
import type { WorkstreamDocument } from "./workstream-schema";
import { buildWorkstreamViewModel } from "./workstream-view-model";
import {
  buildWorkstreamGraphLayout,
  reduceTransitiveEdges,
} from "./workstream-graph";

function buildFixture(nodes: WorkstreamDocument["nodes"]): WorkstreamDocument {
  return {
    schemaVersion: 1,
    id: "example-project",
    title: "Example multi-wave workstream",
    summary: "A workstream for testing graph layout and transitive reduction.",
    status: "active",
    attention: "focus",
    createdAt: "2026-03-30T19:06:10.348Z",
    updatedAt: "2026-03-30T19:06:10.348Z",
    repos: [
      {
        id: "main",
        owner: "example-org",
        name: "example-repo",
      },
    ],
    designRefs: [],
    nodes,
    checkpoints: [],
  };
}

describe("reduceTransitiveEdges", () => {
  it("removes direct edges implied by longer dependency paths", () => {
    const workstream = buildFixture([
      {
        id: "a",
        type: "task",
        title: "A",
        summary: "A",
        status: "completed",
        attention: "focus",
        repoIds: ["main"],
        dependsOn: [],
      },
      {
        id: "b",
        type: "task",
        title: "B",
        summary: "B",
        status: "completed",
        attention: "focus",
        repoIds: ["main"],
        dependsOn: ["a"],
      },
      {
        id: "c",
        type: "task",
        title: "C",
        summary: "C",
        status: "planned",
        attention: "watch",
        repoIds: ["main"],
        dependsOn: ["a", "b"],
      },
    ]);

    expect(reduceTransitiveEdges(workstream)).toEqual([
      { id: "a->b", sourceId: "a", targetId: "b" },
      { id: "b->c", sourceId: "b", targetId: "c" },
    ]);
  });
});

describe("buildWorkstreamGraphLayout", () => {
  it("highlights ancestors and descendants around the selected node", () => {
    const workstream = buildFixture([
      {
        id: "a",
        type: "task",
        title: "A",
        summary: "A",
        status: "completed",
        attention: "focus",
        repoIds: ["main"],
        dependsOn: [],
      },
      {
        id: "b",
        type: "task",
        title: "B",
        summary: "B",
        status: "completed",
        attention: "focus",
        repoIds: ["main"],
        dependsOn: ["a"],
      },
      {
        id: "c",
        type: "task",
        title: "C",
        summary: "C",
        status: "in-progress",
        attention: "focus",
        repoIds: ["main"],
        dependsOn: ["b"],
      },
      {
        id: "d",
        type: "task",
        title: "D",
        summary: "D",
        status: "planned",
        attention: "watch",
        repoIds: ["main"],
        dependsOn: ["c"],
      },
    ]);
    const viewModel = buildWorkstreamViewModel(
      workstream,
      undefined,
      new Date("2026-03-30T20:06:10.348Z"),
    );
    const layout = buildWorkstreamGraphLayout(workstream, viewModel, "c");
    const highlightById = new Map(
      layout.nodes.map((node) => [node.id, node.highlight]),
    );

    expect(highlightById.get("a")).toBe("ancestor");
    expect(highlightById.get("b")).toBe("ancestor");
    expect(highlightById.get("c")).toBe("selected");
    expect(highlightById.get("d")).toBe("descendant");
    expect(layout.edges.map((edge) => edge.id)).toEqual([
      "a->b",
      "b->c",
      "c->d",
    ]);
  });
});
