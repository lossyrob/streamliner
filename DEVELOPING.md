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
