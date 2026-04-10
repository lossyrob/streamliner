# Streamliner - Product Spec

> A command center for orchestrating autonomous AI development across concurrent workstreams.

## What is Streamliner?

Streamliner is a local-first web application for developers who use AI coding agents to execute multi-issue bodies of work. It gives the operator an operational picture of concurrent workstreams, a project-level design layer that survives any single session, an operator-presence system for engaging with agent sessions at any level, and a durable artifact system that keeps important context out of chat history.

The core insight: when work is bigger than a single issue, autonomous execution only stays coherent if agents can ground themselves in both **project design** and **workstream intent**. The operator shapes the design and the workstream, then reserves attention for gates, wave transitions, and other high-leverage moments where judgment and taste matter most.

See [DOCTRINE.md](DOCTRINE.md) for the operating model and [DESIGN-DOCS.md](DESIGN-DOCS.md) for the project-level design layer.

## Who is this for?

A developer who:

- uses AI coding agents to implement work
- manages multiple concurrent workstreams, each with multiple issues
- wants agents to execute autonomously by default, with human attention only at high-leverage moments
- needs durable context that survives session crashes, conversation staleness, and machine restarts
- wants to drop into any session at any level when they choose, then withdraw cleanly

## Core concepts

### Project design layer

Above any individual workstream sits the project's **design layer**: design docs and decision records, typically under `docs/design/` in the source repository but configurable per project (they can also live in a separate design repo or the planning repo).

This layer answers:

- what the intended system is
- how major components relate
- what architectural constraints apply
- why significant decisions were made

The design layer has three document families:

1. **Design index** - the entry point for cold readers
2. **Living design docs** - the intended design for specific domains or concerns
3. **Decision records** - append-only rationale for architecturally significant choices

Design docs are authoritative for intended system design. They are project-level and shared across workstreams.

### Workstream

A **workstream** is the execution layer for a body of work larger than a single issue. It still consists of two paired artifacts:

- a **brief** (`brief.md`) - narrative intent and operational state
- a **dependency graph** (`graph.json`) - structured work plan and operational picture

Those artifacts do not duplicate the project design layer. Instead, they reference the relevant design docs through:

- a human-readable `## Design References` section in the brief
- a machine-readable `designRefs` array in the graph

Together, the brief, graph, and referenced design docs give any new session enough context to operate without re-deriving the project from scratch.

Workstream artifacts are persisted as committed files — typically in a dedicated planning repository, though they can also live in the source repo or elsewhere. They are versioned, diffable, portable, and resilient to session failure.

Fast-changing operational data is separate. Streamliner keeps local runtime state — session IDs, heartbeats, tracker snapshots, launch metadata — outside the committed artifact set and overlays it onto the graph at runtime.

### The brief

The workstream brief is a single markdown file with defined sections and update semantics:

| Section | Content | Update pattern |
|---|---|---|
| **Purpose** | Why the workstream exists; the end state it serves | Rarely changes |
| **Approach** | How this workstream is approaching the problem | Rewritten as understanding deepens |
| **Design References** | Project-level design docs and decisions this workstream must honor | Updated when the workstream's design surface changes |
| **Boundaries** | What's in scope, explicitly out, deferred | Refined each wave |
| **Current State** | What just happened, what's active, what needs attention | Fully rewritten each update |
| **Decisions** | Workstream-local execution choices and rationale | Edited; stale entries removed |
| **Open Questions** | Unresolved issues affecting planning | Removed when resolved |

The brief is **edited in place, never appended to**. At any point it reads as a coherent whole, not a chronological log. Git history provides the audit trail.

The brief's `Decisions` section is not the place for project-wide architecture decisions. Those belong in the design layer.

### Nodes

Each node in the dependency graph represents a unit of work:

- **Tasks** - concrete work items, typically backed by a tracker (GitHub issue, local spec file, or another platform)
- **Research nodes** - investigation or spikes
- **Gates** - validation checkpoints where the operator evaluates whether the workstream is on track

Nodes have:

- artifact status (`planned`, `ready`, `in-progress`, `blocked`, `completed`)
- attention level (`focus`, `watch`, `parked`)
- dependencies
- optional tracker (GitHub issue, local spec file, or other platform)
- optional runtime-linked session state surfaced by the UI

### Waves

Not all work is detailed upfront. Streamliner supports **wave-based planning**:

