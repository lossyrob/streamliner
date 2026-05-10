# Developing Streamliner

## Prerequisites

- **Node.js** ≥ 20 (LTS recommended)
- **npm** ≥ 10 (ships with Node 20+)

## Setup

Clone the repository and install dependencies:

```bash
git clone git@github.com:lossyrob/streamliner.git
cd streamliner
npm install
```

## Development servers

Start the local API and Vite dev server together:

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173). Vite binds to `127.0.0.1` and proxies `/api/*` to the standalone local API at [http://127.0.0.1:4319](http://127.0.0.1:4319). `npm run dev` waits for the API health endpoint before starting Vite so initial dashboard requests do not race the API process. Frontend changes hot-reload through Vite without restarting the API worker.

Run the processes separately when you only need to restart one side:

```bash
npm run dev:api
npm run dev:web
```

Use `npm run api` for a non-watch API process. The API serves `GET /api/health`, graph loading, the session registry, trusted session signals, and `GET /api/sessions/events` for live session updates. Configure it with:

| Variable | Default | Description |
|----------|---------|-------------|
| `STREAMLINER_API_HOST` | `127.0.0.1` | API bind host |
| `STREAMLINER_API_PORT` | `4319` | API port used by direct callers and the Vite proxy |
| `STREAMLINER_GRAPH` | unset | Optional graph file path served by `GET /api/graph.json` |
| `STREAMLINER_LOG_LEVEL` | `info` | Minimum log level (`debug`/`info`/`warn`/`error`) |
| `STREAMLINER_LOG_DIR` | `~/.streamliner/state/logs` | Override the log file directory |
| `STREAMLINER_LOG_CONSOLE` | `1` | Set to `0` to suppress console mirroring of log entries |
| `STREAMLINER_STATE_ROOT` | `~/.streamliner/state` | Base directory for session launch settings and other APIs that do not have a more specific path override |
| `STREAMLINER_WORKSTREAM_REGISTRY` | `~/.streamliner/state/workstream-registry/workstreams.json` | Override the tracked workstream registry path |
| `STREAMLINER_WORKSTREAM_SOURCE_REGISTRY` | `~/.streamliner/state/workstream-registry/sources.json` | Override the workstream source registry path |
| `STREAMLINER_RECENTS_PATH` | `~/.streamliner/recent-graphs.json` | Override the legacy recents path |
| `STREAMLINER_PREVIEW_READONLY` | unset | Set to `1` for read-only preview API mode |
| `STREAMLINER_LAUNCH_CLAIMS_ROOT` | `~/.streamliner/state/launch-claims` | Override the launch-claim store root used by `createLaunchClaim` and the binding pass (see `docs/design/session-system.md` Launch Claim Lifecycle) |

When no `STREAMLINER_GRAPH` is set and no recent graph is available, `GET /api/graph.json` returns a 404. The dashboard handles that by falling back to Vite's static `public/example-project.json` fixture. Use the "Load workstream…" button to select a different workstream JSON file.

The API process writes structured JSON-lines logs to `~/.streamliner/state/logs/api-YYYY-MM-DD.log`. See [`docs/operations/logging.md`](docs/operations/logging.md) for the format, scope reference, and grep/jq recipes.

## Session launch defaults

Streamliner stores default Copilot CLI option tokens for terminal launches in
`~/.streamliner/state/session-launch-settings.json`. Configure them from
**Settings -> Session launch**. Fresh state defaults to `--yolo`; clearing the
editor and saving records an intentional empty default list.

Terminal PAW launches record the resolved args on the session. Relaunch and
restart command previews use recorded args first, including recorded empty args,
then current configured defaults for historical sessions without recorded args.
Streamliner appends its own `--resume=<session>` argument during relaunch, so do
not include `--resume` in the defaults.

## Worktree preview instances

Use a worktree preview when you want to inspect a PR without stopping the main
Streamliner instance running from your primary checkout:

```powershell
npm run preview:worktree -- --name pr-41 --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
```

The command starts background API and Vite processes, seeds an isolated
workstream registry from the graph, disables the session background worker, and
writes runtime state under `.streamliner-preview\<name>\`. Ports are persisted
in `.streamliner-preview\<name>\ports.json`, so restarting the same preview name
reuses the same URL when those ports are available. The default `readonly` mode
blocks mutating API requests so accidental clicks do not create launch artifacts
or edit preview registries. Use `--mode sandbox` only when you intentionally
want to exercise mutating flows against the isolated preview state.

When an agent starts a preview, it should add `--attached` and run the command
in a Copilot-managed background shell instead of detaching the server processes:

```powershell
npm run preview:worktree:attached -- --name pr-41 --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
```

Attached previews keep API/Vite as children of the launcher process, so Copilot
can track the background task and stop it when the task or session ends.

Check or stop a preview with:

```powershell
npm run preview:status -- --name pr-41
npm run preview:stop -- --name pr-41
```

## Copilot CLI Streamliner plugin

The Streamliner Copilot CLI plugin marks real Copilot CLI and Agency sessions as
trusted local sessions. It is installed through a local Copilot plugin
marketplace so normal `copilot` launches load the hook plugin from Copilot CLI's
plugin cache.

### Install from this checkout

Use the main checkout for the local marketplace registration. The Copilot CLI
stores the marketplace as an absolute path in its own config, so registering
from a temporary worktree will leave Copilot pointing at that worktree even
after the PR is merged.

```powershell
$repo = "C:\Users\robemanuele\proj\streamliner\streamliner"

git -C $repo switch main
git -C $repo pull --ff-only

copilot plugin marketplace add $repo
copilot plugin install streamliner@streamliner-local
copilot plugin marketplace list
copilot plugin list
```

`copilot plugin marketplace list` should show `streamliner-local` pointing at
the main checkout, and `copilot plugin list` should include
`streamliner@streamliner-local`.

If `streamliner-local` is already registered to an old worktree, remove and
re-add it from the main checkout:

```powershell
$repo = "C:\Users\robemanuele\proj\streamliner\streamliner"

copilot plugin uninstall streamliner
copilot plugin marketplace remove streamliner-local
copilot plugin marketplace add $repo
copilot plugin install streamliner@streamliner-local
copilot plugin marketplace list
copilot plugin list
```

### Refresh after editing the plugin

Copilot CLI caches installed plugin files. Reinstall the plugin after changing
files under `copilot-plugin\streamliner`:

```powershell
copilot plugin marketplace update streamliner-local
copilot plugin install streamliner@streamliner-local
```

For one-off development runs that should bypass the cache, launch Copilot with
the plugin directory directly:

```powershell
$repo = "C:\Users\robemanuele\proj\streamliner\streamliner"

copilot --plugin-dir (Join-Path $repo "copilot-plugin\streamliner")
```

Direct path installs with `copilot plugin install <absolute-path>` work today,
but Copilot CLI warns that direct installs are deprecated in favor of
`plugin@marketplace` installs.

### Remove or switch checkouts

The marketplace registration is stored in the Copilot CLI config, not in this
repository. Remove it before deleting the checkout it points to or switching the
`streamliner-local` marketplace to another checkout:

```powershell
copilot plugin uninstall streamliner
copilot plugin marketplace remove streamliner-local
```

Then register and install from the new checkout:

```powershell
$repo = "C:\path\to\other\streamliner-worktree"

copilot plugin marketplace add $repo
copilot plugin install streamliner@streamliner-local
```

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the local API and Vite dev server together |
| `npm run dev:api` | Start the local API in watch mode |
| `npm run dev:web` | Wait for the local API, then start only the Vite dev server with HMR |
| `npm run api` | Start the local API without watch mode |
| `npm run build` | Type-check with `tsc` and build for production |
| `npm run preview` | Preview the production build locally with the API running |
| `npm test` | Run tests once with Vitest |
| `npm run lint` | Run ESLint across the project |

## Project structure

```
src/
├── main.tsx                              # React entry point
├── App.tsx                               # Root component — state, data pipeline, layout
├── workstream-schema.ts                  # TypeScript types/enums for workstream JSON
├── workstream-view-model.ts              # Parser, validator, view-model builder
├── workstream-graph.ts                   # Dagre layout, transitive reduction, highlights
├── workstream-graph.test.ts              # Vitest tests for graph logic
├── streamliner-theme.css                 # Light Deep Ocean theme (all sl-* classes)
├── server/                               # Express local API, routes, and SSE event stream
├── session-registry/                     # File-backed session registry and observation worker
└── components/
    ├── WorkstreamCanvas.tsx              # React Flow graph wrapper
    ├── WorkstreamGraphNode.tsx           # Custom node renderers (task + gate)
    ├── NodeInspector.tsx                 # Selected node detail sidebar
    ├── OperationalStatusStrip.tsx        # Ready/in-flight/blocked/review counts
    └── WorkstreamHeader.tsx              # Title, badges, freshness, file loader
```

### Key directories

- **`src/`** — all application source code (flat layout for minimal import paths)
- **`public/`** — static assets served as-is (example workstream fixture, favicon)
- **`prototype/`** — original prototype code these modules were ported from (reference only)
- **`docs/`** — documentation assets (images, etc.)

## Data pipeline

The app transforms workstream data through a clean pipeline:

```
JSON string
  → parseWorkstreamDocument()    # strict validation, returns WorkstreamDocument
  → buildWorkstreamViewModel()   # derives operational queues and signals
  → buildWorkstreamGraphLayout() # dagre positions + highlight states
  → React Flow rendering         # interactive graph in the browser
```

Each layer is a pure function that can be tested independently.

## Testing

Tests use [Vitest](https://vitest.dev/) and cover the graph layout logic (transitive edge reduction, ancestor/descendant highlighting):

```bash
# Run once
npm test

# Watch mode
npx vitest
```

Test files live next to their source files (e.g., `workstream-graph.test.ts`).

## Building for production

```bash
npm run build
```

This runs `tsc -b` for type checking followed by `vite build`. Output goes to `dist/`.

To preview the production build:

```bash
npm run preview
```

## Workstream JSON format

Streamliner consumes workstream JSON documents conforming to `workstream-schema.ts`. Key structure:

```jsonc
{
  "schemaVersion": 1,
  "id": "my-workstream",
  "title": "...",
  "status": "active",           // active | blocked | completed
  "nodes": [
    {
      "id": "node-id",
      "type": "task",           // task | research | gate
      "status": "in-progress",  // planned | ready | in-progress | blocked | completed
      "attention": "focus",     // focus | watch | parked
      "dependsOn": ["other-node-id"],
      // ...
    }
  ],
  "repos": [...],
  "checkpoints": [...]
}
```

See `public/example-project.json` for a complete example and `src/workstream-schema.ts` for the full type definitions.
