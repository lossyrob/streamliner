# Streamliner — Product Spec

> A command center for orchestrating autonomous AI development across concurrent workstreams.

## What is Streamliner?

Streamliner is a local-first web application for developers who use AI coding agents to execute multi-issue bodies of work. It provides an operational picture of concurrent workstreams, an operator presence system for engaging with agent sessions at any level, and a durable artifact system that ensures no context is lost when sessions end, crash, or go stale.

The core insight: when work is bigger than a single issue, developers need a system that enables autonomous agent execution by default and reserves human attention for the moments where judgment, taste, and strategic thinking are irreplaceable. The developer is the operator — shaping workstreams, reviewing at gates, and exercising presence when they choose — while orchestrator and worker agents handle decomposition, implementation, and coordination autonomously.

See [DOCTRINE.md](DOCTRINE.md) for the full design philosophy, including the three-level hierarchy (operator → orchestrator → worker), the context package system, the operating rhythm, and the engagement spectrum.

## Who is this for?

A developer who:

- Uses AI coding agents (Copilot CLI, etc.) to implement work
- Manages multiple concurrent workstreams, each with multiple issues
- Wants agents to execute autonomously by default, with human attention only at high-leverage moments
- Needs durable context that survives session crashes, conversation staleness, and machine restarts
- Wants to drop into any session at any level when they choose, then withdraw cleanly

## Core concepts

### Workstream

A **workstream** is the complete representation of a body of work larger than a single issue. It consists of two paired artifacts:

- A **brief** (`brief.md`) — the narrative companion that captures purpose, approach, boundaries, current state, decisions, and open questions. This is the operator's intent made durable.
- A **dependency graph** (`graph.json`) — the structured plan of nodes, edges, statuses, and wave membership. This is the operational picture.

Together, the brief and graph give any new session — orchestrator or worker — everything it needs to be immediately productive without re-deriving decisions or re-explaining the project.

Workstreams are persisted as committed files in a **planning repository**. This means they're versioned, portable, diffable, and survive any session or machine failure.

### The brief

The workstream brief is a single markdown file with defined sections and update semantics:

| Section | Content | Update pattern |
|---|---|---|
| **Purpose** | Why the workstream exists; the end state | Rarely changes |
| **Approach** | Architecture, patterns, technology choices, constraints | Rewritten as understanding deepens |
| **Boundaries** | What's in scope, explicitly out, deferred | Refined each wave |
| **Current State** | What just happened, what's active, what needs attention | Fully rewritten each update |
| **Decisions** | Choices made and rationale ("X because Y") | Edited; stale entries removed |
| **Open Questions** | Unresolved issues affecting planning | Removed when resolved |

The brief is **edited in place, never appended to**. At any point it reads as a coherent whole, not a chronological accumulation. Git history provides the audit trail. Target length: under 400 lines — if longer, push detail down to issue specs.

### Nodes

Each node in the dependency graph represents a unit of work:

- **Tasks** — concrete work items, backed by a GitHub issue
- **Gates** — validation checkpoints where the operator evaluates whether the workstream is on track

Nodes have:

- Status (planned, ready, in-progress, completed, blocked)
- Attention level (focus, watch, parked) — this doubles as the **engagement control surface**, signaling the operator's desired involvement
- Dependencies (which nodes must complete first)
- Optional linked GitHub issue
- Optional linked agent session

### Waves

Not all work is detailed upfront. Streamliner supports **wave-based planning**:

1. **Wave 1**: Near-term nodes get fully detailed issue specs
2. **Later waves**: Nodes exist as sketches — title, summary, rough dependencies
3. As earlier waves complete, the orchestrator promotes the next wave: detailing specs based on what actually shipped, not what was originally imagined

This keeps later work from going stale and lets the plan evolve naturally. Wave transitions are the moments where the operator reviews the updated plan and applies strategic judgment.

### Context package

AI agents start every session as blank slates. The **context package** solves this by providing layered context appropriate to each role:

- **Layer 1 — Workstream Intent** (all levels): Purpose + Approach + Boundaries from the brief
- **Layer 2 — Operational State** (orchestrator + operator): Current State + Decisions + Open Questions from the brief
- **Layer 3 — Node Context** (workers): Workstream intent snippet + wave context + issue spec + coordination notes

This replaces the "years of shared doctrine" that military subordinates carry implicitly. It ensures every session — regardless of which agent, which machine, or how many sessions have come before — has the full context to operate autonomously within the workstream's intent.

