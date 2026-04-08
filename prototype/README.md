# Streamliner — Prototype Assets

Prior art from an earlier prototype implementation. These modules are proven, tested, and ready to be adapted into the Streamliner web application. All code is TypeScript (React for components, pure functions for logic).

## Directory layout

```
prototype/
├── README.md                          ← this file
├── example-data/
│   └── example-project.json           ← real-world workstream artifact (10 nodes, 2 gates, 9 checkpoints)
└── src/
    ├── workstream-schema.ts           ← TypeScript types and enums for the workstream JSON schema
    ├── workstream-view-model.ts       ← parser, validator, and view-model builder
    ├── workstream-graph.ts            ← dagre layout, transitive edge reduction, selection highlighting
    ├── workstream-graph.test.ts       ← vitest tests for graph logic
    ├── streamliner-theme.css          ← full CSS theme (Light Deep Ocean) with design tokens
    └── components/
        └── WorkstreamGraphNode.tsx    ← custom React Flow node components (task + gate)
```

## Asset descriptions

### `src/workstream-schema.ts`

The canonical TypeScript type definitions for the workstream JSON document format. Includes:

- **Schema version** constant (`WORKSTREAM_SCHEMA_VERSION = 1`)
- **Enum arrays** for node statuses, attention states, node types, checkpoint statuses, PR validation states
- **Interfaces** for the full document hierarchy: `WorkstreamDocument`, `WorkstreamNode`, `WorkstreamCheckpoint`, `WorkstreamRepo`, `WorkstreamIssue`
- **GitHub snapshot types** for issue and PR enrichment data

This is the single source of truth for the workstream data contract. The schema is versioned and validated at parse time.

### `src/workstream-view-model.ts`

Transforms a raw `WorkstreamDocument` (plus optional GitHub enrichment data) into a computed `WorkstreamViewModel`. Contains:

- **`parseWorkstreamDocument(rawJson)`** — strict JSON parser with detailed field-level validation (kebab-case IDs, timestamp formats, enum membership, referential integrity for dependencies/checkpoints/repos)
- **`buildWorkstreamViewModel(workstream, githubSnapshot?, now?)`** — derives operational queues from the raw artifact:
  - `readyNow` — nodes whose dependencies are all complete
  - `inFlight` — nodes currently being worked
  - `waitingForReview` — nodes with PRs needing review
  - `waitingForValidation` — nodes with approved PRs failing/pending CI
  - `blockedOrAttention` — everything else that needs human attention
- **GitHub-aware completion** — when the artifact is stale but GitHub shows an issue as closed/completed, the node is treated as complete for queue placement
- **Freshness calculation** — marks artifacts older than 7 days as stale, with human-readable labels
- **Signal generation** — summary signals for dashboard display (focus items, watch items, next validation gate)

### `src/workstream-graph.ts`

Graph layout engine that takes a `WorkstreamDocument` + `WorkstreamViewModel` and produces positioned nodes and edges for React Flow. Contains:

- **`reduceTransitiveEdges(workstream)`** — removes edges implied by longer paths (if A→B→C exists, the direct A→C edge is suppressed). This dramatically declutters graphs with many cross-dependencies.
- **`collectReachableNodes(startId, adjacency)`** — BFS reachability for computing ancestor/descendant sets
- **`buildWorkstreamGraphLayout(workstream, viewModel, selectedNodeId)`** — full layout pipeline:
  1. Build dependency/dependent adjacency maps
  2. Reduce transitive edges
  3. Compute ancestor/descendant sets for the selected node
  4. Run dagre auto-layout (top-to-bottom, tight-tree ranker)
  5. Assign highlight states to nodes and edges

**Layout configuration** (tuned through visual iteration):
- Direction: top-to-bottom (`TB`)
- Ranker: `tight-tree`
- Rank separation: 64px, node separation: 24px
- Task nodes: 248×132px, gate nodes: 212×92px

**Highlight states**:
- Nodes: `selected` | `ancestor` | `descendant` | `dim` | `none`
- Edges: `ancestor` | `descendant` | `muted` | `none`

### `src/workstream-graph.test.ts`

Vitest tests covering:
- Transitive edge reduction (A→B→C removes the redundant A→C edge)
- Ancestor/descendant highlighting when a node is selected

### `src/components/WorkstreamGraphNode.tsx`

Custom React Flow node components:

- **`WorkstreamGraphNode`** — renders task nodes with title, summary, status badge, attention badge, PR count, repo label, and optional issue link
- **`WorkstreamGraphGateNode`** — renders gate/checkpoint nodes with dashed borders

Both components respond to highlight state (selected/ancestor/descendant/dim) via CSS classes and support the `showId` toggle for debugging.

### `src/streamliner-theme.css`

Complete CSS theme with design tokens. The "Light Deep Ocean" palette:

- Subtle blue-tinted backgrounds with white card surfaces
- Accent blue (`#1d6edc`), green (`#12945f`), amber (`#b07808`), red (`#c83232`)
- Monospace font stack for IDs and paths
- Styles for: graph nodes (task/gate/selected/ancestor/descendant/dim), sidebar, inspector cards, stat strip, action buttons, pills/badges, status screens
- React Flow chrome overrides (minimap, controls, handles, background dots)
- Responsive breakpoints at 1180px and 960px

All CSS classes use the `sl-` prefix (Streamliner) to avoid conflicts.

### `example-data/example-project.json`

A real workstream artifact with:
- 10 nodes (8 tasks, 2 gates) across 2 waves
- Mixed statuses: completed, in-progress, planned
- Dependency graph with transitive edges (good for testing reduction)
- Tracking issue and per-node issue references
- 9 checkpoints spanning both waves

Use this as the default development fixture for rendering the graph and testing the view model.

## Dependencies

These modules require:

| Package | Purpose |
|---------|---------|
| `@xyflow/react` | React Flow graph rendering |
| `@dagrejs/dagre` | Directed graph auto-layout |
| `react` | Component rendering |
| `vitest` | Test runner (dev only) |

## Key design decisions baked into these assets

1. **Controlled nodes** — React Flow is used in controlled mode (`nodes` + `onNodesChange` with `applyNodeChanges`). This lets the app preserve user-dragged positions across re-renders while still updating highlights/data.

2. **Transitive reduction at render time** — the workstream document stores all direct dependencies. The graph view reduces them for display but preserves the full set for dependency tracking, queue computation, and the sidebar inspector.

3. **GitHub enrichment is layered** — the view model works without GitHub data (artifact-only mode) and progressively enhances when snapshots are available. This means the graph is usable offline.

4. **Highlight propagation** — selecting a node computes full ancestor and descendant reachability, then dims everything else. This is computed per-render, not stored in state.

5. **Top-to-bottom layout** — chosen after iterating through left-to-right (produced unusable horizontal ribbons for real workstreams) and multiple spacing configurations. The current values were tuned against a 10-node real workstream.
