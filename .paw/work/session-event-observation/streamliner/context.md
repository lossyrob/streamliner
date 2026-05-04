# Launch Context - Session event observation

## Layer 0 - Design Context Hints

Use Streamliner's design docs directly as the design authority. Start from `docs/design/index.md` when unsure, then follow links into the session and workstream design areas as needed. The paths below are hints and likely starting points, not an exhaustive or mandatory reading list:

- `docs/design/session-system.md` - session launching, lifecycle observation, registry public surface, trusted Copilot CLI signals, launch claims, and runtime overlay behavior.
- `docs/design/decisions/001-observation-based-session-tracking.md` - accepted local observation model for Copilot CLI session-state files, turn boundaries, pending input, session end signals, and confidence diagnostics.
- `docs/design/decisions/004-session-registry-primary-surface.md` - the session registry is the primary surface; graph status is a projection of bound registry rows.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - local registry storage and identity contract.
- `docs/design/workstream-format.md` - committed graph/brief artifacts stay separate from local runtime telemetry.
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW artifact status is separate from Copilot session liveness and attention state.

The workstream and issue both expect design-doc updates when this node changes lifecycle states, attention semantics, diagnostics, or public registry fields. Prefer updating `docs/design/session-system.md` for current intended behavior and adding a new decision record only for a new architectural choice.

## Layer 1 - Worker Mission

Execute exactly the `session-event-observation` node for issue #49: fill the remaining Copilot session observation gaps needed for Wave 4 graph overlay confidence, while reusing the trusted hook signals, activity indexing, registry status, launch-claim binding, and Sessions UI work already landed.

The target outcome is registry/session evidence that downstream consumers can rely on to distinguish active, idle, needs-input, ended, interrupted/degraded, and diagnostically uncertain sessions. This work is graph-independent: update the registry/API/observer seams first, then expose stable fields or diagnostics that My Sessions and future graph-node overlay code can consume. Do not implement graph-node status rendering, PAW artifact workflow status, Sessions workstream grouping, or runtime overlay composition in this node.

Authoritative tracker/spec: https://github.com/lossyrob/streamliner/issues/49

Issue #49 defines the scope:

- Fill remaining observation/status evidence gaps needed by graph overlays.
- Preserve graph-independent registry semantics.
- Reuse trusted hook signals and existing session indexing where available.
- Export registry/session status evidence suitable for My Sessions and graph-node status consumers.
- Make unresolved deferred gaps explicit rather than implicit.

Before implementation, narrow the remaining observation scope from the existing code and design. The issue specifically calls out turn-boundary detail, unresolved input requests, and lifecycle diagnostics as likely gaps not already covered by PR #14.

## Layer 2 - Relevant State

Wave 1 design docs, Wave 2 manual registry, Wave 3 graph launch, and Sessions/workstream linkage are complete. Wave 4 is active. This node is ready and feeds the graph runtime overlay work by improving the session observation evidence stored on registry rows.

Current implementation seams to inspect first:

- `src/session-registry-contract.ts` and `src/session-registry-schema.ts` define the public registry list item and persisted record fields. Existing relevant fields include `lifecycleStatus`, `lastSeenAt`, `observedSessionKind`, `copilotProcessState`, `copilotProcessId`, `activityStatus`, `activityStatusUpdatedAt`, trusted hook timestamps/reasons, derived worktree/branch/GitHub refs, and `graphBinding`.
- `src/session-registry/session-activity-indexer.ts` currently derives coarse `activityStatus` from the tail of `events.jsonl`: `assistant.turn_end` and user-requested tool completion map to `waiting_for_input`; `session.ended` maps to `exited`; user messages, assistant turn/message events, and tool execution events map to `working`; missing live process after a trusted start maps to `interrupted`.
- `src/session-registry/session-context-indexer.ts` incrementally scans event logs for worktree/branch/GitHub reference context and should not be duplicated for activity/status concerns.
- `copilot-plugin/streamliner/scripts/streamliner-signal.mjs` forwards trusted `session.started`, `session.ended`, and `prompt.submitted` signals, including `STREAMLINER_LAUNCH_CLAIM_ID` only on `session.started` for Tier 2 launch-claim binding.
- `src/server/routes/sessions.ts` exposes `/api/sessions/events`, signal ingestion, relaunch, stop, and Tier 2 launch-claim binding. It is the API-side seam for registry change events and trusted signal application.
- `src/server/session-events.ts` streams registry snapshots/upserts/deletes/rebuilds over SSE. Downstream UI should consume registry changes rather than a second telemetry store.
- `src/components/SessionsPage.tsx` and `src/components/session-policies.ts` already interpret existing activity/trusted-signal fields for My Sessions visibility and labels; keep compatibility with manual and unbound sessions.