### Attention level as engagement control

A node's attention level controls the operator's engagement:

- **focus** — operator wants to be involved in this node's lifecycle: review the plan, review the PR, possibly co-pilot the implementation
- **watch** — operator wants to see the output but trusts the autonomous process
- **parked** — fully autonomous; operator doesn't need to see this unless flagged

This creates a continuous **engagement spectrum** from full autonomy to full operator presence, controlled from the graph. The default is autonomy; presence is applied by choice.

## Three pillars

### 1. Operational picture (the graph)

The **dependency graph is the primary interface**. It is an interactive visualization where the operator can:

- See the full shape of the work — what's done, what's in progress, what's blocked, what's next
- Click nodes to inspect details: status, linked issues, active PRs, session state, dependencies, dependents
- See operational status derived from GitHub state (ready, waiting-for-review, waiting-for-validation, blocked)
- View the engagement surface — which nodes are focus, watch, parked
- Filter by status: ready now, in flight, waiting for review, blocked/attention
- See transitive-reduced edges (if A→B→C, the direct A→C edge is hidden for clarity)
- Drag nodes to rearrange the layout

The graph also displays the brief's Current State — giving the operator an immediate orientation on what's happening and what needs attention, without entering any session.

The graph supports multiple concurrent workstreams, each in its own view.

### 2. operator presence (sessions)

The session system is not just a dashboard — it's the **portal through which the operator exercises presence** at any level of the hierarchy.

**Session inventory:** Track every active agent session across environments — Windows, WSL, dev boxes. See where each session is in its lifecycle:
- Planning (waiting for plan review)
- Implementing
- PR created (waiting for review/merge)
- Blocked / errored / idle

**Joinable sessions:** the operator can enter any session and interact directly:
- Review a worker's plan and provide feedback in the session
- Ask the worker about its reasoning or approach
- Co-pilot the implementation on a tricky problem
- Provide direction and withdraw — the session continues autonomously

**Launch from graph:** Click a node, configure the context package, and launch a worker session. The system assembles the appropriate context layers automatically.

**Crash recovery:** Persist which sessions were running so they can be relaunched after a restart or crash. This is the single biggest operational pain point — losing track of what was open.

**Non-workstream sessions:** Also tracks standalone agent sessions not tied to a workstream — not everything is part of a workstream.

**Clean withdrawal:** the operator can leave any session without creating an orphaned state. Workstream artifacts remain the source of truth. The worker continues from its context package.

### 3. Artifact system (the planning repository)

The durable backbone. Everything important is a committed file — nothing lives only in conversation history.

**Planning repository structure:**
```
workstreams/
  └── robin/
        ├── brief.md       ← Workstream intent + operational state
        ├── graph.json      ← Dependency graph
        └── docs/           ← Optional supporting documents
  └── streamliner/
        ├── brief.md
        ├── graph.json
        └── docs/
```

**What IS an artifact:**
- The workstream brief — purpose, approach, boundaries, current state, decisions
- The dependency graph — nodes, edges, statuses, attention levels, issue links
- Issue specs — detailed specifications for individual nodes (on GitHub Issues)

**What is NOT an artifact:**
- Orchestrator conversation history — ephemeral
- Worker conversation history — ephemeral
- Status dashboards — derived from graph + GitHub state at view time
- Change logs — git history provides this naturally

**The orchestrator pattern:** The orchestrator is not a built-in feature of Streamliner — it's a role. An orchestrator is any AI session (typically Copilot CLI, potentially with a specialized skill) that reads the brief + graph, does its work (wave planning, worker review, artifact updates), and commits. Streamliner provides the artifacts and visualization; the orchestrator is a session that uses them.

## The operating rhythm

Streamliner is designed for the developer's actual workflow: bursts of focused attention interspersed with autonomous agent execution.

### Phase 1: Workstream shaping

The operator has a body of work in mind. Through conversation with an orchestrator session, they produce the brief, the initial graph, and Wave 1 issue specs. Later waves are sketched (titles and summaries, no specs).

This is the most attention-intensive phase — strategic decisions, approach definition, boundary setting. Irreplaceable human judgment.

### Phase 2: Autonomous execution

Workers pick up nodes and execute: read context package → plan → implement → PR → flag anything that affects the workstream. The operator's role: **none**, unless flagged. The dashboard provides situational awareness; the operator checks it periodically or is notified of flags.

