# Plan

## Approach Summary

Implement cross-workstream dependencies as explicit node-level graph data, keeping same-workstream `dependsOn` unchanged. Add `externalDependsOn` entries to nodes with optional Streamliner targets, labels, URLs, and constrained manual status overrides. Resolved Streamliner targets derive their satisfaction from the upstream graph; unresolved or URL-only targets can be manually marked satisfied in graph data. External dependency readiness feeds `dependencyReady` and `operationalStatus`, which already gate the dashboard launch button; server-side launch policy is intentionally unchanged in this first version.

Resolve external dependency targets client-side by fetching the existing `/api/workstreams/{projectKey}/{workstreamId}/graph` endpoint for each unique upstream workstream target. Render the local graph immediately, show unresolved/resolving ghost placeholders while external graphs load, and update the derived graph in place when resolution completes.

Render external dependencies as first-class graph geometry: compact red dashed ghost nodes and red dashed external edges matching the known `_proto/canvas` visual language. Extend the inspector with concise external blocker rows and navigation to the upstream workstream/node or fallback URL.

Add a local runtime positions overlay for the workstream graph. The UI computes the automatic Dagre layout, overlays saved positions for local and external nodes, lets users drag cards, and persists those positions via dedicated workstream positions endpoints. Positions are local runtime state, not committed graph semantics.

## Work Items

- [x] **Schema and parser** — Extend `src/workstream-schema.ts` and `src/workstream-view-model.ts` with node-level `externalDependsOn`, typed external dependency targets, validation for IDs/URLs/status values, duplicate detection, and tests proving existing `dependsOn` behavior remains strict and unchanged. Manual `status` override may be present on target-backed dependencies but is honored only when runtime resolution cannot find the target.
- [x] **External dependency resolution and readiness** — Add a client-side resolver that deduplicates upstream `{projectKey, workstreamId}` graph fetches through the existing graph endpoint and derives external dependency satisfaction from upstream workstream/node state. Represent resolving, unresolved, error, resolved, and manual-satisfied states in derived node data and `dependencyReady` without blocking the base graph render.
- [x] **Graph layout model** — Extend `src/workstream-graph.ts` to include synthetic external ghost nodes, red dashed external edges, dependency maps/highlighting that include external ancestors, and stable IDs for unresolved/manual dependencies without importing transitive upstream graph geometry.
- [x] **Runtime position overlay API** — Add local runtime storage and GET/PUT routes for `/api/workstreams/{projectKey}/{workstreamId}/positions`, using schema-versioned JSON, validation, missing-file tolerance, and atomic whole-file replacement under the workstream runtime subtree.
- [x] **Canvas interactions and rendering** — Update `src/components/WorkstreamCanvas.tsx`, `WorkstreamGraphNode.tsx`, theme/CSS, and related tests so local nodes and external ghost nodes are draggable, saved positions overlay auto-layout, position saves are debounced, ghost nodes/edges match `_proto/canvas` styling, archived upstream sources are indicated when registry metadata exposes them, and fit/selection remain predictable.
- [x] **Inspector and navigation** — Update `NodeInspector.tsx` and routing helpers so selected local nodes show external dependency rows with status, manual/resolving/unresolved/error provenance, archived-source indication when available, and links to upstream workstream/node routes or fallback URLs; selected external ghost nodes should show concise read-only blocker details without launch affordances.
- [x] **Documentation** — Update `WORKSTREAM-FORMAT.md` and `docs/design/workstream-format.md` to document `externalDependsOn`, resolution/readiness semantics, manual override boundaries, ghost-node visualization, and local runtime position overlay behavior.
- [x] **Verification** — Add or update Vitest coverage for parsing, readiness, resolver errors, server position routes, graph layout, canvas dragging, and inspector rendering; run targeted tests plus repository lint/build, and perform UI screenshot verification with real graph data because dashboard rendering changes.

## Key Decisions

- Use node-level `externalDependsOn` rather than top-level shared dependency records or mixed local/external `dependsOn` entries.
- Keep `dependsOn` as same-workstream-only and preserve existing parser validation for local node references.
- Use optional-field discrimination for external dependencies: `target` identifies Streamliner workstream/node dependencies, absent `target` plus `url`/`label` represents URL-only/manual dependencies, and `status` is a local override consulted only when the target is absent or cannot be resolved.
- Resolve upstream workstream/node targets client-side through the existing graph endpoint; do not add a server-side batch resolver in this version.
- Let external readiness affect `dependencyReady`/`operationalStatus`, which gates the dashboard launch button today; do not extend backend launch policy in this version.
- Use a dedicated runtime positions API at `/api/workstreams/{projectKey}/{workstreamId}/positions`; do not store positions in `graph.json`.
- Treat resolved Streamliner targets as authoritative; if a target resolves, ignore any local `status` override and surface that provenance in UI/tests rather than rejecting at parse time.
- Show immediate external blockers only; do not recursively import upstream graph geometry or attempt cross-workstream cycle detection in this version.
- Match `_proto/canvas` external dependency styling, but do not promote the portfolio canvas data model, ELK layout, filter controls, or broader canvas feature set.
- Ghost external nodes are selectable read-only graph elements that show blocker details without local-node launch controls.

## Open Questions

None.