Use the durable API logs at `~/.streamliner/state/logs/api-YYYY-MM-DD.log` when diagnosing local observer or hook behavior. `STREAMLINER_LOG_LEVEL=debug` can be used for deeper traces during manual verification.

Known design constraints:

- Observation remains local-first and based on Copilot CLI session state under `~/.copilot/session-state/`, with hooks as low-latency hints rather than the sole source of truth.
- Runtime telemetry belongs in Streamliner's local runtime state and registry-derived API responses, not in committed `graph.json` or the workstream brief.
- The registry is graph-independent. `graphBinding` is linkage metadata on registry rows, not a separate graph telemetry channel.
- PAW artifact status is a separate Wave 4 node. Do not infer PAW workflow progress from Copilot event logs in this node.
- Remote/devbox observation transport is out of scope unless documented as a deferred gap.

## Layer 3 - Coordination Context

Direct dependency: `session-registry-model` is complete. The registry model, storage, and graph-independent primary-surface decision are available for this work.

Completed adjacent work to reuse, not rebuild:

- `manual-session-registry-ui` / PR #14 established the local file-backed registry, Sessions surface, trusted Copilot CLI hook signals, activity/context indexing, derived worktree/branch/GitHub refs, and activity status.
- `session-dashboard-sync` made the standalone local Streamliner API process the owner of registry mutation, trusted signal ingestion, background observation/indexing, live session events, and optimistic builder-edit concurrency.
- `session-relaunch` restored tracked sessions at recorded `cwd`; relaunch correctness remains registry-centered.
- `launch-claim-binding` / PR #42 added launch claims, reserved registry rows, Tier 1 nonce binding, Tier 2 trusted-hook binding via `STREAMLINER_LAUNCH_CLAIM_ID`, claim diagnostics, read-only launch-claim APIs, and `graphBinding` on registry rows.
- `terminal-launch-integration` / PR #45 completed the API-first graph launch path and duplicate active-launch gating.
- `sessions-workstream-linkage-ui` / PR #46 made bound sessions legible from My Sessions via workstream/node chips, grouping, and deep links.

Downstream consumers affected by this node:

- `graph-node-session-status-ui` needs stable registry liveness/attention evidence to render session status on graph nodes with the same pulse/pill language as My Sessions.
- `paw-artifact-status-observation` will derive PAW workflow status from artifacts, but it depends on this node for general session liveness and attention state.
- `runtime-overlay-ui` will combine committed node state, bound Copilot session state, tracker state, and PAW artifact status without writing telemetry into `graph.json`.
- `launch-and-tracking-gate` depends on the overlay being trustworthy enough for builder validation.

Relevant source references:

- `.streamliner/workstreams/session-launching-and-tracking/graph.json`
- `.streamliner/workstreams/session-launching-and-tracking/brief.md`
- `docs/design/index.md`
- `docs/design/session-system.md`
- `docs/design/decisions/001-observation-based-session-tracking.md`
- `docs/design/decisions/004-session-registry-primary-surface.md`
- `docs/design/decisions/005-session-registry-storage-and-identity.md`
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md`
- `src/session-registry-contract.ts`
- `src/session-registry-schema.ts`
- `src/session-registry/session-activity-indexer.ts`
- `src/session-registry/session-context-indexer.ts`
- `src/server/routes/sessions.ts`
- `src/server/session-events.ts`
- `copilot-plugin/streamliner/scripts/streamliner-signal.mjs`
