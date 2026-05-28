# Plan

## Approach Summary

Replace short-interval per-tab workstream graph polling with an API-owned workstream change stream. The server will maintain a single watcher set for the workstream registry, source registry, source roots, and known graph files, then publish debounced SSE invalidation events. The client will subscribe while a visible workstream page is open, refetch only when the active workstream or registry/source inventory is affected, and keep a slow fallback poll for disconnected or unsupported SSE states.

The implementation should reuse the existing session SSE shape where practical: event names, heartbeat handling, replay buffer, `Last-Event-ID` support, and clean shutdown from `createStreamlinerApiApp`. The fallback must be slow and visibility-aware, not the existing 15-second steady-state graph poll.

## Work Items

- [ ] Server workstream event stream and watchers
  - Add an API-side event stream for `/api/workstreams/events` with heartbeat, replay buffer, and events such as `workstream.graph.changed`, `workstream.registry.changed`, and `workstream.source.changed`.
  - Watch one server-side path set per API process: registry JSON, source registry JSON, registered graph files, source-discovered graph files, and source scan roots where feasible.
  - Debounce file/stat changes, refresh watched paths after registry/source changes, include `projectKey`, `workstreamId`, `path`, `sourceId`, and `mtime/version` metadata when available, and close watchers when the API app closes.

- [ ] Client SSE invalidation and slow fallback
  - Replace the 15-second graph polling loop in `useGraphLoader` with a visible-tab EventSource subscription to `/api/workstreams/events`.
  - Refetch the active graph only for matching graph-change events; refetch the registry/source list for registry/source events and reload the active workstream only when needed.
  - Keep a low-frequency jittered fallback poll, plus focus/visibility recovery, only when SSE is unavailable, disconnected, or stale.

- [ ] Tests
  - Cover server SSE emission, debounce/replay behavior, graph metadata payloads, registry/source invalidations, and watcher cleanup using isolated API state.
  - Cover client EventSource subscription, active-workstream filtering, graph refetch on invalidation, registry refetch on registry/source events, hidden-tab pause, and slow fallback polling.

- [ ] Documentation
  - Document the workstream SSE endpoint, event payloads, reconnect behavior, fallback polling behavior, and log-volume verification guidance.

- [ ] Verification and commit
  - Run the relevant Vitest slices while developing, then run repository lint/build/test verification required by the change.
  - Commit only the intended implementation, tests, docs, and PAW artifacts with selective staging.

## Key Decisions

- Use a dedicated workstream SSE stream instead of adding workstream events to the session stream so clients can subscribe only when a workstream page is active.
- Prefer server-side `fs.watchFile`/stat-based watching with debounce over browser polling; this is more reliable across Windows and avoids one watcher per browser tab.
- Do not implement cross-tab leader election in this pass. Normal steady-state graph requests should drop to zero between changes because SSE invalidations carry the refresh trigger; the slow fallback is only for disconnected or unsupported SSE states.
- Keep browser-directory workstreams on existing local browser file handling because the API cannot watch File System Access API handles.

## Open Questions

None
