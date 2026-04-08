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

export function collectViewportFocusIds(
  layout: WorkstreamGraphLayoutResult,
  selectedNodeId: string | null,
): Set<string> {
  if (selectedNodeId) {
    return new Set([
      selectedNodeId,
      ...layout.ancestors,
      ...layout.descendants,
    ]);
  }

  const baseIds = new Set(
    layout.nodes
      .filter(
        ({ entry }) =>
          entry.node.attention === "focus" ||
          entry.operationalStatus === "ready" ||
          entry.operationalStatus === "in-progress" ||
          entry.operationalStatus === "waiting-for-review" ||
          entry.operationalStatus === "waiting-for-validation" ||
          entry.operationalStatus === "blocked",
      )
      .map(({ id }) => id),
  );

  if (baseIds.size === 0) {
    return new Set(
      layout.nodes
        .filter(({ entry }) => entry.operationalStatus !== "completed")
        .map(({ id }) => id),
    );
  }

  const focusIds = new Set(baseIds);

  for (const nodeId of baseIds) {
    for (const dependencyId of layout.dependenciesByNode.get(nodeId) ?? []) {
      focusIds.add(dependencyId);
    }
  }

  const queue = [...baseIds].map((nodeId) => ({ nodeId, depth: 0 }));
  const queuedIds = new Set(baseIds);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= 2) {
      continue;
    }

    for (const dependentId of layout.dependentsByNode.get(current.nodeId) ?? []) {
      focusIds.add(dependentId);
      if (queuedIds.has(dependentId)) {
        continue;
      }

      queuedIds.add(dependentId);
      queue.push({ nodeId: dependentId, depth: current.depth + 1 });
    }
  }

  return focusIds;
}

export function WorkstreamCanvas({
  layout,
  selectedNodeId,
  onNodeSelect,
}: WorkstreamCanvasProps) {
  const reactFlow = useReactFlow();
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
  const viewportFocusIds = useMemo(
    () => collectViewportFocusIds(layout, selectedNodeId),
    [layout, selectedNodeId],
  );
  const framedNodes = useMemo(
    () => nodes.filter((node) => viewportFocusIds.has(node.id)),
    [nodes, viewportFocusIds],
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        await reactFlow.fitView({
          nodes: framedNodes,
          padding: selectedNodeId ? 0.34 : 0.22,
          minZoom: 0.64,
          maxZoom: selectedNodeId ? 0.92 : 0.9,
          duration: 240,
        });

        if (!selectedNodeId) {
          const viewport = reactFlow.getViewport();
          await reactFlow.setViewport(
            { ...viewport, y: viewport.y - 48 },
            { duration: 0 },
          );
        }
      })();
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
        <Controls fitViewOptions={{ nodes, padding: 0.2, maxZoom: 0.7 }} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
