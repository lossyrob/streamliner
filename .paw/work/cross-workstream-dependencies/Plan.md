# Plan

## Approach Summary

Implement cross-workstream dependencies as explicit node-level graph data, keeping same-workstream `dependsOn` unchanged. Add `externalDependsOn` entries to nodes with optional Streamliner targets, labels, URLs, and constrained manual status overrides. Resolved Streamliner targets derive their satisfaction from the upstream graph; unresolved or URL-only targets can be manually marked satisfied in graph data.

Render external dependencies as first-class graph geometry: compact red dashed ghost nodes and red dashed external edges matching the known `_proto/canvas` visual language. Extend the inspector with concise external blocker rows and navigation to the upstream workstream/node or fallback URL.

Add a local runtime positions overlay for the workstream graph. The UI computes the automatic Dagre layout, overlays saved positions for local and external nodes, lets users drag cards, and persists those positions via dedicated workstream positions endpoints. Positions are local runtime state, not committed graph semantics.

## Work Items

- [ ] **Schema and parser** — Extend `src/workstream-schema.ts` and `src/workstream-view-model.ts` with node-level `externalDependsOn`, typed external dependency targets, validation for IDs/URLs/status values, duplicate detection, and tests proving existing `dependsOn` behavior remains strict and unchanged.
- [ ] **External dependency resolution and readiness** — Add a resolver that can load registered/source-discovered upstream workstream graphs by `{projectKey, workstreamId}` and derive external dependency satisfaction from upstream workstream/node state, with unresolved/error/manual-satisfied states represented in derived node data and `dependencyReady`.
- [ ] **Graph layout model** — Extend `src/workstream-graph.ts` to include synthetic external ghost nodes, red dashed external edges, dependency maps/highlighting that include external ancestors, and stable IDs for unresolved/manual dependencies without importing transitive upstream graph geometry.
- [ ] **Runtime position overlay API** — Add local runtime storage and GET/PUT routes for `/api/workstreams/{projectKey}/{workstreamId}/positions`, using schema-versioned JSON, validation, missing-file tolerance, and atomic whole-file replacement under the workstream runtime subtree.
- [ ] **Canvas interactions and rendering** — Update `src/components/WorkstreamCanvas.tsx`, `WorkstreamGraphNode.tsx`, theme/CSS, and related tests so local nodes and external ghost nodes are draggable, saved positions overlay auto-layout, position saves are debounced, ghost nodes/edges match `_proto/canvas` styling, and fit/selection remain predictable.
- [ ] **Inspector and navigation** — Update `NodeInspector.tsx` and routing helpers so selected local nodes show external dependency rows with status, manual/unresolved/error provenance, and links to upstream workstream/node routes or fallback URLs; selected external ghost nodes should show concise blocker details without launch affordances.
- [ ] **Documentation** — Update `WORKSTREAM-FORMAT.md` and `docs/design/workstream-format.md` to document `externalDependsOn`, resolution/readiness semantics, manual override boundaries, ghost-node visualization, and local runtime position overlay behavior.
- [ ] **Verification** — Add or update Vitest coverage for parsing, readiness, resolver errors, server position routes, graph layout, canvas dragging, and inspector rendering; run targeted tests plus repository lint/build, and perform UI screenshot verification with real graph data because dashboard rendering changes.

## Key Decisions

- Use node-level `externalDependsOn` rather than top-level shared dependency records or mixed local/external `dependsOn` entries.
- Keep `dependsOn` as same-workstream-only and preserve existing parser validation for local node references.
- Use a dedicated runtime positions API at `/api/workstreams/{projectKey}/{workstreamId}/positions`; do not store positions in `graph.json`.
- Treat resolved Streamliner targets as authoritative; manual `status` override applies only when a dependency is unresolved or URL-only.
- Show immediate external blockers only; do not recursively import upstream graph geometry or attempt cross-workstream cycle detection in this version.
- Match `_proto/canvas` external dependency styling, but do not promote the portfolio canvas data model, ELK layout, filter controls, or broader canvas feature set.

## Open Questions

None.
