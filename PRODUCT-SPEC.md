# Streamliner — Product Spec

> A command center for orchestrating multi-issue development work with AI coding agents.

## What is Streamliner?

Streamliner is a local-first web application for developers who use AI coding agents (Copilot CLI, etc.) to execute multi-issue bodies of work. It provides an interactive dependency graph for planning, a session control panel for monitoring agent sessions, and an orchestration layer that bridges the gap between high-level plans and individual worker sessions.

The core insight: when work is bigger than a single issue, developers need a durable place to hold the plan, track what agents are doing, and evolve the work as it progresses — all without losing context when sessions crash, conversations get too long, or machines restart.

## Who is this for?

Engineers who:

- Use Copilot CLI (or similar AI coding agents) to implement work
- Regularly break larger efforts into multiple GitHub issues
- Run multiple agent sessions in parallel across machines (local, WSL, dev boxes)
- Want visibility into what their agents are doing without manually tracking terminal windows
- Lose context when sessions crash, machines restart, or conversations get stale

## Core concepts

### Workstream

A **workstream** is a structured representation of a body of work larger than a single issue. It consists of:

- A **dependency graph** of work items (nodes and edges)
- **Planning documents** that capture design decisions, context, and rationale
- Links to **GitHub issues** that ground nodes in executable work
- A **tracking issue** that anchors the whole effort on GitHub

Workstreams are persisted as committed files in a **planning repository** — either a dedicated personal repo or a subdirectory of an existing one. This means they're versioned, portable, and survive any session or machine failure.

### Nodes

Each node in the dependency graph represents a unit of work:

- **Tasks** — concrete work items, typically backed by a GitHub issue
- **Gates** — validation checkpoints that block progression until upstream work is verified

Nodes have:

- Status (planned, ready, in-progress, completed, blocked)
- Attention level (focus, watch, parked)
- Dependencies (which nodes must complete first)
- Optional linked GitHub issue
- Optional linked Copilot session

### Waves

Not all work is detailed upfront. Streamliner supports **wave-based planning**:

1. **Wave 1**: Near-term nodes get fully detailed GitHub issues
2. **Later waves**: Nodes exist as sketches in the graph — title, summary, rough dependencies
3. As earlier waves complete, the orchestrator fleshes out the next wave based on what actually shipped, not what was originally imagined

This keeps later work from going stale and lets the plan evolve naturally.

### Planning documents

Durable context that survives session resets. When an orchestrator conversation gets too long or goes stale, you can reset it — all the important context lives in committed planning docs, not conversation history.

Planning documents include:

- Design decisions and rationale
- Architecture notes
- Constraints and scope boundaries
- Updated as work progresses

These live in the planning repository alongside the workstream graph, or in the target project's documentation if appropriate.

## Three pillars

### 1. Workstream graph

The **dependency graph is the primary interface**. It is an interactive React Flow visualization where you can:

- See the full shape of the work — what's done, what's in progress, what's blocked, what's next
- Click nodes to inspect details, linked issues, active PRs, and session state
- Drag nodes to rearrange the layout
- See transitive-reduced edges (if A→B→C, the direct A→C edge is hidden for clarity)
- View operational status derived from GitHub state (ready, waiting-for-review, waiting-for-validation, blocked)
- Filter by status: ready now, in flight, waiting for review, blocked/attention

The graph supports multiple concurrent workstreams, each in its own view.

### 2. Session control panel

A **live dashboard of all Copilot CLI sessions** across all environments:

- **Session inventory**: Track every active session — Windows, WSL, dev boxes
- **Crash recovery**: Persist which sessions were running so you can relaunch them all after a restart or crash. This is the single biggest pain point — losing track of what you had open
- **Session state**: See where each session is in its lifecycle:
  - Planning (waiting for your review of plan docs)
  - Implementing
  - PR created (waiting for review/merge)
  - PAW review complete
  - Blocked / errored / idle
