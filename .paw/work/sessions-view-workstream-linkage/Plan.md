# Sessions View Workstream Linkage Plan

## Approach Summary

Make existing `SessionRegistryListItem.graphBinding` visible in My Sessions without adding a parallel binding store. The Sessions page will receive tracked workstreams from the App-level registry loader, resolve bound rows by `workstreamId`, and degrade gracefully when a workstream or node cannot be resolved.

The UI will add a Workstream grouping mode, row-level workstream/node context chips, and detail-sheet context. When a binding resolves to a single backend-readable tracked workstream and a known node, the row/detail context will link back into the workstream graph with that node selected. Manual and unbound sessions remain first-class in a stable "Unbound / manual sessions" group and remain visible in existing recency, repo, folder, and flat modes.

Tests will cover grouping, fallback labels, ambiguous/missing workstream resolution, and node deep-link routing. Because this changes rendered UI, implementation will include the iterative UI verification loop with a representative screenshot.

In lieu of a separate CodeResearch artifact, implementation will make these explicit choices from the launch context and observed code shape: pass App-owned tracked workstream entries into `SessionsPage`, keep row context compact while adding richer detail-sheet context, and put reusable linkage resolution in a shared helper rather than burying it in render code.

## Work Items

- [x] Add a node-aware workstream route contract and App wiring so `/workstreams/{projectKey}/{workstreamId}/nodes/{nodeId}` opens the graph with the target node selected while preserving existing workstream routes.
- [x] Add Sessions linkage resolution helpers that join `graphBinding.workstreamId` to tracked workstreams, handle missing/ambiguous matches, and expose display labels/link targets without persisting runtime overlay state.
- [x] Update the Sessions page UI with a Workstream grouping mode, row context chips, detail-sheet context, and styles while preserving existing filters, selection, SSE/polling, optimistic edits, relaunch, stop, and manual-session behavior.
- [x] Add focused tests for workstream grouping, resolved and unresolved bound-session labels, and node-deep-link navigation from My Sessions.
- [x] Run lint/build/test validation and capture an iterative UI screenshot against the session-launching-and-tracking graph.

## Key Decisions

- Use `graphBinding` as display/navigation metadata only; do not add a UI-only binding store and do not write session IDs or launch state into committed workstream artifacts.
- Resolve workstream labels from already tracked workstream list entries. If no tracked workstream matches a bound `workstreamId`, show the raw workstream id. If multiple tracked workstreams share the id, show an ambiguous fallback and avoid deep-linking.
- Resolve node labels by lazily reading graph documents for unambiguous, backend-readable workstreams and caching them by `projectKey/workstreamId` for the page lifetime. If a graph cannot be loaded, keep the workstream label/link and show the raw node id; if the graph loads but the node is missing, link to the workstream only and label the raw node id as unresolved.
- Add node selection to the existing dashboard route model rather than embedding ad hoc URL strings in the Sessions UI.
- Keep unbound sessions visible in every mode, with an explicit default group only in Workstream grouping.
- Persist the new Workstream grouping mode under the existing `streamliner:sessionsGroupMode` key. In Workstream mode, show populated groups only, order unbound/manual sessions first, then tracked workstreams in registry order, then unresolved raw workstream ids by label.
- Prefer a reusable helper module for linkage resolution so follow-on graph-node session status UI can reuse the same workstream/node label and fallback policy.
- Add focused unit coverage for linkage helpers and Sessions rendering, plus an App-level route test for selected-node deep links.

## Open Questions

None.
