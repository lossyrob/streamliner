# Launch Context - Sessions view workstream linkage

## Layer 0 - Design Context Hints

Use the repo's design layer directly when implementation choices need grounding. Start from `docs/design/index.md` when unsure, then follow the design docs or decision records that match the code you are touching.

Possible starting points for this node:

- `docs/design/session-system.md` - session registry, launch binding, graphBinding, and runtime overlay intent.
- `docs/design/workstream-format.md` - committed graph/brief artifacts versus local runtime state separation.
- `docs/design/decisions/004-session-registry-primary-surface.md` - Sessions is the primary surface; graph overlay is a projection.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - registry storage and identity contract.
- `docs/design/decisions/001-observation-based-session-tracking.md` - observation-derived lifecycle/attention state remains separate from durable registry metadata.

Treat these as navigation hints, not a fixed reading list. If the implementation touches UI rendering, also use the existing dashboard patterns in `src/components/SessionsPage.tsx`, `src/components/WorkstreamGraphNode.tsx`, and `src/streamliner-theme.css` as the local design system authority.

## Layer 1 - Worker Mission

Implement the selected node: **Sessions view workstream linkage**.

The Sessions surface should use `graphBinding` metadata already present on launched registry rows to make graph-launched sessions legible in My Sessions. The worker's responsibility is to update the Sessions view so bound sessions can be grouped or filtered by workstream, display workstream/node labels, and provide links back to the relevant workstream graph or selected node. Manual and otherwise unbound sessions must remain visible in a default/unbound grouping.

This node is about the **My Sessions / session registry UI linkage**. Do not take ownership of downstream graph-node status indicators, PAW artifact status observation, runtime overlay composition, or follow-on review automation except to keep your data/model choices compatible with those later nodes.

Expected implementation shape:

- Reuse `SessionRegistryListItem.graphBinding` as the linkage contract; do not introduce a second UI-only binding store.
- Preserve existing session list behavior: trusted/default visibility, ended/stale filters, search, SSE refetch, optimistic editing, relaunch/restart actions, and manual session creation.
- Add user-facing workstream/node context for bound rows, with clear fallback labeling for IDs that cannot currently resolve to a known graph or node.
- Keep unbound/manual sessions first-class and easy to find.
- Add or update tests around Sessions grouping/filtering/rendering and any helper functions introduced for workstream/node labels or links.

## Layer 2 - Relevant State

The workstream is in Wave 4. Wave 3 launch-from-graph is complete: launch preparation, launch claims, terminal spawn, and binding into the registry exist. This node is the first Wave 4 UI step that makes that binding visible from My Sessions.

Current linkage contract and likely code entry points:

- `src/session-registry-schema.ts` defines `SessionRegistryGraphBinding` as `workstreamId`, `nodeId`, and optional `launchClaimId`.
- `src/session-registry-contract.ts` exposes `graphBinding` on `SessionRegistryListItem`, list options include `workstreamId` and `nodeId`, and patches can explicitly set or clear `graphBinding`.
- `src/session-registry/file-store.ts` already validates, persists, filters, and patches `graphBinding`; launch-claim tests cover binding behavior. Prefer consuming this surface rather than changing the storage model unless you find a concrete gap.
- `src/session-registry/launch-claims.ts` and `src/session-registry/launch-claim-binding.ts` create or fuse graph-launched rows and write `graphBinding` as part of launch binding.
- `src/server/node-launch.ts` creates launch claims for a `workstreamId`/`nodeId` and reserves launched registry rows with descriptions like `Graph launch for workstream ..., node ...`.
- `src/server/routes/sessions.ts` wires `/api/sessions` and `/api/sessions/events`; the Sessions page currently receives raw registry list items from this API.
- `src/components/SessionsPage.tsx` is the main UI surface. It already copies `record.graphBinding` into list items, preserves it in snapshot keys, and has grouping modes for recency, repo, folder, and flat. It does not yet render bound workstream/node labels or expose a workstream grouping/filter.
- `src/components/session-policies.ts` owns relevance/relaunch behavior; avoid entangling graph linkage with liveness policy unless tests show a direct need.
- `src/workstream-links.ts` has tracker-link helpers, not workstream graph deep links. If adding links, follow existing route/link conventions in `src/App.tsx`, `src/components/NodeInspector.tsx`, and workstream graph components.
- `src/workstream-view-model.ts` parses durable graph artifacts and derives node state. It is useful for resolving node titles when the Sessions UI can access a workstream graph/model.

The selected workstream graph is `.streamliner/workstreams/session-launching-and-tracking/graph.json`. The relevant selected node ID is `sessions-workstream-linkage-ui`, title `Sessions view workstream linkage`. The workstream title is `Session launching and tracking`. If you need sample bound data, use this workstream/node shape rather than inventing a different contract.

The current Sessions UI behavior to preserve:

- Group modes are stored under `streamliner:sessionsGroupMode`; current modes are `recency`, `repo`, `folder`, and `flat`.
- Existing filter state includes archived, ended, stale-window, and show-all-observed toggles.
- The session list listens to `/api/sessions/events` and falls back to polling/focus refresh.
- Rows show title, AI summary/description, repo, branch, folder, derived GitHub refs, tags, activity pill/pulse, copy restart, relaunch, and stop actions.
- The detail sheet already shows lifecycle/origin/trusted/observed pills and editable builder-owned fields. Consider whether bound workstream/node context belongs in both rows and detail sheet.

Use graphBinding as display metadata only. General session liveness and attention state still come from observation/trusted signals; PAW workflow progress remains a future artifact-derived enrichment.

## Layer 3 - Coordination Context

Direct dependencies are complete:

- `launch-claim-binding` (PR #42) added launch claims, reserved registry rows, Tier 1 nonce binding, Tier 2 trusted hook binding through `STREAMLINER_LAUNCH_CLAIM_ID`, read-only launch-claim APIs, and `graphBinding` on registry rows.
- `terminal-launch-integration` (PR #45) added the API-first node launch path, creates a claim before terminal spawn, injects canonical nonce/claim lines, opens the visible Copilot CLI worker, marks terminal failures through claim failure, and joins launch-claim state into node launch records to gate duplicate active launches.

Direct downstream consumers:

- `graph-node-session-status-ui` will render bound session status on graph nodes using the same status pill/pulse language as My Sessions. Keep any helpers for session activity labels, grouping, and bound-session filtering reusable or easy to adapt.
- `auto-paw-review-launch` later depends on this linkage so follow-on review sessions can be related back to the same node/workstream context.
- `review-session-chain-overlay` later needs implementation/review/address-review sessions shown as related chains. Avoid a Sessions UI design that assumes only one session per node or only one role forever.

Checkpoint context:

- The `launch-from-graph` checkpoint is complete; this node should consume launch output, not rebuild launch binding.
- The active checkpoint is `tracking-visible`: Sessions and graph should become connected through registry `graphBinding`, while fast-changing telemetry stays out of committed `graph.json`.

Keep committed workstream artifacts durable. Do not write observed session IDs, live claim state, or UI runtime telemetry back into `.streamliner/workstreams/session-launching-and-tracking/graph.json`.
