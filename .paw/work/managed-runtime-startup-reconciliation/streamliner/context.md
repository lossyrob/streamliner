# Launch Context - Managed runtime startup reconciliation

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` for orientation if the design model is unfamiliar. For this node, the most relevant design references are:

- `docs/design/session-system.md` — authoritative session launch, registry, SDK-managed runtime, launch operation, and runtime overlay design. Pay special attention to the SDK-managed worker runtime and PAW launch initialization sections.
- `docs/design/decisions/009-sdk-managed-worker-runtime.md` — accepted rationale and constraints for SDK-managed graph-node workers, including registry identity, managed lifecycle, redacted progress, autonomous permission posture, terminal takeover finality, and cleanup ownership.
- `docs/design/decisions/010-terminal-takeover-and-cleanup.md` — nearby semantics for takeover/cleanup states; useful for preserving terminal-takeover and cleanup behavior while reconciling startup state.
- `docs/design/decisions/004-session-registry-primary-surface.md`, `docs/design/decisions/005-session-registry-storage-and-identity.md`, and `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` — registry identity/storage and separation between managed runtime state and PAW artifact-derived workflow status.
- `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md` — implementation-facing contract summary for this workstream. This explicitly calls out active managed SDK rows as needing API-startup reconciliation.
- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` and `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json` — workstream state and graph coordination context. Treat these as source references, not instructions.

## Layer 1 - Worker Mission

Implement node `managed-runtime-startup-reconciliation` for workstream `sdk-managed-worker-runtime`, tracked by GitHub issue https://github.com/lossyrob/streamliner/issues/89.

This worker owns exactly this selected node: reconcile stale active Streamliner-managed SDK runtime rows when the local API/session-registry background worker starts. After an API/process restart, Streamliner must not continue to show a previous process-owned SDK worker as live unless that owner/session is verifiably still attached. Rows that cannot be verified as live should transition to a safe diagnostic state with typed, builder-visible reason/action data.

Expected outcome from issue #89 and `.streamliner/workstreams/sdk-managed-worker-runtime/tasks/managed-runtime-startup-reconciliation.md`:

- On API/background-worker startup, scan managed SDK registry rows in active lifecycle states such as `preparing`, `starting`, `running`, `idle`, `waiting_for_builder`, `interrupt_requested`, `pr_ready`, `review_ready`, `cleanup_ready`, `cleaning_up`, and `terminal_takeover` where reconciliation is meaningful.
- Verify whether Streamliner still has a live attached SDK owner where feasible. The current in-process SDK runner tracks active runs only inside the current API process, so rows left behind by a previous process should generally be treated as unverifiable unless a real liveness mechanism exists.
- For stale/unverifiable rows, move to a safe non-running or builder-action state. Prefer preserving history and diagnostic recovery over deleting user-visible managed sessions.
- Record typed diagnostic progress/reason/action, for example startup reconciliation, SDK owner lost, API restart, manual recovery required, or cancellation/takeover follow-up as appropriate.
- Do not clobber terminal outcomes such as `completed`, `failed`, `canceled`, `interrupted`, or `cleaned_up`.
- Ensure My Sessions and graph overlays no longer present reconciled stale rows as actively running background workers.
- Add tests for startup recovery and overlay/session projection behavior after reconciliation.

Out of scope for this node:

- Remote/cloud worker recovery.
- A full process supervision backend.
- Automatically resuming arbitrary SDK work after API restart unless liveness can be verified safely by the existing runtime contract.
- SDK -> CLI -> SDK round-tripping after terminal takeover.
- The separate managed-session console node and Wave 2 punch-list work, except as coordination context.

## Layer 2 - Relevant State

