# Streamliner Design Docs

> Design docs are the durable project-level design authority. They describe the intended system so any human or agent can align to current design without re-deriving it from code or excavating chat history.

---

## Why this layer exists

Streamliner already has a strong execution artifact model:

- the **brief** carries workstream intent and operational state
- the **graph** carries structure, dependencies, and durable planning state
- **node specs** carry node-level outcomes

Those artifacts are good at answering **what should happen now** inside a single workstream. Fast session telemetry and tracker overlays can sit beside them, but they should not become the design authority.

They are not the right place to hold the project's shared intended design. Without a project-level design layer, four failure modes appear:

1. **Design drift** - parallel workstreams make locally correct but globally inconsistent choices.
2. **Rationale loss** - important design decisions live in chats, notes, and summaries that are easy to lose.
3. **Archaeology burden** - the operator has to search transcripts, specs, and git history to answer "what is the current intended design?"
4. **Decision duplication** - briefs and node specs restate product decisions badly, then drift from the original source.

The design-doc component fills that gap.

---

## Core model

### Design docs describe intended state, not implementation snapshots

Code is the authoritative source for current implementation state. Agents are already good at reading code and discovering what exists.

Design docs should not try to mirror the implementation line by line. They describe the **intended system** in declarative present tense:

- what the architecture is
- how major components relate
- what constraints and boundaries apply
- what decisions are currently in force

An agent then computes the delta between that intended state and the current code as part of its work.

### The invariant

**Every design doc describes either what exists or what is intended to exist. Nothing else.**

That means:

- no abandoned directions left behind as if they were still active
- no "someday maybe" prose that no workstream actually serves
- no silent divergence between implementation and intended design

If the intended direction changes, the design doc changes. If implementation diverges, either the code is corrected or the design doc is updated. Temporary mismatches are allowed, but they must be explicit.

### Temporary solutions are flagged, not normalized

Temporary implementations are expected. They should be marked as temporary in code and called out during review.

The design docs continue to describe the intended end state, not the workaround. The gap is tracked explicitly through workstream review rather than hidden by rewriting the design docs to match a shortcut.

### Design docs are project-level, not workstream-level

Design docs describe the project in its entirety, not one workstream's slice of it.

Workstreams:

- **reference** design docs
- **apply** design docs
- **update** design docs when they materially change intended design

But they do not become the design authority themselves. This prevents the project from fragmenting into multiple inconsistent workstream-local truths.

### The operator is the design authority

Orchestrators and workers can draft design-doc changes. The operator is the final authority on intended design.

In practice, agents do the writing and the operator reviews. The cognitive load is review, not blank-page authoring. But the authority is explicit: the design docs reflect operator intent.

### Draft docs are opt-in, not default truth

`current` design docs are binding and can be loaded automatically for relevant work.

`draft` design docs are different:

- they are visible to the operator and orchestrator by default
- they are **not** loaded into worker context automatically
- they only reach workers when a workstream or issue explicitly references them because the work is shaping, validating, or implementing that draft

`superseded` docs are historical reference only.

---

## Document families

The design layer has three document families.

### 1. Design index - "Where do I start?"

One per project. This is the hub for cold readers.

It provides:

- a short overview of the project
- the reading order through the design set
- the list of living design docs
- the list of decision records
- current open design questions

### 2. Living design docs - "What are we building?"

These are the current intended design for coherent domains or concerns:

- architecture
- session system
- context package
- graph model
- operator presence

They are rewritten in place as the intended design evolves.

### 3. Decision records - "Why did we choose this?"

These capture architecturally significant choices and their rationale.

They are append-only once accepted. If a decision changes, a new record supersedes the old one.

---

## Repository layout

Design docs live in a dedicated directory, normally `docs/design/` in the repository they describe, though the location is configurable per project. They may also live in a separate design repo or the planning repo when the source repo is shared or external.

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

