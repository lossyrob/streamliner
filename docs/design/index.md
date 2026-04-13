# Streamliner — Design

This is the entry point for Streamliner's project-level design documentation. Start here to understand the system, then follow the reading order into the detail pages.

Streamliner helps a single builder direct many concurrent AI coding agent workstreams. It makes workstream-level thinking the natural operating mode — designing work with explicit boundaries, contracts, and gates, then monitoring autonomous execution through an operational picture that surfaces work-design quality.

## Reading order

1. **[product.md](product.md)** — What Streamliner is, who it's for, core concepts, and architecture.
2. **[operating-model.md](operating-model.md)** — Roles, information flow, presence, and operating rhythm.
3. **[design-layer.md](design-layer.md)** — How design docs work: document families, format, and status semantics.
4. **[workstream-format.md](workstream-format.md)** — Workstream artifact format: brief, graph, config, and runtime state separation.

### Concepts

- **[Context Package](concepts/context-package.md)** — The layered context model that solves the blank-slate problem for agent sessions.

## Satellite documents

| Document | Authoritative for |
|---|---|
| [product.md](product.md) | Product scope and architecture |
| [operating-model.md](operating-model.md) | Operating model: roles, information flow, and operating rhythm |
| [design-layer.md](design-layer.md) | Design-doc system: document families and interaction with workstreams |
| [workstream-format.md](workstream-format.md) | Workstream artifact format: brief, graph, config, and runtime state separation |
| [concepts/context-package.md](concepts/context-package.md) | Context package: layered context model for agent sessions |

## Decision log

| # | Decision | Status | Date |
|---|---|---|---|

_No decisions recorded yet. See [decisions/](decisions/) for the template and conventions._

## Open questions

- **Session tracking mechanism**: How does Streamliner discover and monitor Copilot CLI sessions across environments?
- **Operator presence UX**: What does "joining" a session look like in practice?
- **Auth and GitHub tokens**: How does Streamliner authenticate with GitHub for enrichment and issue management?
- **Context package delivery**: How does Layer 0–3 context reach a worker session in practice?
- **Orchestrator execution model**: Should the orchestrator be a single persistent session, SDK-driven helpers that fork sessions for specific tasks, or a combination?
- **Portfolio layer stability**: The portfolio layer concept (projects, cross-workstream coordination, session attachment) is still a working draft and not yet codified as design authority.
