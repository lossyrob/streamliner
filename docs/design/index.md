---
kind: design-doc
status: current
last_updated: 2026-05-02
update_semantics: rewrite-in-place
authoritative_for: "Design documentation entry point, reading order, and decision log"
scope_tags:
  - design-docs
  - navigation
code_paths: []
references_decisions:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
  - 9
  - 10
---

# Streamliner — Design

This is the entry point for Streamliner's project-level design documentation. Start here to understand the system, then follow the reading order into the detail pages.

Streamliner helps a single builder direct many concurrent AI coding agent workstreams. It makes workstream-level thinking the natural operating mode — designing work with explicit boundaries, contracts, and gates, then monitoring autonomous execution through an operational picture that surfaces work-design quality.

## Reading order

1. **[product.md](product.md)** — What Streamliner is, who it's for, core concepts, and architecture.
2. **[operating-model.md](operating-model.md)** — Roles, information flow, presence, and operating rhythm.
3. **[design-layer.md](design-layer.md)** — How design docs work: document families and interaction with workstreams.
4. **[workstream-format.md](workstream-format.md)** — Workstream artifact format: brief, graph, config, and runtime state separation.
5. **[session-system.md](session-system.md)** — Session launching, lifecycle, registry contract, tracking, and runtime overlay.

### Concepts

- **[Context Package](concepts/context-package.md)** — The layered context model that solves the blank-slate problem for agent sessions.
- **[Waves](concepts/waves.md)** — Wave-based planning: promotion, checkpoints, and gate boundaries.

## Satellite documents

| Document | Authoritative for |
|---|---|
| [product.md](product.md) | Product scope and architecture |
| [operating-model.md](operating-model.md) | Operating model: roles, information flow, and operating rhythm |
| [design-layer.md](design-layer.md) | Design-doc system: document families and interaction with workstreams |
| [workstream-format.md](workstream-format.md) | Workstream artifact format: brief, graph, config, and runtime state separation |
| [session-system.md](session-system.md) | Session launching, lifecycle, registry contract, tracking, and runtime overlay (draft) |
| [concepts/context-package.md](concepts/context-package.md) | Context package: layered context model for agent sessions |
| [concepts/waves.md](concepts/waves.md) | Waves: wave-based planning, promotion, and gate boundaries |

## Decision log

| # | Decision | Status | Date |
|---|---|---|---|
| 001 | [Observation-based session tracking](decisions/001-observation-based-session-tracking.md) | accepted | 2026-04-14 |
| 002 | [File-based context delivery](decisions/002-file-based-context-delivery.md) | accepted | 2026-04-14 |
| 003 | [PAW control state as the workflow progression source](decisions/003-paw-control-state-integration.md) | superseded | 2026-04-20 |
| 004 | [Session registry as the primary session surface](decisions/004-session-registry-primary-surface.md) | accepted | 2026-04-21 |
| 005 | [Session registry storage and identity model](decisions/005-session-registry-storage-and-identity.md) | accepted | 2026-04-21 |
| 006 | [Local Streamliner API service](decisions/006-local-streamliner-api-service.md) | accepted | 2026-04-28 |
| 007 | [Tracked workstream registry](decisions/007-tracked-workstream-registry.md) | accepted | 2026-05-01 |
| 008 | [PAW artifacts for workflow status](decisions/008-paw-artifacts-for-workflow-status.md) | accepted | 2026-05-02 |
| 009 | [SDK-managed graph-node worker runtime](decisions/009-sdk-managed-worker-runtime.md) | accepted | 2026-05-07 |
| 010 | [Terminal takeover and managed cleanup actions](decisions/010-terminal-takeover-and-cleanup.md) | accepted | 2026-05-09 |

## Open questions

- **Orchestrator execution model**: Should the orchestrator be a single persistent session, SDK-driven helpers that fork sessions for specific tasks, or a combination?
- **Portfolio layer stability**: The portfolio layer concept (projects, cross-workstream coordination, session attachment) is still a working draft and not yet codified as design authority.
