import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import {
  WorkstreamGraphNode,
  WorkstreamGraphGateNode,
} from "./WorkstreamGraphNode";
import type {
  WorkstreamGraphNodeData,
  WorkstreamGraphLayoutResult,
} from "../workstream-graph";

const nodeTypes = {
  workstreamTask: WorkstreamGraphNode,
  workstreamGate: WorkstreamGraphGateNode,
};

const EDGE_HIGHLIGHT_STYLES: Record<string, React.CSSProperties> = {
  ancestor: { stroke: "#7c3aed", strokeWidth: 2 },
  descendant: { stroke: "#b07808", strokeWidth: 2 },
  muted: { stroke: "#c0c8d8", strokeWidth: 1, opacity: 0.3 },
  none: { stroke: "#94a3b8", strokeWidth: 1.5 },
};

interface WorkstreamCanvasProps {
  layout: WorkstreamGraphLayoutResult;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
}

export function WorkstreamCanvas({
  layout,
  selectedNodeId,
  onNodeSelect,
}: WorkstreamCanvasProps) {
  const nodes = useMemo<Node<WorkstreamGraphNodeData>[]>(
    () =>
      layout.nodes.map((ln) => ({
        id: ln.id,
        type:
          ln.entry.node.type === "gate" ? "workstreamGate" : "workstreamTask",
        position: { x: ln.x, y: ln.y },
        data: {
          entry: ln.entry,
          repoLabel: ln.repoLabel,
          highlight: ln.highlight,
          showId: false,
        },
        style: { width: ln.width, height: ln.height },
      })),
    [layout],
  );

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
      onNodeSelect(node.id === selectedNodeId ? null : node.id);
    },
    [onNodeSelect, selectedNodeId],
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  return (
    <div className="sl-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
