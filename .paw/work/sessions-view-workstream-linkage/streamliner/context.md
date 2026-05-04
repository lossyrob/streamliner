# Launch Context - Sessions view workstream linkage

## Layer 0 - Design Context Hints

Use the repo's design docs directly when implementation choices need grounding. Start from `docs/design/index.md` when unsure, then follow the design docs or decision records that match the code you are touching.

Possible starting points for this node:

- `docs/design/session-system.md` - session registry, launch binding, `graphBinding`, launch claims, and runtime overlay intent.
- `docs/design/workstream-format.md` - committed graph/brief artifacts versus local runtime state separation.
- `docs/design/decisions/004-session-registry-primary-surface.md` - Sessions is the primary session surface; graph overlay is a projection.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - registry storage and identity contract.
- `docs/design/decisions/001-observation-based-session-tracking.md` - observation-derived lifecycle and attention state remain separate from durable registry metadata.

Treat these as navigation hints, not a fixed reading list. If the implementation changes rendered UI, use existing dashboard patterns in `src/components/SessionsPage.tsx`, `src/App.tsx`, related graph/inspector components, and `src/streamliner-theme.css` as the local UI authority.

## Layer 1 - Worker Mission

Implement the selected node: **Sessions view workstream linkage**.

The Sessions surface should use `graphBinding` metadata already present on launched registry rows to make graph-launched sessions legible in My Sessions. Update the Sessions view so bound sessions can be grouped or filtered by workstream, display useful workstream/node labels, and link back to the relevant workstream graph or selected node when Streamliner can resolve that target. Manual and otherwise unbound sessions must remain visible in a default/unbound grouping.

This node owns the **My Sessions / session registry linkage UI**. Do not take ownership of downstream graph-node status indicators, PAW artifact status observation, runtime overlay composition, or follow-on review automation except to keep the data/model and UI choices compatible with those later nodes.

Expected implementation shape:

- Reuse `SessionRegistryListItem.graphBinding` as the linkage contract; do not introduce a second UI-only binding store.
- Preserve existing session list behavior: trusted/default visibility, ended/stale filters, search, SSE refetch, optimistic editing, relaunch/restart actions, stop actions, manual session creation, and existing recency/repo/folder/flat grouping.
- Add user-facing workstream/node context for bound rows, with clear fallback labels for IDs that cannot currently resolve to a known tracked workstream or node.
- Keep unbound/manual sessions first-class and easy to find.
- Add or update tests around Sessions grouping/filtering/rendering and any helper functions introduced for workstream/node label resolution or links.

## Layer 2 - Relevant State

The workstream is in Wave 4. Wave 3 launch-from-graph is complete: launch preparation, launch claims, terminal spawn, and binding into the registry exist. This node is the first Wave 4 UI step that makes that binding visible from My Sessions.

There is no separate tracker issue or selected-node spec for this node in the supplied context. Use the graph node summary as the assignment boundary, and use authoritative repo/design sources for implementation details.

Current linkage contract and likely code entry points:

