---
kind: design-doc
status: current
last_updated: 2026-04-12
update_semantics: rewrite-in-place
authoritative_for: "Design-doc system: document families, format, status semantics, and catalog"
scope_tags:
  - design-layer
  - design-docs
  - design-catalog
code_paths:
  - docs/design/**
references_decisions: []
---

# Design Layer

The design layer is Streamliner's project-level design authority. It sits above execution artifacts (briefs, graphs, node specs) and describes the intended system so any human or agent can align to current design without re-deriving it from code or excavating chat history.

## Why the design layer exists

Streamliner's execution artifacts answer **what should happen now** inside a single workstream. They are not the right place to hold the project's shared intended design. Without a project-level design layer, four failure modes appear:

1. **Design drift** — parallel workstreams make locally correct but globally inconsistent choices.
2. **Rationale loss** — important design decisions live in chats, notes, and summaries that are easy to lose.
3. **Archaeology burden** — the operator searches transcripts, specs, and git history to answer "what is the current intended design?"
4. **Decision duplication** — briefs and node specs restate product decisions badly, then drift from the original source.

The design layer fills that gap.

## Core model

### Intended state, not implementation snapshots

Code is the authoritative source for current implementation state. Design docs describe the **intended system** in declarative present tense: what the architecture is, how major components relate, what constraints apply, and what decisions are in force. Agents compute the delta between intended state and current code as part of their work.

### The invariant

**Every design doc describes either what exists or what is intended to exist. Nothing else.**

- No abandoned directions left behind as if still active.
- No "someday maybe" prose that no workstream serves.
- No silent divergence between implementation and intended design.

If the intended direction changes, the design doc changes. If implementation diverges, either the code is corrected or the design doc is updated. Temporary mismatches are allowed but must be explicit.

### Temporary solutions are flagged, not normalized

Temporary implementations are expected and marked as temporary in code. Design docs continue to describe the intended end state, not the workaround. The gap is tracked through workstream review rather than hidden by rewriting design docs to match a shortcut.

### Project-level, not workstream-level

Design docs describe the project in its entirety. Workstreams **reference**, **apply**, and **update** design docs — but they do not become the design authority themselves. This prevents the project from fragmenting into workstream-local truths.

### The operator is the design authority

Orchestrators and workers draft design-doc changes. The operator is the final authority on intended design. The cognitive load is review, not blank-page authoring, but the authority is explicit: design docs reflect operator intent.

### Draft docs are opt-in, not default truth

`current` design docs are binding and load automatically for relevant work. `draft` design docs are visible to operator and orchestrator but are **not** loaded into worker context automatically — they only reach workers when a workstream explicitly references them because the work is shaping, validating, or implementing that draft.

## Document families

The design layer has three document families.

### 1. Design index — "Where do I start?"

One per project. The hub for cold readers. It provides:

- A short project overview
- Reading order through the design set
- The list of living design docs with status
- The list of decision records
- Current open design questions

### 2. Living design docs — "What are we building?"

The current intended design for coherent domains or concerns (architecture, session system, context package, graph model, etc.). They are rewritten in place as the intended design evolves.

### 3. Decision records — "Why did we choose this?"

Architecturally significant choices and their rationale. Append-only once accepted. If a decision changes, a new record supersedes the old one.

## Repository layout

Design docs live in `docs/design/` in the repository they describe. The location is configurable per project. They may also live in a separate design repo or planning repo when the source repo is shared or external.

```text
docs/design/
  index.md
  architecture.md
  session-system.md
  context-package.md
  ...
  decisions/
    001-use-react-flow.md
    002-planning-repo-as-git.md
    ...
```

Workstream artifacts live separately. The workstream references the design layer; it does not duplicate it.

## Document format

Every design document carries YAML frontmatter. Streamliner derives a machine-readable catalog from that frontmatter rather than asking authors to maintain a second artifact by hand.

### Required fields — all design docs

| Field | Type | Purpose |
|---|---|---|
| `kind` | `design-index` \| `design-doc` \| `decision` | Document family |
| `status` | kind-specific enum | Whether the document is binding, draft, or historical |
| `last_updated` | `YYYY-MM-DD` | Last substantive update |
| `update_semantics` | `rewrite-in-place` \| `append-only` | How the document evolves |

### Additional fields — living design docs

| Field | Type | Purpose |
|---|---|---|
| `authoritative_for` | string | Human-readable statement of what this doc owns |
| `scope_tags` | string[] | Short machine-readable labels for the design area |
| `code_paths` | string[] | Repo-relative globs approximating which code areas this doc covers |
| `references_decisions` | number[] | Accepted decision records this doc depends on |

### Additional fields — decision records

| Field | Type | Purpose |
|---|---|---|
| `number` | number | Sequential decision number |
| `date` | `YYYY-MM-DD` | Decision date |
| `superseded_by` | number \| null | Replacement decision, if any |
| `supersedes` | number \| null | Earlier decision replaced by this one, if any |

### Design index template

```markdown
---
kind: design-index
status: current
last_updated: YYYY-MM-DD
update_semantics: rewrite-in-place
---

# {Project Name} — Design

{1–2 paragraph overview of the system being designed.}

## Reading order
1. **[architecture.md](architecture.md)** — System-level structure.
2. **[context-package.md](context-package.md)** — Layered context design.

## Satellite documents
| Document | Status | Authoritative for |
|---|---|---|
| [architecture.md](architecture.md) | current | System architecture |

## Decision log
| # | Decision | Status | Date |
|---|---|---|---|
| 001 | [Use React Flow](decisions/001-use-react-flow.md) | accepted | 2026-03-15 |

## Open questions
- {Open design question}
```

### Living design doc template

```markdown
---
kind: design-doc
status: current
last_updated: YYYY-MM-DD
update_semantics: rewrite-in-place
authoritative_for: "Session lifecycle, launch, and crash recovery"
scope_tags:
  - sessions
  - crash-recovery
code_paths:
  - src/session/**
references_decisions:
  - 3
---

# {Title}

{Write the intended design in declarative present tense.}
```

### Decision record template

```markdown
---
kind: decision
number: 3
status: accepted
date: YYYY-MM-DD
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 003. {Title}

## Context
{Why this decision was needed.}

## Decision
{What was chosen.}

## Alternatives considered
{What else was considered and why it lost.}

## Consequences
{What follows from this choice.}
```

## Status semantics

### Design index and living design docs

| Status | Meaning | Default consumers |
|---|---|---|
| `current` | Binding design authority for its scope | Operator, orchestrator, worker |
| `draft` | Proposed direction under active shaping | Operator, orchestrator |
| `superseded` | Historical reference only | Reference only |

Workers receive a `draft` design doc only when the workstream or issue explicitly references that draft because the node is participating in the design process.

### Decision records

| Status | Meaning | Default consumers |
|---|---|---|
| `proposed` | Under consideration; not binding | Operator, orchestrator |
| `accepted` | Binding rationale for current design direction | Operator, orchestrator, worker |
| `superseded` | Historical reference only | Reference only |

## Derived design catalog

Streamliner derives a repo-scoped design catalog from frontmatter. The markdown remains authoritative; the catalog exists so context assembly and UI surfaces can be deterministic.

```json
{
  "repoId": "streamliner",
  "rootPath": "docs/design",
  "indexPath": "docs/design/index.md",
  "docs": [
    {
      "path": "docs/design/session-system.md",
      "kind": "design-doc",
      "status": "current",
      "updateSemantics": "rewrite-in-place",
      "authoritativeFor": "Session lifecycle, launch, and crash recovery",
      "scopeTags": ["sessions", "crash-recovery"],
      "codePaths": ["src/session/**"],
      "referencesDecisions": [3, 8]
    }
  ]
}
```

This catalog answers: which design docs are relevant to this workstream? Which docs cover the code touched by this node? Which accepted decisions travel with the context package?

## Interaction with workstreams

### Workstreams reference design docs explicitly

Workstreams carry both a **human-readable** list in the brief and a **machine-readable** list in the graph.

The brief carries a `## Design References` section:

```markdown
## Design References
- `streamliner:docs/design/index.md` — entry point for the project design set
- `streamliner:docs/design/session-system.md` — authoritative session-system design
```

The graph carries `designRefs`:

```json
{
  "designRefs": [
    { "repoId": "streamliner", "path": "docs/design/index.md" },
    { "repoId": "streamliner", "path": "docs/design/session-system.md" }
  ]
}
```

The brief is the readable surface. `designRefs` is the deterministic surface Streamliner uses for context assembly, node inspection, and design-aware review.

### Design docs do not reference workstreams

Design docs describe the project. Workstreams are transient execution vehicles. Reverse relationships (which workstreams touch this design area?) are derived from workstream references and code scope, never stored as backlinks inside design docs.

### Context package integration

The design layer is **Layer 0** of the context package:

- **Layer 0 — Project Design Context**: relevant `current` design docs and accepted decisions
- **Layer 1 — Workstream Intent**: purpose, approach, design references, boundaries
- **Layer 2 — Operational State**: current state, decisions, open questions
- **Layer 3 — Node Context**: wave context, node spec, coordination notes

Progressive disclosure: the design index is small enough to include broadly; only design docs relevant to the current work load automatically; draft docs are included only when explicitly referenced.

### Design impact on completion

Every completed node declares one of:

| Value | Meaning | Required follow-through |
|---|---|---|
| `none` | The work matched existing design | No design diff required |
| `updated-docs` | The work changed intended design and updated docs | Design diff must be present in review |
| `decision-needed` | The work uncovered a mismatch or unresolved design choice | Explicit operator review required |

Streamliner treats this declaration as first-class review data.

### What belongs in the brief vs. the design layer

| Concern | Design docs | Brief |
|---|---|---|
| Scope | Whole project | One workstream |
| Time horizon | Slow-changing | Fast-changing |
| Authority | Intended architecture and design decisions | Execution plan and operational state |
| Update style | Rewrite in place / append-only for decisions | Rewrite in place |
| Audience | Any workstream touching the project | Agents in this workstream |

The brief's `Decisions` section remains useful for **workstream-local execution decisions** but does not duplicate project-wide design decisions that already live in the design layer.
