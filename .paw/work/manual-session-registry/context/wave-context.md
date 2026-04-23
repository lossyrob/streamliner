# Wave Context — Manual Session Registry (#13)

> Assembled context for the worker executing this node. This file is supplementary to the issue body (the node spec) and provides wave-level orientation that would go stale if put in the issue.

## Workstream

**ID:** `session-launching-and-tracking`
**Tracking issue:** [#3](https://github.com/lossyrob/streamliner/issues/3)
**Brief:** `.streamliner/workstreams/session-launching-and-tracking/brief.md`
**Graph:** `.streamliner/workstreams/session-launching-and-tracking/graph.json`

## Wave structure

| Wave | Checkpoint | Status |
|------|-----------|--------|
| 1 — Design foundation | `design-foundation` | **completed** |
| 2 — Manual session registry | `manual-registry-usable` | **current** |
| 3 — Launch from graph | `launch-from-graph` | planned |
| 4 — Runtime overlay | `tracking-visible` | planned |

## Wave 1 — What shipped

- `bootstrap-design-docs` (#4) — repo-scoped `docs/design/` created, design layer bootstrapped.
- `make-workstream-design-explicit` (#5) — explicit design sessions captured session-system.md, decisions 001–003.
- `registry-first-reorientation` (#9, PR #10) — pivoted workstream to registry-first; landed Decision 004.

## Wave 2 — Current wave

**Checkpoint:** `manual-registry-usable` — "Streamliner persists a local, graph-independent registry of Copilot sessions with autosaved titles/descriptions/colors and can relaunch them after a restart."

### This node

- **`manual-session-registry-ui`** (#13) — the node being executed. Implements `SessionRegistryStore` + dashboard UI.

### Completed in this wave

- `registry-first-reorientation` (#9) — pivot landed.
- `session-registry-model` (#11, PR #12) — designed the registry contract. Shipped Decision 005, `src/session-registry-schema.ts`, `src/session-registry-contract.ts`, updated `session-system.md` with record shape / storage / autosave / merge / public surface.

### Parallel / remaining in this wave

- **`session-relaunch`** — reopens a terminal at the recorded cwd. Depends on this node's store export. No issue created yet.
- **`terminal-tab-color-spike`** — spike on Windows Terminal tab color bridge. Depends on this node's store export. `attention: watch`. No issue created yet.

## Downstream consumers of this node's exports

1. **`session-relaunch`** (Wave 2) — will call `getSession(id)` to retrieve cwd for terminal relaunch.
2. **`session-event-observation`** (Wave 4) — will call `attachObservedSession()`, `upsertSession()` with observed origin, and `subscribe()` for change events.
3. **`paw-control-state-observation`** (Wave 4) — will read sessions via `listSessions()` / `getSession()`.
4. **`runtime-overlay-ui`** (Wave 4) — will consume `listSessions()` with `graphBinding` filter for overlay projection.

## Coordination notes

- The dashboard is currently a pure Vite browser app (React + React Flow) with no Node backend. This node introduces the first server-side runtime. The inherited decision on the issue says to host in-process via the dashboard's local Node server.
- The existing dashboard routes are implicit — `App.tsx` renders a single `WorkstreamCanvas`. This node adds a second top-level surface alongside it.
- The workstream canvas, swimlanes, and checkpoint stepper (shipped in earlier commits on main) must not regress. The sessions surface is a sibling, not a replacement.
- Iterative UI development uses the repo's screenshot harness at `scripts/screenshot.mjs` and the `.github/skills/iterative-ui/` skill. For the sessions surface, the harness will need a route or URL that renders the sessions view instead of the graph.
