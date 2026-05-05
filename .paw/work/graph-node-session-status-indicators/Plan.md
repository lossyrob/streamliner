# Graph Node Session Status Indicators Plan

## Approach Summary

Render graph-node session indicators as a projection of the existing session registry rather than new graph data. Extract the My Sessions activity status vocabulary into a shared helper, derive per-node bound-session summaries from registry rows whose `graphBinding` matches the active workstream and node, and pass those summaries through the graph layout/node data so task nodes can show the highest-attention session status, count, and a Sessions navigation affordance. Keep manual and unbound sessions out of the graph projection, document the aggregation policy, and cover bound, unbound, unresolved, and multi-session behavior with tests.

## Work Items

- [x] Extract shared session activity vocabulary
  - Move activity status label, pill tone, signal class, hint, and description helpers out of `SessionsPage.tsx` into a shared session UI helper without changing My Sessions labels.
- [x] Derive graph node session summaries
  - Add a typed aggregation helper that filters registry rows to resolved graph bindings for the active workstream/node, ignores manual or unbound rows, ranks statuses by attention (`waiting_for_input`, `interrupted`, `working`, then `exited`/null or unknown together), and exposes count/detail metadata for rendering and routing.
- [x] Thread session registry data into the graph
  - Load sessions for the active workstream route with a shared client-side session registry hook/store, refresh them with polling/EventSource updates, and pass per-node summaries through `GraphDashboard`, `WorkstreamCanvas`, and `WorkstreamGraphNodeData` without opening avoidable duplicate subscriptions.
- [x] Render and style graph indicators
  - Add a compact task-node indicator using the shared My Sessions status vocabulary/pulse classes, count text, visible empty/unresolved/pre-signal fallback policy, and an in-app Sessions link filtered or otherwise scoped to the matching workstream/node when row-level session routing is unavailable.
- [x] Add tests for graph projection behavior
  - Extend App/component/helper coverage for bound active sessions, unbound/manual exclusion, unresolved workstream/node fallback, and multi-session highest-attention aggregation.
- [x] Update design documentation
  - Update `docs/design/session-system.md` with the graph projection contract and multi-session aggregation semantics without mixing PAW artifact status into session liveness.

## Key Decisions

- The graph indicator is read-only runtime UI: it never writes session telemetry or counts into `graph.json`.
- Only sessions with a `graphBinding` whose workstream and node match the active graph contribute to node indicators; unbound/manual sessions remain visible only in My Sessions.
- Multi-session aggregation chooses the highest-attention session state first, then displays the total bound session count so downstream overlay composition can reuse the policy predictably. Bound rows with null/unknown activity, including reserved launched rows before trusted observation arrives, render as the lowest-attention fallback rather than disappearing.
- The graph uses the same user-facing activity labels and tone classes as My Sessions by sharing helpers rather than copying local strings.
- Node details should navigate to the Sessions surface with enough context to correlate the bound registry entries; direct My Sessions row selection can be deferred unless a row-level route already exists, but workstream/node filtering or query text should make the matching entries discoverable immediately.

## Open Questions

None.
