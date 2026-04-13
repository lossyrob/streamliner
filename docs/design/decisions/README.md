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
| `superseded` | Historical reference only — see `superseded_by` for the replacement |

## Template

New decision records follow this structure:

```markdown
# NNN. Title

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

_No decisions recorded yet._