- `src/session-registry-schema.ts` defines `SessionRegistryGraphBinding` as `workstreamId`, `nodeId`, and optional `launchClaimId`.
- `src/session-registry-contract.ts` exposes `graphBinding` on `SessionRegistryListItem`; list options already include `workstreamId` and `nodeId`; patches can explicitly set or clear `graphBinding`.
- `src/session-registry/file-store.ts` validates, persists, filters, and patches `graphBinding`; launch-claim tests cover binding behavior. Prefer consuming this surface rather than changing the storage model unless you find a concrete gap.
- `src/session-registry/launch-claims.ts` and `src/session-registry/launch-claim-binding.ts` create or fuse graph-launched rows and write `graphBinding` as part of launch binding.
- `src/server/node-launch.ts` creates launch claims for a `workstreamId`/`nodeId` and reserves launched registry rows with graph-launch descriptions.
- `src/server/routes/sessions.ts` wires `/api/sessions` and `/api/sessions/events`; the Sessions page currently receives raw registry list items from this API.
- `src/components/SessionsPage.tsx` is the main UI surface. It already copies `record.graphBinding` into list items, preserves it in snapshot keys, and has grouping modes for `recency`, `repo`, `folder`, and `flat`. It does not yet render bound workstream/node labels or expose a workstream grouping/filter. Group mode is stored under `streamliner:sessionsGroupMode`.
- `src/components/session-policies.ts` owns relevance/relaunch behavior; avoid entangling graph linkage with liveness policy unless tests show a direct need.
- `src/workstream-registry-contract.ts` defines tracked workstream list entries with `projectKey`, `workstreamId`, `title`, `summary`, `path`, and file status. `/api/workstreams` returns tracked workstreams; `/api/workstreams/{projectKey}/{workstreamId}/graph` returns the graph when backend-readable.
- `src/dashboard-routing.ts` currently supports `/sessions`, `/workstreams`, and `/workstreams/{projectKey}/{workstreamId}`. It has no node-deep-link route today. If this node adds links to a selected node, extend or reuse routing deliberately rather than embedding ad hoc URL strings.
- `src/App.tsx` owns dashboard route state, workstream registry loading, and selected graph node state. `SessionsPage` currently only receives `registerBeforeLeave`; resolving workstream titles/node titles may require passing tracked workstream data into Sessions, fetching it there, or extracting a shared lookup helper.
- `src/workstream-view-model.ts` parses durable graph artifacts and derives node state. It is useful for resolving node titles when the Sessions UI can access a workstream graph/model.
- `src/workstream-links.ts` has tracker-link helpers, not a general workstream/node deep-link contract.
- Existing UI tests in `src/App.test.tsx` cover Sessions rows and workstream routing; there is not currently a dedicated `SessionsPage` test file. Add focused coverage in the style that best fits the change.

Important modeling details:

- `graphBinding` does not include `projectKey`. If link resolution needs a route, join against tracked workstreams by `workstreamId` and handle no match or ambiguous matches gracefully.
- The selected workstream graph is `.streamliner/workstreams/session-launching-and-tracking/graph.json`. The selected node ID is `sessions-workstream-linkage-ui`, title `Sessions view workstream linkage`. The workstream title is `Session launching and tracking`. Use this shape for sample bound data if needed.
- Browser-directory workstreams may be visible in the graph UI but are not always backend-readable. Bound session labels should still degrade usefully when the graph cannot be loaded.

The current Sessions UI behavior to preserve:

- Existing filter state includes archived, ended, stale-window, and show-all-observed toggles.
- The session list listens to `/api/sessions/events` and falls back to polling/focus refresh.
- Rows show title, AI summary/description, repo, branch, folder, derived GitHub refs, tags, activity pill/pulse, copy restart, relaunch, and stop actions.
- The detail sheet already shows lifecycle/origin/trusted/observed pills and editable builder-owned fields. Consider whether bound workstream/node context belongs in both rows and the detail sheet.

Use `graphBinding` as display/navigation metadata only. General session liveness and attention state still come from observation/trusted signals; PAW workflow progress remains future artifact-derived enrichment.

## Layer 3 - Coordination Context

Direct dependencies are complete:

- `launch-claim-binding` (PR #42) added launch claims, reserved registry rows, Tier 1 nonce binding, Tier 2 trusted hook binding through `STREAMLINER_LAUNCH_CLAIM_ID`, read-only launch-claim APIs, and `graphBinding` on registry rows.
- `terminal-launch-integration` (PR #45) added the API-first node launch path, creates a claim before terminal spawn, injects canonical nonce/claim lines, opens the visible Copilot CLI worker, marks terminal failures through claim failure, and joins launch-claim state into node launch records to gate duplicate active launches.

Direct downstream consumers:

- `graph-node-session-status-ui` will render bound session status on graph nodes using the same status pill/pulse language as My Sessions. Keep any helpers for session activity labels, grouping, and bound-session filtering reusable or easy to adapt.
- `auto-paw-review-launch` later depends on this linkage so follow-on review sessions can be related back to the same node/workstream context.
- `review-session-chain-overlay` later needs implementation, PAW Review, and address-review sessions shown as related chains. Avoid a Sessions UI design that assumes only one session per node or only one role forever.

Checkpoint context:

- The `launch-from-graph` checkpoint is complete; this node should consume launch output, not rebuild launch binding.
- The active checkpoint is `tracking-visible`: Sessions and graph should become connected through registry `graphBinding`, while fast-changing telemetry stays out of committed `graph.json`.

Keep committed workstream artifacts durable. Do not write observed session IDs, live claim state, or UI runtime telemetry back into `.streamliner/workstreams/session-launching-and-tracking/graph.json`.
