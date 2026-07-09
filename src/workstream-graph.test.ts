import { describe, expect, it } from "vitest";
import type { WorkstreamDocument } from "./workstream-schema";
import { buildWorkstreamViewModel } from "./workstream-view-model";
import {
  applyWorkstreamGraphSelection,
  buildWorkstreamGraphBaseLayout,
  buildWorkstreamGraphLayout,
  reduceTransitiveEdges,
} from "./workstream-graph";

function buildFixture(
  nodes: WorkstreamDocument["nodes"],
  checkpoints: WorkstreamDocument["checkpoints"] = [],
): WorkstreamDocument {
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
    checkpoints,
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

  it("applies selection highlights without changing base layout geometry", () => {
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
    ]);
    const viewModel = buildWorkstreamViewModel(
      workstream,
      undefined,
      new Date("2026-03-30T20:06:10.348Z"),
    );
    const baseLayout = buildWorkstreamGraphBaseLayout(workstream, viewModel);
    const selectedLayout = applyWorkstreamGraphSelection(baseLayout, "b");

    expect(applyWorkstreamGraphSelection(baseLayout, null)).toBe(baseLayout);
    expect(selectedLayout.checkpointLanes).toBe(baseLayout.checkpointLanes);
    expect(selectedLayout.dependenciesByNode).toBe(baseLayout.dependenciesByNode);
    expect(selectedLayout.dependentsByNode).toBe(baseLayout.dependentsByNode);
    expect(
      selectedLayout.nodes.map(({ id, x, y, width, height }) => ({
        id,
        x,
        y,
        width,
        height,
      })),
    ).toEqual(
      baseLayout.nodes.map(({ id, x, y, width, height }) => ({
        id,
        x,
        y,
        width,
        height,
      })),
    );
    expect(new Map(selectedLayout.nodes.map((node) => [node.id, node.highlight]))).toEqual(
      new Map([
        ["a", "ancestor"],
        ["b", "selected"],
        ["c", "descendant"],
      ]),
    );
  });

  it("keeps checkpoint lanes ordered even when dependencies would share a rank", () => {
    const workstream = buildFixture(
      [
        {
          id: "foundation",
          type: "task",
          title: "Foundation",
          summary: "Foundation",
          status: "completed",
          attention: "focus",
          repoIds: ["main"],
          dependsOn: [],
        },
        {
          id: "surface",
          type: "task",
          title: "Surface",
          summary: "Surface",
          status: "in-progress",
          attention: "focus",
          repoIds: ["main"],
          dependsOn: ["foundation"],
        },
        {
          id: "cleanup",
          type: "task",
          title: "Cleanup",
          summary: "Cleanup",
          status: "planned",
          attention: "watch",
          repoIds: ["main"],
          dependsOn: ["foundation"],
        },
      ],
      [
        {
          id: "wave-1",
          title: "Foundation",
          summary: "Foundation",
          status: "completed",
          nodeIds: ["foundation"],
        },
        {
          id: "wave-2",
          title: "Surface",
          summary: "Surface",
          status: "planned",
          nodeIds: ["surface"],
        },
        {
          id: "wave-3",
          title: "Cleanup",
          summary: "Cleanup",
          status: "planned",
          nodeIds: ["cleanup"],
        },
      ],
    );
    const viewModel = buildWorkstreamViewModel(
      workstream,
      undefined,
      new Date("2026-03-30T20:06:10.348Z"),
    );
    const layout = buildWorkstreamGraphLayout(workstream, viewModel, null);

    expect(layout.edges.map((edge) => edge.id)).toEqual([
      "foundation->surface",
      "foundation->cleanup",
    ]);
    expect(layout.checkpointLanes.map((lane) => lane.id)).toEqual([
      "wave-1",
      "wave-2",
      "wave-3",
    ]);
    for (let index = 1; index < layout.checkpointLanes.length; index += 1) {
      const previous = layout.checkpointLanes[index - 1];
      const current = layout.checkpointLanes[index];
      expect(previous.y + previous.height).toBeLessThan(current.y);
    }
  });

  it("adds external dependency ghosts to layout and selection ancestry", () => {
    const workstream = buildFixture([
      {
        id: "local-node",
        type: "task",
        title: "Local node",
        summary: "Local node",
        status: "ready",
        attention: "focus",
        repoIds: ["main"],
        dependsOn: [],
        externalDependsOn: [
          {
            id: "upstream-review",
            target: {
              projectKey: "streamliner",
              workstreamId: "upstream-work",
              nodeId: "review",
            },
          },
        ],
      },
    ]);
    const viewModel = buildWorkstreamViewModel(
      workstream,
      undefined,
      new Date("2026-03-30T20:06:10.348Z"),
    );
    const layout = buildWorkstreamGraphLayout(workstream, viewModel, "local-node");

    expect(layout.externalNodes.map((node) => node.id)).toEqual([
      "external:local-node:upstream-review",
    ]);
    expect(layout.edges).toEqual([
      {
        id: "external:local-node:upstream-review->local-node",
        sourceId: "external:local-node:upstream-review",
        targetId: "local-node",
        kind: "cross-workstream",
        highlight: "ancestor",
      },
    ]);
    expect(layout.externalNodes[0]?.highlight).toBe("ancestor");
  });
});