Workstream artifacts live separately — typically in a planning repository, though they can also live in the source repo or a dedicated workstream repo:

```text
workstreams/
  {workstream-id}/
    brief.md
    graph.json
    docs/
```

The workstream references the design layer; it does not duplicate it.

---

## Minimal document format

Design documents do not require YAML frontmatter. They start with a `# Title`
heading and keep metadata in places humans already maintain:

| Metadata | Source |
|---|---|
| Title | The document's `# H1` |
| Living-doc status, authority, and reading order | `docs/design/index.md` reading order and satellite-documents table |
| Decision number, title, status, and date | Decision filename, decision `# H1`, and decision log tables |
| Last updated and changelog | Git history |
| Relationships | Inline Markdown links, index tables, decision tables, and workstream `designRefs` |

Frontmatter is not a prerequisite for design authority or worker context. If
Streamliner later needs a machine-readable design catalog, that catalog is future
product work and should derive from the maintained markdown surfaces, git, and
workstream references rather than making authors maintain duplicate metadata on
every file.

Existing frontmatter in older design docs is not authoritative and can be removed
later as metadata-only cleanup. New or revised design docs should not add it.

### Design index template

```markdown
# {Project Name} - Design

{1-2 paragraph overview of the system being designed.}

## Reading order
1. **[architecture.md](architecture.md)** - System-level structure.
2. **[context-package.md](context-package.md)** - Layered context design.
3. ...

## Satellite documents
| Document | Status | Authoritative for |
|---|---|---|
| [architecture.md](architecture.md) | current | System architecture |
| [session-system.md](session-system.md) | draft | Session lifecycle |

## Decision log
| # | Decision | Status | Date |
|---|---|---|---|
| 001 | [Use React Flow](decisions/001-use-react-flow.md) | accepted | 2026-03-15 |

## Open questions
- {Open design question}
```

### Living design doc template

```markdown
# {Title}

{Write the intended design in declarative present tense.}
```

### Decision record template

```markdown
# 003. {Title}

> Supersedes: [002-previous-decision](002-previous-decision.md) *(if applicable)*

## Context
{Why this decision was needed.}

## Decision
{What was chosen.}

## Alternatives considered
{What else was considered and why it lost.}

## Consequences
{What follows from this choice.}
```

---

## Status semantics

### Design index and living design docs

Living design-doc status is maintained in the design index's satellite-documents
table.

| Status | Meaning | Default consumers |
|---|---|---|
| `current` | Binding design authority for its scope | Operator, orchestrator, worker |
| `draft` | Proposed direction under active shaping | Operator, orchestrator |
| `superseded` | Historical reference only | Reference only |

Workers should only receive a `draft` design doc when the workstream or issue explicitly references that draft because the node is participating in the design process.

### Decision records

| Status | Meaning | Default consumers |
|---|---|---|
| `proposed` | Under consideration; not binding | Operator, orchestrator |
| `accepted` | Binding rationale for current design direction | Operator, orchestrator, worker |
| `superseded` | Historical reference only | Reference only |

---

## How design docs interact with workstreams

### Workstreams reference design docs explicitly

Workstreams need both:

1. a **human-readable** list in the brief
2. a **machine-readable** list in the graph

The brief carries a `## Design References` section:

