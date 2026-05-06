// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkstreamCanvas } from "./WorkstreamCanvas";
import type {
  WorkstreamGraphLayoutNode,
  WorkstreamGraphLayoutResult,
} from "../workstream-graph";
import type { GraphNodeSessionStatusSummary } from "../graph-node-session-status";
import type { WorkstreamDerivedNode } from "../workstream-view-model";

const fitBoundsMock = vi.hoisted(() => vi.fn());

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  MiniMap: () => null,
  ReactFlow: ({ children }: { children: ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  useReactFlow: () => ({
    fitBounds: fitBoundsMock,
  }),
}));

function buildDerivedNode(id: string): WorkstreamDerivedNode {
  return {
    node: {
      id,
      type: "task",
      title: id,
      summary: "",
      status: "ready",
      attention: "focus",
      repoIds: [],
      dependsOn: [],
    },
    operationalStatus: "ready",
    dependencyReady: true,
    completionSource: null,
  };
}

function buildLayout(offset = 0): WorkstreamGraphLayoutResult {
  const node: WorkstreamGraphLayoutNode = {
    id: "task-a",
    x: 48 + offset,
    y: 96,
    width: 328,
    height: 224,
    highlight: "none",
    repoLabel: "No repo scoped",
    entry: buildDerivedNode("task-a"),
  };
  return {
    nodes: [node],
    edges: [],
    checkpointLanes: [
      {
        id: "current",
        title: "Current checkpoint",
        subtitle: "1 node",
        nodeIds: [node.id],
        index: 0,
        state: "current",
        x: 0 + offset,
        y: 32,
        width: 440,
        height: 320,
      },
    ],
    dependenciesByNode: new Map(),
    dependentsByNode: new Map(),
    ancestors: new Set(),
    descendants: new Set(),
  };
}

describe("WorkstreamCanvas", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fitBoundsMock.mockClear();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function renderCanvas(
    props: Partial<{
      layout: WorkstreamGraphLayoutResult;
      initialFitKey: string;
      selectedNodeId: string | null;
      nodeSessionStatuses: ReadonlyMap<string, GraphNodeSessionStatusSummary>;
    }> = {},
  ): void {
    act(() => {
      root.render(
        <WorkstreamCanvas
          layout={props.layout ?? buildLayout()}
          initialFitKey={props.initialFitKey ?? "streamliner/api-test:"}
          selectedNodeId={props.selectedNodeId ?? null}
          onNodeSelect={vi.fn()}
          nodeSessionStatuses={props.nodeSessionStatuses}
        />,
      );
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
  }

  it("does not refit the viewport for graph refreshes under the same route", () => {
    renderCanvas();

    expect(fitBoundsMock).toHaveBeenCalledTimes(1);
    expect(fitBoundsMock).toHaveBeenLastCalledWith(
      { x: 0, y: 32, width: 440, height: 320 },
      { padding: 0.22, duration: 0 },
    );

    renderCanvas({
      layout: buildLayout(24),
      nodeSessionStatuses: new Map(),
    });
    renderCanvas({
      selectedNodeId: "task-a",
    });

    expect(fitBoundsMock).toHaveBeenCalledTimes(1);

    renderCanvas({
      initialFitKey: "streamliner/other-workstream:",
      layout: buildLayout(48),
    });

    expect(fitBoundsMock).toHaveBeenCalledTimes(2);
  });
});