### Phase 3: Wave transition

When a wave's nodes are mostly complete, the orchestrator reviews what shipped, updates the brief, and proposes the next wave. the operator reviews: does the updated plan still serve the purpose? This is the second moment of irreplaceable judgment.

### Phase 4: Gate review

At gates, the operator evaluates whether the workstream is on track. They test the output, review the approach, and either pass the gate or adjust the plan. High attention, but infrequent and high-leverage.

### operator presence (any time)

At any point during Phases 2-4, the operator can exercise presence: drop into a worker session to co-pilot, do work shaping for a specific issue, review a plan interactively, or interrogate a worker's reasoning. Presence is a choice, not a requirement — the system's default is autonomy.

## Architecture

### Local-first web application

- **Web app** served by a local process — open in any browser
- No desktop app (Tauri/Electron) — just a server and a browser
- Eventually deployable remotely (dev box, cloud) for the same experience from anywhere
- Terminal integration for launching and joining sessions locally

### Planning repository

Workstream data lives in a **committed git repository**:

- A dedicated personal planning repo, or a subdirectory of an existing one
- Versioned and tracked — you can see how plans evolved
- Portable across machines
- The user registers their planning repo location; Streamliner reads/writes from there

### Technology direction

- **Frontend**: React, React Flow for the graph, modern web stack
- **Backend**: Local server (Node/TypeScript for consistency with the frontend)
- **Session tracking**: Integration with terminal/process management for session inventory and launch
- **GitHub integration**: REST/GraphQL API for issue CRUD, PR status, enrichment

## What Streamliner is NOT

- **Not a project management tool** — no sprints, story points, or team dashboards. This is a personal command center for AI-assisted development.
- **Not a micromanagement tool** — the default mode is autonomous execution. operator presence is a capability, not a requirement. If you're reviewing every node personally, the system has failed.
- **Not a replacement for GitHub Issues** — GitHub Issues remain the source of truth for individual work items. Streamliner orchestrates across them.
- **Not an IDE** — Streamliner doesn't edit code. It launches and monitors the sessions that do.
- **Not a chat interface** — the orchestrator is a Copilot CLI session, not a chat window in Streamliner.

## V1 scope

V1 enables the operating rhythm for a single workstream: shape → execute → review → iterate. The focus is on the operational picture and artifact system. Session tracking and operator presence are designed for but not fully built in V1.

### In V1

- [ ] Planning repository setup (register location, init structure)
- [ ] Workstream CRUD (create, edit, view workstreams)
- [ ] Brief viewer and editor (structured sections, in-place editing)
- [ ] Interactive dependency graph (React Flow, dagre layout, transitive reduction)
- [ ] Node inspector (status, attention level, issue links, dependencies, dependents, wave membership)
- [ ] GitHub enrichment (issue state, PR status, derived operational status)
- [ ] Attention level control (set focus/watch/parked from the graph)
- [ ] Operational status strip (ready/in-flight/blocked/review counts)
- [ ] Wave visualization (which nodes belong to which wave, which wave is active)
- [ ] Context package assembly (generate the layered context for a node — workstream intent + wave context + issue spec)
- [ ] Multiple concurrent workstreams
- [ ] Local web server with browser-based UI

### Designed for but after V1

- [ ] Session control panel (inventory, state tracking, crash recovery)
- [ ] operator presence (join/interact with active sessions from the graph)
- [ ] Session launch from graph (configure context package, launch in target environment)
- [ ] Orchestrator skill (Copilot CLI skill for workstream management)
- [ ] Alignment review automation (orchestrator reviews worker plans against intent)
- [ ] Multi-machine session tracking (Windows, WSL, dev box)
- [ ] Remote deployment

## Open questions

1. **Session tracking mechanism**: How do we discover and monitor Copilot CLI sessions across environments? File-based state? Process introspection? Agent-reported heartbeats?
2. **operator presence UX**: What does "joining" a session look like in practice? Opening a terminal? A web-based terminal in Streamliner? Connecting to an existing Copilot CLI session?
3. **Auth and GitHub tokens**: How does Streamliner authenticate with GitHub for enrichment and issue management?
4. **Context package delivery**: How does the assembled context package get into a worker session? Pasted into the prompt? A file the session reads? A skill that loads it?
5. **Orchestrator skill design**: What does the Copilot CLI skill look like that enables an agent to read/write workstream artifacts and manage wave progression?
