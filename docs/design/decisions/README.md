---
kind: design-doc
status: current
last_updated: 2026-04-21
update_semantics: rewrite-in-place
authoritative_for: "Decision record conventions and catalog"
scope_tags:
  - decisions
  - architecture
code_paths: []
references_decisions:
  - 1
  - 2
  - 3
  - 4
  - 5
---

# Decision Records

This directory holds architecturally significant decisions for Streamliner.

## Conventions

- **Numbering**: Sequential, zero-padded to three digits (e.g., `001-use-react-flow.md`)
- **File naming**: `{number}-{slug}.md` where slug is a short kebab-case description
- **Append-only**: Once accepted, a decision record is not edited. If the decision changes, a new record supersedes the old one.

## Status values

| Status | Meaning |
|--------|---------|
| `proposed` | Under consideration; not binding |
| `accepted` | Binding rationale for current design direction |
| `superseded` | Historical reference only — note the replacement in the decision body |

## Template

New decision records follow this structure:

```markdown
# NNN. Title

> Supersedes: [002-previous-decision](002-previous-decision.md) *(if applicable)*

## Context
Why this decision is needed.

## Decision
What was chosen.

## Alternatives considered
What else was considered and why it lost.

## Consequences
What follows from this choice.
```

## Current decisions

| # | Decision | Status | Date |
|---|---|---|---|
| 001 | [Observation-based session tracking](001-observation-based-session-tracking.md) | accepted | 2026-04-14 |
| 002 | [File-based context delivery](002-file-based-context-delivery.md) | accepted | 2026-04-14 |
| 003 | [PAW control state as the workflow progression source](003-paw-control-state-integration.md) | accepted | 2026-04-20 |
| 004 | [Session registry as the primary session surface](004-session-registry-primary-surface.md) | accepted | 2026-04-21 |
| 005 | [Session registry storage and identity model](005-session-registry-storage-and-identity.md) | accepted | 2026-04-21 |
