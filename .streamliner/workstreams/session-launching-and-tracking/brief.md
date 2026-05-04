# Session launching and tracking

## Purpose
Dogfood Streamliner by using it to manage the buildout of launching and tracking
PAW-backed Copilot worker sessions from the graph. Establish the repo-local
workstream setup that Streamliner itself should support for small, single-repo
projects.

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
- **Wave 3 — Launch from graph:** PAW-only MVP launch preparation: context
  assembly, launch configuration dialog for PAW init options and CLI defaults,
  Copilot SDK `paw-init` setup with Streamliner instructions, initial-prompt
  templating with an optional custom-message block, launch-claim binding, and the
  Copilot CLI interactive worker launch. Launches register into the Wave 2
  registry rather than introducing a parallel tracking surface.
- **Wave 4 — Sessions/graph linkage and runtime overlay:** use launch binding
  metadata to tie the Sessions view and workstream graph together. Sessions
  launched from a workstream declare their workstream/node binding in the
  Sessions list, can be grouped by workstream, and link back into the workstream
  or node. Graph nodes render bound session status with the same pulse/pill
  visual language as My Sessions. PAW artifact status is workflow enrichment for
  PAW-backed launches, while general Copilot session state remains the source for
  liveness and attention state.
- **Wave 5 — Follow-on PAW Review automation:** optionally launch separate
  follow-on sessions after an implementation session produces a PR for the issue
  associated with its graph node. Streamliner watches for the PR that resolves
  the node's tracker issue, applies builder-configured PAW Review options, and
  launches a separate PAW Review session rather than injecting prompts into the
  implementation terminal. If review comments need action, Streamliner launches a
  separate address-review worker session on the same PR/branch context instead of
  trying to remotely drive an already-open interactive CLI session.
