import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../../../../../src/streamliner-theme.css";
import "./styles.css";
import {
  dependencies,
  workstreamById,
  workstreams,
  type Availability,
  type DependencyEdge,
  type SpikeTask,
  type SpikeWave,
  type SpikeWorkstream,
  type TaskStatus,
} from "./spike-data";

type LodLevel = "summary" | "detail";

type Selection =
  | { type: "project" }
  | { type: "wave"; workstreamId: string; waveId: string }
  | { type: "task"; workstreamId: string; waveId: string; taskId: string }
  | { type: "edge"; id: string };

const COLUMN_WIDTH = 460;
const COLUMN_GAP = 220;

const HEADER_HEIGHT = 96;
const HEADER_GAP_Y = 24;

const SUMMARY_WAVE_HEIGHT = 96;
const SUMMARY_WAVE_GAP = 22;

const DETAIL_WAVE_BASE_HEIGHT = 110;
const DETAIL_TASK_HEIGHT = 152;
const DETAIL_TASK_GAP = 12;
const DETAIL_WAVE_GAP = 32;

// Edge availability priority for cycle breaking. Higher = stronger evidence
// that the dependency is real and should constrain layout. We drop the
// lowest-priority edge if a cycle exists.
const availabilityWeight: Record<Availability, number> = {
  validated: 6,
  mainline: 5,
  "branch-local": 4,
  preview: 3,
  proposed: 2,
  superseded: 1,
};

const availabilityColor: Record<Availability, string> = {
  validated: "#12945f",
  mainline: "#12945f",
  preview: "#b07808",
  "branch-local": "#d36d21",
  proposed: "#6b7fa0",
  superseded: "#c83232",
};

const availabilityTone: Record<Availability, string> = {
  validated: "green",
  mainline: "green",
  preview: "amber",
  "branch-local": "amber",
  proposed: "muted",
  superseded: "red",
};

function statusClassName(status: TaskStatus): string {
  switch (status) {
    case "in-progress":
      return "status-green";
    case "ready":
    case "completed":
      return "status-accent";
    case "blocked":
      return "status-red";
    default:
      return "status-amber";
  }
}

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").toLowerCase();
}

function waveStatus(wave: SpikeWave, workstream: SpikeWorkstream): TaskStatus {
  const statuses = wave.taskIds
    .map((id) => workstream.tasks[id]?.status)
    .filter((status): status is TaskStatus => Boolean(status));
  if (statuses.length === 0) return "planned";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (
    statuses.some(
      (status) => status === "in-progress" || status === "ready",
    )
  ) {
    return "in-progress";
  }
  if (statuses.some((status) => status === "blocked")) return "blocked";
  return "planned";
}

function waveCompletionRatio(
  wave: SpikeWave,
  workstream: SpikeWorkstream,
): { completed: number; total: number } {
  let completed = 0;
  for (const id of wave.taskIds) {
    if (workstream.tasks[id]?.status === "completed") completed += 1;
  }
  return { completed, total: wave.taskIds.length };
}

function detailWaveHeight(wave: SpikeWave): number {
  const taskCount = wave.taskIds.length;
  return (
    DETAIL_WAVE_BASE_HEIGHT +
    taskCount * DETAIL_TASK_HEIGHT +
    Math.max(0, taskCount - 1) * DETAIL_TASK_GAP
  );
}

interface WorkstreamHeaderData extends Record<string, unknown> {
  workstream: SpikeWorkstream;
  waveCount: number;
  taskCount: number;
}

interface WaveNodeData extends Record<string, unknown> {
  workstream: SpikeWorkstream;
  wave: SpikeWave;
  level: LodLevel;
  selected: boolean;
  status: TaskStatus;
  selectedTaskId: string | null;
  inboundEdges: DependencyEdge[];
  outboundEdges: DependencyEdge[];
  onSelectTask: (taskId: string) => void;
}

const nodeTypes = {
  workstreamHeader: WorkstreamHeaderNode,
  wave: WaveNode,
} satisfies NodeTypes;

function WorkstreamHeaderNode({
  data,
}: NodeProps<Node<WorkstreamHeaderData>>) {
  return (
    <header className="lod-workstream-header">
      <div className="sl-eyebrow">Workstream</div>
      <h2>{data.workstream.title}</h2>
      <p>{data.workstream.summary}</p>
      <div className="lod-workstream-meta">
        <span>{data.workstream.repoLabel}</span>
        <span>·</span>
        <span>{data.waveCount} waves</span>
        <span>·</span>
        <span>{data.taskCount} nodes</span>
      </div>
    </header>
  );
}

