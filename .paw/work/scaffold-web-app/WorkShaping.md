# WorkShaping: Scaffold Web App

## Problem Statement

Streamliner needs to become a usable application. The `prototype/` directory contains proven, tested modules (schema types, parser/validator, graph layout engine, React Flow node components, CSS theme) but they exist as loose files with no app shell, no dev server, and no integration layer. This issue turns them into a working local web app.

**Who benefits**: Developers who want to visualize and interact with workstream dependency graphs for planning multi-issue bodies of work.

**What problem is solved**: The prototype code can't be run. This wires it into a Vite + React + TypeScript app so the graph is viewable and interactive.

## Validation Against Prototype Code

All prototype assets referenced in Issue #1 exist and are confirmed:

| Asset | Status | Notes |
|-------|--------|-------|
| `workstream-schema.ts` | ✅ Present | 116 lines, types/enums for workstream JSON. Includes `research` node type (issue only mentions task/gate but schema has it). |
| `workstream-view-model.ts` | ✅ Present | ~720 lines, strict parser with field-level validation, view model builder with operational queues, GitHub enrichment support. |
| `workstream-graph.ts` | ✅ Present | ~316 lines, dagre layout, transitive edge reduction, selection highlighting. |
| `workstream-graph.test.ts` | ✅ Present | 138 lines, vitest tests for transitive reduction + highlighting. |
| `WorkstreamGraphNode.tsx` | ✅ Present | 115 lines, task + gate node components with highlight states. |
| `streamliner-theme.css` | ✅ Present | 637 lines, full Light Deep Ocean theme with all CSS classes. |
| `example-project.json` | ✅ Present | 284 lines, 10-node workstream with mixed statuses. |

**No amendments to Issue #1 are needed** — the described scope matches the prototype exactly.

## Work Breakdown

### Core (Port + Scaffold)

1. **Vite + React + TypeScript scaffold** — `npm create vite`, install deps (`@xyflow/react`, `@dagrejs/dagre`, `vitest`)
2. **Port prototype modules** — Copy schema, view model, graph layout, node components, CSS into `src/`. Adapt imports for project structure.
3. **Wire graph rendering** — Main `App.tsx` loads example JSON, runs through `parseWorkstreamDocument` → `buildWorkstreamViewModel` → `buildWorkstreamGraphLayout` → React Flow canvas.
4. **Ensure tests pass** — Configure vitest, verify existing tests work in new project.

### New UI Components (Required by Issue)

5. **Node inspector panel** — Clicking a node shows detail card in sidebar: status, dependencies, dependents, linked issue, summary. The sidebar CSS classes already exist in the theme (`sl-sidebar`, `sl-inspector-card`, etc.).
6. **Operational queue status strip** — Ready/in-flight/blocked/waiting-for-review counts from the view model. The stat strip CSS exists (`sl-stat-strip`, `sl-stat`).
7. **Header with workstream metadata** — Title, summary, freshness indicator, status badges. CSS exists (`sl-header`, `sl-title`, `sl-badges`).

### Workstream Loading

8. **File picker or drag-and-drop** — Load workstream JSON from user's filesystem. Simplest UX that satisfies the requirement.
9. **Validation error display** — Surface `parseWorkstreamDocument` errors clearly using existing error state CSS (`sl-action-error`).

## Architecture Sketch

```
src/
├── main.tsx                          # React entry point
├── App.tsx                           # Root component, state management
├── App.css                           # App-level layout (imports theme)
├── types/
│   └── workstream-schema.ts          # Ported from prototype
├── model/
│   ├── workstream-view-model.ts      # Ported from prototype
│   ├── workstream-view-model.test.ts # (if tests exist later)
│   └── workstream-graph.ts           # Ported from prototype
├── components/
│   ├── WorkstreamGraphNode.tsx       # Ported from prototype
│   ├── WorkstreamCanvas.tsx          # React Flow canvas wrapper
│   ├── NodeInspector.tsx             # Node detail sidebar
│   ├── OperationalStatusStrip.tsx    # Stat strip (ready/in-flight/blocked counts)
│   └── WorkstreamHeader.tsx          # Header with title, badges, freshness
├── streamliner-theme.css             # Ported from prototype
└── test/
    └── workstream-graph.test.ts      # Ported from prototype
```

## Key Design Decisions

1. **Controlled React Flow** — prototype uses controlled mode (`nodes`/`onNodesChange`/`applyNodeChanges`). Preserve this pattern.
2. **No backend** — pure client-side app for this issue. Load files via FileReader API.
3. **No GitHub enrichment** — view model supports it but this issue is artifact-only mode (no GitHub API calls).
4. **Default fixture** — App starts by rendering `example-project.json` built into the bundle. File picker adds to/replaces it.
5. **State management** — React useState is sufficient; no need for external state libraries for this scope.

## Edge Cases

- **Invalid JSON** — `parseWorkstreamDocument` throws detailed errors; display in UI error state.
- **Empty nodes array** — Valid but shows empty graph; show helpful empty state message.
- **Very large graphs** — React Flow + dagre handles this; not a concern for V1.
- **Node type `research`** — Schema supports it but prototype node components only distinguish task/gate visually. Research nodes will render as tasks (same component). This is fine for V1.

## Risks

- **Dependency version compatibility** — `@xyflow/react` and `@dagrejs/dagre` import styles may need specific version. Prototype doesn't pin versions.
- **CSS conflicts** — Theme uses `sl-` prefix to avoid conflicts; React Flow CSS may need explicit import ordering.
- **dagre types** — `@dagrejs/dagre` may need `@types/dagre` or type adjustments.

## Codebase Fit

- Direct port — all modules are self-contained TypeScript/React with clean interfaces.
- No external integrations needed for this issue.
- CSS theme is comprehensive and already includes all needed component styles.

## Open Questions for Downstream

- None — scope is clear and self-contained.
