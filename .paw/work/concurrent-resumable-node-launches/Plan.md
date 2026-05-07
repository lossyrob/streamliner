# Concurrent Resumable Node Launches Plan

## Problem and approach

Graph launch state is currently split between a background preparation run manager, a latest prepared-launch record, and `App.tsx` component-local dialog state. That makes a launch feel modal: closing the dialog or switching nodes loses the selected run context, and global React state can mix progress or terminal results across nodes.

The implementation will add an API-owned per-node launch operation state keyed by graph path and node id, then make the dashboard render and update that state instead of treating launch progress as one global dialog workflow. The existing prepared launch record and launch-claim store remain authoritative for prepared handoff paths and duplicate terminal-launch claims; the new operation state records the fast-moving lifecycle around those contracts.

Terminal launch will stay on the existing synchronous `/api/node-launches` route instead of introducing a second background run primitive. Resumability comes from the backend writing `launching` operation state before claim creation/terminal spawn and then writing either `launched_pending_binding`/terminal result or `terminal_failed` before returning. The in-flight spawn window is bounded by the request lifetime, while reopen behavior after close/node selection change is driven by the API operation snapshot and launch-claim summary rather than component-local state.

## Work items

1. Add a launch operation contract and extend runtime state so the API can return `launchable`, `preparing`, `prepared`, `preparation_failed`, `launching`, `launched_pending_binding`, `bound`, and `terminal_failed` projections. Store run id, last status/error, prepared handoff, terminal launch result, and claim-derived state outside `graph.json`; keep high-frequency progress history bounded and API-owned so it does not turn graph artifacts into telemetry.
2. Wire server routes so launch preparation creates/updates operation state, completed preparation keeps upserting the existing prepared launch record, same-node active preparation/terminal-launch attempts are gated, and `GET /api/node-launch-records` returns both the latest record and current operation state. Treat `launched_pending_binding` and `bound` as projections derived from launch claims when a claim exists, not as a competing durable source of truth.
3. Refactor the dashboard launch flow so operation state is keyed per graph/node, dialog close and node selection changes do not cancel background preparation, progress streams can reattach by run id, and prepared/failed/launched states reopen with the right handoff, progress, error, claim, terminal details, kickoff prompt, and `WorkflowContext.md` review access.
4. Add server and UI tests covering operation persistence, duplicate same-node active operation gating, close/reattach behavior, concurrent launches for separate nodes, stale or unknown run ids, failed runs, and graceful fallback when SSE replay is unavailable.
5. Update `docs/design/session-system.md` to document the launch operation lifecycle, state enum/projection rules, retry rules, launch-preparation reattach API, non-modal dialog lifecycle, and the boundary between runtime launch state and committed workstream artifacts.

## Key decisions and considerations

- Keep launch operation state in Streamliner's local runtime state file beside node launch records, not in workstream graph or brief artifacts.
- Preserve existing `NodeLaunchRecord` semantics for the latest prepared handoff paths; expose operation state as a sibling API field so downstream overlay/gate work can consume it without treating preparation progress as a durable graph field.
- Treat `preparing` and `launching` operations as same-node duplicate blockers, while `preparation_failed`, `prepared`, `terminal_failed`, and failed/retryable claims remain intentionally retryable.
- Keep existing launch-claim gating authoritative for terminal sessions that are pending within the binding window or already bound.
- Closing the UI should unsubscribe or hide only the view; it must not cancel the backend preparation run or mutate graph files.
- Use the operation snapshot as the source of truth on reopen. SSE replay from `LaunchPreparationRunManager` remains best-effort live detail; if the run id is unavailable, the buffer has rotated, or the API restarted, the UI falls back to the stored operation snapshot and offers the appropriate retry/review action.
- Confirm the launch-record/operation write path serializes concurrent same-file updates before relying on one JSON store for multiple simultaneous node launches; add serialization if the existing store is not sufficient.
- Layer operation-state gating on top of existing launchability policy. Do not bypass current ready/backend-readable checks or any tracker-required launch policy that lands before this work.
