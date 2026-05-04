# Streamliner — Product Design

When AI coding agents compress execution time, the bottleneck moves from implementation to the design of the work itself — the boundaries, contracts, sequencing, and cross-workstream geometry of the workstreams that build a system. Streamliner exists for builders who have crossed that threshold.

Streamliner is a local-first web application that makes workstream-level thinking the natural operating mode. The builder designs workstreams with explicit boundaries, contracts, imports, exports, and gates, then monitors autonomous execution through an operational picture that reserves attention for high-leverage moments.

## Target User

The user is a builder who:

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

Together, the brief, graph, and design layer — with Design References highlighting strong starting points — give any new session enough context to operate without re-deriving the project from scratch.

Workstream artifacts are committed files — versioned, diffable, portable, and resilient to session failure. Fast-changing operational data (session runtime state, tracker snapshots) lives in a separate local runtime state surface.

### Nodes

Each node in the dependency graph represents a unit of work:

- **Tasks** — concrete work items, typically backed by a tracker
- **Research nodes** — investigation or spikes
- **Gates** — validation checkpoints where the builder evaluates whether the workstream is on track, including hands-on testing of the running system

Nodes carry artifact status (`planned`, `ready`, `in-progress`, `blocked`, `completed`), dependencies, optional tracker references, and optional runtime-linked session state.

### Waves

Streamliner uses wave-based planning to keep later work from going stale. Near-term nodes get fully detailed specs; later nodes exist as sketches that get promoted as reality unfolds. See [Waves](concepts/waves.md) for how promotion, checkpoints, and gate boundaries work.

### Context Package

AI agents start every session as blank slates. The **context package** provides layered context — from project-level design down to a specific node's mission — so any new session can be immediately productive. See [Context Package](concepts/context-package.md) for the full layer model.

## Three Pillars

### 1. The workstream as the primary unit of work

The dependency graph is the primary interface. It shows what is done, in flight, blocked, or next. The builder inspects nodes, dependencies, issues, and active session state; filters by status; and sees which design docs are relevant — all without opening any session.

### 2. Work-design quality is visible

When workstream boundaries are wrong, the builder sees it: too many cross-workstream blockers signal hidden dependencies, sessions that don't fit the structure signal unclear boundaries, outputs that can't be consumed downstream signal implicit contracts, branch-local exports reveal integration risk, and unresolved design escalations signal design gaps.

### 3. Attention goes to high-leverage moments by default

Gates, wave transitions, design mismatches, and scope decisions surface for review. Everything else runs autonomously. Builder presence is a deliberate choice, not the normal mode.

## Artifact System

The durable backbone has two coordinated artifact surfaces whose physical locations are flexible:

1. **Project design docs** — in the source repo, a design repo, or the planning repo
2. **Workstream artifacts** — in a planning repo, the source repo, or a dedicated workstream repo

Alongside those committed artifacts, Streamliner keeps a **local runtime state surface** for fast-moving operational data such as session runtime state and tracker snapshots.

**Artifacts:** design index, living design docs, decision records, workstream brief, dependency graph, node specs.

**Not artifacts:** conversation history, status dashboards, session runtime state, tracker caches, ad-hoc chat summaries.

## Architecture Direction

### Local-First Web Application

Streamliner is a web app served by a local process and opened in any browser. There is no required Electron/Tauri shell. The same model is eventually deployable remotely.

### Registered Repositories

The builder registers where workstream artifacts live (planning repo, source repo, or elsewhere), participating source repositories, and where design docs live in each repo (default: `docs/design/`).

### Technology Stack

- **Frontend:** React, React Flow, modern web stack
- **Backend:** local Node/TypeScript server
- **Session tracking:** integration with terminal/process management
- **GitHub integration:** issue/PR enrichment and status

## What Streamliner Is NOT

- **Not a project management tool** — no sprints, story points, or team dashboards
- **Not a micromanagement tool** — autonomy is the default
- **Not a replacement for the issue tracker** — the tracker remains the source of truth for node-level specs
- **Not an IDE** — Streamliner does not edit code
- **Not a chat app** — the orchestrator is an AI session using artifacts, not a built-in chat surface
