# Plan: Session Dashboard Sync

## Approach Summary

Issue #17 will replace the Vite-plugin-owned backend with a standalone local Express API process and use that process as the synchronization hub for session registry views. The frontend will keep relative `/api/...` calls, but Vite will proxy them to the API in development. The API will own graph/recents/file-picker routes, session registry mutations, trusted signal ingestion, the session registry background worker, and live session change delivery.

Session dashboard sync will be push-first through the API using Server-Sent Events, with focus/visibility refresh and a slower polling fallback for resilience. Builder-owned stale edits will be explicit through optimistic concurrency on session PATCH flows.

## Work Items

- [ ] **api-server-foundation** - Add Express-based local API server structure, dependencies, scripts, health route, localhost binding defaults, graceful shutdown, and Vite dev/preview proxy configuration. Remove backend ownership from the Vite plugin so Vite is frontend-only.
  - Files likely touched: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.node.json`, new `src/server/app.ts`, new `src/server/index.ts`, new `src/server/config.ts`.
  - Acceptance: default API URL is `http://127.0.0.1:4319` unless `STREAMLINER_API_PORT`/host config overrides it; default binding is loopback-only; `EADDRINUSE` fails fast; SIGINT/SIGTERM close the HTTP server and stop the session worker; `npm run dev` uses `concurrently --kill-others-on-fail`; `dev:api`, `dev:web`, and `api` are available.
- [ ] **api-route-migration** - Move graph loading, recents, file picker, and existing session registry API handling into reusable Express route modules. Preserve current response shapes and existing API tests while making the standalone API directly callable.
  - Files likely touched: new `src/server/routes/graph.ts`, `src/server/routes/recents.ts`, `src/server/routes/file-picker.ts`, `src/server/routes/sessions.ts`, `src/session-registry/http-api.ts`, remove or retire `vite-plugin-serve-graph.ts`.
  - Acceptance: `STREAMLINER_GRAPH` resolution moves to the API process; recents writes happen only in the API process; `/api/pick-file` uses local Windows-safe behavior, including `powershell -STA`; trusted signal ingestion rejects non-loopback callers when the route mutates trusted state; route tests exercise `createApp()` without `listen()`.
- [ ] **session-live-sync** - Add API-owned session change streaming at `GET /api/sessions/events` via SSE backed by `SessionRegistryStore.subscribe()`. Ensure API startup owns the registry background worker and broadcasts worker/session mutations to connected clients.
  - SSE contract: send an initial `snapshot` event with current list, then `session.upserted`, `session.deleted`, `session.rebuilt`, and `heartbeat` events. Each event carries a monotonic id and JSON payload; heartbeats are sent at least every 15 seconds. Keep a bounded replay buffer for `Last-Event-ID`; if replay is unavailable, send a fresh `snapshot`.
  - Acceptance: Vite proxy is SSE-safe; clients reconnect after API restart; store `rebuild` events trigger a full refresh; refetches are coalesced to avoid tab/event storms.
- [ ] **frontend-sync-client** - Update the Sessions UI to subscribe to session events, refetch promptly on changes, refresh on focus/visibility, keep polling as fallback, and surface API connectivity/sync errors clearly.
  - Acceptance: open/restored Sessions pages refresh without manual reload after edits or worker lifecycle changes; API-down and reconnecting states are visible; refetches use a trailing debounce; graph/recents views at least refresh on focus and surface API fetch failures after API restart.
- [ ] **explicit-concurrency** - Add optimistic concurrency for builder-owned session PATCH flows. Stale edits should return an explicit conflict with the latest row rather than silently overwriting newer builder-owned changes.
  - Contract: session records expose a `version` number or equivalent opaque revision. Builder PATCH sends `expectedVersion` or `If-Match`. `409 Conflict` returns `{ error, latest, conflictingFields }`.
  - Builder-owned conflict fields: `title`, `description`, `color`, `tags`, `graphBinding`, builder-driven `lifecycleStatus`.
  - Observation/worker-owned fields do not participate in builder conflict detection when they are the only changed fields: `copilotSessionId`, `lastSeenAt`, `cwd`, `repo`, `branch`, trusted signal fields, process/activity fields, AI summary fields, and derived context/GitHub fields.
  - UI behavior: if the open sheet receives an event for the selected row while dirty, keep dirty fields and show a stale-data banner; on 409, show the latest row/conflicting fields and require the builder to refresh/reapply before saving.
- [ ] **design-docs** - Update the design layer to capture the standalone local API/service contract for Wave 2.
  - Files likely touched: new `docs/design/decisions/006-local-streamliner-api-service.md`, `docs/design/session-system.md`, `docs/design/index.md`, `docs/design/.vitepress/config.ts`.
  - Acceptance: the decision record covers API process boundary, registry write/worker ownership, loopback binding, SSE sync contract, dev/preview proxy lifecycle, and relationship to Decision 005's single logical writer model.
- [ ] **verification** - Update/add unit and component tests for the Express app/routes, Vite proxy, SSE/event behavior, stale PATCH conflicts, frontend sync behavior, and run the repository verification commands.
  - Acceptance: tests cover direct API route access, server app/listen separation, SSE initial snapshot/heartbeat/change events, stale PATCH conflicts, Sessions UI event-triggered refresh, focus/visibility refresh, and dev/preview proxy configuration.

## Key Decisions

- Use `express` and `@types/express` now because the local API is becoming a durable product surface, not a temporary dev shim.
- Add `concurrently` so `npm run dev` can run API and frontend together while still supporting separate `dev:api` and `dev:web` terminals.
- The API process is the single live owner of the registry worker. Registry files remain durable storage, but pages and tools coordinate through the API.
- Vite should not continue to host authoritative backend behavior. The Vite config should proxy API calls in dev rather than registering the backend routes itself.
- SSE is the initial live-sync mechanism because it is simple, browser-native, one-way from API to dashboards, and fits registry change notifications.
- Keep polling and focus/visibility refresh as recovery mechanisms for missed events, server restarts, sleeping laptops, or disconnected pages.
- Stale builder edits are conflicts. Observation-derived updates remain field-scoped and should not unnecessarily conflict with builder-owned drafts.
- Do not add first-class CORS in Wave 2. Keep the API loopback-oriented and use Vite proxying for browser development.
- Keep `vite preview` as a frontend preview that proxies to the standalone API. Serving built frontend assets from Express is deferred.
- The stale PATCH response shape is `409 Conflict` with `{ error, latest, conflictingFields }`.

## Open Questions

None.
