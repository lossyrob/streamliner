import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import {
  WorkstreamGraphNode,
  WorkstreamGraphGateNode,
  WorkstreamExternalDependencyNode,
} from "./WorkstreamGraphNode";
import { WorkstreamSwimlane } from "./WorkstreamSwimlane";
import type { WorkstreamSwimlaneData } from "./WorkstreamSwimlane";
import { collectViewportFocusIds } from "./workstream-canvas-focus";
import type {
  WorkstreamExternalGraphNodeData,
  WorkstreamGraphNodeData,
  WorkstreamGraphLayoutResult,
} from "../workstream-graph";
import type {
  WorkstreamExternalDependencyView,
} from "../workstream-view-model";
import type { WorkstreamGraphNodePosition } from "../workstream-positions-contract";
import type {
  GraphNodeSessionStatusState,
  GraphNodeSessionStatusSummary,
} from "../graph-node-session-status";
import type { WorkstreamRuntimeOverlay } from "../workstream-runtime-overlay";
import type { NodeLaunchOperation } from "../node-launch-record-contract";

const nodeTypes = {
  workstreamTask: WorkstreamGraphNode,
  workstreamGate: WorkstreamGraphGateNode,
  workstreamExternalDependency: WorkstreamExternalDependencyNode,
  workstreamSwimlane: WorkstreamSwimlane,
};

function nodePositionFor(
  positions: ReadonlyMap<string, WorkstreamGraphNodePosition>,
  nodeId: string,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  const saved = positions.get(nodeId);
  return saved ? { x: saved.x, y: saved.y } : fallback;
}

const EDGE_HIGHLIGHT_STYLES: Record<string, React.CSSProperties> = {
  ancestor: { stroke: "#7c3aed", strokeWidth: 2 },
  descendant: { stroke: "#b07808", strokeWidth: 2 },
  muted: { stroke: "#c0c8d8", strokeWidth: 1, opacity: 0.3 },
  none: { stroke: "#94a3b8", strokeWidth: 1.5 },
};

const EXTERNAL_EDGE_STYLES: Record<string, React.CSSProperties> = {
  ancestor: { stroke: "#dc2626", strokeWidth: 3, strokeDasharray: "7 5" },
  descendant: { stroke: "#dc2626", strokeWidth: 3, strokeDasharray: "7 5" },
  muted: { stroke: "#dc2626", strokeWidth: 1, strokeDasharray: "7 5", opacity: 0.25 },
  none: { stroke: "#dc2626", strokeWidth: 2, strokeDasharray: "7 5" },
};

function minimapNodeColor(node: Node): string {
  if (node.type === "workstreamSwimlane") {
    return "rgba(147, 197, 253, 0.18)";
  }
  if (node.type === "workstreamExternalDependency") {
    const data = node.data as Partial<WorkstreamExternalGraphNodeData> | undefined;
    return data?.dependency?.satisfied ? "#2fa66f" : "#dc2626";
  }
  const data = node.data as Partial<WorkstreamGraphNodeData> | undefined;
  switch (data?.entry?.operationalStatus) {
    case "completed":
      return "#2fa66f";
    case "retired":
      return "#8d9bb5";
    case "in-progress":
      return "#1f7ae0";
    case "ready":
      return "#7c3aed";
    case "blocked":
      return "#dc2626";
    case "waiting-for-review":
      return "#b07808";
    case "waiting-for-validation":
      return "#d97706";
    default:
      return "#f59e0b";
  }
}

function minimapNodeStrokeColor(node: Node): string {
  return node.type === "workstreamSwimlane" ? "#93c5fd" : "rgba(20, 37, 64, 0.42)";
}

interface WorkstreamCanvasProps {
  layout: WorkstreamGraphLayoutResult;
  initialFitKey: string;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  nodeSessionStatuses?: ReadonlyMap<string, GraphNodeSessionStatusSummary>;
  nodeSessionStatusState?: GraphNodeSessionStatusState;
  runtimeOverlay?: WorkstreamRuntimeOverlay | null;
  launchOperations?: ReadonlyMap<string, NodeLaunchOperation>;
  nodePositions?: ReadonlyMap<string, WorkstreamGraphNodePosition>;
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
  sessionRouteForNode?: (nodeId: string) => {
    href: string;
    onOpen: () => void | Promise<void>;
  };
  externalRouteForDependency?: (
    dependency: WorkstreamExternalDependencyView,
  ) => {
    href: string;
    onOpen: () => void | Promise<void>;
  } | null;
}

