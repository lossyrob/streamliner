# `_proto/canvas` — DBAgent Portfolio Canvas (prototype)

> Quick-and-dirty prototype that uses Streamliner's API server to give the
> DBAgent portfolio canvas filesystem-backed position persistence.
>
> Hard-coded paths. Single page. Will be promoted into a proper Streamliner
> feature later — at that point the contract that should survive is
> "portfolio document + positions overlay keyed by node ID + atomic
> whole-file replace."

## What this is

A single static page (`index.html`) that loads the DBAgent portfolio data
from a hard-coded planning-repo file and renders it as a draggable React
Flow canvas. Drag positions are auto-saved (1s debounce) to a
filesystem-backed positions file via three new API endpoints under
`/api/_proto/canvas/`.

This replaces the previous `localStorage`-backed prototype that lived in
the planning repo at
`C:\Users\robemanuele\proj\planning\planning\streamliner\dbagent\deps-4.7\portfolio-canvas.html`.
That file remains usable as the standalone fallback; this prototype is
the durable workspace for layout work.

## Hard-coded paths

| Resource | Path |
|---|---|
| Portfolio source (read-only) | `C:\Users\robemanuele\proj\planning\planning\streamliner\dbagent\deps-4.7\portfolio.json` |
| Positions store (read/write) | `_proto/canvas/state/positions.json` (committed to streamliner repo so layout work persists across machines) |

Both paths are baked into `src/server/routes/proto-canvas.ts`. To repoint
the prototype at a different portfolio, edit those two constants. When
this graduates, both should become arguments / config.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/_proto/canvas/portfolio` | Returns the raw `portfolio.json` from the planning repo. |
| `GET` | `/api/_proto/canvas/positions` | Returns `{ path, positions: { id: { x, y, manuallyMoved, ts } } }`. Returns `{}` for `positions` if the file doesn't exist yet. |
| `PUT` | `/api/_proto/canvas/positions` | Body: `{ positions: { id: { x, y, ... }, ... } }`. Atomic whole-file replace (write to `.tmp`, rename). Light validation: ignores entries without numeric `x`/`y`. |

Mounted in `src/server/app.ts`. The static page is served from
`/_proto/canvas/` via `express.static()` against the `_proto/canvas/`
folder.

## How to run

```powershell
cd C:\Users\robemanuele\proj\streamliner\streamliner
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
4. After 1s of inactivity, the cache is `PUT` to
   `/api/_proto/canvas/positions`. Status flips to
   `● saving N positions…` then `● saved N · HH:MM:SS`.
5. The server writes to `_proto/canvas/state/positions.json.tmp` then
   renames over the live file (atomic on Windows + Unix).
6. On page reload the page re-fetches portfolio + positions from the
   API; pinned positions take precedence over ELK-computed positions.
7. On `beforeunload` (tab close), pending saves are flushed via
   `navigator.sendBeacon` as a best-effort last-chance write.

## Migrating positions from the older localStorage prototype

If you had pinned positions in the planning-repo
`portfolio-canvas.html` (browser localStorage), open that page, click
the **Export N pinned** button (green button under the existing Reset
button), save the downloaded JSON to:

```
C:\Users\robemanuele\proj\streamliner\streamliner\_proto\canvas\state\positions.json
```

Reload the prototype — your positions are loaded. The format is
identical between the two prototypes.

## What promotes well

When this graduates to a real Streamliner feature, the parts worth
keeping:

- **Three-endpoint contract** (portfolio, GET positions, PUT positions)
  generalized to per-document positions overlays
- **Atomic write pattern** (tmp + rename) for positions
- **Debounced save with visible status indicator** + `sendBeacon`
  fallback on unload
- **Pinned-overlay-on-top-of-auto-layout** model (ELK computes a
  baseline, pinned positions override per-node)
- **Single-file React Flow + ELK + htm** prototyping pattern (no build
  step, edit and reload)

What needs to change:

- **No more hard-coded paths** — accept portfolio + positions paths from
  config or query string
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
└── state/
    └── positions.json             ← committed; created on first save
src/server/routes/
└── proto-canvas.ts                ← Express router for the three endpoints
```

The static-file middleware mount lives in
`src/server/app.ts:~250` (search for `_proto/canvas`).