1. **Wave 1** - near-term nodes get fully detailed specs (via tracker)
2. **Later waves** - nodes exist as sketches: title, summary, rough dependencies
3. As earlier waves complete, the orchestrator promotes the next wave based on what actually shipped

This keeps later work from going stale and lets the plan evolve naturally.

Waves are represented structurally for now through dependencies, checkpoints, and tracker promotion rather than through an explicit `wave` field on each node.

### Context package

AI agents start every session as blank slates. The **context package** solves this with layered context:

- **Layer 0 - Project Design Context**: relevant `current` design docs and accepted decisions
- **Layer 1 - Workstream Intent**: Purpose, Approach, Design References, Boundaries
- **Layer 2 - Operational State**: Current State, Decisions, Open Questions
- **Layer 3 - Node Context**: wave context, node spec, coordination notes, and any node-specific design narrowing carried in those node artifacts

Only `current` design docs are included automatically. `draft` design docs are opt-in and only reach workers when the workstream or issue explicitly references them because the node is shaping or validating that draft.

This replaces the "years of shared doctrine" that human organizations rely on. Every session, regardless of where or when it starts, gets the same durable context surfaces.

### Attention level as engagement control

A node's attention level controls the operator's engagement:

- **focus** - operator wants to be involved in this node's lifecycle
- **watch** - operator wants to see the output but trusts autonomous execution
- **parked** - fully autonomous unless flagged

This creates a continuous engagement spectrum from full autonomy to full operator presence, controlled from the graph.

## Three pillars

### 1. Operational picture

The **dependency graph is the primary interface**. It is where the operator can:

- see what is done, in flight, blocked, or next
- inspect nodes, dependencies, dependents, issues, and active session state
- see operational status derived from tracker state and local runtime state
- view the engagement surface - which nodes are `focus`, `watch`, or `parked`
- filter by ready/in-flight/review/blocked state
- inspect the workstream's current state without opening any session
- see which design docs are relevant to the workstream or selected node

The graph supports multiple concurrent workstreams, each in its own view.

### 2. Operator presence

The session system is the portal through which the operator exercises presence at any level of the hierarchy.

Streamliner should let the operator:

- see every active orchestrator or worker session across environments
- understand whether each session is planning, implementing, blocked, waiting for review, or idle
- join any session directly to review, redirect, co-pilot, or interrogate reasoning
- withdraw cleanly, leaving artifacts as the durable source of truth

The default remains autonomy. Presence is a superpower, not the normal mode.

### 3. Artifact system

The durable backbone has **two coordinated artifact surfaces** whose physical locations are flexible:

1. **Project design docs** — in the source repo, a design repo, or the planning repo
2. **Workstream artifacts** — in a planning repo, the source repo, or a dedicated workstream repo

Alongside those committed artifacts, Streamliner keeps a **local runtime state surface** for fast-moving operational data such as session heartbeats and tracker snapshots.

A typical layout:

```text
{source-repo or design-repo}/
  docs/
    design/
      index.md
      {domain-or-concern}.md
      decisions/
        001-{slug}.md

{planning-repo or source-repo}/
  workstreams/
    {id}/
      brief.md
      graph.json
      docs/

~/.streamliner/state/
  {projectKey}/
    {workstream-id}/
      runtime.json
      sessions.json
      tracker-cache.json
```

`projectKey` comes from the workstream graph (or falls back to the primary repo ID / sole repo ID when omitted). The filenames above are illustrative; the runtime layer may decompose hot data into smaller files later as long as the artifact/runtime split stays intact.

See [WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md) for the full details on where artifacts can live.

**What IS an artifact:**

- design index, living design docs, and decision records
- the workstream brief
- the dependency graph
- node specs (GitHub issues, local spec files, or other tracker platforms)

**What is NOT an artifact:**

- orchestrator conversation history
- worker conversation history
- status dashboards
- session heartbeats and launch metadata
- tracker caches and PR snapshot overlays
- ad hoc chat summaries used as de facto source of truth

The orchestrator is not a built-in daemon. It is any AI session that reads the brief, graph, and referenced design docs, then updates artifacts when durable plan or progress changes are worth committing. Fast-moving runtime state is tracked separately and projected onto the UI.

## The operating rhythm

Streamliner is designed for bursts of focused human attention interspersed with autonomous agent execution.

### Phase 1: Workstream shaping

The operator works with an orchestrator session to produce:

- the initial brief
- the initial graph
- Wave 1 node specs (created as issues or local spec files)
- relevant `designRefs`
- any design-doc updates required to establish the intended direction before execution starts

