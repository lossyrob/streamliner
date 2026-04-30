# Session launching and tracking

## Purpose
Dogfood Streamliner by using it to manage the buildout of launching and tracking
Copilot worker sessions from the graph. Establish the repo-local workstream
setup that Streamliner itself should support for small, single-repo projects,
with PAW treated as one configurable launch profile rather than the only
workflow Streamliner can start.

## Approach
Bootstrap Streamliner's own `docs/design/` set from the current root docs first,
so the launch and tracking work executes against a real project design layer
rather than living forever on transitional documents.

Build the feature in waves:

- **Wave 1 — Design foundation (done):** bootstrap the repo-scoped design layer
  and run explicit design sessions so the launch contract, runtime model, and
  key design decisions are written down before the downstream implementation
  issue graph is finalized.
- **Wave 2 — Manual session registry (done):** ship a local-first,
  graph-independent registry of Copilot CLI sessions. Persist per-session
  metadata (title, description, color, cwd, repo, status, last-seen) under the
  local runtime-state root, autosave on edit, import/discover existing sessions
  by observing Copilot CLI session state files, and support "reopen this
  session" across restarts. Delivers the highest near-term value — recovering
  session context after a Windows restart — without needing the launch
  pipeline. Treats the registry as the primary session surface; the graph
  overlay is a later projection of it.
- **Wave 3 — Launch from graph:** launch preparation (context assembly, launch
  profile and prompt assembly, default CLI args, optional profile-specific setup
  such as PAW initialization), launch-claim binding, and the Copilot CLI
  interactive worker launch. Launches register into the Wave 2 registry rather
  than introducing a parallel tracking surface.
- **Wave 4 — Runtime overlay on the graph:** project registry state, launch
  bindings, and observed session liveness onto graph nodes in the UI. PAW
  control state is optional workflow enrichment for PAW-backed launches, not a
  prerequisite for the graph launch and tracking loop.

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
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md` - rationale for treating the session registry as the primary session surface
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md` - concrete storage and identity contract for the local session registry

## Boundaries
- **In scope:** Repo-local Streamliner initialization, design-doc bootstrap,
  launch contract, context assembly, launch prompt profiles, layered launch
  instructions, default Copilot CLI arguments, Copilot CLI interactive launch,
  manual session registry (local persistence, UI list/edit, color assignment,
  relaunch at cwd), observation-based session tracking, runtime overlay in the
  UI
- **Out of scope:** Non-Copilot worker runtimes, non-GitHub tracker
  integrations, remote multi-machine tracking, devbox session observation, a
  general orchestration platform
- **Deferred:** Rich session control beyond launch/relaunch/status, full
  tracker abstraction across ADO/Linear, automatic promotion of runtime
  facts into committed artifact state, deep PAW workflow orchestration,
  multi-machine sync of the registry

## Current State
Wave 1 design foundation is complete. Issue #4 (`bootstrap-design-docs`)
shipped the repo-scoped `docs/design/` set. Issue #5
(`make-workstream-design-explicit`, PR #8 merged) produced the session system
design doc (`docs/design/session-system.md`) and three accepted decision
records (observation-based session tracking, file-based context delivery, PAW
control-state integration). The workstream's intended design is written down,
including the split between launch preparation and Copilot CLI interactive
worker launch.

Wave 2 is complete. The workstream reoriented per issue #9 to deliver a
**manual session registry** before the launch pipeline, then completed the
`manual-registry-usable` checkpoint through issues #13, #15, #17, and #29.
Issue #13 (`manual-session-registry-ui`, PR #14) landed the local file-backed
registry and Sessions surface, and hot work pulled trusted Copilot CLI session
tracking into the same branch: plugin hook signals, trusted/default visibility,
activity/context indexing, derived worktree/branch/GitHub refs, activity status,
restart copy actions, and related design-doc updates. Issue #15 resolved Windows
Terminal tab color as optional launch-time presentation metadata, not core
relaunch behavior. Issue #17 accepted a standalone local Streamliner API process
as the registry synchronization hub. Issue #29 completed local session relaunch:
restore a tracked session at its recorded `cwd` through the local API, with
Copilot resume and Windows Terminal color treated as best-effort enhancements.
Wave 3 is now framed around configurable launch from the graph rather than a
mandatory PAW bootstrap path. The next ready work is backend context assembly,
launch-claim binding, and launch prompt/profile definition: layered instruction
text at Streamliner instance, project, workstream, and node-launch scopes; final
editable prompt preview; context package references; and default Copilot CLI
arguments such as `--yolo`. PAW remains an important preset/instruction style,
but PAW workflow status is not a completion blocker for this workstream. The
remaining observation work should consume what PR #14 landed instead of
duplicating it. The ready Wave 3 nodes are now tracked by GitHub issues:
`backend-context-assembly` is #31, `launch-claim-binding` is #32, and
`launch-prompt-profiles` is #33.

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
- Use launch profiles and prompt profiles as first-class launch inputs. Profiles
  may contribute instruction text, context references, workflow defaults,
  terminal preferences, and Copilot CLI arguments from instance, project,
  workstream, and node-launch scopes, with a final builder-editable prompt before
  launch.
- Keep PAW as one launch profile/instruction style, not the baseline launch
  contract. A PAW profile may run profile-specific setup and point the worker at
  PAW expectations, but launch-from-graph is complete when Streamliner can start
  a correctly prompted Copilot CLI session, bind it to the node, and track it in
  the registry.
- Bind launched sessions through a launch claim keyed by launch nonce plus
  `cwd`/branch/window guardrails rather than `cwd` alone.
- For PAW-backed sessions, read PAW `## Control State` (including `Workflow
  Identity`) from `WorkflowContext.md` / `ReviewContext.md` as optional workflow
  enrichment in the runtime overlay. Session liveness and launch tracking remain
  registry/Copilot-session concerns and must work when no PAW artifact exists.
- Treat the **session registry as the primary session surface** ([Decision
  004](docs/design/decisions/004-session-registry-primary-surface.md)); the
  graph overlay is a projection of the registry. Pull manual tracking ahead of
  the launch pipeline so restart recovery ships independently of launch work
  (issue #9).
- Treat Windows Terminal tab color as optional presentation metadata only. If
  `session-relaunch` later opens a new Windows Terminal tab and has a resolved
  hex registry color, it may pass `wt new-tab --tabColor`; relaunch must continue
  uncolored when Windows Terminal is unavailable, color is missing/invalid, the
  environment is not local Windows Terminal, or color application fails. Do not
  attempt existing-tab recolor in Wave 2.
- Use a standalone local Streamliner API process as the owner of the registry
  API, registry mutation, trusted signal ingestion, session-registry background
  observation/indexing, and live session change events. Vite dev/preview servers
  should proxy `/api/*` to that process instead of owning independent registry
  workers. Session synchronization should be push-first via API-hosted events,
  with focus/refetch and polling retained as resilience fallbacks.

## Open Questions
- When should runtime-discovered progress be promoted into committed workstream
  artifact state?
- Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/
  IDE terminal APIs?
- How should Streamliner observe remote session-state roots for devbox-launched
  sessions?
- Which launch profile fields belong in committed project/workstream config
  versus local builder defaults?
- What is the minimum remaining `session-event-observation` scope after issue
  #13 / PR #14's trusted hook signals, activity indexing, and registry status
  work?
