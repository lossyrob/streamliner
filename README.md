<p align="center">
  <img src="docs/streamliner.png" alt="Streamliner" width="600" />
</p>

# Streamliner

A command center for orchestrating multi-issue development work with AI coding agents. Streamliner provides an interactive dependency graph for planning, monitoring, and evolving bodies of work that span multiple GitHub issues and agent sessions.

**Work in progress.** Streamliner is intended for one trusted user on a local
machine. Expect rough edges and evolving formats. Keep its API on loopback;
it is not a hosted or multi-user service.

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

## Quick start: explore the example workstreams

Use **Node.js 24 LTS (24.x)** with its bundled **npm 11**. Node and npm are
sufficient for viewing graphs; Copilot and PAW are used by optional agent
features.

```powershell
git clone https://github.com/lossyrob/streamliner.git
cd streamliner
npm ci
```

Prepare the local environment and disable automatic session
discovery/summarization for this first run.

PowerShell:

```powershell
Copy-Item .env.template .env
Add-Content -Path .env -Value 'STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER=1'
```

macOS/Linux:

```bash
cp .env.template .env
printf '\nSTREAMLINER_INTERNAL_DISABLE_SESSION_WORKER=1\n' >> .env
```

Then start both the local API and web app:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), or the URL printed by Vite
if that port is busy. The API health endpoint defaults to
[http://127.0.0.1:4319/api/health](http://127.0.0.1:4319/api/health).

On fresh state, register this clone before opening a graph:

1. Open **Workstreams**.
2. Under **Add source**, choose **Project root**.
3. Enter the absolute path to this clone, then click **Add source**.
4. Open a discovered workstream, such as **Session launching and tracking**.

Project-root scanning discovers graphs under `.streamliner\workstreams`.
The checked-in workstreams document Streamliner's own development; use them
as reference examples and create a workstream for your own project before
launching agents.

`.env` is ignored by Git and loaded automatically. The template's
`STREAMLINER_GRAPH` value configures the legacy graph endpoint and default
launch context. Registered sources populate the dashboard.

**Session data:** normal startup enables a worker that discovers local
Copilot sessions and can send eligible recent user-message excerpts and
session context to Copilot for summaries. The first-run setting above
disables that worker. Leave agent launch, relaunch, and cleanup controls
unused while exploring; those are separate actions that can modify local
repositories or run commands.

## Optional integrations

| Capability | Additional setup |
|------------|------------------|
| Live GitHub issue/PR status | Optional [GitHub authentication](DEVELOPING.md#github-status-authentication); anonymous lookups are supported but may be rate-limited. |
| PAW-backed agent execution | Install and authenticate Copilot CLI, install PAW skills, configure models available to your account, and follow the [agent workflow setup](DEVELOPING.md#optional-agent-workflows). |
| Local session observation and summaries | Remove the first-run `STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER=1` setting and restart the API when you want to enable the worker described above. |

Visible worker terminals use Windows Terminal or PowerShell on Windows,
and Apple Terminal.app by default on macOS, with iTerm2 also supported.
The viewer setup does not establish that every agent-launch integration is
configured or supported on your machine.

## Development commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the API and Vite web app together |
| `npm run dev:api` | Start only the local API in watch mode |
| `npm run dev:web` | Start only the Vite web app after waiting for the API |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run ESLint |
| `npm run build` | Type-check and build the web app |

See [DEVELOPING.md](DEVELOPING.md) for environment settings, isolated worktree
previews, and development workflow.

## License

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 Rob Emanuele.