export function WorkstreamCanvas({
  layout,
  initialFitKey,
  selectedNodeId,
  onNodeSelect,
  nodeSessionStatuses = new Map(),
  nodeSessionStatusState = "ready",
  runtimeOverlay = null,
  launchOperations = new Map(),
  nodePositions = new Map(),
  onNodePositionChange,
  sessionRouteForNode,
  externalRouteForDependency,
}: WorkstreamCanvasProps) {
  const reactFlow = useReactFlow();
  const fittedKeyRef = useRef<string | null>(null);
  const laneNodes = useMemo<Node<WorkstreamSwimlaneData>[]>(
    () =>
      layout.checkpointLanes.map((lane) => ({
        id: `lane:${lane.id}`,
        type: "workstreamSwimlane",
        position: { x: lane.x, y: lane.y },
        data: {
          title: lane.title,
          subtitle: lane.subtitle,
          index: lane.index,
          state: lane.state,
        },
        width: lane.width,
        height: lane.height,
        style: { width: lane.width, height: lane.height },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
      })),
    [layout.checkpointLanes],
  );
  const taskNodes = useMemo<Node<WorkstreamGraphNodeData>[]>(
    () =>
      layout.nodes.map((ln) => {
        const sessionRoute = sessionRouteForNode?.(ln.id) ?? null;
        return {
          id: ln.id,
          type:
            ln.entry.node.type === "gate" ? "workstreamGate" : "workstreamTask",
          position: nodePositionFor(nodePositions, ln.id, { x: ln.x, y: ln.y }),
          data: {
            entry: ln.entry,
            repoLabel: ln.repoLabel,
            highlight: ln.highlight,
            showId: false,
            sessionStatus: nodeSessionStatuses.get(ln.id) ?? null,
            sessionStatusState: nodeSessionStatusState,
            runtimeOverlay: runtimeOverlay?.nodesById.get(ln.id) ?? null,
            launchOperation: launchOperations.get(ln.id) ?? null,
            sessionsHref: sessionRoute?.href ?? null,
            onOpenSessions: sessionRoute?.onOpen ?? null,
          },
          width: ln.width,
          height: ln.height,
          style: { width: ln.width, height: ln.height },
        };
      }),
    [
      layout.nodes,
      nodePositions,
      nodeSessionStatusState,
      nodeSessionStatuses,
      runtimeOverlay,
      launchOperations,
      sessionRouteForNode,
    ],
  );
  const externalNodes = useMemo<Node<WorkstreamExternalGraphNodeData>[]>(
    () =>
      layout.externalNodes.map((ln) => {
        const route = externalRouteForDependency?.(ln.dependency) ?? null;
        return {
          id: ln.id,
          type: "workstreamExternalDependency",
          position: nodePositionFor(nodePositions, ln.id, { x: ln.x, y: ln.y }),
          data: {
            dependency: ln.dependency,
            highlight: ln.highlight,
            onOpenTarget: route?.onOpen ?? null,
          },
          width: ln.width,
          height: ln.height,
          style: { width: ln.width, height: ln.height },
        };
      }),
    [externalRouteForDependency, layout.externalNodes, nodePositions],
  );
  const nodes = useMemo<Node[]>(
    () => [...laneNodes, ...externalNodes, ...taskNodes],
    [externalNodes, laneNodes, taskNodes],
  );
  const viewportFocusIds = useMemo(
    () => collectViewportFocusIds(layout, selectedNodeId),
    [layout, selectedNodeId],
  );
  const framedBounds = useMemo(() => {
    const currentLane = layout.checkpointLanes.find(
      (lane) => lane.state === "current",
    );
    const framedBoxes = currentLane
      ? [currentLane]
      : [...layout.nodes, ...layout.externalNodes].filter((node) =>
          viewportFocusIds.has(node.id),
        );
    if (framedBoxes.length === 0) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of framedBoxes) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [layout.checkpointLanes, layout.externalNodes, layout.nodes, viewportFocusIds]);

  const initialFitPadding = selectedNodeId ? 0.24 : 0.22;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!framedBounds || fittedKeyRef.current === initialFitKey) return;
      fittedKeyRef.current = initialFitKey;
      void reactFlow.fitBounds(framedBounds, {
        padding: initialFitPadding,
        duration: 0,
      });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [framedBounds, initialFitKey, initialFitPadding, reactFlow]);

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((le) => ({
        id: le.id,
        source: le.sourceId,
        target: le.targetId,
        style:
          (le.kind === "external" ? EXTERNAL_EDGE_STYLES : EDGE_HIGHLIGHT_STYLES)[
            le.highlight
          ] ?? EDGE_HIGHLIGHT_STYLES.none,
        animated:
          le.highlight === "ancestor" || le.highlight === "descendant",
      })),
    [layout.edges],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("lane:")) {
        return;
      }
      onNodeSelect(node.id === selectedNodeId ? null : node.id);
    },
    [onNodeSelect, selectedNodeId],
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("lane:")) {
        return;
      }
      onNodePositionChange?.(node.id, node.position);
    },
    [onNodePositionChange],
  );

  return (
    <div className="sl-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        nodesConnectable={false}
        nodesDraggable={Boolean(onNodePositionChange)}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls fitViewOptions={{ nodes: taskNodes, padding: 0.28, maxZoom: 0.7 }} />
        <MiniMap
          pannable
          zoomable
          bgColor="#ffffff"
          maskColor="rgba(15, 23, 42, 0.08)"
          nodeBorderRadius={4}
          nodeColor={minimapNodeColor}
          nodeStrokeColor={minimapNodeStrokeColor}
          nodeStrokeWidth={1.5}
        />
      </ReactFlow>
    </div>
  );
}
