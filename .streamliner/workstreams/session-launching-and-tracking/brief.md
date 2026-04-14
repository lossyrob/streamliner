# Session launching and tracking

## Purpose
Dogfood Streamliner by using it to manage the buildout of launching and tracking
PAW worker sessions from the graph. Establish the repo-local workstream setup
that Streamliner itself should support for small, single-repo projects.

## Approach
Bootstrap Streamliner's own `docs/design/` set from the current root docs first,
so the launch and tracking work executes against a real project design layer
rather than living forever on transitional documents.

Build the feature in waves: bootstrap the repo-scoped design layer, then run
explicit design sessions for the workstream so the launch contract, runtime
model, and key design decisions are written down before the downstream
implementation issue graph is finalized. After that, add backend Copilot SDK
plumbing to run `paw-init`, launch a visible terminal session, and layer
session tracking and runtime overlay into the UI.

Keep committed workstream artifacts limited to durable planning state.
Session IDs, heartbeats, tracker snapshots, and launch metadata stay in
Streamliner's local runtime state and are projected onto the graph as derived UI
state rather than written back into `graph.json`.

## Design References
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope, architecture, and V1 goals
- `streamliner:docs/design/operating-model.md` - operating model: roles, context package, and operating rhythm
- `streamliner:docs/design/design-layer.md` - design-doc system: document families, format, and catalog
- `streamliner:docs/design/workstream-format.md` - workstream artifact format and runtime state separation
- `streamliner:docs/design/session-system.md` - session launching, lifecycle, tracking, and runtime overlay
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md` - rationale for observation-based session tracking
- `streamliner:docs/design/decisions/002-file-based-context-delivery.md` - rationale for file-based context delivery

## Boundaries
- **In scope:** Repo-local Streamliner initialization, design-doc bootstrap,
  launch contract, context assembly, Copilot SDK `paw-init`, terminal launch,
  session tracking model, runtime overlay in the UI
- **Out of scope:** Non-PAW launch modes, non-GitHub tracker integrations,
  remote multi-machine tracking, a general orchestration platform
- **Deferred:** Rich session control beyond launch and status, full tracker
  abstraction across ADO/Linear, automatic promotion of runtime facts into
  committed artifact state

## Current State
Wave 1 design foundation is nearly complete. Issue #4 (`bootstrap-design-docs`)
shipped the repo-scoped `docs/design/` set. Issue #5
(`make-workstream-design-explicit`) has produced the session system design doc
(`docs/design/session-system.md`) and two accepted decision records (heartbeat-
based session tracking, file-based context delivery). The workstream's intended
design is now explicit and written down.

The downstream implementation graph is ready for review and refinement. The
session system design doc defines the launch contract, context assembly model,
session lifecycle, tracking model, and runtime overlay — enough to guide
backend and UI implementation in subsequent waves.

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

## Open Questions
- When should runtime-discovered progress be promoted into committed workstream
  artifact state?
- How does the Copilot CLI session write heartbeats? Sidecar process or PAW
  skill integration?
- Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/
  IDE terminal APIs?
- Can a node have multiple concurrent sessions (e.g., after crash and relaunch)?