- **Launch from graph**: Click a node in the workstream, configure the prompt and agent, and launch a session in a target environment (local terminal, WSL, dev box)
- **Non-workstream sessions**: Also tracks standalone PAW runs and ad-hoc Copilot sessions — not everything is part of a workstream

### 3. Orchestrator ↔ worker coordination

The orchestrator is a persistent conversation (or resettable conversation backed by durable docs) that manages the workstream:

- **Plan the work**: Map out the dependency graph, generate waves of GitHub issues
- **Evolve the plan**: After waves complete, update the graph and generate next-wave issues based on what actually shipped
- **Review worker plans**: Before a worker starts implementing, the orchestrator can review their planning documents against the overall plan — catching scope creep, conflicts with downstream issues, or misalignment
- **Workstream briefs**: Each worker gets grounded in the broader context, not just their isolated issue
- **Automatic review pipeline**: Implementation → PR → PAW Review → feedback loop, all trackable from the dashboard
- **Update issues**: As the plan evolves, update existing GitHub issues or create new ones

## Architecture

### Local-first web application

- **Web app** served by a local process — open in any browser
- No desktop app (Tauri/Electron) — just a server and a browser
- Eventually deployable remotely (dev box, cloud) for the same experience from anywhere
- Terminal integration for launching sessions locally

### Planning repository

Workstream data lives in a **committed git repository**, not in gitignored local state:

- A dedicated personal planning repo, or a subdirectory of an existing one
- Versioned and tracked — you can see how plans evolved
- Portable across machines
- The user registers their planning repo location; Streamliner reads/writes from there

### Technology direction

- **Frontend**: React, React Flow for the graph, modern web stack
- **Backend**: Local server (language TBD — Node/TypeScript likely for consistency with the frontend and Copilot ecosystem)
- **Session tracking**: Integration with terminal/process management for session inventory and launch
- **GitHub integration**: REST/GraphQL API for issue CRUD, PR status, enrichment

## What Streamliner is NOT

- **Not a project management tool** — no sprints, story points, or team dashboards. This is a personal (or small-team) command center for AI-assisted development.
- **Not a replacement for GitHub Issues** — GitHub Issues remain the source of truth for individual work items. Streamliner orchestrates across them.
- **Not an IDE** — Streamliner doesn't edit code. It launches and monitors the sessions that do.

## V1 scope

The first version focuses on the workstream graph and planning workflow. Session tracking and orchestrator coordination are designed for but not fully built in V1.

### In V1

- [ ] Planning repository setup (register location, init structure)
- [ ] Workstream CRUD (create, edit, view workstreams)
- [ ] Interactive dependency graph (React Flow, dagre layout, transitive reduction)
- [ ] Node inspector (status, issue links, dependencies, dependents)
- [ ] GitHub enrichment (issue state, PR status, derived operational status)
- [ ] Wave-based issue generation (detail near-term nodes, sketch later ones)
- [ ] Planning document management (create, edit, link to workstream)
- [ ] Multiple concurrent workstreams
- [ ] Local web server with browser-based UI

### Designed for but after V1

- [ ] Session control panel (inventory, state tracking, crash recovery)
- [ ] Session launch from graph (configure prompt, agent, target environment)
- [ ] Orchestrator conversation management (reset with durable context)
- [ ] Orchestrator review of worker plans
- [ ] Automatic PAW pipeline integration (implement → PR → review → feedback)
- [ ] Multi-machine session tracking (Windows, WSL, dev box)
- [ ] Remote deployment

## Open questions

1. **Planning repo structure**: What does the directory layout look like? One directory per workstream? How do planning docs relate to the graph file?
2. **Workstream schema evolution**: The current schema is a starting point. What needs to change for the independent tool?
3. **Session tracking mechanism**: How do we discover and monitor Copilot CLI sessions across environments? File-based state? Process introspection? Agent-reported heartbeats?
4. **Orchestrator UX**: Is the orchestrator a chat interface in Streamliner, or does it launch a Copilot CLI session with special context? Or both?
5. **Auth and GitHub tokens**: How does Streamliner authenticate with GitHub for enrichment and issue management?
