// @vitest-environment jsdom

import { act } from "react";
import type { MouseEvent, ReactNode } from "react";
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
const reactFlowProps = vi.hoisted(() => ({
  latest: null as {
    nodes?: Array<{ id: string; position: { x: number; y: number } }>;
    nodesDraggable?: boolean;
    onNodeDragStop?: (
      event: MouseEvent,
      node: { id: string; position: { x: number; y: number } },
    ) => void;
  } | null,
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  MiniMap: () => null,
  ReactFlow: (
    props: {
      children: ReactNode;
      nodes?: Array<{ id: string; position: { x: number; y: number } }>;
      nodesDraggable?: boolean;
      onNodeDragStop?: (
        event: MouseEvent,
        node: { id: string; position: { x: number; y: number } },
      ) => void;
    },
  ) => {
    reactFlowProps.latest = props;
    return <div data-testid="react-flow">{props.children}</div>;
  },
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
    externalDependencies: [],
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
    externalNodes: [],
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
      nodePositions: ReadonlyMap<string, { x: number; y: number; updatedAt: string }>;
      onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void;
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
          nodePositions={props.nodePositions}
          onNodePositionChange={props.onNodePositionChange}
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

  it("overlays saved positions and reports drag stops for persisted layout", () => {
    const onNodePositionChange = vi.fn();

    renderCanvas({
      nodePositions: new Map([
        ["task-a", { x: 320, y: 480, updatedAt: "2026-05-19T12:00:00.000Z" }],
      ]),
      onNodePositionChange,
    });

    expect(reactFlowProps.latest?.nodesDraggable).toBe(true);
    expect(
      reactFlowProps.latest?.nodes?.find((node) => node.id === "task-a")?.position,
    ).toEqual({ x: 320, y: 480 });

    act(() => {
      reactFlowProps.latest?.onNodeDragStop?.(
        {} as MouseEvent,
        { id: "task-a", position: { x: 360, y: 512 } },
      );
    });

    expect(onNodePositionChange).toHaveBeenCalledWith("task-a", { x: 360, y: 512 });
  });
});
