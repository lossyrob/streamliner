# WorkShaping

## Problem statement

Streamliner workstream nodes can currently depend only on nodes inside the same `graph.json` through `dependsOn`. Operators sometimes intentionally hold a node back because it depends on real upstream work in another workstream, but that relationship is only visible in prose artifacts such as briefs, node notes, or imported-dependency commentary.

The graph should make those cross-workstream blockers explicit. A user looking at a blocked or not-ready node should be able to see the upstream workstream or node, inspect its current status when Streamliner can resolve it, and click through to the upstream context without reverse-engineering the decision from free-form text.

## Shaped outcome

Add explicit cross-workstream dependency support as committed graph data on the downstream node. Keep existing `dependsOn` semantics same-workstream-only; add a separate external dependency model for work outside the current graph.

The first version should:

- Represent external dependencies durably in `graph.json` at node level.
- Support a registered Streamliner workstream target with an optional upstream node ID.
- Support optional author-provided label and URL fallback for unregistered or URL-only dependencies.
- Resolve upstream workstream or node status from registered/source-discovered workstreams when available.
- Draw ghost upstream nodes in the current graph for external dependencies.
- Draw dependency edges from ghost upstream nodes to the dependent local node.
- Match the existing `_proto/canvas` external dependency visual language: red dashed ghost cards and red dashed external edges.
- Show a short inspector entry for each external dependency, including status and a click target to the other workstream when resolvable.
- Include unresolved ghost placeholders for missing/unreadable targets and keep those dependencies unsatisfied.
- Honor explicit local status override only when a dependency is unresolved or URL-only; resolved Streamliner targets remain authoritative.
- Allow users to drag graph cards, including external ghost cards, and persist those manual positions across restarts and graph updates.

## Key decisions from shaping

1. External dependencies are explicit graph data, not inferred from prose.
2. External references can point to a workstream and optionally a node, with label/URL fallback.
3. External dependencies participate in readiness and dashboard launch-affordance gating when resolvable.
4. Ghost upstream nodes should render inside the current graph instead of using only badges or inspector metadata.
5. Unresolved external targets still render as ghost placeholders and remain unsatisfied.
6. Manual resolution via graph data is allowed only for unresolved or URL-only dependencies; resolved Streamliner targets derive status from upstream graph state.
7. The external dependency visual treatment should align with the known `_proto/canvas` style: red dashed external cards/edges and compact blocker details.
8. Manual node placement is in scope, but it should persist in Streamliner local runtime state, not in committed `graph.json`.

## Work breakdown

### Core functionality

- Extend the workstream schema and parser with an external dependency field on nodes.
- Validate target identity shape without requiring external targets to exist at parse time.
- Preserve strict local `dependsOn` validation for same-workstream IDs.
- Resolve external dependencies against the local tracked/source-discovered workstream registry.
- Extend derived node/view-model data with external dependency resolution results.
- Fold resolved external dependencies into dependency readiness.
- Render ghost external nodes and edges in the workstream graph layout.
- Add inspector details and navigation for external dependencies.
- Add draggable local and external graph cards with persisted manual positions.

### Supporting work

- Update format/design documentation for the new graph field and behavior.
- Document that graph position overrides are local runtime overlay state, not durable graph semantics.
- Add tests for parsing, validation, readiness gating, graph layout, and inspector rendering.
- Add tests for position persistence and layout fallback behavior.
- Add focused UI verification with real graph data because this changes dashboard rendering.

## Rough architecture

### Graph schema

Keep `node.dependsOn: string[]` for local graph dependencies. Add a separate external dependency array, tentatively:

```json
{
  "externalDependsOn": [
    {
      "id": "sdk-worker-runtime",
      "target": {
        "projectKey": "streamliner",
        "workstreamId": "sdk-managed-worker-runtime",
        "nodeId": "runtime-contract"
      },
      "label": "SDK runtime contract",
      "url": "https://github.com/lossyrob/streamliner/issues/123"
    }
  ]
}
```

For URL-only or unresolved dependencies, allow a local status override such as `status: "pending" | "satisfied"`. Target-backed entries may carry this override for the unresolved case, but once the target resolves the upstream graph remains authoritative and the local override is ignored.

### Resolution flow

1. Parse the active workstream graph.
2. For each node external dependency, attempt to resolve the target through the registered/source-discovered workstream identity.
3. If `nodeId` is present, derive blocker state from that upstream node.
4. If only workstream identity is present, derive blocker state from the upstream workstream status.
5. If no target can be resolved, render an unresolved ghost placeholder and use the local override only if present and allowed.
6. Expose resolved external dependency data to the view model and graph layout.

### Readiness rules

- Same-workstream dependencies continue to be satisfied by completed or retired upstream local nodes.
- Resolved external node dependencies are satisfied only when the upstream node is completed or retired.
- Resolved workstream-level dependencies are satisfied only when the upstream workstream is completed.
- Unresolved dependencies are unsatisfied unless they are URL-only/unresolved dependencies with an explicit local `satisfied` override.
- Unsatisfied external dependencies should explain readiness degradation rather than silently making the node look arbitrarily blocked.

### Graph rendering

