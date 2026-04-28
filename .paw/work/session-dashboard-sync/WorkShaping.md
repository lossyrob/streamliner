# Work Shaping: Session Dashboard Sync

## Problem Statement

Issue #17 needs Streamliner dashboard pages on one machine to behave as coordinated views of one local session registry. The immediate pain is stale session state across multiple pages or frontend instances, but the design discussion identified a broader architectural problem: the current Vite plugin is acting as both frontend dev server and backend owner. That makes session registry API access, background worker ownership, restart behavior, and future launch/relaunch work harder to reason about.

The user prefers a clean frontend/API split now while the project is still young, rather than continuing to expand the Vite plugin and migrating later.

## Core Decisions

- Introduce a standalone local Streamliner API process for issue #17.
- Use Express now instead of hand-rolled `node:http`, because the API is becoming a durable product surface with routing, middleware, event streaming, launch, relaunch, and context-assembly responsibilities.
- Treat the API process as the live synchronization hub for the local session registry.
- Keep the file-backed registry as durable storage, but make the API the single live owner of registry mutations, background observation/indexing, trusted signal ingestion, and change broadcasting.
- Make Vite frontend-only in development, with `/api/*` proxied to the standalone API.
- Do not preserve the old Vite-plugin-owned backend path as a parallel production path; remove or reduce it to frontend proxy/config glue.
- Capture the standalone API/service ownership change in a new accepted decision record, because issue #17 explicitly treats introducing a local service or changing registry write ownership as a design-impact decision.

## Work Breakdown

### Core functionality

1. Add a standalone Express API server with routes equivalent to the current Vite middleware:
   - `GET /api/health`
   - `GET /api/graph.json`
   - `GET /api/recents`
   - `POST /api/pick-file`
   - existing `/api/sessions` registry operations
   - trusted session signal ingestion
2. Move shared backend route logic out of the Vite plugin so the API server owns it directly.
3. Update Vite config so the frontend proxies `/api/*` to the API server during dev.
4. Make the session registry background worker start only in the API process.
5. Add push-first session synchronization through the API, likely Server-Sent Events at `GET /api/sessions/events`.
6. Update the Sessions UI to subscribe to live registry changes, refetch promptly, and retain focus/visibility refresh and polling as fallbacks.
7. Make concurrent builder edits explicit so stale sheets do not silently overwrite changes from another page or API caller.

### Supporting functionality

- Add dev scripts for separate and combined development:
  - `dev:api`
  - `dev:web`
  - `dev`
  - `api`
- Keep direct API access simple for curl/scripts/agents.
- Update tests around API routing, server startup seams, Vite proxy expectations, and Sessions UI sync behavior.
- Update design docs to capture the local API/service contract as a durable Wave 2 decision.

## Edge Cases and Expected Handling

- **API server restarts while pages are open:** pages should reconnect/refetch, and polling/focus refresh should recover missed events.
- **Frontend Vite restarts:** API and registry worker should remain alive.
- **Backend code changes:** API restarts independently; frontend remains alive and reconnects.
- **Multiple frontend instances:** all coordinate through the same API process, not separate Vite middleware instances.
- **Direct API callers mutate sessions:** dashboard pages receive the same change events and refresh.
- **Stale edit sheet:** a PATCH based on an outdated builder-owned snapshot returns `409 Conflict` with the latest row and conflicting builder-owned fields; it must not silently overwrite unrelated newer builder-owned fields.
- **Observation-derived updates during editing:** worker-owned fields may update in the background without taking over builder-owned draft fields.
- **API unavailable:** frontend should show a useful load/sync error rather than pretending state is current.

## Rough Architecture

```text
Browser dashboard(s)
  |
  | /api/* in dev (Vite proxy) or direct localhost API
  v
Standalone Streamliner API process (Express)
  |
  | owns
  v
SessionRegistryFileStore + background worker + trusted signal ingestion
  |
  v
~/.streamliner/state/session-registry/

API -> SSE session change stream -> Browser dashboard(s)
```

The API process becomes the live coordination point. The registry files remain the durable source of persisted session data, but browser pages should not behave as independent state owners.

## Critical Analysis

The previous recommendation was to defer a standalone service and harden page-level sync through the Vite plugin. That would minimize immediate implementation scope, but it would keep backend lifecycle coupled to frontend dev lifecycle and leave separate Vite/preview instances as disk-coordinated eventual consistency.

The user explicitly prefers the standalone API model, and the broader workstream is headed toward backend-heavy capabilities: relaunch, launch claims, Copilot SDK launch prep, context assembly, and graph overlay. Moving now avoids building more coordination contracts into a transitional Vite plugin.

Express is acceptable now because the API is not a throwaway dev shim. It gives a conventional route/middleware model before downstream nodes depend on it.

## Codebase Fit

Existing backend-like behavior is concentrated in:

- `vite-plugin-serve-graph.ts` - current graph/session middleware and worker startup.
- `src/session-registry/http-api.ts` - route-independent session registry API handler.
- `src/session-registry/runtime.ts` - shared registry store singleton.
- `src/session-registry/background-worker.ts` - worker lifecycle.
- `src/components/SessionsPage.tsx` - polling, autosave, session list, and edit sheet behavior.
- `src/App.tsx` and `src/components/WorkstreamHeader.tsx` - graph and file-picker API calls.

The implementation should reuse the existing session registry API contract and file store rather than rewrite persistence.

## Risks and Gotchas

- Backend/frontend script changes may affect local development muscle memory; scripts and docs need to be clear.
- SSE reconnection must not create event listener leaks or refetch storms.
- Optimistic concurrency must be scoped to builder-owned fields so observation updates do not create unnecessary conflicts.
- `POST /api/pick-file` is Windows/local-desktop-specific and should remain local-only.
- Tests should not require a long-lived server; app creation should be separable from listening.
- API process should bind to localhost by default, not a public interface.

## Resolved Questions

- **CORS:** Do not add first-class CORS in Wave 2. The API binds to loopback by default, Vite uses a proxy, and direct API tools do not need browser CORS.
- **Preview/static serving:** `vite preview` should mirror dev by proxying to the standalone API. Serving `dist/` from Express can be added later when packaging/distribution becomes explicit.
- **Stale PATCH shape:** Builder-owned stale PATCH requests return `409 Conflict` with `{ error, latest, conflictingFields }`. Observation-derived changes bypass this builder precondition path.

## Session Notes

- The issue comment documenting these design decisions was posted to https://github.com/lossyrob/streamliner/issues/17#issuecomment-4331562999.
- The work should proceed through PAW-lite non-interactively after this shaping pass.
- Planning and final reviews should use multi-model mode with pre-mortem and post-mortem perspectives, using `claude-opus-4.7`.
