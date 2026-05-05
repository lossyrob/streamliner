# Launch Context - Graph node session status indicators

## Layer 0 - Design Context Hints

Use the repo's design docs directly as the source of design authority. If you need broader orientation, start at `docs/design/index.md` and follow its navigation rather than relying on this launch context as a substitute.

Possible starting points for this node:

- `docs/design/session-system.md` - session lifecycle, registry binding, graph overlay, launch/runtime tracking model.
- `docs/design/decisions/004-session-registry-primary-surface.md` - registry rows are the primary session surface; graph status is a projection of bound registry records.
- `docs/design/decisions/001-observation-based-session-tracking.md` - observed Copilot session evidence and liveness/attention states.
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW artifact status is separate downstream enrichment; do not mix it into this node's session-liveness indicator.
- `.streamliner/workstreams/session-launching-and-tracking/brief.md` and `.streamliner/workstreams/session-launching-and-tracking/graph.json` - Wave 4 context and dependency position.

The selected node's tracker is `https://github.com/lossyrob/streamliner/issues/50`.

## Layer 1 - Worker Mission

Implement only `graph-node-session-status-ui`: render bound session status directly on workstream graph nodes.

A graph node with one or more bound launched sessions should show the highest-attention session state and session count using the same status pulse/pill vocabulary as My Sessions. Indicator details should let the builder correlate or navigate back to the corresponding My Sessions entries. Manual or unbound sessions must not appear as graph-node sessions.

Issue #50 frames the success criteria:

- A graph node with active bound sessions shows status and count on the graph.
- Status language matches My Sessions rather than introducing a separate vocabulary.
- Indicator details can navigate or correlate back to Sessions entries.
- Empty, unresolved, and multi-session states have a visible fallback policy.

Boundaries:

- In scope: graph-node visual indicators; aggregation across multiple bound sessions; reuse/factoring of My Sessions status labels, pulse classes, and link affordances where appropriate; tests for bound, unbound, and multi-session behavior.
- Out of scope: creating or mutating launch/session binding data; My Sessions grouping/linking itself; PAW artifact-derived workflow status; the full composed runtime overlay gate.
- Design impact: update `docs/design/session-system.md` if you change the graph overlay contract, the shared status vocabulary, or multi-session aggregation semantics.

## Layer 2 - Relevant State

Wave 4 is active. Its first two prerequisites for this node are complete:

- `session-event-observation` / issue #49 / PR #54 added `activityEvidence` alongside `activityStatus`, including status reason, confidence, diagnostics, pending input, turn-boundary timestamps/counts, process state, and bounded event-scan metadata.
- `sessions-workstream-linkage-ui` / issue #48 / PR #46 made bound registry rows legible in My Sessions via `graphBinding`, workstream/node chips, workstream grouping, and deep links back to graph nodes when bindings resolve.

The current code surfaces likely to matter:

- `src/components/WorkstreamCanvas.tsx` converts graph layout nodes to React Flow nodes and passes `WorkstreamGraphNodeData` into `WorkstreamGraphNode`.
- `src/components/WorkstreamGraphNode.tsx` renders graph-node badges, status pills, summary, repo label, and tracker link. This is the likely UI insertion point for graph session indicators.
- `src/workstream-graph.ts` defines `WorkstreamGraphNodeData` and layout node sizing constants. If graph nodes need more data or extra space, update layout sizing deliberately and verify the graph still fits.
- `src/workstream-view-model.ts` defines `WorkstreamDerivedNode`; it currently derives artifact/GitHub operational status, not session overlay status.
- `src/session-registry-contract.ts` exposes `SessionRegistryListItem`, including `graphBinding`, `activityStatus`, `activityEvidence`, lifecycle, trusted signal, and process fields.
- `src/components/SessionsPage.tsx` contains the current My Sessions status vocabulary. Notable helpers include `getActivityStatusLabel`, `activityStatusClass`, `activitySignalClass`, `activityStatusHint`, and `getActivityStatusDescription`. Prefer extracting shared helpers over duplicating divergent status logic.
- `src/session-workstream-linkage.ts` resolves `graphBinding` against tracked workstreams and graph nodes and returns resolved/unresolved linkage status plus route targets. Use or mirror this contract for graph-to-session correlation rather than inventing a second linkage model.
- `src/session-registry/http-api.ts` and `/api/sessions` expose list filtering with `workstreamId` and `nodeId`; the graph surface may be able to use this instead of pulling all session state, depending on existing app data flow.
- `src/App.tsx` owns top-level routing and already wires `WorkstreamCanvas`, `NodeInspector`, and `SessionsPage`; inspect it when deciding where session data should enter the graph page.
- `src/App.test.tsx` already has coverage for Sessions workstream-linkage behavior and mock session payloads; extend existing patterns for graph-node indicators rather than starting a separate test style.

My Sessions currently classifies `activityStatus` roughly as: `working` -> active/agent working, `waiting_for_input` -> waiting for you/assistant done, `interrupted` -> resumable, `exited` -> ended, and `unknown` -> trusted/observed fallback labels. The graph indicator should use the same user-facing words and visual tone unless the design doc is intentionally updated.

Aggregation guidance for multiple bound sessions: choose the highest-attention session state for the primary indicator and show the session count. Treat needs-input/waiting-for-you as higher attention than merely working, then interrupted/resumable, then working/active, then exited/ended/unknown. Make the chosen ordering explicit in code/tests so downstream `runtime-overlay-ui` can compose it predictably.

Keep telemetry out of committed artifacts. The graph should derive bound session indicators from runtime registry/session data and `graphBinding`; do not write session IDs, counts, or liveness state back into `.streamliner/workstreams/.../graph.json`.

## Layer 3 - Coordination Context

Direct prerequisites are complete and provide this node's inputs:

- `session-event-observation` supplies `activityStatus`/`activityEvidence` for session attention and liveness.
- `sessions-workstream-linkage-ui` supplies the visible My Sessions side of `graphBinding`, workstream/node chips, grouping, and route/deep-link behavior.

Direct downstream work:

- `runtime-overlay-ui` depends on this node and will later compose committed node status, bound session status, tracker state, and PAW artifact status. Keep this node's output focused and reusable so that composition can consume it cleanly.
- `launch-and-tracking-gate` depends on the complete runtime-overlay path and will validate that graph launch/tracking is usable end to end.

Adjacent but separate Wave 4 work:

- `paw-artifact-status-observation` owns PAW workflow progress derived from files in the PAW work directory. Do not infer PAW progress from graph session indicators.
- `resumable-node-launch-dialog` and `terminal-launch-portability-seam` are launch-polish lanes. They may affect launch UX or terminal internals, but they are not part of this graph-node indicator assignment.

Coordinate with the visual language already present in My Sessions. If the first visual treatment is materially different from existing pills/pulses, flag it for review before finalizing because issue #50 explicitly asks for review of the aggregation and empty/unresolved states.
