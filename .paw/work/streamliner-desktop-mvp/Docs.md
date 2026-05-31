# Streamliner Desktop MVP — Notifications

## Overview

Streamliner Desktop turns orchestrator pings into native Windows toasts plus a
durable, linkable feed of cards, supplanting the dbagent orchestrator's prior
`toasty.exe` usage. A producer (e.g. the orchestrator) calls the `streamliner
notify` CLI; the local Streamliner API validates, enriches, and persists the
event and re-broadcasts it over SSE; the desktop app raises a native toast and
adds a feed card. The differentiator versus `toasty.exe` is a runtime-generated
badge that encodes **both** the workstream (registry color + short-name
monogram) **and** the event kind (a corner chip/glyph) in one glance, so the
producer no longer maintains per-workstream swatch PNGs or hand-built title
prefixes.

The work spans five phases: the API + store + SSE (1), the `streamliner notify`
CLI (2), a portable Rust core crate (3), the Tauri shell + feed UI (4a), and
native toasts + protocol activation (4b).

## Architecture and Design

### High-Level Architecture

```
producer --> `streamliner notify` (CLI) --> POST /api/notifications
  --> enrich (workstream registry) --> append NDJSON store --> publish SSE
  --> desktop SSE client --> { native toast (Windows) , feed card (always) }
toast click --> streamliner://notification/<id> --> resolve GET /api/notifications/:id --> open link
```

- **Server** (`src/server/`): an Express router mounted on the local API.
  `notification-store.ts` is a serialized append-only NDJSON store assigning
  monotonic ids; `notification-enrichment.ts` resolves workstream color/short
  name and derives a dashboard link; `notification-events.ts` is the id-coupled
  SSE stream; `routes/notifications.ts` is the ingress + list + get-by-id.
- **CLI** (`src/cli/`): a cwd-independent launcher bundled to
  `dist/cli/streamliner.mjs`; `commands/notify.ts` POSTs to the API.
- **Desktop core** (`desktop/core`, crate `streamliner-core`): portable,
  cargo-tested domain logic — model, SSE parser, toast-replay dedupe, deep-link
  validation, badge renderer, ToastGeneric XML builder.
- **Desktop shell** (`desktop/src-tauri`): Tauri v2 tray app — SSE client,
  tray/window, commands, and Windows-only toast + activation.

### Design Decisions

- **Shared contract as the keystone.** `src/notification-contract.ts` is the
  single source of truth for severities, event kinds, link rules, and SSE event
  names; the Rust model mirrors it. Phases were parallelizable only because this
  was pinned first.
- **In-memory SSE cursor (no toast storm).** The desktop holds `Last-Event-ID`
  in memory only and never persists it, so a relaunch always cold-connects and
  receives a `snapshot` (which is never toast-eligible). Combined with "only
  `notification.created` above the dedupe high-water mark toasts," a batch of
  events accumulated while the app was closed appears as feed cards with **no**
  toast burst.
- **Toasting is best-effort.** A toast/XML/registry failure is logged and never
  blocks the frontend feed emit — native notification failure must not break the
  core app.
- **Precise id resolution for cold-start activation.** `listSince` returns the
  newest `limit` records (`slice(-limit)`), so an `afterId=id-1&limit=1` trick
  is unsound. A dedicated `GET /api/notifications/:id` resolves an arbitrary
  (possibly old) id when a toast is clicked from the Action Center after the app
  exited. The route is digit-guarded (`next()` fall-through on non-numeric) so
  it can never shadow `/api/notifications/events`.
- **Portable core / thin platform shell.** All logic that can be tested off
  Windows lives in `streamliner-core` (including the toast XML string builder);
  only the WinRT `Show` and the HKCU registration are `#[cfg(windows)]`, with
  no-op stubs elsewhere so CI stays portable.
- **Per-user, no-admin registration.** AUMID and the `streamliner://` scheme are
  registered under `HKCU` at first run (idempotent), matching the unpackaged
  desktop story; no installer or elevation required for the MVP.

### Integration Points

