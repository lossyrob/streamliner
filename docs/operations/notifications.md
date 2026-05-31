# Notifications

Streamliner emits operational notifications (workstream came online, a PR was
created or approved, an issue closed, a reconciliation finished, a workstream is
done) through a single local API surface. A producer such as the dbagent
orchestrator calls the `streamliner notify` CLI; the local API enriches and
persists the event and re-broadcasts it over SSE; the Streamliner Desktop app
shows it as a native toast and a durable feed card.

This replaces the previous `toasty.exe` usage: instead of the producer choosing a
swatch PNG icon and hand-building a title prefix, the producer passes
`--workstream <id>` and an `--event` kind, and the desktop resolves the
per-workstream color + monogram and the event-kind chip into one badge.

## API surface

All endpoints are served by the local Streamliner API (default
`http://127.0.0.1:4319`, override with `STREAMLINER_API_BASE_URL`).

| Method / Path | Purpose |
| --- | --- |
| `POST /api/notifications` | Create a notification. Validates and enriches the request, persists it, and publishes it over SSE. Returns `201 { notification, warnings? }`. |
| `GET /api/notifications?afterId=<id>&limit=<n>` | List persisted notifications in ascending id order. `afterId` is a strict (`>`) cursor; `limit` caps the count. Returns `{ notifications: [...] }`. |
| `GET /api/notifications/:id` | Resolve a single persisted notification by id. Returns `200 { notification }`, `404 not_found` for an unknown id, or `400 invalid_id` for a non-positive id. Used by desktop protocol activation to resolve `<id>` -> link on a cold start. The route is digit-guarded so it never shadows `/api/notifications/events`. |
| `GET /api/notifications/events` | SSE stream (see below). |
| `GET /api/client-config` | Discovery: `{ dashboardBaseUrl }` so the desktop can compose links to the locally served dashboard (default `http://127.0.0.1:5173`, override with `STREAMLINER_DASHBOARD_BASE_URL`). |

`POST /api/notifications` is a localhost-only write surface and is therefore
**exempt from the preview read-only guard** — it remains available even when the
API runs in read-only preview mode, while registry mutations stay blocked.

### Request fields

`title` and `body` are required. All other fields are optional:

| Field | Notes |
| --- | --- |
| `severity` | `info` (default), `warn`, or `error`. |
| `eventKind` | One of `online`, `pr-created`, `pr-approved`, `issue-closed`, `reconciled`, `done`, `generic` (default). |
| `workstreamId` | Resolved against the workstream registry for color + short name + a derived dashboard link. |
| `projectKey` | Disambiguates a `workstreamId` that exists under more than one project. |
| `nodeId`, `sessionId` | Threaded onto the record; `nodeId` deepens the derived link to a node. |
| `link` | Explicit deep link. Must be an absolute `http`, `https`, or `file` URL; relative or other-scheme values are rejected (`400 invalid_link`). When omitted, the server derives a link from the workstream + node if it can. |
| `source` | Free-form producer tag (defaults to `cli`). |

### Enrichment

When `workstreamId` (optionally with `projectKey`) matches a registered
workstream, the server fills `workstreamColor`, `workstreamShortName`, and
`projectKey`, and composes a dashboard `link` (when one was not supplied). An
**ambiguous** unqualified `workstreamId` (same id under multiple projects) is not
guessed: the notification is still created, but with null workstream fields and a
`warnings[]` entry telling the caller to pass `--project-key`.

### SSE stream and toast suppression

`GET /api/notifications/events` is **id-coupled**: each live
`notification.created` event carries an SSE `id:` equal to the persisted record
id, so `Last-Event-ID` is a stable cursor.

- A **cold** client (no `Last-Event-ID`) receives one `snapshot` event carrying
  the recent backlog, then live `notification.created` events. A `snapshot`
  carries no SSE id and is **never toast-eligible** — it backfills the feed
  silently.
- A **reconnecting** client (with `Last-Event-ID`) gets only the strictly-newer
  `notification.created` records replayed from the durable store — no snapshot,
  no backlog burst.
- `heartbeat` events carry no id and never advance `Last-Event-ID`.

The desktop holds `Last-Event-ID` **in memory only** and never persists it across
process restarts, so a relaunch always cold-connects (snapshot, no toasts for the
backlog). Combined with "only `notification.created` is toast-eligible," this is
what prevents a toast storm when the app starts after a batch of events.

### Storage

Notifications are appended to an NDJSON file under the Streamliner state root
(`~/.streamliner/state/notifications/notifications.ndjson` by default; the state
root honors `STREAMLINER_STATE_ROOT`). Writes are serialized; ids are assigned
monotonically from the current maximum. The MVP store is append-only with **no
rotation** — acceptable for the expected event volume, but worth revisiting if
producers become chatty.

## CLI: `streamliner notify`

```
streamliner notify --title <text> --body <text> [options]
```

| Flag | Maps to | Notes |
| --- | --- | --- |
| `--title` | `title` | required |
| `--body` | `body` | required |
| `--workstream` | `workstreamId` | server resolves color + short name + link |
| `--project-key` | `projectKey` | disambiguates `--workstream` |
| `--severity` | `severity` | `info` \| `warn` \| `error` |
| `--event` | `eventKind` | see the enum above |
| `--link` | `link` | absolute `http(s)`/`file` URL only |
| `--node` | `nodeId` | |
| `--session` | `sessionId` | |

On success the CLI prints the created id and title and exits `0`. If the API is
unreachable it prints an actionable message naming the API base URL and exits
non-zero; an API error surfaces the API `code`/`error` and exits non-zero. The
CLI never raises a toast itself — it only talks to the API.

