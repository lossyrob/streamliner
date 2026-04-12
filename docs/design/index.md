---
kind: design-index
status: current
last_updated: 2026-04-12
update_semantics: rewrite-in-place
---

# Streamliner — Design

Streamliner is a local-first web application for developers who use AI coding agents to execute multi-issue bodies of work. It makes workstream-level thinking the natural operating mode: the developer designs workstreams with explicit boundaries, contracts, and gates, then monitors autonomous execution through an operational picture that surfaces work design quality and reserves attention for high-leverage moments.

The core insight: when execution is cheap, the bottleneck moves to the design of the work itself — not the design of the system being built, but the boundaries, contracts, and sequencing of the workstreams that build it.

## Reading order

1. **[product.md](product.md)** — What Streamliner is, who it's for, core concepts, architecture, and V1 scope.
2. **[operating-model.md](operating-model.md)** — Roles, context package, information flow, presence, and operating rhythm.
3. **[design-layer.md](design-layer.md)** — How design docs work: document families, format, status semantics, and catalog.
4. **[workstream-format.md](workstream-format.md)** — Workstream artifact format: brief, graph, config, and runtime state separation.

## Satellite documents

| Document | Status | Authoritative for |
|---|---|---|
| [product.md](product.md) | current | Product scope, architecture, and V1 goals |
| [operating-model.md](operating-model.md) | current | Operating model: roles, context package, information flow, and operating rhythm |
| [design-layer.md](design-layer.md) | current | Design-doc system: document families, format, status semantics, and catalog |
| [workstream-format.md](workstream-format.md) | current | Workstream artifact format: brief, graph, config, and runtime state separation |

## Decision log

| # | Decision | Status | Date |
|---|---|---|---|

_No decisions recorded yet. See [decisions/](decisions/) for the template and conventions._

## Open questions

- **Session tracking mechanism**: How does Streamliner discover and monitor Copilot CLI sessions across environments?
- **Operator presence UX**: What does "joining" a session look like in practice?
- **Auth and GitHub tokens**: How does Streamliner authenticate with GitHub for enrichment and issue management?
- **Context package delivery**: How does Layer 0–3 context reach a worker session in practice?
- **Orchestrator skill design**: What does the skill look like that manages wave progression and artifact updates?
- **Design relevance heuristics**: How should Streamliner map changed files and nodes to design docs when explicit references are missing or too broad?
- **Portfolio layer stability**: The portfolio layer concept (projects, cross-workstream coordination, session attachment) is still a working draft and not yet codified as design authority.
