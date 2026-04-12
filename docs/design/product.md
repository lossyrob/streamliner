---
kind: design-doc
status: current
last_updated: 2026-04-12
update_semantics: rewrite-in-place
authoritative_for: "Product scope, architecture, and V1 goals"
scope_tags:
  - product
  - architecture
  - v1-scope
code_paths:
  - src/**
references_decisions: []
---

# Streamliner — Product Design

Streamliner is a local-first web application for developers who use AI coding agents to execute multi-issue bodies of work. It makes workstream-level thinking the natural operating mode: the developer designs workstreams with explicit boundaries, contracts, and gates, then monitors autonomous execution through an operational picture that surfaces work-design quality and reserves attention for high-leverage moments.

## Core Insight

When execution is cheap, the bottleneck moves to the design of the work itself — not the design of the system being built, but the boundaries, contracts, and sequencing of the workstreams that build it.

## Target User

The user is a developer who:

- Uses AI coding agents to implement work
- Manages multiple concurrent workstreams, each spanning multiple issues
- Wants agents to execute autonomously by default, with human attention only at high-leverage moments
- Needs durable context that survives session crashes, conversation staleness, and machine restarts
- Wants to drop into any session at any level when they choose, then withdraw cleanly

## Core Concepts

### Project Design Layer

Above any individual workstream sits the project's **design layer**: design docs and decision records that live under `docs/design/` (or a configurable location). This layer answers what the intended system is, how major components relate, what architectural constraints apply, and why significant decisions were made.

The design layer has three document families:

1. **Design index** — the entry point for cold readers
2. **Living design docs** — the intended design for specific domains or concerns, rewritten in place
3. **Decision records** — append-only rationale for architecturally significant choices

Design docs are authoritative for intended system design. They are project-level and shared across workstreams.

### Workstream

A **workstream** is the execution layer for a body of work larger than a single issue. It consists of two paired artifacts:

- A **brief** (`brief.md`) — narrative intent and operational state, edited in place so it always reads as a coherent whole
- A **dependency graph** (`graph.json`) — structured work plan and operational picture

These artifacts reference the project design layer through human-readable `## Design References` in the brief and machine-readable `designRefs` in the graph. Together, the brief, graph, and referenced design docs give any new session enough context to operate without re-deriving the project from scratch.

Workstream artifacts are committed files — typically in a dedicated planning repository — versioned, diffable, portable, and resilient to session failure. Fast-changing operational data (session heartbeats, tracker snapshots) lives in a separate local runtime state surface.

### Nodes

Each node in the dependency graph represents a unit of work:

- **Tasks** — concrete work items, typically backed by a tracker
- **Research nodes** — investigation or spikes
- **Gates** — validation checkpoints where the developer evaluates whether the workstream is on track

Nodes carry artifact status (`planned`, `ready`, `in-progress`, `blocked`, `completed`), attention level, dependencies, optional tracker references, and optional runtime-linked session state.

### Waves

Streamliner uses wave-based planning to keep later work from going stale:

1. **Wave 1** — near-term nodes get fully detailed specs
2. **Later waves** — nodes exist as sketches with rough dependencies
3. As earlier waves complete, the orchestrator promotes the next wave based on what actually shipped

Waves are represented structurally through dependencies, checkpoints, and tracker promotion rather than through an explicit `wave` field.

### Context Package

AI agents start every session as blank slates. The **context package** provides layered context:

| Layer | Content |
|---|---|
| **Layer 0 — Project Design** | Relevant `current` design docs and accepted decisions |
| **Layer 1 — Workstream Intent** | Purpose, Approach, Design References, Boundaries |
| **Layer 2 — Operational State** | Current State, Decisions, Open Questions |
| **Layer 3 — Node Context** | Wave context, node spec, coordination notes |

Only `current` design docs are included automatically. `draft` docs are opt-in and only reach workers when the workstream or issue explicitly references them.

### Attention Levels

A node's attention level controls the developer's engagement:

- **focus** — developer is involved in the node's lifecycle
- **watch** — developer sees the output but trusts autonomous execution
- **parked** — fully autonomous unless flagged

This creates a continuous engagement spectrum from full developer presence to full autonomy, controlled from the graph.

## Three Pillars

### 1. The workstream as the primary unit of work

The dependency graph is the primary interface. It shows what is done, in flight, blocked, or next. The developer inspects nodes, dependencies, issues, and active session state; views the engagement surface; filters by status; and sees which design docs are relevant — all without opening any session.

### 2. Work-design quality is visible

When workstream boundaries are wrong, the developer sees it: too many cross-workstream blockers signal hidden dependencies, sessions that don't fit the structure signal unclear boundaries, outputs that can't be consumed downstream signal implicit contracts, and `decision-needed` escalations signal design gaps.

### 3. Attention goes to high-leverage moments by default

Gates, wave transitions, design mismatches, and scope decisions surface for review. Everything else runs autonomously. Developer presence is a deliberate choice, not the normal mode.

## Artifact System

The durable backbone has two coordinated artifact surfaces whose physical locations are flexible:

1. **Project design docs** — in the source repo, a design repo, or the planning repo
2. **Workstream artifacts** — in a planning repo, the source repo, or a dedicated workstream repo

Alongside those committed artifacts, Streamliner keeps a **local runtime state surface** for fast-moving operational data such as session heartbeats and tracker snapshots.

**Artifacts:** design index, living design docs, decision records, workstream brief, dependency graph, node specs.

**Not artifacts:** conversation history, status dashboards, session heartbeats, tracker caches, ad-hoc chat summaries.

## Operating Rhythm

Streamliner is designed for bursts of focused human attention interspersed with autonomous agent execution.

1. **Workstream shaping** — the developer works with an orchestrator session to produce the initial brief, graph, Wave 1 node specs, design references, and any design-doc updates needed before execution starts. This is the most attention-intensive phase.
2. **Autonomous execution** — workers read Layer 0–3 context, plan, implement, update design docs or flag mismatches, create the PR, and declare design impact (`none`, `updated-docs`, or `decision-needed`).
3. **Wave transition** — the orchestrator reviews what shipped against the plan and the design layer, updates the brief and design references, proposes the next wave, and presents the updated plan for review.
4. **Gate review** — the developer evaluates whether the workstream is on track: testing output, reviewing approach, reviewing design-doc changes, and resolving `decision-needed` cases.

At any point, the developer can enter a session, shape the work directly, then withdraw back to strategic oversight.

## Architecture Direction

### Local-First Web Application

Streamliner is a web app served by a local process and opened in any browser. There is no required Electron/Tauri shell. The same model is eventually deployable remotely.

### Registered Repositories

The developer registers where workstream artifacts live (planning repo, source repo, or elsewhere), participating source repositories, and where design docs live in each repo (default: `docs/design/`). The graph's `repos` array and `designRefs` use repo IDs to link across boundaries, keeping physical layout flexible.

### Technology Stack

- **Frontend:** React, React Flow, modern web stack
- **Backend:** local Node/TypeScript server
- **Session tracking:** integration with terminal/process management
- **GitHub integration:** issue/PR enrichment and status
- **Design catalog:** derived from design-doc frontmatter

## What Streamliner Is NOT

- **Not a project management tool** — no sprints, story points, or team dashboards
- **Not a micromanagement tool** — autonomy is the default
- **Not a replacement for the issue tracker** — the tracker remains the source of truth for node-level specs
- **Not an IDE** — Streamliner does not edit code
- **Not a chat app** — the orchestrator is an AI session using artifacts, not a built-in chat surface

## V1 Scope

V1 enables the operating rhythm for a single workstream: shape → execute → review → iterate. The focus is on the operational picture, the artifact system, and making the design layer explicit. Session tracking and operator presence are designed for but not fully built in V1.

### V1 Deliverables

- Planning repository setup (register location, initialize structure)
- Source repository registration and design-doc path configuration
- Derived design catalog from `docs/design/*`
- Workstream CRUD
- Brief viewer/editor with structured sections
- Interactive dependency graph
- `designRefs` support and brief Design References
- Design index and design-doc viewer
- Node inspector with relevant design-doc links
- GitHub enrichment for issue and PR state
- Attention level control
- Operational status strip
- Wave visualization
- Context package assembly (Layer 0 through Layer 3)
- Multiple concurrent workstreams
- Local web server with browser UI

### Designed For but After V1

- Session control panel and crash recovery
- Operator presence from the graph
- Session launch from the graph
- Design freshness heuristics based on `code_paths`
- Design diff surface during review
- Built-in design-doc editor
- Orchestrator skill for workstream management
- Alignment review automation
- Multi-machine session tracking
- Remote deployment
