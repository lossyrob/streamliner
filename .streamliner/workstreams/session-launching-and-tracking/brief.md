# Session launching and tracking

## Purpose
Dogfood Streamliner by using it to manage the buildout of launching and tracking
PAW worker sessions from the graph. Establish the repo-local workstream setup
that Streamliner itself should support for small, single-repo projects.

## Approach
Bootstrap Streamliner's own `docs/design/` set from the current root docs first,
so the launch and tracking work executes against a real project design layer
rather than living forever on transitional documents.

Build the feature in waves:

- **Wave 1 — Design foundation (done):** bootstrap the repo-scoped design layer
  and run explicit design sessions so the launch contract, runtime model, and
  key design decisions are written down before the downstream implementation
  issue graph is finalized.
- **Wave 2 — Manual session registry (current focus):** ship a local-first,
  graph-independent registry of Copilot CLI sessions. Persist per-session
  metadata (title, description, color, cwd, repo, status, last-seen) under the
  local runtime-state root, autosave on edit, import/discover existing sessions
  by observing Copilot CLI session state files, and support "reopen this
  session" across restarts. Delivers the highest near-term value — recovering
  session context after a Windows restart — without needing the launch
  pipeline. Treats the registry as the primary session surface; the graph
  overlay is a later projection of it.
- **Wave 3 — Launch from graph:** Copilot SDK launch prep (context assembly,
  `paw-init`, kickoff-prompt compilation), launch-claim binding, and the
  Copilot CLI interactive worker launch. Launches register into the Wave 2
  registry rather than introducing a parallel tracking surface.
- **Wave 4 — Runtime overlay on the graph:** extend observation with PAW
  control state, turn boundaries, and hook signals, and project the registry
  plus observed state onto graph nodes in the UI.

Keep committed workstream artifacts limited to durable planning state.
Session IDs, observed session state, tracker snapshots, and launch metadata
stay in Streamliner's local runtime state and are projected onto the graph as
derived UI state rather than written back into `graph.json`.

## Design References
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope, architecture, and V1 goals
- `streamliner:docs/design/operating-model.md` - operating model: roles, context package, and operating rhythm
- `streamliner:docs/design/design-layer.md` - design-doc system: document families, format, and catalog
- `streamliner:docs/design/workstream-format.md` - workstream artifact format and runtime state separation
- `streamliner:docs/design/session-system.md` - session launching, lifecycle, tracking, and runtime overlay
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md` - rationale for observation-based session tracking
- `streamliner:docs/design/decisions/002-file-based-context-delivery.md` - rationale for file-based context delivery
- `streamliner:docs/design/decisions/003-paw-control-state-integration.md` - rationale for reading PAW control state as the workflow progression source

## Boundaries
- **In scope:** Repo-local Streamliner initialization, design-doc bootstrap,
  launch contract, context assembly, Copilot SDK preparation (`paw-init`,
  context writing, kickoff-prompt compilation), Copilot CLI interactive
  launch, manual session registry (local persistence, UI list/edit, color
  assignment, relaunch at cwd), observation-based session tracking, runtime
  overlay in the UI
- **Out of scope:** Non-PAW launch modes, non-GitHub tracker integrations,
  remote multi-machine tracking, devbox session observation, a general
  orchestration platform
- **Deferred:** Rich session control beyond launch/relaunch/status, full
  tracker abstraction across ADO/Linear, automatic promotion of runtime
  facts into committed artifact state, automatic session-to-node binding,
  multi-machine sync of the registry

## Current State
Wave 1 design foundation is complete. Issue #4 (`bootstrap-design-docs`)
shipped the repo-scoped `docs/design/` set. Issue #5
(`make-workstream-design-explicit`, PR #8 merged) produced the session system
design doc (`docs/design/session-system.md`) and three accepted decision
records (observation-based session tracking, file-based context delivery, PAW
control-state integration). The workstream's intended design is written down,
including the split between SDK-based launch preparation and Copilot CLI
interactive worker launch.

Wave 2 is now the active focus, reoriented per issue #9 to deliver a
**manual session registry** before the launch pipeline. This pivot is driven
by the most acute near-term pain: losing track of active Copilot sessions
across Windows restarts. The registry is graph-independent — sessions do not
need to be tied to workstream nodes — and builds directly on the
observation-based tracking decision (#001), so it does not require any of
the launch plumbing to land first. Launch-from-graph and the graph runtime
overlay follow in Waves 3 and 4 and register into / project from the Wave 2
registry rather than introducing parallel surfaces.

## Decisions
- Use repo-local `.streamliner/workstreams/` for Streamliner's committed
  workstream artifacts so the product dogfoods its own in-repo layout.
- Keep fast-changing session and tracker state out of Git under Streamliner's
  local runtime state root and render it as a graph overlay.
- Use the workstream-scoped project key `streamliner` for local runtime-state
  namespacing.
- Keep wave structure implicit through dependencies, checkpoints, and
  tracker-backed node promotion for now rather than adding a `wave` field.
- Treat `graph.json.updatedAt` as changing on any intentional committed graph
  edit, never on runtime-only overlay changes.
- Keep node-specific design narrowing in tracker/spec and coordination-note
  context for now; defer a dedicated node-level `designRefs` field unless
  context assembly later proves it necessary.
- Use a parent GitHub issue to represent the workstream when the child nodes are
  GitHub-backed, so progress and grouping are visible in GitHub itself.
- Treat explicit design sessions as a valid early Wave 1 node when the
  workstream design is still implicit in the brief and graph.
- Bootstrap `docs/design/` before building launch plumbing so later work uses
  real design references instead of transitional root documents.
- Use Copilot SDK for launch preparation (context assembly, `paw-init`, kickoff
  prompt compilation) and Copilot CLI interactive mode for the visible worker
  session.
- Bind launched sessions through a launch claim keyed by launch nonce plus
  `cwd`/branch/window guardrails rather than `cwd` alone.
- Read PAW `## Control State` (including `Workflow Identity`) from
  `WorkflowContext.md` / `ReviewContext.md` as the authoritative source for
  workflow progression in the runtime overlay, keeping session liveness
  (Copilot session state) and workflow progression (PAW control state) as
  two orthogonal observation sources.
- Treat the **session registry as the primary session surface**; the graph
  overlay is a projection of the registry. Pull manual tracking ahead of the
  launch pipeline so restart recovery ships independently of launch work
  (issue #9, pending decision record).

## Open Questions
- When should runtime-discovered progress be promoted into committed workstream
  artifact state?
- Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/
  IDE terminal APIs?
- How should Streamliner observe remote session-state roots for devbox-launched
  sessions?
- Registry persistence: per-session JSON files plus an index, or a single
  SQLite store? (Leaning JSON for hand-editability and alignment with the
  observation-based pattern.)
- Windows Terminal tab color bridge: feasible via profile/tab title + tabColor,
  or better deferred until a cross-platform strategy is clearer? (Spike inside
  `session-registry-model`.)
