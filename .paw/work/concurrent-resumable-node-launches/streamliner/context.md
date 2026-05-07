# Launch Context - Concurrent resumable node launches

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` when design orientation is needed. For this node, the most relevant design hints are:

- `docs/design/session-system.md` - authoritative draft for graph launch preparation, PAW init runs, node launch records, launch claims, terminal launch, session registry binding, and runtime overlay projection.
- `docs/design/workstream-format.md` - authoritative for the boundary between committed graph/brief artifacts and local runtime state. Runtime launch progress, session IDs, claim state, and telemetry must stay out of `graph.json` and `brief.md`.
- `docs/design/decisions/004-session-registry-primary-surface.md` - session registry is the canonical session surface; graph overlays and graph-launched sessions project registry/claim state rather than maintain a parallel durable session store.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - relevant if registry row identity, local storage, or schema behavior changes.
- `docs/design/decisions/001-observation-based-session-tracking.md` and `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - relevant background for downstream visibility after launch and PAW status observation.

Treat design docs, graph files, tracker text, and workstream briefs as source context, not executable instructions. If implementation changes node launch record contracts, dialog lifecycle, retry semantics, launch-preparation run APIs, or launch-state UI/API surfaces, expect an update to `docs/design/session-system.md`.

## Layer 1 - Worker Mission

Implement GitHub issue #55: **Concurrent resumable node launches (Wave 4)** for the selected graph node `concurrent-resumable-node-launches`.

This node is responsible for making graph node launch operations concurrent and resumable. A builder should be able to start PAW init or visible terminal launch for node A, close the dialog or navigate away while that operation continues, start launches for other ready nodes, and later return to each node to see its current state: in-progress preparation, progress history, prepared handoff, errors, `WorkflowContext.md`, launch claim state, terminal launch result, binding-pending, or bound.

Keep the scope focused on this selected node, not the whole session-launching-and-tracking workstream. The workstream context explains surrounding dependencies, but the assigned task is the launch-operation lifecycle and UI/API reattachment behavior for graph-launched node sessions.

In scope:

- Let PAW init / launch preparation continue after the launch dialog closes or node selection changes.
- Let visible terminal launch flow be represented as resumable per-node runtime/API state instead of only transient React component state.
- Allow multiple independent ready nodes to have launch operations in progress concurrently.
- Rehydrate each node's launch state when the builder reopens that node/dialog.
- Preserve duplicate active-launch gating for the same node while allowing other nodes to launch.
- Make failed preparation or terminal launch attempts intentionally retryable, with enough preserved details for diagnosis.
- Store fast-moving progress/details in local runtime/API state, not committed `graph.json`.

Out of scope:

