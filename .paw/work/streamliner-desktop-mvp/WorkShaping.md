# WorkShaping: Streamliner Desktop MVP

> Ruthlessly scoped MVP for a Streamliner Desktop notification companion that
> turns orchestrator-emitted pings into Windows toasts plus a durable, linkable
> feed, routed through the Streamliner local API. Must be able to supplant the
> `toasty.exe` usage in the dbagent orchestrator prompt.

## Problem statement

Streamliner workstream orchestrator sessions currently shell out to the
external `toasty.exe` CLI to surface lifecycle events (ONLINE, PR Created, PR
Approved, Issue Closed, Reconciled, DONE) as Windows toasts. That path is:

- **Ephemeral** — a toast appears and is gone; there is no durable, reviewable
  history of what an orchestrator reported, and no way to click through to the
  relevant workstream/node in the local dashboard.
- **External** — it depends on a third-party binary unrelated to Streamliner,
  with its own icon/preset model and no awareness of Streamliner concepts
  (workstreams, nodes, sessions, colors, the local dashboard).
- **One-directional and unstructured** — the orchestrator passes a title +
  message + icon path; nothing is captured as structured Streamliner data.

**Who benefits:** the portfolio operator / orchestrator-watcher (the human
running one or many workstream orchestrators) gets a Streamliner-native
notification surface: toasts when something happens *and* a persistent feed of
cards they can scroll, triage, and click through to the local dashboard.

**What this MVP proves:** the full vertical loop —
`streamliner notify ...` → local API persists + emits SSE → desktop app raises a
per-workstream-iconed toast and adds a durable feed card → click opens the right
local dashboard page. Once that single path works end to end, everything else
(auto-conditions, richer rules, actions, phone push) is additive.

## Scope boundaries

### In scope (the ruthless MVP)