- **Workstream registry** for enrichment (color, short name, derived link).
- **Read-only preview guard**: `POST /api/notifications` is mounted before the
  guard (localhost-only write surface) so a read-only preview still receives
  orchestrator notifications while registry mutations stay blocked.
- **Dashboard discovery** via `GET /api/client-config` (`{ dashboardBaseUrl }`).

## User Guide

### Prerequisites

- The local Streamliner API running (default `http://127.0.0.1:4319`).
- For toasts/feed: the desktop app (Windows for native toasts).
- `streamliner` CLI on `PATH` (`npm run build:cli` then `npm link`).

### Basic Usage

```powershell
streamliner notify --title "PR Created" --body "<node>: <detail>" `
  --workstream <workstream-id> --event pr-created
```

The badge (color + monogram + event chip) is implicit from `--workstream` and
`--event`. See `docs/operations/notifications.md` for the full flag table and
the `toasty.exe` migration mapping.

### Advanced Usage

- `--project-key` disambiguates a `--workstream` id that exists under multiple
  projects (otherwise the event is created with a `warnings[]` entry and null
  workstream fields).
- `--link` supplies an explicit absolute `http(s)`/`file` deep link; otherwise
  the server derives one from the workstream (+ `--node`).
- Override endpoints with `STREAMLINER_API_BASE_URL` /
  `STREAMLINER_DASHBOARD_BASE_URL`.

## API Reference

Authoritative endpoint/flag/field tables live in
`docs/operations/notifications.md`. Reusable surfaces:

- **`streamliner-core`**: `model::{Notification, Severity, EventKind}`;
  `sse::SseParser`; `dedupe::ToastDedupe`; `deeplink::openable_link`;
  `badge::{render_badge, render_badge_cached, badge_cache_path,
  derive_display_monogram}`; `toast_xml::{build_toast_xml, file_uri,
  ToastContent}`.
- **Server**: `GET /api/notifications/:id` -> `{ notification }` (404/400 on
  miss/invalid).

### Configuration Options

| Variable | Effect |
| --- | --- |
| `STREAMLINER_API_BASE_URL` | API base for the CLI and desktop (default `http://127.0.0.1:4319`). |
| `STREAMLINER_DASHBOARD_BASE_URL` | Dashboard base for derived links (default discovered, then `http://127.0.0.1:5173`). |
| `STREAMLINER_STATE_ROOT` | Controls the NDJSON store location. |

## Testing

### How to Test (human)

1. Start the API and the desktop app.
2. `streamliner notify --title "ONLINE" --body "..." --workstream <id> --event online`.
3. Expect a native toast whose logo is the workstream badge with the event chip,
   plus a new feed card.
4. Click the toast (popup **and** Action Center, including after quitting the
   app) — the correct dashboard link opens via protocol activation.
5. Emit several events while the app is closed, then relaunch — expect feed
   cards only, **no** toast burst.

### Edge Cases

- Ambiguous unqualified `workstreamId` -> created with null workstream fields +
  a `warnings[]` entry (never silently guessed).
- Non-absolute / disallowed-scheme links -> `400 invalid_link` at the server and
  rejected client-side before opening.
- Invalid/zero/foreign activation URLs -> ignored by `parse_notification_id`.
- Control characters in title/body -> sanitized before XML so a toast can't be
  dropped by `LoadXml`.

## Limitations and Future Work

- **Native toast + click-through behavior is Windows-only and verified
  manually** — the WinRT `Show`, Action Center retention, and cold-start
  activation routing are not headlessly testable in CI (only `cargo build` and
  the portable core/parse tests run automatically).
- The store is **append-only with no rotation** (acceptable for current event
  volume; revisit if producers become chatty).
- Each `streamliner notify` pays Node cold-start (~80-150 ms) vs `toasty.exe`'s
  sub-10 ms; fine for orchestration pings, documented so it isn't misattributed.
- Updating the planning-repo orchestrator prompt to call `streamliner notify`
  instead of `toasty.exe` is a follow-up in that repository.
