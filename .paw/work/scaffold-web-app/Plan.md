# Implementation Plan: Scaffold Web App

## Approach

Scaffold a Vite + React + TypeScript project, port prototype modules, wire up graph rendering with interactive features (node inspector, operational status strip), and add workstream file loading. Implementation is structured for maximum parallelism.

## Work Items

### Phase 1: Scaffold & Port (parallelizable)

**1a. Scaffold Vite project** (`scaffold-vite`)
- Run `npm create vite@latest` with React + TypeScript template in the worktree root
- Install dependencies: `@xyflow/react`, `@dagrejs/dagre`, `vitest`
- Configure vitest in `vite.config.ts`
- Add test script to `package.json`
- Remove Vite boilerplate (default App.tsx, App.css content, assets)
- Success: `npm run dev` starts, `npm test` runs (no tests yet)

**1b. Port prototype modules** (`port-prototype`) — depends on `scaffold-vite`
- Copy `workstream-schema.ts` → `src/types/workstream-schema.ts`
- Copy `workstream-view-model.ts` → `src/model/workstream-view-model.ts`
- Copy `workstream-graph.ts` → `src/model/workstream-graph.ts`
- Copy `workstream-graph.test.ts` → `src/model/workstream-graph.test.ts`
- Copy `WorkstreamGraphNode.tsx` → `src/components/WorkstreamGraphNode.tsx`
- Copy `streamliner-theme.css` → `src/streamliner-theme.css`
- Copy `example-project.json` → `src/data/example-project.json`
- Fix all import paths to match new structure
- Success: `npm test` passes, `tsc --noEmit` passes

### Phase 2: Wire Application (parallelizable after Phase 1)

**2a. Core app shell + graph canvas** (`app-shell`)
- Create `src/components/WorkstreamCanvas.tsx` — React Flow wrapper that converts layout results to React Flow nodes/edges, handles node selection
- Create `src/App.tsx` — loads example-project.json, runs parse → viewModel → layout pipeline, renders header + stat strip + canvas + sidebar
- Import theme CSS
- Success: `npm run dev` shows the graph rendering with dagre layout, nodes are clickable

**2b. Node inspector panel** (`node-inspector`) — can parallel with 2a if interface is agreed
- Create `src/components/NodeInspector.tsx` — shows selected node details: title, summary, status, attention, type, dependencies (names), dependents (names), linked issue, repo label
- Uses existing sidebar CSS classes (`sl-sidebar`, `sl-inspector-card`, `sl-inspector-meta`)
- Shows empty state when no node selected
- Success: clicking a node shows its details in the sidebar

**2c. Operational status strip** (`status-strip`) — can parallel with 2a
- Create `src/components/OperationalStatusStrip.tsx` — displays counts: ready now, in flight, blocked/attention, waiting for review, total nodes
- Uses existing stat strip CSS (`sl-stat-strip`, `sl-stat`)
- Success: stat strip shows correct counts from the view model

**2d. Workstream header** (`workstream-header`) — can parallel with 2a
- Create `src/components/WorkstreamHeader.tsx` — title, summary, status/attention badges, freshness indicator, tracking issue link
- Uses existing header CSS (`sl-header`, `sl-title-row`, `sl-badges`, `sl-pill`)
- Success: header shows workstream metadata

### Phase 3: File Loading & Polish

**3a. File loading** (`file-loading`)
- Add file picker button in header actions area (or a drop zone) to load workstream JSON
- Use FileReader API to read file, pass through `parseWorkstreamDocument`
- Display validation errors using existing error CSS (`sl-action-error`)
- Default to example-project.json on initial load
- Success: can load a different JSON file and see it render; invalid JSON shows clear error

**3b. Integration verification** (`integration-verify`)
- Verify all acceptance criteria from Issue #1
- Run full test suite
- Verify `npm run build` succeeds
- Visual check of graph rendering, highlighting, inspector, status strip
- Success: all acceptance criteria met

## Key Decisions

1. **Single-file port** — prototype modules are copied with minimal changes (import paths only). No refactoring.
2. **App state in App.tsx** — `useState` for workstream document, selected node ID, view model, layout. Recompute on change.
3. **React Flow integration** — controlled mode with `applyNodeChanges`. Node types registered: `workstreamTask`, `workstreamGate`.
4. **No routing** — single-page app with one view for this issue.
5. **CSS import order** — `@xyflow/react/dist/style.css` first, then `streamliner-theme.css` to allow overrides.

## Dependencies

```
scaffold-vite → port-prototype → [app-shell, node-inspector, status-strip, workstream-header] → file-loading → integration-verify
```

Note: 2b/2c/2d can be built in parallel with 2a since they're independent components, but they all need the ported modules from Phase 1.