1. **`streamliner` CLI (first shape of issue #40), with a single `notify`
   subcommand.** This is the first concrete piece of the #40 "distribution
   spine over the daemon/local API" thesis: config/runtime-root discovery, a
   thin local-API client, and a clean machine-friendly command. Only `notify`
   is implemented now; the command structure is created so `doctor`,
   `sessions`, `launch-node`, etc. can be added later.
2. **`POST /api/notifications` ingress on the existing Streamliner local API.**
   Validates and persists a notification, assigns an id, emits it on an SSE
   stream. The API is the source of truth (per #40).
3. **`GET /api/notifications` (list) + `GET /api/notifications/events` (SSE).**
   Mirrors the existing `session-events` / `workstream-events` SSE pattern
   (replay buffer + heartbeat + `Last-Event-ID` resume).
4. **Durable notification store** under `~/.streamliner/state/` (respecting
   `STREAMLINER_STATE_ROOT`), so notifications survive API restarts and are
   replayable into the feed.
5. **Desktop app (Tauri v2 + React)** that is a thin SSE consumer:
   - Connects to `/api/notifications/events`, renders a **feed of cards** (one
     per notification) with workstream color, severity, title, body, timestamp,
     and a deep link.
   - Raises a **native Windows toast** for each newly-arriving notification,
     using **custom ToastGeneric toast XML** so a per-notification **badge**
     (workstream color + short-name monogram + event-kind chip/glyph) appears on
     the toast (richer than toasty's static swatch icon).
   - **Toast click and card click** open the notification's deep link (the
     local dashboard workstream/node page) in the default browser.
   - System tray presence (background-resident, like donna desktop).
6. **`core` Rust crate with zero Tauri dependency** holding all testable logic
   (notification model, SSE line parsing, toast-XML construction, badge
   rendering, deep-link resolution, id-aware toast replay suppression). Tauri layer is shell + tray + toast emit + window only.
   (Mirrors donna desktop's proven core/shell split.)
7. **Migration mapping doc** in the streamliner repo: a table mapping each
   current orchestrator `toasty.exe` invocation to the equivalent
   `streamliner notify ...` invocation, so the orchestrator prompt can be
   reworded in a follow-up. This PR does NOT edit the planning-repo prompt.
8. **Documentation** of the "desktop app must be running for a live toast"
   assumption and the persist-then-replay behavior.

### Explicitly out of scope (deferred, additive later)

- **Server-side automatic / condition-based notifications** (watching workstream
  or session SSE and auto-emitting). Deferred entirely; the emit pipeline is the
  MVP. A later phase adds a rules layer that POSTs to the same endpoint.
- **Server-side fallback toast** when no desktop consumer is connected. MVP
  requires the desktop app to be running for a live toast; if it is down, the
  notification still persists and appears in the feed on next launch.
- **Desktop auto-launch** on first notification.
- **Toast action buttons** (relaunch / acknowledge / mute), per-workstream mute
  or notification policies, read/unread state beyond what the feed trivially
  needs, filtering.
- **ntfy / phone push bridge.**
- **Other `streamliner` CLI subcommands** (`doctor`, `server`, `sessions`,
  `launch-node`, `copilot ...`) from #40.
- **toasty-compatible argument shim.** The CLI is clean-sheet; the orchestrator
  prompt will be reworded rather than kept arg-compatible.
- **Surfacing notifications in the web dashboard.** The API design leaves room
  for it, but the MVP consumer is the desktop app only.
- **Embedded in-app webview** for the dashboard (MVP opens the system browser).
- **Cross-platform** (Windows-only for the toast layer; `core` stays portable
  for tests).

## CLI design (`streamliner notify`)

Clean-sheet, structured flags that map directly to feed-card fields:

```
streamliner notify
  --title    <text>            (required) toast + card title
  --body     <text>            (required) toast + card body
  --workstream <id>            (optional) workstream short-id; drives color/badge + deep link
  --event    <kind>            (optional, default generic) structured event kind; drives
                               badge event-chip/glyph (online|pr-created|pr-approved|
                               issue-closed|reconciled|done|generic)
  --project-key <key>          (optional) disambiguates --workstream when the same short-id
                               exists under multiple projects; refines deep link
  --severity <info|warn|error> (optional, default info) card accent + toast styling
  --link     <url>             (optional) explicit deep link; MUST be an absolute
                               http(s)/file URL; else derived from workstream/node
  --node     <id>              (optional) node id; refines deep link + card
  --session  <id>             (optional) session id; refines deep link + card
```

> Deferred (not in MVP): `--dedupe-key`. Producer-level duplicate collapse is out
> of scope for the MVP — see the dedupe note under Edge cases. The desktop still
> performs id-aware toast replay suppression so SSE reconnect never double-toasts.

Behavior:
- Resolves the local API base URL the same way the dashboard/server do
  (default `http://127.0.0.1:4319`, env-overridable).
- POSTs a JSON notification to `/api/notifications`.
- Exits non-zero with a clear message if the API is unreachable (orchestrator
  can decide whether to treat that as fatal). Does NOT itself raise a toast —
  the desktop app owns rendering.
- Deep link: an explicit `--link` (absolute `http`/`https`/`file` URL) is sent
  as-is. When `--link` is absent, **the server enriches** the deep link from the
  workstream registry using the dashboard route shape
  `/workstreams/<projectKey>/<workstreamId>[/nodes/<nodeId>]` — the CLI does not
  resolve `projectKey` itself. On an ambiguous unqualified workstream id, the
  server does not guess and leaves the link null (pass `--project-key` to
  disambiguate). See the resolved Open questions.

### Notification schema (API contract)

```jsonc
{
  "id": 42,                       // server-assigned, monotonic (for SSE Last-Event-ID)
  "createdAt": "ISO-8601",        // server-assigned
  "title": "string",              // required
  "body": "string",               // required
  "severity": "info|warn|error",  // default info
  "workstreamId": "string|null",
  "projectKey": "string|null",      // resolved/disambiguating project for the workstream
  "workstreamColor": "6754d7|null", // resolved hex (no #) for badge field, if known
  "workstreamShortName": "string|null", // resolved short name for badge monogram, if known
  "eventKind": "online|pr-created|pr-approved|issue-closed|reconciled|done|generic", // default generic
  "nodeId": "string|null",
  "sessionId": "string|null",
  "link": "string|null",          // resolved absolute deep-link URL
  "source": "cli"                 // reserved for future emitters (rules engine, etc.)
}
```

## Orchestrator toasty → streamliner notify mapping (for the migration doc)

| Current toasty usage | Equivalent `streamliner notify` |
|---|---|
| ONLINE toast w/ swatch icon + `<short> <name>: ...` title | `notify --workstream <id> --event online --title "ONLINE ..." --body "<coach message>"` |
| PR Created | `notify --workstream <id> --event pr-created --node <node> --title "PR Created" --body "<node title>: <detail>" --link <pr-or-node>` |
| PR Approved | `notify --workstream <id> --event pr-approved --node <node> --title "PR Approved" --body "..."` |
| Issue Closed | `notify --workstream <id> --event issue-closed --node <node> --title "Issue Closed" --body "..."` |
| Reconciled | `notify --workstream <id> --event reconciled --title "Reconciled" --body "..."` |
| DONE | `notify --workstream <id> --event done --title "DONE ..." --body "..."` |

The per-workstream icon, which toasty took as an explicit `--icon swatch.png`
path, becomes implicit: the desktop app renders a badge from the workstream
color + short name and the `--event` kind, so the orchestrator only passes
`--workstream <id> --event <kind>`.

## Rough architecture

```
Orchestrator session
  │  streamliner notify --workstream ws --title "PR Created" --body "..."
  ▼
streamliner CLI  ──HTTP POST /api/notifications──▶  Streamliner local API (4319)
                                                     │  validate → persist (state dir)
                                                     │  assign id → push to SSE buffer
                                                     ▼
                              GET /api/notifications/events (SSE, replay+heartbeat)
                                                     │
                                                     ▼
   Streamliner Desktop (Tauri v2)
     ├─ core crate (no Tauri dep): model, SSE parse, toast-XML build, link resolve, badge render, toast replay suppression
     ├─ SSE client → on new notification: build ToastGeneric XML w/ generated badge → show
     ├─ React feed panel: cards (color, severity, title, body, time) → click = open link
     ├─ toast click / card click → open deep link in default browser
     └─ system tray (background resident)
```

Reused existing infrastructure:
- SSE replay-buffer + heartbeat + `Last-Event-ID` pattern from
  `src/server/session-events.ts` / `workstream-events.ts`.
- State-root convention `~/.streamliner/state` (`STREAMLINER_STATE_ROOT`).
- Dashboard route shape for deep links.
- Color swatch PNGs under `public/streamliner-terminal-color-swatches/`.

## Edge cases and expected handling

| Case | Expected handling |
|---|---|
| Desktop app not running when notify fires | API still persists notification; no live toast; it appears in the feed (via list + SSE replay) when the app next launches. Documented assumption. |
| API not running when CLI fires | CLI exits non-zero with a clear, actionable error. No silent success. |
| SSE disconnect / app restart | App reconnects with `Last-Event-ID`; server replays missed notifications from the buffer; list endpoint backfills anything older than the buffer. |
| Unknown / missing workstream color | Toast + card fall back to a default Streamliner icon/accent; no failure. |
| Missing `--link` and insufficient ids to derive one | Card shows with no clickable link (or links to dashboard root); no failure. |
| Ambiguous `--workstream` (same short-id under multiple projects, no `--project-key`) | Server does not guess: persist the notification but leave `projectKey`/color/short-name/derived link null and return a validation warning advising `--project-key`. |
| Duplicate notification | MVP defers producer-level collapse (no `dedupeKey`). The desktop performs id-aware toast replay suppression so SSE reconnect never re-toasts; repeat producer notifications stack as distinct cards. |
| Very long title/body | Toast truncates per OS limits; full text retained in the card. |
| Malformed POST body | API returns 400 with validation detail; CLI surfaces it. |
| Notification with no workstream (generic) | Allowed; renders with a generic badge, no deep link unless `--link` given. |
| State store grows unbounded | MVP decision: append-only NDJSON store with no rotation (the complete on-disk store guarantees gap-free SSE replay/backfill). Bounded retention is deferred; operational cleanup noted as a known limitation. |

## Codebase fit / reuse opportunities

- **SSE**: model `/api/notifications/events` on the existing event-stream classes
  (replay buffer, heartbeat interval, client registry, `Last-Event-ID`). Strong
  reuse; do not invent a new SSE mechanism.
- **Routes**: add `src/server/routes/notifications.ts` + a store module, wire in
  `src/server/app.ts` alongside the other routers and the SSE no-buffer path
  list (the `path.startsWith(.../events)` guard).
- **State paths**: reuse the `STREAMLINER_STATE_ROOT ?? ~/.streamliner/state`
  resolution used across server modules.
- **Desktop app**: greenfield in this repo, but the **donna desktop** Tauri v2
  layout is the template — `core` crate with zero Tauri dep (unit-tested with
  `cargo test` on any platform), `src-tauri/src` for shell/tray/toast/window,
  React frontend for the feed. Custom WinRT toast XML follows toasty's approach
  (toast XML w/ image) but implemented in Rust via the `windows` crate.
- **Tests**: server side uses existing vitest + supertest patterns
  (`app.test.ts`); desktop `core` uses `cargo test`.

## Critical analysis (value / tradeoffs)

- **Why route through the API instead of desktop-direct?** Aligns with #40
  (daemon/API is source of truth, CLI + app are thin), reuses SSE infra, makes
  notifications durable independent of the app, and leaves room for the web
  dashboard or a future rules engine to be additional producers/consumers. Cost:
  the app must be running for a *live* toast — accepted, since toasts are the
  transient surface of a durable feed.
- **Why full WinRT toast-icon parity now (not fast-follow)?** The orchestrator
  deliberately uses per-workstream color swatches to tell workstreams apart at a
  glance; losing that on day one would be a visible regression vs toasty. It
  also forces us to solve toast-XML + toast-click activation early, which is the
  riskiest desktop seam — better to confront it in the MVP than retrofit.
- **Build vs modify:** server changes are additive (new route + store + SSE),
  low blast radius. The desktop app is net-new but follows a proven template.
- **Biggest risk concentration:** the desktop seams — WinRT toast XML rendering,
  toast-click → app activation → open-link handoff, SSE reconnect/replay
  correctness. Planning + rubber-ducking should focus here.

## Failure modes of the designed fix (to expand in planning)

1. **Toast click activation handoff fails** (toast clicked but app/launcher
   doesn't receive the activation argument, or the link doesn't open). Classic
   WinRT toast-activation pitfall on Windows; needs an explicit activation
   strategy.
2. **Lost notifications across app downtime / SSE gaps** if replay buffer is too
   small and the list endpoint backfill is incomplete — the feed silently misses
   events. Need buffer + list to jointly guarantee no gaps.
3. **Duplicate / double toasts** if SSE replay re-delivers already-shown
   notifications after reconnect (dedupe must be id-aware, not just key-aware).
4. **Workstream→deep-link / projectKey resolution wrong**, producing dead links
   — undermines the core "click through" value.
5. **State store unbounded growth** or corruption on concurrent writes (multiple
   orchestrators emitting at once).
6. **Toast icon path resolution** depends on swatch PNGs the app can read at a
   stable absolute path; brittle if packaged/installed differently than dev.
7. **CLI exit-code semantics** mislead the orchestrator (e.g., treating a queued
   persist as failure, or a failure as success).

## Recurrence (where this class of problem shows up again)

- Every future `streamliner` CLI subcommand (#40) re-hits **API discovery, auth
  /trust, machine-readable output, exit-code semantics** — so getting the CLI
  client + API-base resolution right now pays forward.
- Every future notification **producer** (rules engine, web dashboard, MCP)
  re-hits the **schema + dedupe + SSE-replay** contract — so the API contract is
  the durable interface to get right.
- Every future desktop **consumer surface** (actions, mute, filters) builds on
  the **core/shell split + toast activation** — so the activation + core
  boundary decisions are load-bearing.

## Open questions for planning

> Status: all resolved during planning (see ImplementationPlan.md). Retained here
> with their resolutions for traceability.

1. **projectKey resolution:** RESOLVED — the **server enriches** from the
   workstream registry (it owns the registry). The CLI sends `--workstream` (and
   optional `--project-key`); the server resolves color, short name, and the
   deep link. On ambiguous unqualified short-id, the server does not guess (null
   enrichment + warning).
2. **Dedupe location & policy:** RESOLVED — producer-level dedupe (`dedupeKey`)
   is **deferred** from the MVP. The desktop performs id-aware toast replay
   suppression so SSE reconnect never double-toasts; repeat producer
   notifications stack as distinct cards.
3. **Store format & cap:** RESOLVED — **append-only NDJSON** with no rotation in
   the MVP; the complete on-disk store guarantees gap-free SSE replay/backfill.
   Bounded retention is deferred (documented limitation).
4. **Toast activation mechanism:** RESOLVED — **protocol activation**
   (`streamliner://notification/<id>` + per-user AUMID), validated by the
   activation spike to survive popup click, Action Center click, and
   post-sender-exit. Custom ToastGeneric XML is shown via the raw `windows`
   crate; click is routed through Tauri single-instance/open-url.
5. **Tooling baseline:** does CI / the repo already build Rust/Tauri, or does
   this introduce a new toolchain + build step (and how is it gated so it
   doesn't break the existing `npm run build`/test)?
6. **CLI packaging/location:** where does the `streamliner` CLI live and how is
   it invoked in the MVP (npm bin script under this repo vs standalone)? Keep it
   minimal but consistent with #40's eventual packaging.
7. **Swatch icon availability to the app:** how the desktop app locates the
   color-swatch PNGs (copy into app assets vs read from repo `public/`).

## Session notes (key decisions)

- **Routing:** notifications route **through the local API** (POST + list +
  SSE), desktop app is a **thin SSE consumer**. Chosen over desktop-direct to
  align with issue #40 and reuse existing SSE infra.
- **CLI identity:** the MVP CLI is the **first shape of the `streamliner` CLI
  from issue #40**, implementing only `notify` now but establishing the command
  structure / API-client / config-discovery patterns.
- **CLI args:** **clean-sheet** structured flags (`--title --body --workstream
  --event --project-key --severity --link --node --session`); **no toasty-compat
  shim**. The orchestrator prompt will be reworded (separate follow-up), so we are
  unconstrained by toasty's UX.
- **Auto-conditions:** **deferred entirely.** MVP = emit pipeline + toast +
  feed.
- **App-down behavior:** **require the desktop app running** for a live toast;
  if down, the notification **persists and shows in the feed on launch**.
  Documented assumption (no server fallback toast, no auto-launch).
- **Toast fidelity:** **invest in custom ToastGeneric toast XML now** for
  per-notification badges (workstream color + monogram + event chip — richer than
  toasty's static swatch), accepting the extra work because it de-risks the
  toast-activation seam and is the core differentiator over toasty.
- **Supplant scope:** this PR delivers **full equivalent capability + a
  toasty→streamliner-notify migration mapping doc**; **editing the orchestrator
  prompt** in the planning repo is a **separate follow-up** (keeps this PR inside
  streamliner).
- **Structure discipline:** **`core` Rust crate with zero Tauri dependency**
  holds all testable logic; Tauri is shell only (donna desktop template).
```