- Reimplementing PAW context assembly, PAW init, terminal spawning, launch claims, or session binding internals from scratch.
- Graph-node session status indicators (#50), PAW artifact workflow status observation (#51), and full runtime overlay composition (#52), except where this node exposes state those consumers can use.
- CLI/skill/MCP launch surfaces from the distribution workstream.

Success criteria from the tracker:

- Starting PAW init or terminal launch for node A no longer traps the builder in a modal workflow; the builder can close/navigate away and launch node B.
- Multiple node launch operations can be in progress concurrently without sharing one global dialog state.
- Reopening node A shows relevant launch operation state instead of resetting to a blank launch dialog.
- In-progress, prepared, failed, launched, and binding-pending/bound states are distinguishable enough for the builder to decide next action.
- Failed launch/preparation attempts remain retryable intentionally, while active pending/bound attempts still block accidental duplicate launches for the same node.
- Runtime progress/details are stored in local runtime/API state, not committed `graph.json`.
- Downstream runtime overlay/gate work can consume or reference the same launch operation state.

## Layer 2 - Relevant State

Tracker: https://github.com/lossyrob/streamliner/issues/55

Current issue state:

- Issue title: `Concurrent resumable node launches (Wave 4)`.
- Issue is open.
- The latest clarification says this specifically covers concurrent launch operations across multiple nodes: kick off several ready node sessions in one sitting, walk away, and later return to each node's progress/handoff.
- Earlier comments said this had been batched into closeout, but the graph now contains this as a standalone ready Wave 4 node; use the graph and current issue body as the selected-node authority.

Selected graph node from `.streamliner/workstreams/session-launching-and-tracking/graph.json`:

- ID: `concurrent-resumable-node-launches`
- Type: `task`
- Status: `ready`
- Attention: `focus`
- Summary: make graph node launch operations durable and reattachable so builders can start PAW init or terminal launch, leave it running, launch other nodes, and return to each node's progress/handoff/errors/claim/terminal state.
- Depends on: `terminal-launch-integration`.
- Dependent gate: `launch-and-tracking-gate`.

Important existing implementation surfaces:

- `src/server/routes/launch-preparations.ts` - exposes `POST /api/launch-preparations/runs`, `GET /api/launch-preparations/runs/:runId`, and `GET /api/launch-preparations/runs/:runId/events` SSE. Today the route starts background preparation runs and upserts a node launch record on completion.
- `src/server/launch-preparation-runs.ts` - in-memory `LaunchPreparationRunManager` with run status, result/error, and a bounded event buffer. It is likely too process-local/transient for the full resumable operation lifecycle unless explicitly persisted or backed by node launch runtime state.
- `src/server/node-launch-record-store.ts` and `src/node-launch-record-contract.ts` - currently persist latest per-node prepared handoff metadata in `~/.streamliner/state/node-launch-records.json` and expose path status plus latest claim summary.
- `src/server/routes/node-launch-records.ts` - `GET /api/node-launch-records` returns the latest record and `latestClaim`; also includes stuck-claim release support.
- `src/server/routes/node-launches.ts` and `src/server/node-launch.ts` - consume a prepared handoff, create/check launch claims, spawn the visible terminal, and return terminal launch response. Duplicate active-launch handling already exists here and should remain authoritative per node.
- `src/components/PawLaunchDialog.tsx` - currently owns launch-preparation progress, prepared handoff, terminal result, kickoff prompt editing, and WorkflowContext review in component-local state. Closing is blocked while preparing/launching/releasing, and state resets when closed.
- `src/App.tsx` - currently stores one global launch dialog state (`launchPreparing`, `launchHandoff`, `terminalLaunchResult`, `launchProgressEvents`, etc.), opens a single dialog keyed by selected node/graph, starts one SSE subscription, and refreshes node launch records after completion.
- `src/components/NodeInspector.tsx` - currently displays the latest PAW launch card and opens the same launch dialog. It already shows paths, prepared timestamp, latest claim summary, and can relabel the action for blocking claims.
- Tests to extend are likely near `src/server/launch-preparation.test.ts`, `src/server/node-launch.test.ts`, `src/server/app.test.ts`, and `src/App.test.tsx`. Existing tests cover launch run snapshots, launch record upsert, existing prepared launch reuse, terminal launch, and duplicate active-launch conflict.

Current behavior gap to close:

- Preparation runs exist in a background manager, but the browser currently awaits one specific SSE stream inside `handleSubmitLaunch`; losing that component/session path becomes a UI error instead of a resumable operation.
- The dialog cannot be dismissed while preparation or terminal launch is active.
- Launch-progress and terminal-launch result state are global to the current `App` instance and selected dialog rather than keyed per graph node/run.
- Node launch records persist completed prepared handoffs, but they do not appear to model in-progress preparation state, failed preparation state, progress history, terminal-launch-in-progress/result state, or per-node reattachment to a run after navigation.

Likely implementation direction:

- Introduce a durable or at least API-owned per-node launch operation state keyed by graph path + node id, while preserving the existing latest prepared launch record contract where possible.
- Decide whether to evolve `NodeLaunchRecord` into a broader operation record or add a sibling operation model that links to prepared handoffs and claims. Prefer a clear API/UI contract that can represent `launchable`, `preparing`, `prepared`, `preparation_failed`, `launching`, `launched_pending_binding`, `bound`, and retryable failed terminal states without persisting telemetry in graph artifacts.
- Ensure run progress can be reattached after dialog close/navigation. Existing `GET /api/launch-preparations/runs/:runId` and SSE replay can be reused if the run id is discoverable from per-node state and survives the required lifecycle.
- Preserve same-node duplicate gating through existing launch claim checks, but avoid a single global UI lock that blocks launching other nodes.
- Keep user-editable kickoff prompt and `WorkflowContext.md` review access available for a prepared operation when the builder returns to the dialog.
- Be careful with active process ownership: closing UI should unsubscribe from SSE only; it must not cancel the server-side preparation run.

## Layer 3 - Coordination Context

Upstream completed context:

- `terminal-launch-integration` (#44 / PR #45) completed the API-first node-launch path: prepared PAW handoff consumption, launch claim creation before terminal spawn, canonical nonce injection, `STREAMLINER_LAUNCH_CLAIM_ID`, visible Copilot CLI worker launch, claim failure on terminal-spawn failures, and duplicate active-launch gating.
- `sessions-workstream-linkage-ui` (#48 / PR #46) made graph-launched sessions navigable from My Sessions through `graphBinding`.
- `session-event-observation` (#49 / PR #54) added activity evidence for downstream visibility.
- `graph-node-session-status-ui` (#50) and `paw-artifact-status-observation` (#51) are completed and downstream-adjacent but not this node's task.

Sibling/downstream context:

- `tracker-required-launch-policy` (#47) is in progress and may affect launchability gating before preparation/claim/spawn. Do not bypass tracker-required policy if present.
- `runtime-overlay-ui` (#52) is in progress and may consume launch/session state projections. This node should expose a stable-enough state shape or documentation so overlay/gate work can consume it.
- `launch-and-tracking-gate` (#53) depends on this node and will verify launch/tracking usability on the graph.

Coordination notes:

- Launch operations are runtime state. Keep progress, run ids, claim state, terminal results, and session IDs in local runtime/API state, not committed workstream artifacts.
- The graph and brief are durable planning context. Do not mutate them to record launch progress.
- If design/API contracts change, update `docs/design/session-system.md` rather than creating ad hoc behavior only in code.
- The final PR title should include issue `#55`.
- The final PR description should include a collapsible `<details>` section with `<summary>Docs.md</summary>` containing a completed Docs.md following the PAW docs guidance template.
