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

## Development server

Start the Vite dev server with hot module replacement:

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173). Changes to source files are reflected immediately in the browser.

The dev server serves `public/example-project.json` as the default workstream fixture. You can load a different workstream JSON file using the "Load workstream…" button in the app header.

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
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Type-check with `tsc` and build for production |
| `npm run preview` | Preview the production build locally |
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
