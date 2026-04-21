import dagre from "@dagrejs/dagre";
import type { WorkstreamDocument } from "./workstream-schema";
import type {
  WorkstreamDerivedNode,
  WorkstreamViewModel,
} from "./workstream-view-model";

const TASK_NODE_WIDTH = 304;
const TASK_NODE_HEIGHT = 168;
const GATE_NODE_WIDTH = 384;
const GATE_NODE_HEIGHT = 96;

const LANE_PADDING_X = 32;
const LANE_PADDING_TOP = 72;
const LANE_PADDING_BOTTOM = 32;

export type WorkstreamCheckpointLaneState =
  | "completed"
  | "current"
  | "upcoming";

export interface WorkstreamGraphCheckpointLane {
  id: string;
  title: string;
  subtitle: string;
  nodeIds: string[];
  index: number;
  state: WorkstreamCheckpointLaneState;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WorkstreamGraphNodeHighlight =
  | "selected"
  | "ancestor"
  | "descendant"
  | "dim"
  | "none";

export type WorkstreamGraphEdgeHighlight =
  | "ancestor"
  | "descendant"
  | "muted"
  | "none";

export interface WorkstreamGraphNodeData extends Record<string, unknown> {
  entry: WorkstreamDerivedNode;
  repoLabel: string;
  highlight: WorkstreamGraphNodeHighlight;
  showId: boolean;
}

export interface WorkstreamGraphRenderableEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface WorkstreamGraphLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  highlight: WorkstreamGraphNodeHighlight;
  repoLabel: string;
  entry: WorkstreamDerivedNode;
}

export interface WorkstreamGraphLayoutEdge
  extends WorkstreamGraphRenderableEdge {
  highlight: WorkstreamGraphEdgeHighlight;
}

export interface WorkstreamGraphLayoutResult {
  nodes: WorkstreamGraphLayoutNode[];
  edges: WorkstreamGraphLayoutEdge[];
  checkpointLanes: WorkstreamGraphCheckpointLane[];
  dependenciesByNode: Map<string, string[]>;
  dependentsByNode: Map<string, string[]>;
  ancestors: Set<string>;
  descendants: Set<string>;
}

function nodeSizeForType(nodeType: WorkstreamDerivedNode["node"]["type"]) {
  return nodeType === "gate"
    ? { width: GATE_NODE_WIDTH, height: GATE_NODE_HEIGHT }
    : { width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT };
}

function repoLabelForNode(
  workstream: WorkstreamDocument,
  entry: WorkstreamDerivedNode,
): string {
  if (entry.node.repoIds.length === 0) {
    return "No repo scoped";
  }

  const repoById = new Map(workstream.repos.map((repo) => [repo.id, repo]));
  return entry.node.repoIds
    .map((repoId) => {
      const repo = repoById.get(repoId);
      return repo ? `${repo.owner}/${repo.name}` : repoId;
    })
    .join(" · ");
}

function buildDependencyMaps(workstream: WorkstreamDocument) {
  const dependenciesByNode = new Map(
    workstream.nodes.map((node) => [node.id, [...node.dependsOn]]),
  );
  const dependentsByNode = new Map(
    workstream.nodes.map((node) => [node.id, [] as string[]]),
  );

  for (const node of workstream.nodes) {
    for (const dependencyId of node.dependsOn) {
      dependentsByNode.get(dependencyId)?.push(node.id);
    }
  }

  return { dependenciesByNode, dependentsByNode };
}

function hasAlternatePath(
  sourceId: string,
  targetId: string,
  adjacency: Map<string, string[]>,
): boolean {
  const seen = new Set<string>();
  const stack = [...(adjacency.get(sourceId) ?? [])].filter(
    (candidate) => candidate !== targetId,
  );

  for (const candidate of stack) {
    seen.add(candidate);
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current === targetId) {
      return true;
    }

    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) {
        continue;
      }

      seen.add(next);
      stack.push(next);
    }
  }

  return false;
}

export function reduceTransitiveEdges(
  workstream: WorkstreamDocument,
): WorkstreamGraphRenderableEdge[] {
  const { dependentsByNode } = buildDependencyMaps(workstream);

  return workstream.nodes.flatMap<WorkstreamGraphRenderableEdge>((node) =>
    node.dependsOn
      .filter(
        (dependencyId) =>
          !hasAlternatePath(dependencyId, node.id, dependentsByNode),
      )
      .map((dependencyId) => ({
        id: `${dependencyId}->${node.id}`,
        sourceId: dependencyId,
        targetId: node.id,
      })),
  );
}

export function collectReachableNodes(
  startId: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adjacency.get(startId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        stack.push(next);
      }
    }
  }

  return seen;
}

function nodeHighlightFor(
  nodeId: string,
  selectedNodeId: string | null,
  ancestors: Set<string>,
  descendants: Set<string>,
): WorkstreamGraphNodeHighlight {
  if (!selectedNodeId) {
    return "none";
  }

  if (nodeId === selectedNodeId) {
    return "selected";
  }

  if (ancestors.has(nodeId)) {
    return "ancestor";
  }

  if (descendants.has(nodeId)) {
    return "descendant";
  }

  return "dim";
}

