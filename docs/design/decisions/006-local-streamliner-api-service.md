---
kind: decision
number: 6
status: accepted
date: 2026-04-28
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 006. Local Streamliner API service

## Context

The session registry started as an in-process surface behind the Vite development server. That was expedient for early UI work, but issue #17 exposed two architectural problems:

1. Frontend reloads and Vite restarts were coupled to backend registry observation, making UI iteration slow and making live session state feel bulky.
2. The registry is becoming a durable product surface for session discovery, trusted hook signals, background summarization, relaunch, and synchronization across browser tabs. It needs to be callable directly, not only through a frontend instance.

Streamliner is still early enough that keeping the old Vite-plugin backend alongside a new API would add compatibility drag without preserving meaningful external contracts.

## Decision

Move Streamliner's local backend responsibilities into a standalone loopback-only Express API process.

The API process owns:

1. session registry reads and mutations,
2. trusted Copilot CLI hook signal intake,
3. the background observation/summarization worker,
4. live session-registry notifications over server-sent events,
5. local graph, recent-file, and file-picker endpoints that the dashboard needs.

Vite becomes frontend-only. During development and preview it proxies `/api/*` to the local API process and is loopback-bound by default. The default API bind address is `127.0.0.1:4319`, overridable with `STREAMLINER_API_HOST` and `STREAMLINER_API_PORT`.

Adopt Express now rather than a minimal hand-rolled HTTP router. The route surface is expected to grow, and Express gives Streamliner stable route/middleware structure for JSON bodies, health checks, test seams, and future API concerns without a later migration.

For synchronization, the API exposes `GET /api/sessions/events` as an EventSource stream. Clients receive an initial `snapshot` or replayed buffered events, then `session.upserted`, `session.deleted`, and `session.rebuilt` change events. Id-less `heartbeat` events keep the stream alive without consuming replay ids. Browser focus/visibility refresh remains a fallback for missed reconnect windows.

For write conflicts, builder-facing PATCH requests carry `expectedVersion`. If the row version has advanced, the API returns `409 Conflict` with the latest row and the fields the rejected patch attempted to change. Observation-derived updates do not bump builder versions.

## Alternatives considered

**Keep the Vite plugin as the backend.** Rejected. It keeps frontend process restarts coupled to registry observation, hides the API behind a dev-server implementation detail, and makes direct API debugging awkward.

**Create a standalone API with Node's built-in HTTP server only.** Rejected. It avoids one dependency but would likely be replaced as routes, middleware, and tests grow. Adding Express now avoids that churn.

**Keep both Vite-plugin and standalone API modes during transition.** Rejected. This project is new enough to cut over cleanly. Dual paths would duplicate route behavior and increase synchronization risk.

**Use WebSockets for live sync.** Deferred. Server-sent events are sufficient for the current one-way registry-change stream, work with the browser's built-in `EventSource`, and keep the protocol simple. A bidirectional control channel can be added later if Streamliner needs it.

## Consequences

- Development uses two long-lived processes: API and web. `npm run dev` starts both; `npm run dev:api` and `npm run dev:web` run them independently.
- Frontend HMR and Vite restarts no longer restart the registry worker or session event stream.
- Local callers can hit `http://127.0.0.1:4319/api/...` directly without a browser or Vite instance.
- The API process is the single logical registry/worker owner and uses an `api.lock` file to catch accidental duplicate API processes against the same runtime root.
- Trusted Copilot hook signal intake stays loopback-only even when reached through the Vite proxy; forwarded non-loopback callers are rejected.
- Tests can exercise API behavior with Express app factories and injected registry stores instead of booting Vite.
- Deployment remains local-first and loopback-oriented. Cross-machine access, remote session observation, and authentication are still out of scope until Streamliner intentionally supports remote environments.