### Global install

The CLI is bundled to a single cwd-independent launcher so it can be called from
anywhere (the way a producer would call a standalone tool):

```powershell
npm run build:cli          # produces dist/cli/streamliner.mjs
npm link                   # or: npm install -g .
streamliner notify --title "ONLINE" --body "..." --workstream <id> --event online
```

**Known friction:**

- `streamliner notify` must be on `PATH` via npm's global bin directory.
  nvm-windows switches that bin directory per Node version, so a `streamliner`
  installed under one Node version disappears after `nvm use` of another. Node
  installed from the Microsoft Store can also block `-g` global installs. If the
  command is "not found," confirm `npm bin -g` is on `PATH` for the active Node.
- Each `streamliner notify` call pays Node's cold-start cost (~80-150 ms to spawn
  the runtime), versus toasty's sub-10 ms. A burst of events costs roughly a
  second of aggregate overhead. This is acceptable for orchestration pings but is
  documented so the slowdown is not misattributed.

## Streamliner Desktop app

The desktop app (`desktop/`) is a tray-resident Tauri v2 shell that turns the
SSE stream into native Windows toasts and a durable feed of cards. It is split
into a portable, cargo-tested core crate and a thin platform shell:

- **`desktop/core` (`streamliner-core`)** — portable domain logic with no Tauri
  or Windows dependency: the notification model, the SSE line parser, the
  toast-replay dedupe, deep-link scheme validation, the badge renderer, and the
  ToastGeneric XML builder. This is where the testable logic lives.
- **`desktop/src-tauri`** — the Tauri shell: SSE client, tray, window, the
  `open_link`/`list_notifications`/`notification_badge` commands, and the
  Windows-only toast + activation code.

### Badge

Every toast and feed card shows a runtime-generated badge that encodes **both**
the workstream (its registry color as the tile, the short-name monogram) **and**
the event kind (a corner chip + glyph: a check for `pr-approved`, a plus for
`pr-created`, an `=` for `reconciled`, and so on). The badge is rendered by
`core::badge` and cached as a PNG under the app data dir (`<app-data>/badges`);
the cache is never pruned because Windows reads the toast image lazily and keeps
it for the Action Center.

### Native toasts (Windows)

On each toast-eligible `notification.created`, the shell renders the badge and
composes a `ToastGeneric` XML document (`appLogoOverride` = badge PNG, two text
lines = title/body, an attribution line = `short-name / event-kind`) and shows it
via the raw `windows` crate (`XmlDocument::LoadXml` ->
`ToastNotificationManager::CreateToastNotifierWithId(AUMID)::Show`). Title/body
are sanitized of XML-invalid control characters and XML-escaped. Toast emission
is **best-effort**: a toast failure is logged and never blocks the feed update.

Toasts are Windows-only; on other platforms the feed UI works and toast emission
is a no-op.

### Protocol activation (click-through)

Each toast carries `activationType="protocol"` and
`launch="streamliner://notification/<id>"`. On first run the app idempotently
registers, in `HKCU` (no admin):

- the AUMID `com.streamliner.desktop` (`Software\Classes\AppUserModelId\...`),
  also set on the process via `SetCurrentProcessExplicitAppUserModelID`, so
  toasts carry the app identity; and
- the `streamliner://` scheme (`Software\Classes\streamliner\shell\open\command`)
  pointing at the app executable.

Clicking a toast (from the popup **or** the Action Center, even after the app
exited) launches the handler with the `streamliner://notification/<id>` URL. The
app parses the id, resolves it to its deep link via `GET /api/notifications/:id`,
and opens the link (subject to the `http`/`https`/`file` scheme allow-list).
Two routing paths are handled:

- **Warm** (app already running): the second launch is forwarded by
  `tauri-plugin-single-instance` to the running instance, which routes the URL.
- **Cold** (app not running): the OS launches the app with the URL in its own
  argv; the app reads it at startup and routes it once the runtime is up.

### Configuration

The shell resolves its API base from `STREAMLINER_API_BASE_URL` (default
`http://127.0.0.1:4319`) and the dashboard base from
`STREAMLINER_DASHBOARD_BASE_URL`, falling back to `GET /api/client-config` and
then `http://127.0.0.1:5173`.

## Migrating from `toasty.exe`

The dbagent orchestrator previously raised toasts with `toasty.exe`, choosing a
per-workstream swatch PNG icon and prefixing each title with
`<short-name> <workstream name>: `. With Streamliner notifications the producer
passes `--workstream <id>` and the matching `--event` kind instead; the desktop
renders the workstream color + monogram and the event chip into one badge, so the
swatch-PNG bookkeeping and the manual title prefix are no longer needed.

| Orchestrator event | `--event` value | Title (example) |
| --- | --- | --- |
| Workstream ONLINE | `online` | `ONLINE` |
| `pr_created` | `pr-created` | `PR Created` |
| `pr_approved` | `pr-approved` | `PR Approved` |
| `issue_closed` | `issue-closed` | `Issue Closed` |
| Reconciled | `reconciled` | `Reconciled` |
| Workstream DONE | `done` | `DONE` |

Example:

```powershell
streamliner notify `
  --title "PR Created" `
  --body "<node title>: <short informative detail>" `
  --workstream <workstream-id> `
  --event pr-created
```

The per-workstream badge is implicit: pass `--workstream <id>` and the app
resolves the color, the monogram (from the workstream short name), and the event
chip. Updating the planning-repo orchestrator prompt to call `streamliner notify`
in place of `toasty.exe` is a follow-up in that repository.