```markdown
## Design References
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/session-system.md` - authoritative session-system design
- `streamliner:docs/design/decisions/003-session-tracking-via-heartbeat.md` - rationale for heartbeat tracking
```

The graph carries the same information structurally:

```json
{
  "designRefs": [
    {
      "repoId": "streamliner",
      "path": "docs/design/index.md"
    },
    {
      "repoId": "streamliner",
      "path": "docs/design/session-system.md"
    },
    {
      "repoId": "streamliner",
      "path": "docs/design/decisions/003-session-tracking-via-heartbeat.md"
    }
  ]
}
```

The brief is the readable surface. `designRefs` is the deterministic surface Streamliner uses to point context assembly, node inspection, and design-aware review toward the right starting places. It is not an allowlist over the wider design layer.

### Design docs do not reference workstreams

Design docs describe the project. Workstreams are transient execution vehicles.

If Streamliner needs reverse relationships such as "which workstreams touch this design area?", it derives them from workstream references and code scope. It does not store workstream backlinks inside design docs.

### What belongs in the brief vs. the design layer

| Concern | Design docs | Brief |
|---|---|---|
| Scope | Whole project | One workstream |
| Time horizon | Slow-changing | Fast-changing |
| Authority | Intended architecture and design decisions | Execution plan and operational state |
| Update style | Rewrite in place, append-only for decisions | Rewrite in place |
| Audience | Any workstream touching the project | Agents in this workstream |

The brief's `Decisions` section is still useful, but only for **workstream-local execution decisions**. It should not duplicate project-wide design decisions that already live in design docs or decision records.

### Context package integration

The design layer becomes **Layer 0** of the context package:

- **Layer 0 - Project Design Context**: the design index, front-loaded `current` design docs and accepted decisions, with access to the broader design layer
- **Layer 1 - Workstream Intent**: Purpose, Approach, Design References, Boundaries
- **Layer 2 - Operational State**: Current State, Decisions, Open Questions
- **Layer 3 - Node Context**: wave context, node spec, coordination notes

Progressive disclosure matters:

- the design index is small enough to include broadly
- the initial bundle should front-load the design docs most relevant to the current work without turning `designRefs` into an allowlist
- draft docs should only be included when explicitly referenced

### Design impact on completion

Every completed node declares one of:

| Value | Meaning | Required follow-through |
|---|---|---|
| `none` | The work matched existing design and did not change it | No design diff required |
| `updated-docs` | The work changed or clarified intended design and updated docs accordingly | Design diff must be present in review |
| `decision-needed` | The work uncovered a meaningful mismatch or unresolved design choice | Explicit operator review required |

This declaration can live in PR metadata, worker completion output, or another review artifact, but Streamliner should treat it as first-class review data.

---

## What Streamliner needs to surface

### Core component

The initial first-class design-doc component should include:

1. repo-level configuration for where design docs live
2. design index and decision log parsing from maintained markdown tables
3. a design index viewer
4. a design doc viewer
5. design-aware node inspection using `designRefs`
6. Layer 0 context assembly
7. design-impact declarations in review flows

### Later extensions

Useful, but not part of the initial component:

1. a machine-readable design catalog derived from the index, decision tables,
   links, git history, and workstream references
2. automated "significant code diff with no design diff" warnings
3. a built-in design-doc editor
4. fitness functions that validate implementation against design
5. MCP exposure of the design catalog
6. cross-project design coordination

The core model should exist before the heavier automation. Otherwise Streamliner risks building noisy heuristics on top of an unstable document discipline.

---

## Relationship to Streamliner's existing root docs

For Streamliner itself, the current root docs map naturally onto this model:

- `DOCTRINE.md` - operating philosophy and delegation model
- `PRODUCT-SPEC.md` - product model and scope
- `WORKSTREAM-FORMAT.md` - reference spec for execution artifacts

These predate the repo-scoped `docs/design/` structure, but conceptually they are already part of the design layer. During a later migration, they can move under `docs/design/` if that proves cleaner for Streamliner's own repository.

---

## Summary

The design-doc component adds a project-level design layer above Streamliner's execution artifacts:

- **design docs** hold the intended architecture
- **decision records** hold durable rationale
- the **design index** is the entry point for cold readers
- workstreams reference the design layer explicitly through a brief section and graph `designRefs`
- the context package gains **Layer 0 - Project Design Context**
- `draft` docs are opt-in, not default worker truth
- the model starts with maintained markdown tables and explicit references before heavier freshness and validation automation

This is the smallest design system that stays coherent when one operator and many cold-starting agents work in parallel on an evolving codebase.
