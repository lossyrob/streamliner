import { useMemo, useCallback, useEffect } from "react";
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
} from "./WorkstreamGraphNode";
import { WorkstreamSwimlane } from "./WorkstreamSwimlane";
import type { WorkstreamSwimlaneData } from "./WorkstreamSwimlane";
import { collectViewportFocusIds } from "./workstream-canvas-focus";
import type {
  WorkstreamGraphNodeData,
  WorkstreamGraphLayoutResult,
} from "../workstream-graph";
import type {
  GraphNodeSessionStatusState,
  GraphNodeSessionStatusSummary,
} from "../graph-node-session-status";

const nodeTypes = {
  workstreamTask: WorkstreamGraphNode,
  workstreamGate: WorkstreamGraphGateNode,
  workstreamSwimlane: WorkstreamSwimlane,
};

const EDGE_HIGHLIGHT_STYLES: Record<string, React.CSSProperties> = {
  ancestor: { stroke: "#7c3aed", strokeWidth: 2 },
  descendant: { stroke: "#b07808", strokeWidth: 2 },
  muted: { stroke: "#c0c8d8", strokeWidth: 1, opacity: 0.3 },
  none: { stroke: "#94a3b8", strokeWidth: 1.5 },
};

function minimapNodeColor(node: Node): string {
  if (node.type === "workstreamSwimlane") {
    return "rgba(147, 197, 253, 0.18)";
  }
  const data = node.data as Partial<WorkstreamGraphNodeData> | undefined;
  switch (data?.entry?.operationalStatus) {
    case "completed":
      return "#2fa66f";
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
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  nodeSessionStatuses?: ReadonlyMap<string, GraphNodeSessionStatusSummary>;
  nodeSessionStatusState?: GraphNodeSessionStatusState;
  sessionRouteForNode?: (nodeId: string) => {
    href: string;
    onOpen: () => void | Promise<void>;
  };
}

export function WorkstreamCanvas({
  layout,
  selectedNodeId,
  onNodeSelect,
  nodeSessionStatuses = new Map(),
  nodeSessionStatusState = "ready",
  sessionRouteForNode,
}: WorkstreamCanvasProps) {
  const reactFlow = useReactFlow();
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
    [layout],
  );
  const taskNodes = useMemo<Node<WorkstreamGraphNodeData>[]>(
    () =>
      layout.nodes.map((ln) => {
        const sessionRoute = sessionRouteForNode?.(ln.id) ?? null;
        return {
          id: ln.id,
          type:
            ln.entry.node.type === "gate" ? "workstreamGate" : "workstreamTask",
          position: { x: ln.x, y: ln.y },
          data: {
            entry: ln.entry,
            repoLabel: ln.repoLabel,
            highlight: ln.highlight,
            showId: false,
            sessionStatus: nodeSessionStatuses.get(ln.id) ?? null,
            sessionStatusState: nodeSessionStatusState,
            sessionsHref: sessionRoute?.href ?? null,
            onOpenSessions: sessionRoute?.onOpen ?? null,
          },
          width: ln.width,
          height: ln.height,
          style: { width: ln.width, height: ln.height },
        };
      }),
    [layout, nodeSessionStatusState, nodeSessionStatuses, sessionRouteForNode],
  );
  const nodes = useMemo<Node[]>(
    () => [...laneNodes, ...taskNodes],
    [laneNodes, taskNodes],
  );
  const viewportFocusIds = useMemo(
    () => collectViewportFocusIds(layout, selectedNodeId),
    [layout, selectedNodeId],
  );
  const framedNodes = useMemo(() => {
    const currentLane = layout.checkpointLanes.find(
      (lane) => lane.state === "current",
    );
    if (currentLane) {
      const laneNode = laneNodes.find(
        (node) => node.id === `lane:${currentLane.id}`,
      );
      if (laneNode) {
        return [laneNode];
      }
    }
    // Fallback: frame all focus tasks.
    return taskNodes.filter((node) => viewportFocusIds.has(node.id));
  }, [taskNodes, laneNodes, layout, viewportFocusIds]);

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((le) => ({
        id: le.id,
        source: le.sourceId,
        target: le.targetId,
        style: EDGE_HIGHLIGHT_STYLES[le.highlight] ?? EDGE_HIGHLIGHT_STYLES.none,
        animated:
          le.highlight === "ancestor" || le.highlight === "descendant",
      })),
    [layout],
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (framedNodes.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of framedNodes) {
        const w = Number(node.style?.width ?? 0);
        const h = Number(node.style?.height ?? 0);
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + w);
        maxY = Math.max(maxY, node.position.y + h);
      }
      void reactFlow.fitBounds(
        {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        },
        {
          padding: selectedNodeId ? 0.24 : 0.22,
          duration: 0,
        },
      );
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [framedNodes, reactFlow, selectedNodeId]);

  return (
    <div className="sl-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodesConnectable={false}
        nodesDraggable={false}
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
