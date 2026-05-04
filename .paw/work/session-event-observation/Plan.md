# Plan

## Approach Summary

Issue #49 is best handled at the registry/session-observation seam. Existing trusted hook signals already admit real Copilot CLI sessions, launch claims already bind sessions to graph nodes, and `activityStatus` already gives a coarse liveness/attention state. The remaining gap is evidence quality: downstream consumers cannot tell why a row is `waiting_for_input`, whether an unresolved `ask_user` request is present, what turn-boundary evidence was observed, or when activity parsing is diagnostically uncertain.

Add graph-independent activity evidence fields to the registry record and list item, populate them from the existing activity indexer and trusted signal paths, preserve compatibility for manual/unbound sessions, and document the narrowed scope. Keep PAW artifact workflow status, graph-node rendering, workstream grouping, and remote/devbox transport out of this node.

Narrowed observation scope for this node:

- Solved here: active/working, idle, needs-input, cleanly ended, interrupted, and diagnostically degraded evidence for local trusted Copilot CLI sessions with registry rows.
- Exposed here: evidence confidence and diagnostic codes so downstream consumers can distinguish low-confidence observation from high-confidence activity states without overloading `activityStatus`.
- Deferred: full persistent incremental open-request rehydration across watcher restarts, remote/devbox observation transport, PAW artifact status, graph-node rendering, and runtime overlay composition.

## Work Items

- [x] Extend registry schema and API contract with activity evidence fields for status reason, confidence, pending input, turn-boundary timestamps/counts, event scan metadata, and diagnostic codes.
- [x] Enhance the activity indexer to derive those fields from the bounded event-log tail, including unresolved `ask_user` requests, turn boundaries, process interruption, clean end evidence, and explicit uncertainty diagnostics when evidence is missing, empty, truncated, or unrecognized.
- [x] Wire evidence through registry persistence, index/list surfaces, trusted signal ingestion, row fusion, UI list-item conversion, and compatibility defaults for legacy/manual records.
- [x] Update session-system design documentation to describe the public evidence fields, narrowed semantics, and deferred gaps such as full incremental open-request rehydration and remote/devbox transport.
- [x] Add or update focused tests for schema constants, file-store round trips, trusted signal evidence, activity indexing, background-worker indexing, and session UI policy compatibility.
- [x] Run targeted and repository validation, then commit the implementation with PAW artifacts.

## Key Decisions

- Keep `activityStatus` as the coarse consumer-facing state for compatibility, and add explanatory evidence rather than replacing it.
- Treat unresolved `ask_user` detection as a local event-log observation concern. A visible pending input request maps to `activityStatus: waiting_for_input`, with a separate boolean/count so consumers can distinguish "idle" from "needs input."
- Surface degraded confidence explicitly instead of guessing when the event log is missing, empty, tail-truncated, parse-erroring, or has no supported events. The consumer-facing degraded bucket is represented by evidence confidence plus diagnostic codes on the registry list item, not by replacing `activityStatus`.
- Treat process interruption and evidence-quality uncertainty as independent dimensions: a session may be `activityStatus: interrupted` with high-confidence process evidence, or non-interrupted with degraded observation confidence.
- Keep all new evidence on registry rows and list items; do not write runtime telemetry into committed workstream graph files.
- Keep hook payloads unchanged; unresolved `ask_user` and turn-boundary evidence are derived from Copilot `events.jsonl` through the existing background worker path, avoiding plugin-cache refresh work in this node.
- Let evidence updates emit registry upserts through the existing store/SSE path; do not add a second telemetry channel or special event stream.
- For manual or never-observed rows, use neutral evidence defaults rather than low-confidence diagnostics. Lack of an event log is expected for manual rows, not itself a degraded observation.
- Defer full persistent incremental open-request indexing/rehydration and remote/devbox observation transport; bounded local-tail diagnostics make those limitations explicit for Wave 4 consumers.

## Open Questions

None.