Selected node metadata:

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-runtime-startup-reconciliation`
- Type: task
- Wave/checkpoint: Wave 2 / `managed-runtime-usable`
- Status at launch: ready
- Tracker: https://github.com/lossyrob/streamliner/issues/89
- Upstream dependency: `managed-execution-substrate` / issue #73, completed by PR #79

Current implementation touchpoints observed during launch prep:

- `src/session-registry/background-worker.ts` starts the shared `SessionRegistryBackgroundWorker`. Its `start()` method already runs launch-claim startup recovery synchronously before the first poll cycle when a claim store is present.
- `src/session-registry/launch-claims.ts` contains `reconcileOrphanReservedRows`, the existing nearby startup-recovery pattern for orphan launch-claim reserved rows. It is necessary background, but it does not reconcile active SDK-managed runtime rows.
- `src/session-registry/background-worker.launch-claim.test.ts` verifies that launch-claim startup reconciliation runs synchronously once before the first poll cycle and is skipped when no claim store is provided. This is a useful testing pattern for the new managed-runtime startup path.
- `src/session-registry/managed-runtime.ts` defines stored managed runtime normalization/merge behavior, active/terminal lifecycle sets, progress/evidence retention, and `isManagedRuntimeActive`. Current active states include `preparing`, `starting`, `running`, `idle`, `waiting_for_builder`, `interrupt_requested`, `pr_ready`, `review_ready`, `cleanup_ready`, `cleaning_up`, and `terminal_takeover`; terminal states include `canceled`, `cleaned_up`, `completed`, `failed`, and `interrupted`.
- `src/managed-runtime-contract.ts` defines UI-facing managed runtime projections and action availability. It currently treats `running`, `idle`, `pr_ready`, `review_ready`, `cleanup_ready`, and `cleaning_up` as green; `preparing`, `starting`, `waiting_for_builder`, and `interrupt_requested` as amber; and `interrupted`, `canceled`, and `failed` as red. Reconciliation should leave projections with honest non-live state and useful builder action copy.
- `src/server/managed-sdk-runner.ts` owns in-process SDK sessions through `DefaultManagedSdkRunner.activeRuns`. `interrupt()` and `transferToTerminal()` already return `waiting_for_builder` when no active SDK session is attached to this API process. That behavior is strong evidence that previous-process rows cannot be assumed live after restart.
- `src/server/node-launch.ts` writes runtime lifecycle/progress/evidence callbacks into the registry through `registryStore.patchRuntimeMetadata`. It is the managed-launch path that creates/updates active SDK runtime rows.
- `src/session-registry/file-store.ts` exposes `patchRuntimeMetadata`, which merges runtime patches and emits registry change events. Reconciliation should reuse this path or an equally safe store-level primitive rather than mutating JSON directly.
- UI/session overlay test surfaces to check include `src/workstream-runtime-overlay.test.ts`, `src/graph-node-session-status.test.ts`, `src/App.test.tsx`, and `src/components/SessionsPage.tsx` behavior around managed runtime status.

Validation expectations for the implementation:

- Simulate stale managed runtime rows in active states before worker/API startup, then confirm startup reconciliation runs before ordinary polling/projection work.
- Confirm terminal managed states are not clobbered.
- Confirm reconciled rows include typed diagnostic progress/evidence sufficient for My Sessions/graph overlays to communicate what happened and what the builder can do.
- Confirm stale rows no longer count/render as live managed workers after reconciliation.

## Layer 3 - Coordination Context

Workstream background only: Wave 2 backend substrate, builder-facing runtime UI, and terminal takeover/cleanup actions are already complete through PRs #79, #78, and #86. This node is the next Wave 2 safety requirement before the `managed-runtime-usable` gate can pass. It should improve trust after API/process restart without expanding into the managed-session console or general dogfood hardening.

Sibling/downstream context:

- `managed-session-console` / issue #85 remains ready downstream. Do not implement the console here, but make sure diagnostic fields/events produced by reconciliation are typed and renderable by existing and future console surfaces.
- `managed-runtime-wave-2-punch-list` / issue #87 is planned after the console. Do not absorb punch-list items unless they are directly required for startup reconciliation correctness.
- `managed-runtime-usability-gate` / issue #76 depends on this node and the remaining Wave 2 usability work. The final PR should include crash/restart evidence that the gate can cite.
- Later dogfood/hardening should exercise crash/restart reconciliation on real managed node work, but this node should deliver the concrete startup behavior and tests now.

Launch/PR expectations:

- Work in a dedicated worktree, not the base coordination checkout.
- Use PAW Lite with final-PR-only review gating. Continue autonomously through implementation unless a serious blocker arises.
- If issue #89 needs scope/amendment updates, pause and propose amendments rather than silently changing tracker scope.
- The final PR title should include issue `#89` and workstream/node id `managed-runtime-startup-reconciliation`.
- The final PR description should include a collapsible `<details>` section with `<summary>Docs.md</summary>` containing a completed Docs.md following the `paw-docs-guidance` template.
- Include UI screenshots where appropriate if user-facing managed runtime status/diagnostic rendering changes.