function edgeHighlightFor(
  sourceId: string,
  targetId: string,
  selectedNodeId: string | null,
  ancestors: Set<string>,
  descendants: Set<string>,
): WorkstreamGraphEdgeHighlight {
  if (!selectedNodeId) {
    return "none";
  }

  if (
    targetId === selectedNodeId ||
    (ancestors.has(sourceId) &&
      (ancestors.has(targetId) || targetId === selectedNodeId))
  ) {
    return "ancestor";
  }

  if (
    sourceId === selectedNodeId ||
    ((sourceId === selectedNodeId || descendants.has(sourceId)) &&
      descendants.has(targetId))
  ) {
    return "descendant";
  }

  return "muted";
}

export function buildWorkstreamGraphLayout(
  workstream: WorkstreamDocument,
  viewModel: WorkstreamViewModel,
  selectedNodeId: string | null,
): WorkstreamGraphLayoutResult {
  const { dependenciesByNode, dependentsByNode } =
    buildDependencyMaps(workstream);
  const renderedEdges = reduceTransitiveEdges(workstream);
  const ancestors = selectedNodeId
    ? collectReachableNodes(selectedNodeId, dependenciesByNode)
    : new Set<string>();
  const descendants = selectedNodeId
    ? collectReachableNodes(selectedNodeId, dependentsByNode)
    : new Set<string>();

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "TB",
    ranker: "network-simplex",
    ranksep: 104,
    nodesep: 72,
    edgesep: 28,
    marginx: 56,
    marginy: 56,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const entry of viewModel.derivedNodes) {
    const { width, height } = nodeSizeForType(entry.node.type);
    graph.setNode(entry.node.id, { width, height });
  }

  for (const edge of renderedEdges) {
    graph.setEdge(edge.sourceId, edge.targetId);
  }

  dagre.layout(graph);

  const layoutNodes: WorkstreamGraphLayoutNode[] = viewModel.derivedNodes.map(
    (entry) => {
      const { width, height } = nodeSizeForType(entry.node.type);
      const position = graph.node(entry.node.id) as
        | { x: number; y: number }
        | undefined;

      return {
        id: entry.node.id,
        x: (position?.x ?? width / 2) - width / 2,
        y: (position?.y ?? height / 2) - height / 2,
        width,
        height,
        highlight: nodeHighlightFor(
          entry.node.id,
          selectedNodeId,
          ancestors,
          descendants,
        ),
        repoLabel: repoLabelForNode(workstream, entry),
        entry,
      };
    },
  );

  const checkpointLanes = buildCheckpointLanes(viewModel, layoutNodes);

  return {
    nodes: layoutNodes,
    edges: renderedEdges.map((edge) => ({
      ...edge,
      highlight: edgeHighlightFor(
        edge.sourceId,
        edge.targetId,
        selectedNodeId,
        ancestors,
        descendants,
      ),
    })),
    checkpointLanes,
    dependenciesByNode,
    dependentsByNode,
    ancestors,
    descendants,
  };
}

function laneStateFor(
  progress: WorkstreamViewModel["checkpoints"][number],
): WorkstreamCheckpointLaneState {
  if (progress.checkpoint.status === "completed") {
    return "completed";
  }
  if (
    progress.totalNodes > 0 &&
    progress.completedNodes === progress.totalNodes
  ) {
    return "completed";
  }
  if (progress.isCurrent) {
    return "current";
  }
  return "upcoming";
}

function buildCheckpointLanes(
  viewModel: WorkstreamViewModel,
  layoutNodes: WorkstreamGraphLayoutNode[],
): WorkstreamGraphCheckpointLane[] {
  const positionById = new Map(layoutNodes.map((ln) => [ln.id, ln]));

  return viewModel.checkpoints
    .map((progress, index) => {
      const members = progress.checkpoint.nodeIds
        .map((id) => positionById.get(id))
        .filter((ln): ln is WorkstreamGraphLayoutNode => ln !== undefined);

      if (members.length === 0) {
        return null;
      }

      const minX = Math.min(...members.map((m) => m.x));
      const minY = Math.min(...members.map((m) => m.y));
      const maxX = Math.max(...members.map((m) => m.x + m.width));
      const maxY = Math.max(...members.map((m) => m.y + m.height));

      const x = minX - LANE_PADDING_X;
      const y = minY - LANE_PADDING_TOP;
      const width = maxX - minX + LANE_PADDING_X * 2;
      const height = maxY - minY + LANE_PADDING_TOP + LANE_PADDING_BOTTOM;

      const state = laneStateFor(progress);
      const { totalNodes, completedNodes } = progress;
      const subtitle =
        totalNodes === 0
          ? "No nodes"
          : `${completedNodes} / ${totalNodes} complete`;

      return {
        id: progress.checkpoint.id,
        title: progress.checkpoint.title,
        subtitle,
        nodeIds: members.map((m) => m.id),
        index,
        state,
        x,
        y,
        width,
        height,
      };
    })
    .filter((lane): lane is WorkstreamGraphCheckpointLane => lane !== null);
}