Ghost upstream nodes are read-only graph elements generated from external dependency resolution results. They should be visually distinct from local task/gate nodes and should not show launch controls. They should participate in layout as upstream sources for the dependent node so the dependency is visible in graph geometry.

The visual style should borrow from `_proto/canvas`: compact red dashed external cards, a clear `EXT` label, red dashed external edges, and red left-border blocker rows in the inspector. This is a style match only; the portfolio canvas data model and broader canvas controls are not part of this work.

If a ghost target is resolvable, clicking it or its inspector link should navigate to `/workstreams/{projectKey}/{workstreamId}` or `/workstreams/{projectKey}/{workstreamId}/nodes/{nodeId}`. If unresolved but a URL fallback exists, expose the URL. Otherwise show the unresolved label and target identity.

Selecting a ghost node should show read-only blocker details without local-node launch controls.

### Manual position overlay

The existing workstream graph uses Dagre-generated positions and currently disables node dragging. External ghost nodes increase the chance that auto-layout produces an awkward or operator-unfriendly arrangement, so the first version should let users drag local nodes and external ghost nodes.

Manual positions should be stored in Streamliner local runtime state keyed by workstream identity and node ID, for example `{projectKey, workstreamId, nodeId}`. They should not be written to `graph.json`, because they are user/layout convenience rather than shared workstream semantics. On render, Streamliner should compute the auto-layout baseline and then overlay saved positions for matching node IDs. Missing position entries use auto-layout. Deleted or renamed nodes naturally leave stale position entries unused.

## Codebase fit

- `src/workstream-schema.ts` owns graph TypeScript types.
- `src/workstream-view-model.ts` parses, validates, and derives operational readiness.
- `src/workstream-graph.ts` builds graph dependency maps, reduced edges, layout nodes, and highlights.
- `src/components/WorkstreamGraphNode.tsx` renders graph nodes and can host ghost-node presentation.
- `src/components/WorkstreamCanvas.tsx` currently disables node dragging and is the likely integration point for drag handlers and position overlays.
- `src/components/NodeInspector.tsx` already renders local dependencies/dependents and is the natural place for external dependency entries.
- `src/dashboard-routing.ts` already supports workstream node routes.
- `src/server/routes/workstreams.ts`, `src/server/workstream-registry.ts`, and `src/server/workstream-sources.ts` already expose registered/source-discovered workstream graphs that resolution can reuse.
- `_proto/canvas/index.html` demonstrates the desired external dependency card/edge styling and a local-runtime position overlay model to adapt, not copy wholesale.
- `WORKSTREAM-FORMAT.md` and `docs/design/workstream-format.md` document the graph schema and should be updated with the new field.

## Edge cases and expected handling

- Missing upstream workstream: draw unresolved ghost placeholder; dependency is unsatisfied unless allowed local override says satisfied.
- Missing upstream node in a resolvable workstream: draw unresolved ghost placeholder with target identity; dependency remains unsatisfied.
- Unreadable or invalid upstream graph: draw unresolved ghost placeholder and surface the read/parse error in the inspector.
- Upstream workstream archived: still resolve if the graph is readable; visually indicate archived source if registry data exposes it.
- URL-only dependency: render ghost placeholder from label/URL; use local status override for readiness.
- Manual override on a resolvable Streamliner target: do not let the override supersede upstream graph status.
- Duplicate external dependencies on one node: reject duplicate local external dependency IDs and avoid duplicate ghost nodes/edges.
- External dependency cycles across workstreams: do not attempt global cycle detection in the first version; resolve only immediate external dependencies for display/readiness.
- Transitive external dependencies: do not recursively import upstream graph geometry; show immediate external blockers only.
- Awkward auto-layout after adding external ghost nodes: users can drag affected cards and the local runtime position overlay preserves those choices across restarts and graph updates.
- Graph edits that resolve an external dependency: update committed graph dependency status/target data; the next render should show the dependency satisfied and unblock readiness.
- Node rename/delete after manual placement: ignore stale local position entries for IDs that no longer exist.
- Multiple users or machines: manual positions are local unless future work adds shared/user-scoped layout sync.

## Risks and gotchas

- Pulling other graphs into the active view can create async loading and error states; avoid blocking the base graph render while external targets resolve.
- Ghost nodes must remain visually distinct so users do not confuse them with local executable nodes.
- Readiness behavior must be explicit because changing dependency gating can affect launch availability.
- The schema should not overload `dependsOn`; keeping local and external dependencies separate preserves existing validation and avoids breaking current graphs.
- Cross-workstream resolution depends on registered/source-discovered workstreams; unresolved state is a normal condition, not a parse failure.
- Persisted positions should not become accidental plan authority. Keep them in runtime state and make graph edits the only durable way to resolve dependency status.
- Drag persistence requires careful interaction with React Flow selection and fit-to-view behavior so saved positions do not make first load disorienting.

## Open questions for downstream planning

- Exact field names and discriminated-union shape should be finalized during planning.
- Decide whether the first implementation resolves external graphs entirely client-side from existing API routes or adds a server-side batch endpoint.
- Decide the exact runtime file/API shape for persisted graph positions.
