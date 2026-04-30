---
kind: design-doc
status: current
last_updated: 2026-04-30
update_semantics: rewrite-in-place
authoritative_for: "Layered context package concept and progressive-disclosure model"
scope_tags:
  - context-package
  - launch-context
code_paths:
  - src/server/launch-context.ts
references_decisions:
  - 2
---

# Context Package

AI agents start every session as blank slates. Human teams carry shared context in memory and habit. The context package replaces that with one SDK-synthesized orientation file containing layered sections and references.

The context package is designed to be:

- **Complete enough to navigate** — enough synthesized orientation and links to act responsibly
- **Layered conceptually** — each role gets what it needs without forcing multiple files
- **Progressive** — broad context first, deeper context only when needed
- **Bounded** — small enough to fit inside a useful context budget

## Layer 0 — Project Design Context

The project's intended design: a reference index to the design docs and decision records that describe the system being built, with the design index as the cold-reader entry point. Layer 0 points at the authoritative docs from the generated `context.md`; it does not copy their bodies into the generated package.

Answers: What system are we building? What constraints are in force? What rationale must be honored?

## Layer 1 — Worker Mission

The selected node's concrete responsibility, key boundaries, and direct source-of-truth references.

This is where SDK synthesis matters most: the workstream's durable intent is source material, but the generated context must not make the worker think it owns the whole workstream.

## Layer 2 — Relevant State

The current situation that affects this worker: relevant state, decisions, constraints, and missing inputs.

This layer orients the worker to what just happened, what is in flight, and what matters for the selected node. Session runtime state, tracker caches, and launch metadata live outside the committed artifact layer.

## Layer 3 — Coordination Context

What a worker receives for a specific node: wave context, node spec reference, coordination notes, and any node-specific design narrowing.

The worker never reconstructs the whole workstream. It receives references to project design, focused workstream intent and operational state, and the node's specific mission.

## Progressive Disclosure

Workers retain access to the full design set through the repo. The generated Layer 0 reference index names the design index plus the most relevant design docs to read first, then the worker can keep reading deeper from the broader design layer as needed. Design References bias ordering and emphasis — they tell the session what to look at first, not what it is forbidden to read. Each successive section in `context.md` narrows context further — from the entire project down to one node's mission — without requiring separate file reads.
