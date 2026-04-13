---
kind: design-doc
status: current
last_updated: 2026-04-13
update_semantics: rewrite-in-place
authoritative_for: "Context package: layered context model for agent sessions"
scope_tags:
  - context-package
code_paths: []
references_decisions: []
---

# Context Package

AI agents start every session as blank slates. Human teams carry shared context in memory and habit. The context package replaces that with an explicit, layered set of committed artifacts.

The context package is designed to be:

- **Complete** — everything needed to act responsibly
- **Layered** — each role gets what it needs
- **Progressive** — broad context first, deeper context only when needed
- **Bounded** — small enough to fit inside a useful context budget

## Layer 0 — Project Design Context

The project's intended design: the design docs and decision records that describe the system being built, with the design index as the cold-reader entry point.

Answers: What system are we building? What constraints are in force? What rationale must be honored?

## Layer 1 — Workstream Intent

The workstream's durable intent: Purpose, Approach, Design References, and Boundaries.

This is how the builder narrows project-level design into a specific effort — defining the workstream's boundaries and design surface.

## Layer 2 — Operational State

The current situation: Current State, Decisions, and Open Questions.

This layer orients the orchestrator and builder to what just happened, what is in flight, and what comes next. It is a durable summary, not a telemetry feed. Session heartbeats, tracker caches, and launch metadata live outside the committed artifact layer.

## Layer 3 — Node Context

What a worker receives for a specific node: wave context, node spec, coordination notes, and any node-specific design narrowing.

The worker never reconstructs the whole workstream. It receives project design, workstream intent, operational state, and the node's specific mission.

## Progressive Disclosure

The design index is small enough to include broadly. Only the design docs relevant to the current work need to load. Each successive layer narrows context further — from the entire project down to one node's mission.
