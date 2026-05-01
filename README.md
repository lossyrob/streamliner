<p align="center">
  <img src="docs/streamliner.png" alt="Streamliner" width="600" />
</p>

# Streamliner

A command center for orchestrating multi-issue development work with AI coding agents. Streamliner provides an interactive dependency graph for planning, monitoring, and evolving bodies of work that span multiple GitHub issues and agent sessions.

## What it does

Streamliner loads a **workstream** — a structured JSON artifact describing a dependency graph of work items — and renders it as an interactive visualization.

- **Dependency graph** — dagre-layouted, transitive-reduced React Flow graph showing the full shape of the work
- **Selection highlighting** — click any node to see its ancestors and descendants highlighted, with everything else dimmed
- **Node inspector** — sidebar panel showing details for the selected node: status, type, attention state, dependencies, dependents, linked issue, and repository
- **Operational status strip** — at-a-glance counts of ready, in-flight, blocked, and review-pending items derived from the workstream view model
- **File loading** — load any workstream JSON file via the built-in file picker; validation errors are surfaced clearly

## Architecture

```
local API → workstream JSON → parseWorkstreamDocument() → buildWorkstreamViewModel() → buildWorkstreamGraphLayout() → React Flow
```

The data pipeline is fully layered:

| Layer | File | Responsibility |
|-------|------|----------------|
| **Schema** | `workstream-schema.ts` | TypeScript types and enums for the workstream document format |
| **View Model** | `workstream-view-model.ts` | Strict parser/validator, operational queue derivation, freshness signals |
| **Graph Layout** | `workstream-graph.ts` | Dagre auto-layout, transitive edge reduction, selection highlighting |
| **Local API** | `src/server/` | Express API for graph loading, session registry mutations, trusted signals, and live session events |
| **Components** | `src/components/` | React Flow canvas, node renderers, inspector, header, status strip |
| **Theme** | `streamliner-theme.css` | Light Deep Ocean design system with `sl-` prefixed CSS classes |

## Tech stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Express](https://expressjs.com/) — local loopback API
- [React Flow](https://reactflow.dev/) (`@xyflow/react`) — graph rendering
- [dagre](https://github.com/dagrejs/dagre) (`@dagrejs/dagre`) — directed graph auto-layout
- [Vitest](https://vitest.dev/) — testing

## Quick start

Clone the repo, install dependencies, copy the local environment template, then start the API and web app together:

```powershell
git clone https://github.com/lossyrob/streamliner.git
cd streamliner
npm install
Copy-Item .env.template .env
npm run dev
```

On macOS/Linux, use `cp .env.template .env` instead of `Copy-Item`.

The checked-in `.env.template` points Streamliner at the sample session-launching workstream and sets the launch-context synthesis model to Claude Sonnet 4.6:

```dotenv
STREAMLINER_GRAPH=.streamliner/workstreams/session-launching-and-tracking/graph.json
STREAMLINER_CONTEXT_MODEL=claude-sonnet-4.6
STREAMLINER_API_HOST=127.0.0.1
STREAMLINER_API_PORT=4319
```

Edit `.env` to choose a different workstream graph or Copilot SDK model. `.env` is ignored by Git, and Streamliner loads it automatically when running the local API, Vite config, and API wait script.

Open [http://localhost:5173](http://localhost:5173) to see the configured workstream graph. `npm run dev` starts both the local API and Vite; the API is available directly at [http://127.0.0.1:4319/api/health](http://127.0.0.1:4319/api/health).

Useful commands:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the API and Vite web app together |
| `npm run dev:api` | Start only the local API in watch mode |
| `npm run dev:web` | Start only the Vite web app after waiting for the API |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run ESLint |
| `npm run build` | Type-check and build the web app |

See [DEVELOPING.md](DEVELOPING.md) for full development setup and workflow.

## License

Private — not yet licensed for distribution.