This is the most attention-intensive phase.

### Phase 2: Autonomous execution

Workers pick up nodes and execute:

1. read Layer 0-3 context
2. plan the implementation
3. implement
4. update referenced design docs or flag a design mismatch when needed
5. create the PR
6. declare design impact: `none`, `updated-docs`, or `decision-needed`

The operator's role during this phase is none unless flagged.

### Phase 3: Wave transition

When a wave is mostly complete, the orchestrator reviews what shipped versus:

- what the workstream planned
- what the design layer says the system should become

Then it updates the brief, refreshes the workstream's design references if needed, proposes the next wave, and presents the updated plan to the operator for review.

### Phase 4: Gate review

At gates, the operator evaluates whether the workstream is on track. This may include:

- testing the output
- reviewing the approach
- reviewing any design-doc changes associated with the wave
- resolving `decision-needed` cases

### Operator presence (any time)

At any point during execution, wave transition, or review, the operator can enter a session, shape the work directly, then withdraw back to strategic oversight.

## Architecture

### Local-first web application

- web app served by a local process and opened in any browser
- no required Electron/Tauri shell
- eventually deployable remotely with the same model
- terminal/session integration for launching and joining sessions

### Registered repositories

Streamliner works across registered repositories. The operator registers:

- where workstream artifacts live (a planning repo, the source repo, or elsewhere)
- the participating source repositories
- where design docs live in each repo (default: `docs/design/`)

Design docs and workstream artifacts can live in the same repo or different repos. The graph's `repos` array and `designRefs` use repo IDs to link across boundaries, so physical layout is flexible. See [WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md) for layout options.

### Technology direction

- **Frontend:** React, React Flow, modern web stack
- **Backend:** local Node/TypeScript server
- **Session tracking:** integration with terminal/process management
- **GitHub integration:** issue/PR enrichment and status
- **Design catalog:** derived from design-doc frontmatter

## What Streamliner is NOT

- **Not a project management tool** - no sprints, story points, or team dashboards
- **Not a micromanagement tool** - autonomy is the default
- **Not a replacement for your issue tracker** - when using GitHub Issues, ADO, or another platform, those remain the source of truth for node-level specs. Streamliner can also work with local spec files when no external tracker is used.
- **Not an IDE** - Streamliner does not edit code itself
- **Not a chat app** - the orchestrator is an AI session using artifacts, not a built-in chat surface

## V1 scope

V1 enables the operating rhythm for a single workstream: shape -> execute -> review -> iterate. The focus is on the operational picture, the artifact system, and making the design layer explicit. Session tracking and operator presence are designed for but not fully built in V1.

### In V1

- [ ] Planning repository setup (register location, initialize structure)
- [ ] Source repository registration and design-doc path configuration
- [ ] Derived design catalog from `docs/design/*`
- [ ] Workstream CRUD
- [ ] Brief viewer/editor with structured sections
- [ ] Interactive dependency graph
- [ ] `designRefs` support and brief `Design References`
- [ ] Design index and design-doc viewer
- [ ] Node inspector with relevant design-doc links
- [ ] GitHub enrichment for issue and PR state
- [ ] Attention level control
- [ ] Operational status strip
- [ ] Wave visualization
- [ ] Context package assembly (Layer 0 through Layer 3)
- [ ] Multiple concurrent workstreams
- [ ] Local web server with browser UI

### Designed for but after V1

- [ ] Session control panel and crash recovery
- [ ] Operator presence from the graph
- [ ] Session launch from the graph
- [ ] Design freshness heuristics based on `code_paths`
- [ ] Design diff surface during review
- [ ] Built-in design-doc editor
- [ ] Orchestrator skill for workstream management
- [ ] Alignment review automation
- [ ] Multi-machine session tracking
- [ ] Remote deployment

## Open questions

1. **Session tracking mechanism**: How do we discover and monitor Copilot CLI sessions across environments?
2. **Operator presence UX**: What does "joining" a session look like in practice?
3. **Auth and GitHub tokens**: How does Streamliner authenticate with GitHub for enrichment and issue management?
4. **Context package delivery**: How does Layer 0-3 context reach a worker session in practice?
5. **Orchestrator skill design**: What does the skill look like that manages wave progression and artifact updates?
6. **Design relevance heuristics**: How should Streamliner map changed files and nodes to design docs when explicit references are missing or too broad?