function WaveNode({ data }: NodeProps<Node<WaveNodeData>>) {
  const { workstream, wave, level, selected, status } = data;
  const ratio = waveCompletionRatio(wave, workstream);
  const showInbound = data.inboundEdges.length > 0;
  const showOutbound = data.outboundEdges.length > 0;
  const waveIdx = workstream.waves.findIndex((w) => w.id === wave.id);
  const isFirstWave = waveIdx === 0;
  const isLastWave = waveIdx === workstream.waves.length - 1;

  return (
    <article
      className={`sl-swimlane sl-swimlane--${
        status === "completed" ? "completed" : status === "in-progress" ? "current" : "upcoming"
      } lod-wave lod-wave--${level} ${selected ? "selected" : ""}`}
    >
      {!isFirstWave ? (
        <Handle
          id="spine-in"
          type="target"
          position={Position.Top}
          className="lod-port lod-port--spine"
        />
      ) : null}
      {!isLastWave ? (
        <Handle
          id="spine-out"
          type="source"
          position={Position.Bottom}
          className="lod-port lod-port--spine"
        />
      ) : null}
      {showInbound ? (
        <Handle
          id="wave-import"
          type="target"
          position={Position.Left}
          className="lod-port lod-port--import"
        />
      ) : null}
      {showOutbound ? (
        <Handle
          id="wave-export"
          type="source"
          position={Position.Right}
          className="lod-port lod-port--export"
        />
      ) : null}

      <div className="sl-swimlane-header lod-wave-header">
        <span className="sl-swimlane-index">
          {String(wave.index + 1).padStart(2, "0")}
        </span>
        <div className="sl-swimlane-titles">
          <span className="sl-swimlane-title">{wave.title}</span>
          <span className="sl-swimlane-subtitle">
            {ratio.total > 0
              ? `${ratio.completed} / ${ratio.total} complete`
              : "No nodes yet"}
          </span>
        </div>
        <span className={`sl-pill ${availabilityTone[statusToAvailability(status)]}`}>
          {formatLabel(status)}
        </span>
      </div>

      {showInbound ? (
        <div className="lod-wave-imports" aria-label="Imports">
          {data.inboundEdges.map((edge) => (
            <span
              key={edge.id}
              className={`lod-import-chip lod-import-${edge.state}`}
              title={edge.risk}
            >
              <span className="lod-import-chip-arrow">→</span>
              imports {edge.toImport} ({edge.state})
            </span>
          ))}
        </div>
      ) : null}

      {level === "detail" ? (
        <div className="lod-wave-tasks">
          {wave.taskIds.map((taskId) => {
            const task = workstream.tasks[taskId];
            if (!task) return null;
            const isSelectedTask = data.selectedTaskId === task.id;
            return (
              <button
                key={task.id}
                type="button"
                className={`sl-node ${task.type === "gate" ? "gate" : "task"} ${statusClassName(task.status)} lod-task-card ${isSelectedTask ? "selected" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onSelectTask(task.id);
                }}
              >
                <div className="sl-node-title">{task.title}</div>
                <div className="sl-node-badges">
                  <span className={`sl-node-pill ${statusClassName(task.status)}`}>
                    {formatLabel(task.status)}
                  </span>
                  <span className="sl-node-pill muted">{task.type}</span>
                  <span className="sl-node-pill muted">{task.attention}</span>
                </div>
                <div className="sl-node-summary">{task.summary}</div>
                <div className="sl-node-meta">
                  <span>{workstream.repoLabel}</span>
                  {task.trackerLabel ? (
                    <span className="sl-node-issue-link">{task.trackerLabel}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="lod-wave-summary">
          <p>{wave.summary}</p>
          <div className="lod-wave-summary-meta">
            <span>{wave.taskIds.length} nodes</span>
            {wave.exports.length > 0 ? (
              <span>· exports {wave.exports.join(", ")}</span>
            ) : null}
          </div>
        </div>
      )}

      {showOutbound ? (
        <div className="lod-wave-exports" aria-label="Exports">
          {data.outboundEdges.map((edge) => (
            <span
              key={edge.id}
              className={`lod-export-chip lod-export-${edge.state}`}
              title={edge.risk}
            >
              exports {edge.fromExport} ({edge.state})
              <span className="lod-export-chip-arrow">→</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function statusToAvailability(status: TaskStatus): Availability {
  switch (status) {
    case "completed":
      return "validated";
    case "in-progress":
      return "preview";
    case "blocked":
      return "superseded";
    case "ready":
      return "preview";
    default:
      return "proposed";
  }
}

function workstreamHeaderNodeId(workstreamId: string): string {
  return `header:${workstreamId}`;
}

function waveNodeId(workstreamId: string, waveId: string): string {
  return `wave:${workstreamId}:${waveId}`;
}

function inboundFor(workstreamId: string, waveId: string): DependencyEdge[] {
  return dependencies.filter(
    (edge) => edge.toWorkstream === workstreamId && edge.toWave === waveId,
  );
}

function outboundFor(workstreamId: string, waveId: string): DependencyEdge[] {
  return dependencies.filter(
    (edge) => edge.fromWorkstream === workstreamId && edge.fromWave === waveId,
  );
}

interface WaveLayout {
  workstreamId: string;
  waveId: string;
  rank: number;       // global topological depth across all workstreams
  x: number;
  y: number;
  height: number;
  inboundEdges: DependencyEdge[];
  outboundEdges: DependencyEdge[];
}

interface ProjectLayout {
  waves: Map<string, WaveLayout>;        // keyed by `${ws}::${wave}`
  layoutEdges: DependencyEdge[];          // edges that survived cycle breaking
  ignoredEdges: DependencyEdge[];         // edges dropped to break cycles (still rendered)
  rankCount: number;
  workstreamColumnX: Record<string, number>;
}

function waveKey(workstreamId: string, waveId: string): string {
  return `${workstreamId}::${waveId}`;
}

// Detect cycles in the wave dependency graph (intra-workstream sequence +
// cross-workstream edges) and return the set of edge ids that need to be
// dropped to break them. Drops the lowest-priority cross-workstream edge
// from each cycle. Intra-workstream sequence edges are never dropped.
function detectAndBreakCycles(): Set<string> {
  // Build adjacency including all edges
  const adj = new Map<string, Array<{ to: string; edge: DependencyEdge | null }>>();
  for (const ws of workstreams) {
    for (let i = 0; i < ws.waves.length; i++) {
      adj.set(waveKey(ws.id, ws.waves[i].id), []);
    }
  }
  // Intra-workstream sequence edges
  for (const ws of workstreams) {
    for (let i = 0; i < ws.waves.length - 1; i++) {
      const from = waveKey(ws.id, ws.waves[i].id);
      const to = waveKey(ws.id, ws.waves[i + 1].id);
      adj.get(from)?.push({ to, edge: null });
    }
  }
  // Cross-workstream edges
  for (const edge of dependencies) {
    const from = waveKey(edge.fromWorkstream, edge.fromWave);
    const to = waveKey(edge.toWorkstream, edge.toWave);
    adj.get(from)?.push({ to, edge });
  }

  const dropped = new Set<string>();
  const colour = new Map<string, "white" | "grey" | "black">();
  const path: Array<{ from: string; edge: DependencyEdge | null }> = [];

  for (const start of adj.keys()) colour.set(start, "white");

  function visit(node: string): void {
    colour.set(node, "grey");
    for (const next of adj.get(node) ?? []) {
      if (dropped.has(next.edge?.id ?? "")) continue;
      const c = colour.get(next.to) ?? "white";
      if (c === "white") {
        path.push({ from: node, edge: next.edge });
        visit(next.to);
        path.pop();
      } else if (c === "grey") {
        // Found a back-edge — node→next.to closes a cycle.
        // Walk path back to next.to to find all cross-workstream edges in
        // this cycle, drop the weakest one. The closing edge itself is in
        // the candidate set if it's a cross-workstream edge.
        const candidates: DependencyEdge[] = [];
        if (next.edge) candidates.push(next.edge);
        for (let i = path.length - 1; i >= 0; i--) {
          const step = path[i];
          if (step.edge) candidates.push(step.edge);
          if (step.from === next.to) break;
        }
        if (candidates.length > 0) {
          // Drop the lowest-priority edge
          let weakest = candidates[0];
          for (const c of candidates) {
            if (availabilityWeight[c.state] < availabilityWeight[weakest.state]) {
              weakest = c;
            }
          }
          dropped.add(weakest.id);
        }
      }
    }
    colour.set(node, "black");
  }

  for (const start of adj.keys()) {
    if (colour.get(start) === "white") visit(start);
  }

  return dropped;
}

// Compute global rank (topological depth) for each wave. Within a
// workstream, wave i must have rank >= rank(wave i-1) + 1. Across
// workstreams, an importing wave must have rank >= rank(exporting wave) + 1.
function computeWaveRanks(droppedEdges: Set<string>): Map<string, number> {
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();

  function depsOf(workstreamId: string, waveId: string): string[] {
    const result: string[] = [];
    const ws = workstreamById[workstreamId];
    const idx = ws.waves.findIndex((w) => w.id === waveId);
    if (idx > 0) {
      result.push(waveKey(workstreamId, ws.waves[idx - 1].id));
    }
    for (const edge of dependencies) {
      if (droppedEdges.has(edge.id)) continue;
      if (edge.toWorkstream === workstreamId && edge.toWave === waveId) {
        result.push(waveKey(edge.fromWorkstream, edge.fromWave));
      }
    }
    return result;
  }

  function rank(key: string): number {
    if (ranks.has(key)) return ranks.get(key)!;
    if (visiting.has(key)) return 0; // safety: should not hit after cycle break
    visiting.add(key);
    const [ws, wave] = key.split("::");
    const ds = depsOf(ws, wave);
    let max = 0;
    for (const dep of ds) {
      max = Math.max(max, rank(dep) + 1);
    }
    visiting.delete(key);
    ranks.set(key, max);
    return max;
  }

  for (const ws of workstreams) {
    for (const wave of ws.waves) {
      rank(waveKey(ws.id, wave.id));
    }
  }
  return ranks;
}

function computeProjectLayout(level: LodLevel): ProjectLayout {
  const droppedEdges = detectAndBreakCycles();
  const ranks = computeWaveRanks(droppedEdges);

  // Assign each workstream a fixed x column based on its order in the data.
  const workstreamColumnX: Record<string, number> = {};
  workstreams.forEach((ws, idx) => {
    workstreamColumnX[ws.id] =
      80 + idx * (COLUMN_WIDTH + COLUMN_GAP);
  });

  // Compute the y position of each rank as a stack: each rank's y is the
  // bottom of the previous rank plus a gap. Wave height varies by content
  // and level.
  const wavesPerRank = new Map<number, WaveLayout[]>();
  const allWaves: WaveLayout[] = [];

  for (const ws of workstreams) {
    for (const wave of ws.waves) {
      const inboundEdges = inboundFor(ws.id, wave.id);
      const outboundEdges = outboundFor(ws.id, wave.id);
      const height =
        level === "summary"
          ? SUMMARY_WAVE_HEIGHT +
            (inboundEdges.length + outboundEdges.length) * 24
          : detailWaveHeight(wave);
      const r = ranks.get(waveKey(ws.id, wave.id)) ?? 0;
      const layout: WaveLayout = {
        workstreamId: ws.id,
        waveId: wave.id,
        rank: r,
        x: workstreamColumnX[ws.id],
        y: 0, // filled in below
        height,
        inboundEdges,
        outboundEdges,
      };
      const list = wavesPerRank.get(r) ?? [];
      list.push(layout);
      wavesPerRank.set(r, list);
      allWaves.push(layout);
    }
  }

  // Assign y per rank. Each rank's y baseline is `running` (top); the rank's
  // height is the max height of any wave at that rank. After placing the
  // rank, advance running by that max + gap.
  const sortedRanks = Array.from(wavesPerRank.keys()).sort((a, b) => a - b);
  let running = HEADER_HEIGHT + HEADER_GAP_Y;
  const gap = level === "summary" ? SUMMARY_WAVE_GAP : DETAIL_WAVE_GAP;

  const wavesByKey = new Map<string, WaveLayout>();
  for (const r of sortedRanks) {
    const wavesAtRank = wavesPerRank.get(r)!;
    const maxHeight = Math.max(...wavesAtRank.map((w) => w.height));
    for (const w of wavesAtRank) {
      // Top-align waves within the rank band so the swimlane reads correctly
      w.y = running;
      wavesByKey.set(waveKey(w.workstreamId, w.waveId), w);
    }
    running += maxHeight + gap;
  }

  const ignored = dependencies.filter((e) => droppedEdges.has(e.id));
  const kept = dependencies.filter((e) => !droppedEdges.has(e.id));

  return {
    waves: wavesByKey,
    layoutEdges: kept,
    ignoredEdges: ignored,
    rankCount: sortedRanks.length,
    workstreamColumnX,
  };
}

function buildNodes(
  layout: ProjectLayout,
  level: LodLevel,
  selection: Selection,
  onSelectTask: (workstreamId: string, waveId: string, taskId: string) => void,
): Node[] {
  const result: Node[] = [];

  // Workstream column headers above the first wave at each column
  for (const ws of workstreams) {
    const x = layout.workstreamColumnX[ws.id];
    const taskCount = Object.values(ws.tasks).length;
    // Find the topmost wave for this workstream
    const firstWave = ws.waves[0];
    const firstWaveLayout = layout.waves.get(waveKey(ws.id, firstWave.id));
    const headerY = firstWaveLayout
      ? firstWaveLayout.y - HEADER_HEIGHT - HEADER_GAP_Y
      : 0;

    result.push({
      id: workstreamHeaderNodeId(ws.id),
      type: "workstreamHeader",
      position: { x, y: headerY },
      width: COLUMN_WIDTH,
      height: HEADER_HEIGHT,
      style: { width: COLUMN_WIDTH, height: HEADER_HEIGHT, pointerEvents: "none" },
      draggable: false,
      selectable: false,
      focusable: false,
      data: {
        workstream: ws,
        waveCount: ws.waves.length,
        taskCount,
      },
    });

    for (const wave of ws.waves) {
      const wl = layout.waves.get(waveKey(ws.id, wave.id));
      if (!wl) continue;
      const status = waveStatus(wave, ws);
      const isSelectedWave =
        selection.type === "wave" &&
        selection.workstreamId === ws.id &&
        selection.waveId === wave.id;
      const isWaveOfSelectedTask =
        selection.type === "task" &&
        selection.workstreamId === ws.id &&
        selection.waveId === wave.id;
      const selectedTaskId =
        selection.type === "task" && isWaveOfSelectedTask ? selection.taskId : null;

      result.push({
        id: waveNodeId(ws.id, wave.id),
        type: "wave",
        position: { x: wl.x, y: wl.y },
        width: COLUMN_WIDTH,
        height: wl.height,
        style: { width: COLUMN_WIDTH, height: wl.height },
        data: {
          workstream: ws,
          wave,
          level,
          selected: isSelectedWave || isWaveOfSelectedTask,
          status,
          selectedTaskId,
          inboundEdges: wl.inboundEdges,
          outboundEdges: wl.outboundEdges,
          onSelectTask: (taskId: string) => onSelectTask(ws.id, wave.id, taskId),
        } satisfies WaveNodeData,
      });
    }
  }

  return result;
}

function buildEdges(
  layout: ProjectLayout,
  level: LodLevel,
  selection: Selection,
): Edge[] {
  const result: Edge[] = [];

  // Intra-workstream spine edges (workstream sequence). Drawn as subtle
  // solid lines connecting wave-N's bottom to wave-(N+1)'s top.
  for (const ws of workstreams) {
    for (let i = 0; i < ws.waves.length - 1; i++) {
      const fromWave = ws.waves[i];
      const toWave = ws.waves[i + 1];
      result.push({
        id: `spine:${ws.id}:${fromWave.id}->${toWave.id}`,
        source: waveNodeId(ws.id, fromWave.id),
        target: waveNodeId(ws.id, toWave.id),
        sourceHandle: "spine-out",
        targetHandle: "spine-in",
        type: "smoothstep",
        className: "lod-spine-edge",
        style: {
          stroke: "rgba(20, 60, 130, 0.32)",
          strokeWidth: 2,
        },
        selectable: false,
        focusable: false,
      });
    }
  }

  // Cross-workstream dependency edges. Layout-kept edges go left/right.
  // Dropped (cycle-breaking) edges still render but are visually muted to
  // signal "this is a back-edge in the layout".
  for (const edge of dependencies) {
    const isSelected = selection.type === "edge" && selection.id === edge.id;
    const isDropped = layout.ignoredEdges.some((e) => e.id === edge.id);
    result.push({
      id: edge.id,
      source: waveNodeId(edge.fromWorkstream, edge.fromWave),
      target: waveNodeId(edge.toWorkstream, edge.toWave),
      sourceHandle: "wave-export",
      targetHandle: "wave-import",
      label: `${edge.label} · ${edge.state}`,
      type: "smoothstep",
      animated:
        !isDropped &&
        (edge.state === "preview" ||
          edge.state === "branch-local" ||
          edge.state === "proposed"),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: availabilityColor[edge.state],
      },
      className: `lod-route lod-route-${edge.state} ${isSelected ? "selected" : ""} ${isDropped ? "back-edge" : ""}`,
      style: {
        stroke: availabilityColor[edge.state],
        strokeWidth: isSelected ? 3.5 : level === "summary" ? 2.5 : 2.2,
        strokeDasharray:
          edge.state === "mainline" || edge.state === "validated"
            ? undefined
            : "8 8",
        opacity: isDropped ? 0.5 : 1,
      },
      labelStyle: { fontWeight: 700, fill: "#1a2540" },
      labelBgStyle: { fill: "rgba(255,255,255,0.92)" },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 6,
    });
  }

  return result;
}

function levelForZoom(zoom: number): LodLevel {
  return zoom < 0.95 ? "summary" : "detail";
}

function ZoomPanel({
  level,
  zoom,
  onZoomChange,
}: {
  level: LodLevel;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  return (
    <Panel className="lod-zoom-panel" position="bottom-left">
      <div className="lod-zoom-heading">
        <span className="sl-eyebrow">Two-level wave geometry</span>
        <strong>
          {level === "summary" ? "Wave summary" : "Wave containers (production-style)"}
        </strong>
      </div>
      <input
        aria-label="Semantic zoom"
        max="1.4"
        min="0.45"
        onChange={(event) => onZoomChange(Number(event.target.value))}
        step="0.01"
        type="range"
        value={zoom}
      />
      <p>
        {level === "summary"
          ? "Each wave is a compact swimlane bar with status, completion, and import/export chips. Cross-workstream edges connect at wave boundaries."
          : "Each wave swimlane contains its task cards exactly like the production workstream view. Cross-workstream edges still attach only at wave boundaries — never at task cards."}
      </p>
    </Panel>
  );
}

function LodFlow({
  level,
  selection,
  setSelection,
  zoom,
  setZoom,
}: {
  level: LodLevel;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
}) {
  const reactFlow = useReactFlow();

  const handleSelectTask = useCallback(
    (workstreamId: string, waveId: string, taskId: string) => {
      setSelection({ type: "task", workstreamId, waveId, taskId });
    },
    [setSelection],
  );

  const layout = useMemo(() => computeProjectLayout(level), [level]);
  const nodes = useMemo(
    () => buildNodes(layout, level, selection, handleSelectTask),
    [layout, level, selection, handleSelectTask],
  );
  const edges = useMemo(
    () => buildEdges(layout, level, selection),
    [layout, level, selection],
  );

  const onZoomChange = useCallback(
    (nextZoom: number) => {
      setZoom(nextZoom);
    },
    [setZoom],
  );

  const onInit = useCallback((instance: ReactFlowInstance) => {
    window.setTimeout(() => {
      void instance.fitView({ padding: 0.12, duration: 0, maxZoom: 0.92 });
    }, 0);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (level === "summary") {
        void reactFlow.fitView({
          padding: 0.12,
          duration: 200,
          maxZoom: 0.95,
        });
      } else {
        // In detail mode, focus on the dependency boundary at production
        // fidelity and let the user pan to navigate. Find the first
        // cross-workstream dependency edge and center between its endpoints.
        const firstEdge = layout.layoutEdges[0];
        if (firstEdge) {
          const fromW = layout.waves.get(
            waveKey(firstEdge.fromWorkstream, firstEdge.fromWave),
          );
          const toW = layout.waves.get(
            waveKey(firstEdge.toWorkstream, firstEdge.toWave),
          );
          if (fromW && toW) {
            const cx =
              (fromW.x + COLUMN_WIDTH / 2 + toW.x + COLUMN_WIDTH / 2) / 2;
            const cy = (fromW.y + fromW.height / 2 + toW.y + toW.height / 2) / 2;
            void reactFlow.setCenter(cx, cy, { zoom: 0.78, duration: 220 });
            return;
          }
        }
        // Fallback: centre roughly in the middle of all waves
        const allWaves = Array.from(layout.waves.values());
        if (allWaves.length > 0) {
          const cx =
            allWaves.reduce((sum, w) => sum + w.x + COLUMN_WIDTH / 2, 0) /
            allWaves.length;
          const cy =
            allWaves.reduce((sum, w) => sum + w.y + w.height / 2, 0) /
            allWaves.length;
          void reactFlow.setCenter(cx, cy, { zoom: 0.78, duration: 220 });
        }
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [level, reactFlow, layout]);

  return (
    <ReactFlow
      defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
      edges={edges}
      fitView={false}
      maxZoom={1.4}
      minZoom={0.35}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={nodeTypes}
      onEdgeClick={(_event, edge) =>
        setSelection({ type: "edge", id: edge.id })
      }
      onInit={onInit}
      onNodeClick={(_event, node) => {
        if (node.id.startsWith("wave:")) {
          const [, workstreamId, waveId] = node.id.split(":");
          setSelection({ type: "wave", workstreamId, waveId });
        }
      }}
      onPaneClick={() => setSelection({ type: "project" })}
      panOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={28} size={1.2} variant={BackgroundVariant.Dots} />
      <Controls fitViewOptions={{ padding: 0.1, maxZoom: 0.95 }} />
      <ZoomPanel level={level} onZoomChange={onZoomChange} zoom={zoom} />
    </ReactFlow>
  );
}

function Inspector({
  level,
  selection,
}: {
  level: LodLevel;
  selection: Selection;
}) {
  if (selection.type === "task") {
    const workstream = workstreamById[selection.workstreamId];
    const wave = workstream.waves.find((w) => w.id === selection.waveId);
    const task = workstream.tasks[selection.taskId];
    if (workstream && wave && task) {
      return (
        <InspectorShell title={task.title} subtitle={task.summary}>
          <BadgeRow>
            <span className={`sl-pill ${tonePillFor(task.status)}`}>
              {formatLabel(task.status)}
            </span>
            <span className="sl-pill muted">{task.type}</span>
            <span className="sl-pill muted">{task.attention}</span>
          </BadgeRow>
          <InspectorSection title="Wave context">
            <p>
              <strong>{wave.title}</strong> in <strong>{workstream.title}</strong>.
              Cross-workstream dependencies anchor at this wave, not at the task.
            </p>
          </InspectorSection>
          {task.trackerLabel ? (
            <InspectorSection title="Tracker">
              <p>{task.trackerLabel}</p>
            </InspectorSection>
          ) : null}
        </InspectorShell>
      );
    }
  }

  if (selection.type === "wave") {
    const workstream = workstreamById[selection.workstreamId];
    const wave = workstream.waves.find((w) => w.id === selection.waveId);
    if (workstream && wave) {
      const inbound = inboundFor(workstream.id, wave.id);
      const outbound = outboundFor(workstream.id, wave.id);
      const ratio = waveCompletionRatio(wave, workstream);
      return (
        <InspectorShell title={wave.title} subtitle={wave.summary}>
          <BadgeRow>
            <span className="sl-pill accent">
              {String(wave.index + 1).padStart(2, "0")} of {workstream.waves.length}
            </span>
            <span className="sl-pill muted">
              {ratio.completed} / {ratio.total} nodes complete
            </span>
          </BadgeRow>
          <InspectorSection title="Imports">
            {inbound.length === 0 ? (
              <p>No external imports for this wave.</p>
            ) : (
              inbound.map((edge) => (
                <InspectorItem
                  key={edge.id}
                  title={edge.label}
                  text={`From ${workstreamById[edge.fromWorkstream].title} / ${
                    workstreamById[edge.fromWorkstream].waves.find(
                      (w) => w.id === edge.fromWave,
                    )?.title
                  } · ${edge.state}`}
                />
              ))
            )}
          </InspectorSection>
          <InspectorSection title="Exports">
            {wave.exports.length === 0 ? (
              <p>No declared exports for this wave.</p>
            ) : (
              wave.exports.map((name) => (
                <InspectorItem key={name} title={name} text="Wave export" />
              ))
            )}
            {outbound.map((edge) => (
              <InspectorItem
                key={edge.id}
                title={edge.label}
                text={`Consumed by ${workstreamById[edge.toWorkstream].title} / ${
                  workstreamById[edge.toWorkstream].waves.find(
                    (w) => w.id === edge.toWave,
                  )?.title
                } · ${edge.state}`}
              />
            ))}
          </InspectorSection>
          <InspectorSection title="Tasks in this wave">
            {wave.taskIds.map((id) => {
              const task = workstream.tasks[id];
              if (!task) return null;
              return (
                <InspectorItem
                  key={id}
                  title={task.title}
                  text={`${formatLabel(task.status)} · ${task.type}`}
                />
              );
            })}
          </InspectorSection>
        </InspectorShell>
      );
    }
  }

  if (selection.type === "edge") {
    const edge = dependencies.find((candidate) => candidate.id === selection.id);
    if (edge) {
      const fromWs = workstreamById[edge.fromWorkstream];
      const toWs = workstreamById[edge.toWorkstream];
      const fromWave = fromWs.waves.find((w) => w.id === edge.fromWave);
      const toWave = toWs.waves.find((w) => w.id === edge.toWave);
      return (
        <InspectorShell title={edge.label} subtitle={edge.risk}>
          <BadgeRow>
            <span className={`sl-pill ${availabilityTone[edge.state]}`}>
              {edge.state}
            </span>
            <span className="sl-pill muted">wave-to-wave dependency</span>
          </BadgeRow>
          <InspectorSection title="Geometry">
            <p>
              Export <strong>{edge.fromExport}</strong> leaves{" "}
              <strong>{fromWs.title}</strong> at wave{" "}
              <strong>{fromWave?.title}</strong>, then enters{" "}
              <strong>{toWs.title}</strong> at wave{" "}
              <strong>{toWave?.title}</strong> as <strong>{edge.toImport}</strong>.
            </p>
          </InspectorSection>
          <InspectorSection title="Action">
            <p>{edge.action}</p>
          </InspectorSection>
        </InspectorShell>
      );
    }
  }

  return (
    <InspectorShell
      title="Project: Streamliner"
      subtitle="Two real workstreams: session-launching-and-tracking and session-status-signals. Their dependency goes both ways at the wave/checkpoint boundary."
    >
      <BadgeRow>
        <span className="sl-pill accent">
          {level === "summary" ? "Wave summary" : "Wave containers"}
        </span>
        <span className="sl-pill muted">{workstreams.length} workstreams</span>
      </BadgeRow>
      <InspectorSection title="Geometry rule">
        <p>
          Each workstream is a vertical sequence of waves. Tasks live inside
          their wave swimlane and never form cross-workstream edges. All
          cross-workstream dependencies attach at wave/checkpoint boundaries.
        </p>
      </InspectorSection>
      <InspectorSection title="Reading the levels">
        <p>
          Zoom out to see waves as compact bars with status pills and dependency
          chips. Zoom in to expand each wave into Streamliner-style task cards
          identical to the production workstream view.
        </p>
      </InspectorSection>
    </InspectorShell>
  );
}

function tonePillFor(status: TaskStatus): string {
  switch (status) {
    case "completed":
      return "green";
    case "ready":
    case "in-progress":
      return "accent";
    case "blocked":
      return "red";
    default:
      return "muted";
  }
}

function InspectorShell({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <aside className="sl-sidebar lod-inspector">
      <div>
        <div className="sl-eyebrow">Inspector</div>
        <h2 className="sl-sidebar-title">{title}</h2>
        <p className="sl-inspector-summary">{subtitle}</p>
      </div>
      {children}
    </aside>
  );
}

function InspectorSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="sl-sidebar-section">
      <h3 className="sl-section-label">{title}</h3>
      {children}
    </section>
  );
}

function BadgeRow({ children }: { children: React.ReactNode }) {
  return <div className="sl-badges">{children}</div>;
}

function InspectorItem({ text, title }: { text: string; title: string }) {
  return (
    <div className="lod-inspector-item">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function App() {
  const [zoom, setZoom] = useState(0.72);
  const [selection, setSelection] = useState<Selection>({ type: "project" });
  const level = levelForZoom(zoom);

  return (
    <div className="sl-root lod-root">
      <header className="sl-shell-nav lod-shell-nav">
        <a className="sl-shell-brand" href="../index.html">
          <span className="lod-logo-mark" aria-hidden="true">S</span>
          <span className="sl-shell-brand-stack">
            <span className="sl-shell-brand-wordmark">Streamliner</span>
            <span className="sl-shell-brand-rail" />
          </span>
        </a>
        <div className="lod-nav-copy">
          <strong>Work Geometry Canvas</strong>
          <span>Wave-anchored cross-workstream geometry</span>
        </div>
      </header>

      <section className="sl-header lod-header">
        <div className="sl-header-main">
          <div className="sl-eyebrow">Independent prototype · real workstreams</div>
          <div className="sl-title-row">
            <h1 className="sl-title">
              Session launching ↔ session status signals
            </h1>
            <span className="sl-pill accent">
              {level === "summary" ? "Wave summary" : "Wave containers"}
            </span>
          </div>
          <p className="sl-summary lod-header-summary">
            Two real workstreams from this repo, drawn as vertical wave
            swimlanes. Cross-workstream dependencies anchor at wave boundaries
            on both sides; tasks inside a wave never form cross-workstream
            edges. Zoom in to see the production-style task cards.
          </p>
        </div>
        <div className="lod-header-actions">
          <span className="sl-pill muted">React Flow</span>
          <span className="sl-pill muted">Throwaway spike</span>
        </div>
      </section>

      <main className="sl-body lod-body">
        <section className="sl-canvas lod-canvas">
          <ReactFlowProvider>
            <LodFlow
              level={level}
              selection={selection}
              setSelection={setSelection}
              setZoom={setZoom}
              zoom={zoom}
            />
          </ReactFlowProvider>
        </section>
        <Inspector level={level} selection={selection} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
