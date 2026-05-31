# Streamliner Desktop MVP Implementation Plan

## Overview

Build the ruthlessly scoped MVP of a Streamliner notification pipeline that can
supplant the orchestrator's `toasty.exe` usage:

1. A **`POST /api/notifications`** ingress on the existing Streamliner local API,
   plus **list** and **SSE** endpoints, backed by a durable store. The API is the
   source of truth and enriches notifications from the workstream registry
   (color, projectKey, deep link), per issue #40's "daemon/API is source of
   truth, CLI/app are thin" thesis.
2. A **`streamliner` CLI** (first concrete shape of the #40 distribution spine),
   implementing only a `notify` subcommand that POSTs to the API, packaged so it
   is **globally invocable from any cwd** (so an orchestrator agent can call it
   exactly like it called `toasty.exe`).
3. A **Streamliner Desktop app** (Tauri v2 + React) that is a thin SSE consumer:
   raises Windows toasts carrying a per-workstream color swatch and renders a
   durable, clickable feed of cards that deep-link into the local dashboard.
4. **Documentation** including a `toasty` → `streamliner notify` migration map.

The full vertical loop proven by this MVP:
`streamliner notify ...` → API persists + emits SSE → desktop app raises a toast
+ adds a feed card → click opens the right local dashboard page.

## Current State Analysis

- **Local API** (`src/server/`, Express, port `4319`) mounts routers under
  `/api` in `src/server/app.ts`. Two SSE streams already exist with a reusable
  pattern: `src/server/session-events.ts` and `src/server/workstream-events.ts`
  (monotonic event ids, in-memory replay buffer, `Last-Event-ID` resume,
  heartbeat interval, client registry, snapshot-on-connect). SSE routes are
  exempted from access logging via a `path.startsWith(.../events)` skip list and
  registered relative to the readonly guard. **Note** (from review): the existing
  session stream uses an *in-memory* `nextEventId` that resets to 1 on restart —
  acceptable there because it multiplexes many event types; we deliberately do
  NOT copy that for notifications (see Phase 1, id coupling).
- **Snapshot/live race** (from review): in `session-events.ts handle()` the
  client is registered in `clients` *before* `writeSnapshot`, so an event
  published in between is delivered twice. Our design tolerates this via
  id-based dedupe + the "snapshot never toasts" rule (Phase 3/4).
- **Concurrency**: `workstream-registry.ts` serializes writes with a module-level
  `mutationQueue` (line ~50). The notification store must do the same to avoid id
  collisions / torn NDJSON lines under concurrent producers.
- **State root** resolves as `process.env.STREAMLINER_STATE_ROOT ?? ~/.streamliner/state`
  across server modules. JSON-lines logs already live under
  `~/.streamliner/state/logs/`.
- **Workstream registry** (`src/server/workstream-registry.ts`) exposes list
  entries with `projectKey`, `workstreamId`, and `presentation { shortName, color }`
  (`src/workstream-registry-contract.ts`, `src/workstream-schema.ts`). Multiple
  project sources can coexist (`WorkstreamSourceConfig`), so a `workstreamId` is
  only unique within a `projectKey`.
- **Dashboard origin** (from review): the dashboard is served by **Vite**, not by
  the API. The API on `4319` only mounts `/api/*` (and `/_proto/canvas/*`). Dev
  is `:5173`, preview/frozen differ. There is therefore **no canonical dashboard
  URL** today; the MVP must introduce one explicitly (Phase 1 discovery + desktop
  config) or deep links cannot resolve.
- **Web routes** for deep links: `/workstreams/<projectKey>/<workstreamId>` and
  `/workstreams/<projectKey>/<workstreamId>/nodes/<nodeId>` (confirmed in
  `src/App.tsx` / `App.test.tsx`).
- **No CLI** exists: `package.json` has no `bin`. **No Rust/Tauri** exists in the
  repo. There are **no CI workflows** (`.github/` holds plugin/skills/instructions
  only), so a new Rust/Tauri toolchain breaks no existing pipeline. `npm run build`
  (`tsc -b && vite build`) and `npm test` (vitest) are the existing gates.
- **Color swatch PNGs** the orchestrator passes to toasty exist only in the
  developer's main checkout under `public/streamliner-terminal-color-swatches/`
  and are **git-untracked** (no generation script in-repo). The desktop app must
  NOT depend on them; it generates a colored icon from the hex at runtime.
- **Toast tooling precedent**: the donna desktop template
  (`C:\Users\robemanuele\proj\pal\personal-agent-layer\donna\desktop`) uses
  `tauri-plugin-notification` (v2) but **only for basic
  `.title().body().show()` toasts** — inspection shows it does NOT exercise
  per-notification icons, AUMID/shortcut setup, or click-activation forwarding.
  So donna proves the trivial path only; the per-workstream icon + click-through
  requirements are NOT pre-validated by it (see Phase 4b, which spikes them
  explicitly and names a protocol-activation fallback). `toasty`
  (`C:\Users\robemanuele\proj\util\toasty\main.cpp`) is the working reference for
  the harder path: an AUMID Start-Menu shortcut (`PKEY_AppUserModel_ID` via
  `IShellLink`/`IPropertyStore`) + a registered `streamliner://` URL scheme +
  toast XML with `activationType="protocol"`, which survives Action Center clicks
  and app restart without a COM activator.
- **TypeScript constraint**: `erasableSyntaxOnly` — no constructor parameter
  properties; declare fields explicitly. Tests are `*.test.ts(x)` next to source
  using vitest (`--pool=forks` for heavy suites).

## Desired End State

- `POST /api/notifications` accepts a structured notification, validates it,
  enriches it from the workstream registry, persists it to a durable NDJSON
  store (serialized writes), assigns a monotonic id (`= maxStoredId + 1`, seeded
  from the file on startup) + `createdAt`, and publishes it on an SSE stream
  whose **event id equals the notification id**.
- `GET /api/notifications?afterId=<n>&limit=<m>` returns stored notifications with
  id `> afterId` (default: most recent `limit`, default 200), newest-last,
  enriched.
- `GET /api/notifications/events` is an SSE stream mirroring the existing pattern
  (replay buffer + heartbeat + `Last-Event-ID`), emitting a `snapshot` on connect
  and `notification.created` per new notification. On replay-miss it backfills via
  the store using the client's `Last-Event-ID` (no silent cap-induced gap).
- `GET /api/health` (or a sibling discovery endpoint) returns the configured
  **dashboard base URL** so the desktop app can compose absolute deep links.
- POST `/api/notifications` is **allowed even in readonly preview mode** (a
  notification is not a workstream/repo mutation), so an orchestrator can notify
  against any local instance.
- `streamliner notify --title <t> --body <m> [--workstream <id>] [--project-key <k>]
  [--severity info|warn|error] [--link <url>] [--node <id>] [--session <id>]`
  POSTs to the API and reports success/failure with a clear non-zero exit on
  unreachable API or error response. **Installed globally** so it runs from any
  cwd like a normal executable.
- The desktop app, when running, raises a Windows toast per *new* notification
  with a per-workstream color swatch and shows a durable feed of clickable cards;
  clicking a toast or card opens the notification's deep link in the default
  browser. **Snapshot/backlog items never raise toasts** — only live
  `notification.created` events do. When the app is not running, notifications
  still persist and appear in the feed on next launch (documented; no live toast,
  no server fallback toast).
- Verification: vitest covers store + enrichment + events + routes + an
  end-to-end POST→SSE ordering test + CLI; `cargo test` covers the desktop
  `core` crate; manual Windows verification covers the toast + feed +
  click-through loop, including the toast-activation spike.

## What We're NOT Doing

- No server-side automatic/condition-based notifications. Emit pipeline only.
- No server-side fallback toast when no consumer is connected; no desktop
  auto-launch on notification.
- No toast action buttons, no per-workstream mute/policies, no read/unread state
  beyond trivial feed needs, no feed filtering/search.
- **No `dedupeKey` / notification de-duplication in the MVP** (dropped after
  review: a half-working dedupe flag risks an empty-looking feed and complicates
  the store/SSE contract; deferred to a later phase with a defined collapse
  policy).
- No ntfy / phone-push bridge.
- No other `streamliner` CLI subcommands (`doctor`, `server`, `sessions`,
  `launch-node`, `copilot ...`).
- No toasty-compatible argument shim; the CLI is clean-sheet.
- No surfacing of notifications in the web dashboard UI.
- No embedded in-app dashboard webview (open system browser).
- No editing of the planning-repo orchestrator prompt (separate follow-up); this
  PR only documents the migration mapping.
- No store rotation/retention beyond what the on-disk file naturally holds (no
  truncation/rotation in the MVP; documented limitation).
- No cross-platform toast layer (`core` stays portable for tests, shell is
  Windows-only). No wiring the Tauri build into CI (none exists).

## Phase Status
- [ ] **Phase 1: Notification API + store + SSE + discovery** - Server ingress, serialized durable store, registry enrichment, id-coupled SSE stream with gap-free backfill, dashboard-base discovery.
- [ ] **Phase 2: `streamliner` CLI with `notify` (globally invocable)** - Distribution-spine CLI entrypoint that POSTs notifications, packaged to run from any cwd.
- [ ] **Phase 3: Desktop `core` crate** - Portable, cargo-tested domain logic (model, SSE parse, deep link, toast-suppression dedupe, hex icon).
- [ ] **Phase 4a: Desktop shell + SSE client + tray + feed UI** - Tauri scaffold consuming the API/`core`, React feed, tray, live feed updates (no toasts yet).
- [ ] **Phase 4b: Toast emission + activation (de-risk spike first)** - Per-workstream-iconed toasts via `tauri-plugin-notification`, click → open deep link, snapshot-suppression.
- [ ] **Phase 5: Documentation + migration mapping** - Docs.md, migration table, project docs.

## Phase Candidates
- [ ] (none deferred into candidates; all in-scope work is phased above)

---

## Phase 1: Notification API + store + SSE + discovery

Backbone of the pipeline. Fully testable server-side with vitest/supertest, no
desktop dependency. **This phase pins every contract Phases 2-4 depend on.**

### Pinned contracts (must be stable before downstream phases start)

- **Notification record** (stored + emitted): `id` (monotonic int, == SSE event
  id), `createdAt` (ISO-8601), `title`, `body`, `severity` (`info|warn|error`),
  `workstreamId?`, `projectKey?`, `workstreamColor?` (hex, no `#`), `nodeId?`,
  `sessionId?`, `link?` (absolute URL after enrichment, or `null`), `source`
  (default `cli`).
- **`link` is an absolute URL** after enrichment (composed against the configured
  dashboard base), not a bare path — so the desktop opens it verbatim.
- **SSE `event.id` == record `id`**, seeded from the store on startup. So
  `Last-Event-ID` is a stable cross-restart cursor.
- **Snapshot payload**: `{ notifications: NotificationRecord[] }`, ordered
  **newest-last**, each carrying `id`. Delivered as event name `snapshot`.
- **Live event**: name `notification.created`, data is one `NotificationRecord`.
- **`snapshot` and `notification.created` are distinct** so the desktop can
  suppress toasts on snapshot/backlog.

### Changes Required:

- **`src/notification-contract.ts`** (new): shared request + record types and the
  `Severity` union. Request body (client → API): `title` (required), `body`
  (required), `severity?` (default `info`), `workstreamId?`, `projectKey?`,
  `nodeId?`, `sessionId?`, `link?`, `source?`.
- **`src/server/notification-store.ts`** (new): durable append-only store at
  `${stateRoot}/notifications/notifications.ndjson`. Responsibilities: on
  construction, seed `nextId` from the max id in the existing file (or 0);
  `append(record)` serialized through a module/instance `mutationQueue` (mirror
  `workstream-registry.ts`) to guarantee unique ids and untorn lines under
  concurrent POSTs; `listSince(afterId, limit)` and `listRecent(limit)` reading
  the file. Inject `now` + path for tests; `mkdir` on first write
  (`node-launch-record-store.ts` conventions).
- **`src/server/notification-enrichment.ts`** (new): given a request + registry
  lookup + dashboard base URL, resolve `projectKey`, `workstreamColor`, and an
  absolute `link`. Link precedence: explicit request `link` → composed
  `<dashboardBase>/workstreams/<projectKey>/<workstreamId>[/nodes/<nodeId>]` when
  the registry lookup succeeds → `null`. Registry lookup is best-effort: match by
  (`projectKey` if given, then) `workstreamId`, falling back to
  `presentation.shortName`; on miss/any error, enrich nothing (never fail the
  request). Reuse `listRegisteredWorkstreams`.
- **`src/server/notification-config.ts`** (new) or extend existing config: resolve
  the **dashboard base URL** from `process.env.STREAMLINER_DASHBOARD_BASE_URL ??`
  a sensible default (`http://127.0.0.1:5173`). Single source of truth used by
  enrichment and the discovery endpoint.
- **`src/server/notification-events.ts`** (new): `NotificationEventStream` modeled
  on `SessionRegistryEventStream` but **single event-type** and **id-coupled**:
  `nextEventId` seeded from the store's max id + 1; on publish, `event.id =
  record.id`; bounded in-memory replay buffer; heartbeat; snapshot on connect via
  `listRecent`; `replayAfter` resolves replay-misses by querying
  `store.listSince(lastEventId)` (gap-free) rather than a fresh bounded snapshot.
  **Pin (review R2): on a replay-miss the ENTIRE replay is sourced from
  `store.listSince(lastEventId)` and the in-memory buffer is bypassed for that
  reconnect** — the on-disk store is complete (no rotation in MVP), so mixing
  buffer + store on the gap path would double-deliver ids in their intersection.
  The buffer serves only the fast in-buffer replay path (sufficient by itself).
  `listSince` and `Last-Event-ID` both use strict `> n` (never `>=`); a unit test
  asserts the boundary agrees across the HTTP list and SSE replay.
- **`src/server/routes/notifications.ts`** (new): `createNotificationsRouter`
  with `POST /notifications` (validate → enrich → **store (await) → publish** →
  return `201` with the stored record) and `GET /notifications` (supports
  `afterId` + `limit`). Validation `400` with `code`/`error` body. Publish must
  happen only after the store append resolves (so a crash can't emit an event
  absent from the snapshot).
- **`src/server/app.ts`** (edit): construct `NotificationEventStream` (sharing the
  store instance with the router); register `GET /api/notifications/events`
  **before** the readonly guard and add it to the access-log skip list; mount the
  notifications router so that **`POST /api/notifications` is exempt from the
  readonly guard** (notifications are not mutations) — e.g. register the
  notifications router before the readonly middleware, or special-case the path in
  the guard. Add a `dashboardBaseUrl` field to the `GET /api/health` response (or
  a sibling `GET /api/client-config`). **Note (review R2): the readonly carve-out
  for `POST /api/notifications` is a deliberate localhost-only write surface;
  safety relies on the API binding to `127.0.0.1` (as it does today). Document
  this assumption — readonly preview no longer means "zero request-driven
  filesystem writes".** Expose the stream on `StreamlinerApiApp`
  and close it in `close()`.
- **Tests**:
  - `notification-store.test.ts`: id seeding from existing file; serialized
    concurrent `append` produces strictly unique, monotonic ids and no torn
    lines; `listSince`/`listRecent` ordering + bounds; fresh-dir creation.
  - `notification-enrichment.test.ts`: explicit-link passthrough; composed
    absolute link from registry (by id, by shortName, with/without nodeId);
    project-key disambiguation; miss/error → no-op.
  - `notification-events.test.ts`: event id == record id; snapshot ordering and
    that snapshot is a distinct event; `Last-Event-ID` replay; replay-miss
    backfills via store (no gap); heartbeat carries no id.
  - Extend `app.test.ts` (supertest): POST happy path returns enriched `201`;
    `400` validation; GET list with `afterId`; **readonly mode blocks workstream
    mutations but ALLOWS POST `/api/notifications`, GET, and `/events`**;
    discovery endpoint returns `dashboardBaseUrl`.
  - **End-to-end ordering test** (supertest): open an SSE client, fire N POSTs
    concurrently, assert the stream delivers N `notification.created` events with
    strictly monotonic ids that match the stored records' ids.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes (all new + extended suites, including the e2e ordering test).
- [ ] `npm run lint` passes.
- [ ] `npx tsc -b` typechecks (no `erasableSyntaxOnly` violations).

#### Manual Verification:
- [ ] `curl -X POST localhost:4319/api/notifications` returns an enriched record
      with an absolute `link`; `curl 'localhost:4319/api/notifications?afterId=0'`
      lists it; `curl -N localhost:4319/api/notifications/events` streams snapshot
      then the new notification with matching ids.
- [ ] `curl localhost:4319/api/health` includes `dashboardBaseUrl`.
- [ ] NDJSON file appears under `~/.streamliner/state/notifications/`.

---

## Phase 2: `streamliner` CLI with `notify` (globally invocable)

First shape of the #40 distribution spine; only `notify` is implemented. **Must
be runnable from any cwd** so the orchestrator can call it like `toasty.exe`.

### Changes Required:

- **`src/cli/streamliner.ts`** (new): entrypoint with a minimal subcommand
  router. Unknown/absent subcommand prints usage, exits non-zero; `notify`
  dispatches to its handler. Shaped so future subcommands slot in.
- **`src/cli/api-base.ts`** (new): resolve the API base URL
  (`process.env.STREAMLINER_API_BASE_URL ?? http://127.0.0.1:4319`) — the
  reusable client-config seam #40 builds on.
- **`src/cli/commands/notify.ts`** (new): parse flags (`--title`, `--body`,
  `--workstream`, `--project-key`, `--severity`, `--link`, `--node`, `--session`),
  validate required `--title`/`--body` and the `severity` enum, build the request,
  `POST` via global `fetch`. `2xx` → print id+title, exit `0`. Connection failure
  → actionable stderr message, non-zero. `4xx/5xx` → surface API `code`/`error`,
  non-zero. CLI never raises a toast itself.
  - **`--workstream` resolution is documented**: treated as a `workstreamId`,
    with server-side `shortName` fallback; `--project-key` disambiguates when the
    same id exists across sources.
- **Packaging for global invocation** (resolves the "actually supplants toasty"
  gap): the `bin` target must not depend on `tsx`/repo `node_modules`/cwd. Build
  the CLI to a self-contained launcher: **bundle `src/cli/**` to a single
  `dist/cli/streamliner.mjs` with esbuild** (`--platform=node --format=esm
  --bundle --banner` with a Node shebang) — chosen because `tsc -b` emits
  per-file JS, not a dependency-free single entry, and esbuild is the lightest
  way to get a cwd-independent launcher. Point
  `package.json` `"bin": { "streamliner": "dist/cli/streamliner.mjs" }` at the
  built file. Install via `npm link` (dev) or `npm i -g` so npm generates the
  Windows `.cmd`/`.ps1` shims on `PATH`. Add `scripts`:
  `"build:cli"` and a dev `"streamliner": "tsx src/cli/streamliner.ts"`.
- **Tests**:
  - `src/cli/commands/notify.test.ts`: required/enum validation; request-body
    shaping (incl. `--project-key`, `--node`); success against mocked fetch;
    non-zero exit on network error and on API error response.
  - `src/cli/api-base.test.ts`: env override and default.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes (CLI tests).
- [ ] `npm run build:cli` produces `dist/cli/streamliner.mjs`.
- [ ] `npm run lint` + typecheck pass.

#### Manual Verification:
- [ ] After install, running `streamliner notify --title "PR Created" --body
      "node X: detail" --workstream <id>` **from an unrelated cwd** returns `0`
      and the notification appears via `GET /api/notifications`.
- [ ] With the API stopped, the same command prints a clear error and exits
      non-zero.

---

## Phase 3: Desktop `core` crate (portable, no Tauri dependency)

All testable desktop domain logic, `cargo test`-able on any platform (mirrors
donna desktop's `core`/shell split). No Windows-only or Tauri APIs here.

### Changes Required:

- **`desktop/core/Cargo.toml`** + **`desktop/core/src/lib.rs`** (new crate):
  pure-logic crate, no Tauri/WinRT deps.
- **`desktop/core/src/model.rs`**: `Notification` struct matching the API record
  (serde derive), `Severity` enum.
- **`desktop/core/src/sse.rs`**: incremental SSE parser → `(eventName, dataJson,
  lastEventId)`; tolerant of `heartbeat` (must **not** advance `Last-Event-ID`),
  `snapshot`, `notification.created`. Handles chunk boundaries.
- **`desktop/core/src/deeplink.rs`**: choose the URL to open — record `link` is
  already absolute, so this validates the scheme (`http`/`https`/`file` only) and
  returns it; returns `None` for missing/disallowed links. (Composition is done
  server-side; the desktop trusts the absolute link but guards the scheme.)
- **`desktop/core/src/dedupe.rs`**: toast-suppression state machine. Core rule:
  **only `notification.created` events are toast-eligible; `snapshot`/backlog are
  never toasted.** Within a session, track highest-seen `id` so SSE replay after
  reconnect does not re-toast. This rule is sufficient ONLY in combination with
  the Phase 4a contract that the SSE `Last-Event-ID` cursor is in-memory-only
  (cold launch omits it → server sends a `snapshot`, not replayed
  `notification.created` events). Pure + unit-tested, including a test that a
  `snapshot` carrying ids above the current in-session high-water mark still
  produces zero toast-eligible items.
- **`desktop/core/src/icon.rs`**: deterministic map from a workstream hex color
  (or a default) to a solid-color **256×256** PNG (via the pure-Rust `png` crate,
  as donna uses) written to/cached in a provided cache dir, keyed by hex; returns
  the path. Removes any dependency on the untracked repo swatch PNGs. Cache dir is
  a parameter so tests use a temp dir. **Honest framing (review R3): Win11 renders
  the toast app-logo slot as a small (~48px) circular-cropped image, so this ships
  as a per-workstream COLOR SWATCH (a colored dot), at parity with the orchestrator's
  current color-only swatch PNGs — not a labeled badge.** Optional stretch (not
  MVP-blocking): render the workstream `shortName` initials into the swatch (adds a
  small font dep, e.g. `ab_glyph`); defer unless cheap.
- **Tests** (`#[cfg(test)]`): SSE parsing across chunk boundaries; heartbeat does
  not advance `Last-Event-ID`; snapshot vs created classification; deep-link
  scheme validation (allow/deny); dedupe (snapshot never eligible; replay id
  suppression); icon caching (same hex → same path, valid 256×256 PNG header).

### Success Criteria:

#### Automated Verification:
- [ ] `cargo test` passes in `desktop/core` (platform-independent — no
      Windows/GTK/WebKit needed).
- [ ] Crate compiles warning-free (`cargo build`); `cargo clippy` clean if adopted.

#### Manual Verification:
- [ ] A generated icon PNG opens and shows the expected solid color at 256×256.

---

## Phase 4a: Desktop shell + SSE client + tray + feed UI (no toasts yet)

Thin Windows shell that consumes the API + `core`. Depends on Phase 1 (contract)
and Phase 3 (`core`). Deliberately excludes toasts so the risky toast seam is
isolated in 4b.

### Changes Required:

- **`desktop/src-tauri/`** (new Tauri v2 app): `Cargo.toml` (depends on `core`,
  `tauri`, `tauri-plugin-notification`), `tauri.conf.json`, `capabilities/`,
  `build.rs`, icons. Tray-resident background app with a feed window (donna
  desktop layout).
- **`desktop/src-tauri/src/config.rs`**: resolve the API base + dashboard base
  (env overrides; defaults `http://127.0.0.1:4319` / from `/api/health`).
- **`desktop/src-tauri/src/sse_client.rs`**: connect to
  `${apiBase}/api/notifications/events`, feed bytes through `core::sse`, reconnect
  with backoff + `Last-Event-ID`. Emit a Tauri event to the frontend for each
  `snapshot` (backlog) and `notification.created` (live). (Toast emission is added
  in 4b; here the hook point exists but does nothing.)
  - **Contract (review R2 — prevents the cold-launch toast burst):
    `Last-Event-ID` is held IN-MEMORY ONLY and is NOT persisted across app process
    restarts.** A cold launch therefore connects with NO `Last-Event-ID`, so the
    server replies with a `snapshot` (which is never toast-eligible) and the feed
    backfills silently. The in-memory cursor + buffer/`listSince` replay handle
    only transient SSE reconnects *within* a running process. This is required
    because the SSE replay/backfill paths emit `notification.created` events (not
    `snapshot`), so the "snapshot never toasts" rule alone would NOT suppress a
    burst if a persisted cursor were replayed on boot. Do not add cross-restart
    cursor persistence in the MVP.
- **`desktop/src-tauri/src/tray.rs`** + **`lib.rs`/`main.rs`** + **`commands.rs`**:
  tray icon/menu (show feed, quit), app setup/`AppState`, and commands
  `list_notifications` (initial backlog via the API list endpoint) and
  `open_link` (validate via `core::deeplink` then open with the `open` crate).
- **`desktop/src/`** (React/TS, Vite; donna layout): `App.tsx`,
  `components/NotificationFeed.tsx`, `NotificationCard.tsx` (workstream color
  accent, severity, title, body, relative time; click → `open_link`),
  `hooks/useNotificationEvents.ts` (Tauri event subscription + initial backlog).
- **`desktop/package.json`, `vite.config.ts`, `tsconfig.json`, `README.md`**
  (new): isolated frontend build + run docs + the app-must-be-running assumption.
- **Tests**: frontend view-model/unit tests (vitest + jsdom) for card rendering
  and feed ordering (donna's `workstream-view-model.test.ts` style).

### Success Criteria:

#### Automated Verification:
- [ ] `cargo build` succeeds for `desktop/src-tauri` on Windows.
- [ ] Frontend `npm run build`/`tsc` and frontend vitest pass in `desktop/`.

#### Manual Verification:
- [ ] `cargo tauri dev` launches a tray-resident app with a feed window.
- [ ] Notifications POSTed to the API appear as feed cards (live via SSE and as
      backlog on launch); clicking a card opens the correct dashboard page.
- [ ] **Restart check (R2): with the app closed, POST several notifications, then
      relaunch — the feed shows them as backlog with no errors, and (once 4b
      lands) zero toasts fire for the backlog**, confirming the cursor is not
      persisted across restarts.

---

## Phase 4b: Toast emission + activation (de-risk spike first)

The single riskiest seam — isolated and spiked before full commit. **Budget this
phase at ~2x a normal desktop phase**: native Windows toast activation for an
*unpackaged* app is real systems work, and the plugin does not pre-solve it (see
Current State note correcting the donna citation).

### Spike (do first, timeboxed) — test the load-bearing gate FIRST:

- **Gate 0 (do this before anything else): Action Center / post-restart
  activation.** Using `tauri-plugin-notification` in the Phase 4a app, raise a
  toast, let the popup expire, then click it from the **Action Center**, and also
  click a toast after restarting the app. Confirm whether activation forwards back
  to the app with enough context to resolve the link. **This is the check most
  likely to fail and the whole phase pivots on it — discover the failure now, not
  in final manual verification.**
- Then confirm, on Windows 10/11: (a) the toast appears for an **unpackaged** app;
  (b) a generated per-workstream **icon** (`core::icon`) renders in the toast;
  (c) live popup body-click activation works.
- **Decision gate (three-way, not binary):**
  1. Plugin delivers popup **and** Action Center activation + per-notification
     icon → ship on the plugin.
  2. Plugin delivers popup-only activation (the likely outcome) → adopt the
     **protocol-activation pattern**: emit toast XML with
     `activationType="protocol" launch="streamliner://notification/<id>"`,
     register `streamliner://` under `HKCU\Software\Classes` pointing at the
     desktop exe, install an AUMID Start-Menu shortcut
     (`PKEY_AppUserModel_ID` via `IShellLink`+`IPropertyStore`), and call
     `SetCurrentProcessExplicitAppUserModelID` on startup. Mirror
     `toasty/main.cpp` (lines ~1666-1779, ~1988-2010). This survives Action
     Center + restart **without** a COM activator. This is the expected path.
  3. Only if even sending/icon is blocked → full toasty-style raw WinRT for the
     send path too.
- **Note:** a raw-WinRT *in-process `Activated` handler* is NOT a valid fallback —
  it has the same Action-Center gap as the plugin. The fallback is
  protocol-activation, above.
- Record the chosen path and outcome in Docs.md.

### Changes Required:

- **`desktop/src-tauri/src/toast.rs`**: on each toast-eligible
  `notification.created` (per `core::dedupe`; **snapshot/backlog never toast**),
  resolve the icon via `core::icon` (cache under the app data dir), raise the
  toast (plugin if Gate 0 passed; otherwise protocol-activation toast XML), and on
  activation resolve the URL via `core::deeplink` and open it (reusing the
  `open_link` command path).
- **`desktop/src-tauri/src/activation.rs`** (only if Gate 0 fails): one-time
  AUMID shortcut install + `streamliner://` scheme registration + a single-instance
  handler that parses the `streamliner://notification/<id>` launch argument and
  opens the corresponding link. Register a stable AUMID for correct attribution.
- **Wire** the 4a SSE hook point to the toast emitter.
- **Tests**: toast-eligibility decisions stay in `core::dedupe` (cargo-tested in
  Phase 3); the shell wiring + activation are validated by the spike + manual
  Windows checks (documented).

### Success Criteria:

#### Automated Verification:
- [ ] `cargo build` succeeds; `core` dedupe/icon tests still green.

#### Manual Verification:
- [ ] `streamliner notify --workstream <id> --title ... --body ...` raises a
      Windows toast bearing the workstream color swatch and adds a feed card.
- [ ] Clicking the toast opens the correct local dashboard page **from both the
      popup AND the Action Center** (the Gate 0 check, re-verified end-to-end).
- [ ] **No toast burst on launch**: notifications emitted while the app was closed
      appear only as feed cards on next launch; no duplicate toasts after an SSE
      reconnect.

---

## Phase 5: Documentation + migration mapping

### Changes Required:

- **`.paw/work/streamliner-desktop-mvp/Docs.md`** (load `paw-docs-guidance`):
  as-built reference — API contract (`/api/notifications` POST/list/events,
  `afterId`, readonly exemption, discovery endpoint), notification schema +
  enrichment + id coupling, store location/format + serialization + no-rotation
  limitation, CLI usage + global install, desktop architecture (`core`/shell
  split, toast path chosen in the 4b spike, snapshot-never-toasts rule, icon
  generation, dashboard-base config), and the app-must-be-running assumption.
- **`docs/notifications.md`** (or `docs/operations/...`, per repo convention):
  the `toasty` → `streamliner notify` mapping table for orchestrator events
  (ONLINE, PR Created, PR Approved, Issue Closed, Reconciled, DONE), explaining
  that the per-workstream icon becomes implicit (pass `--workstream <id>`; the app
  resolves the color) and that editing the planning-repo prompt is a follow-up.
  **Include two known-friction notes (review R3): (1) `streamliner notify`
  requires npm's global bin on `PATH` — call out that nvm-windows switches the
  bin dir per Node version and Microsoft Store Node may block `-g` installs;
  (2) per-call cold start (~80-150 ms to spawn Node) is higher than toasty's
  <10 ms, so bursty event runs cost ~1 s of overhead — acceptable but documented
  so the orchestrator owner doesn't misattribute the slowdown.**
  Update any docs index if present.
- **`DEVELOPING.md`** (edit, if warranted): the `streamliner notify` command +
  global install, the `/api/notifications` endpoints + `STREAMLINER_DASHBOARD_BASE_URL`,
  and the `desktop/` app build/run.
- **Design doc check**: if the local API contract change warrants a note under
  `docs/design/`, follow the `design-docs` skill conventions; otherwise record
  that it was considered and deemed unnecessary for the MVP.

### Success Criteria:

#### Automated Verification:
- [ ] `npm run docs:build` succeeds if any `docs/design/` files changed; else N/A.
- [ ] `npm run lint` still passes.

#### Manual Verification:
- [ ] Migration table is accurate against the current orchestrator prompt events.
- [ ] Docs.md reflects the as-built API, CLI, store, and desktop architecture
      (including the 4b toast-path decision).

---

## Failure Modes & Recurrence Analysis

### Failure modes of the designed approach (and mitigations)

1. **Toast does not display / click doesn't activate** (riskiest). An AUMID alone
   may not let an *unpackaged* app display toasts, and Action-Center / post-restart
   click activation does NOT work without either a COM activator or
   protocol-based activation. `tauri-plugin-notification` does not solve this
   (donna only uses basic toasts). Mitigation: spike Action-Center activation
   FIRST (Gate 0, Phase 4b); if the plugin is popup-only (expected), use the
   **protocol-activation pattern** (`activationType="protocol"` +
   `streamliner://` URL-scheme registration + AUMID Start-Menu shortcut), mirroring
   `toasty/main.cpp` — survives Action Center + restart without a COM activator.
   Phase 4b is budgeted ~2x accordingly.
2. **Toast burst on launch.** The snapshot delivers backlog; if treated like live
   events the app fires many toasts. The subtlety (review R2): SSE replay/backfill
   emit `notification.created` (not `snapshot`), so the "snapshot never toasts"
   rule alone does NOT cover a cold launch that replays a persisted cursor.
   Mitigation (two coupled rules): (a) "snapshot/backlog never toast; only
   `notification.created` does," encoded in `core::dedupe`; AND (b) the desktop
   holds `Last-Event-ID` in-memory only (never persisted across process
   restarts), so a cold launch omits it and receives a `snapshot` rather than a
   replay of `notification.created`. Both are tested.
3. **Silent feed gaps across long downtime / replay-buffer overflow.** A bounded
   snapshot would drop items between `Last-Event-ID` and `currentId - cap`.
   Mitigation: `store.listSince(afterId)` backfill on replay-miss; the on-disk
   store, not the in-memory buffer, defines completeness.
4. **Duplicate delivery from the snapshot/live race + reconnect replay.**
   Mitigation: id-based suppression keyed on the **record id** (== SSE id);
   tested via the e2e ordering test and dedupe tests.
5. **Id instability across restarts.** Decoupled in-memory SSE ids reset on
   restart and desync clients. Mitigation: SSE `event.id = record.id`, seeded from
   the store; `Last-Event-ID` becomes a stable cursor; one id concept end-to-end.
6. **Concurrent producers collide on id / tear NDJSON.** Multiple orchestrators
   emit at once. Mitigation: serialize store writes via a `mutationQueue`
   (workstream-registry pattern); tested under concurrency.
7. **Dead deep links / no dashboard origin.** The dashboard is a Vite app with no
   canonical URL. Mitigation: a configured `STREAMLINER_DASHBOARD_BASE_URL` +
   discovery endpoint; server composes absolute links; desktop validates scheme.
   Best-effort enrichment degrades to explicit `--link` or no link, never a broken
   guess.
8. **CLI not actually invocable like toasty.** A `tsx`/cwd-bound `bin` wouldn't run
   from an orchestrator's arbitrary cwd. Mitigation: build a self-contained
   launcher and a documented global install; manual "from unrelated cwd" check.
9. **CLI exit-code semantics mislead the orchestrator.** Mitigation: persisted →
   `0`; unreachable/4xx/5xx → non-zero; explicitly tested.
10. **Icon dependency on untracked artifacts.** Mitigation: generate the icon from
    the hex at runtime (fixed 256×256), no reliance on developer-local PNGs.
11. **Readonly preview blocks notifications.** Mitigation: exempt POST
    `/api/notifications` from the readonly guard (not a mutation); tested.
12. **New Rust/Tauri toolchain friction.** No CI to break; `core` is pure and
    cargo-testable without Windows/WebKit; server/CLI stay in the Node toolchain
    so half the system is reviewable/testable without Rust.

### Where this class of problem recurs

- **Every future `streamliner` subcommand (#40)** re-hits API-base discovery,
  global invocability, machine-readable output, and exit-code semantics — Phase 2
  establishes those seams.
- **Every future notification producer** (rules engine, web dashboard, MCP)
  re-hits the schema + enrichment + id-coupled SSE + gap-free backfill contract —
  Phase 1 is the durable interface to get right once.
- **Every future desktop consumer surface** (actions, mute, filters, dedupe)
  builds on the `core`/shell split + toast activation + snapshot-suppression —
  Phases 3/4 establish those load-bearing boundaries.

## References
- Issue: https://github.com/lossyrob/streamliner/issues/40 (CLI/distribution spine thesis)
- Shaping: `.paw/work/streamliner-desktop-mvp/WorkShaping.md`
- Orchestrator prompt (toasty usage to supplant): `C:\Users\robemanuele\proj\planning\planning\streamliner\dbagent\prompt-drafts\orchestrator-initial-prompt-v1.md`
- Reuse patterns: `src/server/session-events.ts`, `src/server/workstream-events.ts`, `src/server/node-launch-record-store.ts`, `src/server/workstream-registry.ts` (mutationQueue), `src/server/app.ts`
- Desktop template (incl. `tauri-plugin-notification`): `C:\Users\robemanuele\proj\pal\personal-agent-layer\donna\desktop`