- **Future distribution workstream (deferred, non-blocking; tracked by issue
  #40):** package the proven launch/session pipeline behind a `streamliner` CLI,
  daemon-control commands, Copilot plugin hook installation/diagnostics, and thin
  skills/MCP/agent wrappers. The current workstream should leave a clean
  API-first launch seam for that future work, but should not block Wave 3 graph
  launch on the distribution story.

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
- `streamliner:docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - rationale for deriving PAW workflow status from artifacts instead of control state
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md` - rationale for treating the session registry as the primary session surface
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md` - concrete storage and identity contract for the local session registry

## Boundaries
- **In scope:** Repo-local Streamliner initialization, design-doc bootstrap,
  launch contract, context assembly, PAW launch configuration, `paw-init` SDK
  preparation, initial-prompt templating, default Copilot CLI arguments, Copilot
  CLI interactive launch, manual session registry (local persistence, UI
  list/edit, color assignment, relaunch at cwd), observation-based session
  tracking, runtime overlay in the UI
- **Out of scope:** Non-PAW launch modes for the MVP, non-Copilot worker
  runtimes, non-GitHub tracker integrations, remote multi-machine tracking,
  devbox session observation, a general orchestration platform, the future
  `streamliner` CLI/daemon/Copilot-plugin distribution workstream
- **Deferred:** Rich session control beyond launch/relaunch/status, full
  tracker abstraction across ADO/Linear, automatic promotion of runtime
  facts into committed artifact state, unbounded autonomous review/address loops
  beyond explicit Wave 5 safety gates, multi-machine sync of the registry

## Current State
Wave 1 design foundation is complete. Issue #4 (`bootstrap-design-docs`)
shipped the repo-scoped `docs/design/` set. Issue #5
(`make-workstream-design-explicit`, PR #8 merged) produced the session system
design doc (`docs/design/session-system.md`) and three accepted decision
records (observation-based session tracking, file-based context delivery, and
the original PAW control-state integration decision now superseded by Decision
008's artifact-status model). The workstream's intended design is written down,
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
Wave 3 is now framed as a PAW-only MVP launch from the graph. Issue #31
completed backend context assembly: a selected ready graph node can produce a
launch context package reference for downstream launch code before the PAW work
directory exists, and the launch path will later place/reference that context
from the PAW work directory. Issue #33 (PR #41) completed PAW launch
preparation: the graph-node launch button opens an **Initialize PAW launch**
dialog, collects natural-language PAW workflow instructions and reusable local
prompt-profile snippets, normalizes Copilot CLI args and terminal preferences,
runs a fully capable Copilot SDK `paw-init` session, stages and installs
`.paw/work/<work-id>/streamliner/context.md`, exposes bounded
`WorkflowContext.md` review/editing, and returns a structured terminal handoff
without starting the visible worker session. Rich PAW WorkflowContext
configuration UI is deferred to issue #43 so it can be built against PAW-owned
metadata instead of hard-coded Streamliner fields. Issue #32 (PR #42) completed
launch-claim binding: local runtime launch claims, reserved registry rows,
Tier 1 prompt-nonce binding, Tier 2 trusted-hook binding via
`STREAMLINER_LAUNCH_CLAIM_ID`, claim sweep/diagnostics, read-only launch-claim
HTTP APIs, and `graphBinding` on registry rows. The remaining Wave 3 work is
terminal launch integration: it must join the #33 preparation handoff with the
#32 launch-claim contract and then start the visible Copilot CLI session through
the same lower-level terminal spawning path used by session relaunch. The launch
path should be API-first internally: the graph button is the first caller, but a
future `streamliner` CLI, Copilot skill, MCP tool, or agent helper should be able
to call the same local API rather than reconstructing launch instructions
manually. PAW runtime status is still Wave 4 overlay enrichment rather than a
Wave 3 launch blocker. The remaining observation work should consume what PR #14
landed instead of duplicating it. Wave 4 now has explicit Sessions-to-graph
linkage work: the Sessions view should group launched sessions by workstream and
link each bound session back to its workstream/node, while graph nodes should
show bound session status using the same pulse/pill language used in My
Sessions. Wave 5 is now a planned follow-on automation wave: watch for the PR
that solves the GitHub issue associated with a graph node, optionally launch a
configured PAW Review session in a separate terminal/session, and optionally
launch a separate address-review worker for comments rather than injecting
prompts into an existing interactive implementation terminal.

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
- MVP graph launch is PAW-only. The graph-node launch action opens a launch
  configuration dialog that shows defaults and lets the builder provide PAW
  workflow instructions, choose reusable local prompt-profile snippets, set
  Copilot CLI arguments, and review/edit the resulting `WorkflowContext.md`
  before the visible worker launch begins.
- Use Copilot SDK for PAW launch preparation: assemble/retrieve Streamliner
  context, run `paw-init` with Streamliner-specific instructions and the selected
  PAW configuration, place/reference the generated `context.md` under the PAW
  work directory, and build the initial worker prompt from a template. The SDK
  `paw-init` instruction contract must make clear that the prep agent initializes
  PAW and returns structured launch data; it must not start the visible worker
  session itself.
- Keep the launch pipeline API-first. The graph launch UI is the MVP caller, but
  the application service/API should be reusable by future agent-initiated launch
  surfaces such as a `streamliner launch-node` CLI command, Copilot skill, or MCP
  tool. Those wrappers belong to a separate distribution/integration workstream
  and must not create a second launch pipeline.
- Treat the builder's optional custom message as a distinct prompt section, not
  as undifferentiated template text. If present, it must be clearly labeled in
  the initial prompt so the worker can distinguish builder guidance from
  generated Streamliner instructions.
- Bind launched sessions through a launch claim keyed by launch nonce plus
  `cwd`/branch/window guardrails rather than `cwd` alone. Tier 1 keeps the
  launch nonce visible in the kickoff prompt so binding works without the
  Copilot plugin; Tier 2 passes `STREAMLINER_LAUNCH_CLAIM_ID` into the spawned
  Copilot CLI process so trusted plugin hook signals can bind the claim faster
  and without relying on builder-editable prompt text.
- Treat `graphBinding` on a registry row as the shared linkage contract between
  Sessions and the graph. The Sessions view derives workstream grouping and
  workstream/node links from it; the graph derives node session indicators from
  the same bound rows. Do not introduce a second UI-only linkage store.
- Use the same session-status visual language in My Sessions and on graph nodes
  so active, idle, needs-input, launching, and ended sessions read as the same
  operational state across both surfaces.
- For follow-on automation, launch new role-specific sessions instead of
  injecting prompts into an existing interactive Copilot CLI terminal. The
  implementation, PAW Review, and address-review sessions are separate registry
  rows linked by workstream, node, PR, branch/worktree, and session role metadata.
- Use the node's tracker issue as the PR detection anchor for follow-on review:
  watch for a PR that resolves or is associated with the issue already attached
  to the graph node before triggering configured PAW Review automation.
- For PAW-backed sessions, derive workflow status from the PAW artifact set in
  the work directory rather than treating `## Control State` in
  `WorkflowContext.md` / `ReviewContext.md` as authoritative. General Copilot
  session state remains the source for liveness, activity, idle/needs-input, and
  ended status. Manual or legacy tracked sessions may still exist without PAW
  artifacts even though MVP graph launches create PAW work.
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
- Which PAW launch configuration fields belong in committed project/workstream
  config versus local builder defaults?
- What is the minimum remaining `session-event-observation` scope after issue
  #13 / PR #14's trusted hook signals, activity indexing, and registry status
  work?
