# Plan

## Approach Summary

Replace short-interval per-tab workstream graph polling with an API-owned workstream change stream. The server will maintain a single watcher set for the workstream registry, source registry, source roots, and known graph files, then publish debounced SSE invalidation events. The client will subscribe while a visible workstream page is open, refetch only when the active workstream or registry/source inventory is affected, and keep a slow fallback poll for disconnected or unsupported SSE states.

The implementation should reuse the existing session SSE shape where practical: event names, heartbeat handling, replay buffer, `Last-Event-ID` support, and clean shutdown from `createStreamlinerApiApp`. The fallback must be slow and visibility-aware, not the existing 15-second steady-state graph poll.

The intended multi-tab contract is: steady-state visible tabs do not issue periodic graph requests; on an actual graph invalidation, each visible tab for the affected workstream may refetch once. Registry refreshes should come from registry/source invalidations and initial loads, not from every successful graph fetch.

## Work Items

- [ ] Server workstream event stream and watchers
  - Add a dedicated `WorkstreamEventStream` for `/api/workstreams/events`, duplicating the existing session SSE shape for low blast radius rather than extracting a generic base in this pass.
  - Include heartbeat, replay buffer, `Last-Event-ID` replay, and events such as `workstream.graph.changed`, `workstream.registry.changed`, and `workstream.source.changed`.
  - Watch one server-side path set per API process: registry JSON, source registry JSON, registered graph files, source-discovered graph files, and source scan roots where feasible.
  - Use stat-based watching (`fs.watchFile`) with an approximately 200 ms debounce so rename-based registry/source writes are handled reliably on Windows.
  - Re-derive watched paths by re-reading registry/source state after registry or source registry mtime changes; self-triggered events from API mutations are acceptable because clients should receive the invalidation.
  - Include `projectKey`, `workstreamId`, `path`, `sourceId`, `sourceType`, and `lastModified`/`mtimeMs` metadata when available, and close both SSE clients and file watchers from `createStreamlinerApiApp.close()`.

- [ ] Client SSE invalidation and slow fallback
  - Replace the 15-second graph polling loop in `useGraphLoader` with a visible-tab EventSource subscription to `/api/workstreams/events`.
  - Close the EventSource while the tab is hidden, reconnect on visibility/focus recovery, and rely on server replay/snapshot fallback plus a focused refetch to cover missed events.
  - Refetch the active graph only for matching graph-change events; refetch the registry/source list for registry/source events and reload the active workstream only when needed.
  - Remove the implicit registry refetch after every successful graph load; registry/source SSE events are the source of truth for list updates.
  - Keep a low-frequency fallback poll with jitter, using a named constant such as `WORKSTREAM_FALLBACK_POLL_INTERVAL_MS = 60_000` and +/-20% jitter.
  - Run fallback only when `EventSource` is unavailable, disconnected, or stale, and only while the document is visible. Hidden tabs must not poll.
  - Keep browser-directory workstreams on local browser file handling because the API cannot watch File System Access handles; any fallback refresh for these entries must remain visibility-aware and must not generate API graph requests.

- [ ] Tests
  - Cover server SSE emission, debounce/replay behavior, graph metadata payloads, registry/source invalidations, and watcher cleanup using isolated API state.
  - Cover client EventSource subscription, active-workstream filtering, graph refetch on invalidation, registry refetch on registry/source events, hidden-tab close/no-poll behavior, visibility/focus recovery, and slow fallback polling.
  - Cover multi-tab semantics enough to prove steady-state graph requests do not multiply; change-triggered refetches may occur once per visible affected tab.

- [ ] Documentation
  - Document the workstream SSE endpoint, event payloads, reconnect behavior, fallback polling behavior, and log-volume verification guidance in an operations doc such as `docs/operations/workstream-events.md`.
  - Include a verification recipe that compares `GET /api/workstreams/.../graph` access-log counts before and after the change over a fixed window with one visible tab and then two visible tabs.

- [ ] Verification and commit
  - Run the relevant Vitest slices while developing, then run repository lint/build/test verification required by the change.
  - Run a local log-volume smoke check against `~/.streamliner/state/logs/api-YYYY-MM-DD.log` or document the exact command/output if a browser smoke test is not practical in the worktree.
  - Commit only the intended implementation, tests, docs, and PAW artifacts with selective staging.

## Key Decisions

- Use a dedicated workstream SSE stream instead of adding workstream events to the session stream so clients can subscribe only when a workstream page is active.
- Duplicate the session SSE pattern into a workstream-specific stream rather than generalizing the session stream in this pass.
- Use server-side `fs.watchFile`/stat-based watching with debounce over browser polling; this is more reliable across Windows rename-replace writes and avoids one watcher per browser tab.
- Do not implement cross-tab leader election in this pass. Normal steady-state graph requests should drop to zero between changes because SSE invalidations carry the refresh trigger; the slow fallback is only for disconnected or unsupported SSE states.
- Keep browser-directory workstreams on existing local browser file handling because the API cannot watch File System Access API handles.
- Treat "multiple tabs do not multiply steady-state graph requests" as a steady-state requirement. Multiple visible tabs may each react to the same real invalidation, but they should not independently poll during idle periods.

## Open Questions

None
