# `_proto/canvas` — Portfolio Canvas (prototype)

> Quick-and-dirty prototype that uses Streamliner's API server to give the
> portfolio canvas filesystem-backed position persistence.
>
> Explicitly configured local project. Single page. Will be promoted into a proper Streamliner
> feature later - at that point the contract that should survive is
> "portfolio document + positions overlay keyed by node/workstream anchor ID
> + atomic writes."

## What this is

A single static page (`index.html`) that loads portfolio data
from a configured local project and renders it as a draggable React
Flow canvas. Drag positions are auto-saved (1s debounce) to a
filesystem-backed positions file via API endpoints under
`/api/_proto/canvas/`.

This replaces the earlier `localStorage`-backed prototype with a durable
workspace for layout work. If you still use that standalone page, see
the migration instructions below.

## Project-configured paths

Set `STREAMLINER_PROTO_CANVAS_PROJECT_ROOT` in your ignored `.env` file or
process environment before starting the API. Use the directory containing
your project's `streamliner.json`, `workstreams`, and `shaping` artifacts.
An absolute path is recommended; a relative root is resolved from the API
process's working directory. Restart the API after changing the setting.

When the setting is absent or blank, all `/api/_proto/canvas/*` endpoints
return HTTP 503 with a configuration-required message. No project files are
read or written, and other Streamliner APIs remain available.

For an example root of `C:\work\example-project`, the default paths are:

| Resource | Path |
|---|---|
| Portfolio source (read-only) | `C:\work\example-project\portfolio\portfolio.json` |
| Portfolio state store (read/write) | `C:\work\example-project\portfolio\state\` |

The route reads `portfolio.path` and `portfolio.stateDir` from
`streamliner.json` in the configured project root.
Relative portfolio and state paths are resolved from that root; absolute
paths are used directly. If the config
is absent, the prototype falls back to `portfolio\portfolio.json` and
`portfolio\state`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/_proto/canvas/portfolio` | Returns the raw `portfolio.json` from the planning repo. |
| `GET` | `/api/_proto/canvas/positions` | Returns `{ path, positions: { id: { x, y, manuallyMoved, ts } } }`. Returns `{}` for `positions` if the file doesn't exist yet. |
| `PUT` | `/api/_proto/canvas/positions` | Legacy full-overlay upsert. Body: `{ positions: { id: { x, y, ... }, ... } }`. Merges entries over the current file and never deletes. |
| `PATCH` | `/api/_proto/canvas/positions` | Routine save path. Body: `{ upsert?: { id: { x, y, ... } }, remove?: [id] }`. Applies partial updates atomically. |
| `POST` | `/api/_proto/canvas/positions?method=patch` | `sendBeacon` unload fallback for the same partial update shape as `PATCH`. |
| `GET` | `/api/_proto/canvas/colors` | Returns `{ path, colors }` from the portfolio state directory. |
| `PUT` | `/api/_proto/canvas/colors` | Replaces the color overlay. |
| `GET` | `/api/_proto/canvas/terminal-active` | Returns `{ path, activeIds }` from the portfolio state directory. |
| `PUT` | `/api/_proto/canvas/terminal-active` | Replaces the active terminal marker set. |

Mounted in `src/server/app.ts`. The static page is served from
`/_proto/canvas/` via `express.static()` against the `_proto/canvas/`
folder.

## How to run

```powershell
cd C:\work\streamliner
$env:STREAMLINER_PROTO_CANVAS_PROJECT_ROOT = "C:\work\example-project"
npm run api          # starts the API server on STREAMLINER_API_PORT (default 4319)
# then open:
start http://127.0.0.1:4319/_proto/canvas/
```

The page works without the Vite dev server because it's served directly
from the API process. If you want to run alongside `npm run dev`, the
URL is the same — Vite's port serves the React app, the API port serves
this prototype.

## How position persistence works

1. User drags a node in React Flow.
2. `onNodeDragStop` updates the in-memory `pinnedCache` and calls
   `saveDebounced()` which schedules a save 1 second later.
3. The save status indicator in the top-left controls panel shows
   `● change pending — saving in 1s`.
4. After 1s of inactivity, the changed entries are `PATCH`ed to
   `/api/_proto/canvas/positions`. Status flips to
   `● saving N positions…` then `● saved N · HH:MM:SS`.
5. The server writes to `portfolio\state\positions.json.tmp` then
   renames over the live file (atomic on Windows + Unix).
6. On page reload the page re-fetches portfolio + positions from the
   API; pinned positions take precedence over ELK-computed positions.
7. On `beforeunload` (tab close), pending saves are flushed via
   `navigator.sendBeacon` as a best-effort last-chance write.

The positions file also stores `ws:<workstreamId>` anchors. A drag of any
wave records the workstream's current top-left alongside the exact node pin.
On later portfolio reconciliation, if wave IDs are added or renamed, the
canvas translates the current ELK layout back near the saved workstream
anchor before applying exact per-node pins. This keeps a workstream's visual
location stable even when a candidate becomes a multi-wave workstream.

## Migrating positions from the older localStorage prototype

If you had pinned positions in the planning-repo
`portfolio-canvas.html` (browser localStorage), open that page, click
the **Export N pinned** button (green button under the existing Reset
button), save the downloaded JSON to:

```
C:\work\example-project\portfolio\state\positions.json
```

Reload the prototype — your positions are loaded. The format is
identical between the two prototypes.

## What promotes well

When this graduates to a real Streamliner feature, the parts worth
keeping:

- **Positions contract** (portfolio, GET positions, PATCH positions)
  generalized to per-document positions overlays
- **Atomic write pattern** (tmp + rename) for positions
- **Debounced save with visible status indicator** + `sendBeacon`
  fallback on unload
- **Pinned-overlay-on-top-of-auto-layout** model (ELK computes a
  baseline, pinned positions override per-node)
- **Single-file React Flow + ELK + htm** prototyping pattern (no build
  step, edit and reload)

What needs to change:

- **First-class project selection** — select registered projects rather than
  one prototype root supplied through the environment
- **TypeScript + Vite-built bundle** instead of esm.sh imports for
  production
- **Multi-document support** — register multiple canvases, switch
  between them
- **User identity** — multi-user means per-user overlays + a shared
  base; today it's single-user and unauthenticated
- **Undo / named snapshots** — currently every save overwrites the prior
  state; no history beyond git on `positions.json`

## Files

```
_proto/canvas/
├── README.md                      ← this file
├── index.html                     ← the canvas page (~60KB, no build step)
└── wave-progress-prototype.html   ← static design sheet for wave progress markers
src/server/routes/
└── proto-canvas.ts                ← Express router for the prototype endpoints
C:\work\example-project\portfolio\state\
└── positions.json / colors.json / terminal-active.json
```

The static-file middleware mount lives in
`src/server/app.ts` (search for `_proto/canvas`).
