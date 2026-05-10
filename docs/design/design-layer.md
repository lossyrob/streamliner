---
kind: design-doc
status: current
last_updated: 2026-05-10
update_semantics: rewrite-in-place
authoritative_for: "Project design layer and documentation-family authority model"
scope_tags:
  - design-docs
  - documentation-system
  - context-package
code_paths: []
references_decisions:
  - 11
---

# Design Layer

The design layer is Streamliner's project-level design authority. It sits above
execution artifacts (briefs, graphs, node specs) and describes the intended
system so any human or agent can align to current design without re-deriving it
from code or excavating chat history.

## Why the design layer exists

Streamliner's execution artifacts answer **what should happen now** inside a single workstream. They are not the right place to hold the project's shared intended design. Without a project-level design layer, four failure modes appear:

1. **Design drift** — parallel workstreams make locally correct but globally inconsistent choices.
2. **Rationale loss** — important design decisions live in chats, notes, and summaries that are easy to lose.
3. **Archaeology burden** — the builder searches transcripts, specs, and git history to answer "what is the current intended design?"
4. **Decision duplication** — briefs and node specs restate product decisions badly, then drift from the original source.

The design layer fills that gap.

## Project documentation families

Streamliner recognizes three project documentation families. They are peers in
the published documentation system, but they do not have the same authority.

| Family | Default source root | Required? | Owns |
|---|---|---|---|
| Design | `docs/design/` | Streamliner-native required context | Intended system behavior, invariants, constraints, accepted project direction, and significant rationale references |
| Architecture | `docs/architecture/` | Optional but recommended | Current-codebase orientation: module maps, runtime and data flow, storage surfaces, extension points, operational sharp edges, and where to look |
| User Guide | `docs/guide/` | Optional but recommended | User-facing tasks, setup, workflows, commands, visible behavior, and troubleshooting |

Design is the normative project context Streamliner expects every managed project
to provide or reference. Architecture and User Guide are discoverable
capabilities: Streamliner can surface, hint, and help maintain them when present,
but their absence does not block workstream launch or make agents invent them.

### Design

Design answers: **What is the intended system, and what constraints or decisions
should future work obey?**

Design includes implemented and not-yet-implemented intended state. It is written
for future work, not only for present code reading. Design owns normative rules,
project-level invariants, accepted constraints, cross-workstream contracts, and
links to decision records that explain why important choices were made.

### Architecture

Architecture answers: **How is the current codebase organized, and where should a
human or agent look to understand it?**

Architecture is descriptive and current-state oriented. It should avoid
restating all intended behavior from Design. Instead, it orients contributors and
agents to the implementation: major modules, runtime processes, data flow,
storage locations, integration boundaries, extension points, and sharp edges that
are expensive to rediscover from raw code.

### User Guide

User Guide answers: **How does a user install, configure, operate, and
troubleshoot Streamliner?**

User Guide is task-oriented and user-facing. It describes observable workflows,
commands, UI behavior, setup, operational procedures, and troubleshooting paths.
It is not a design authority and should not carry project rationale that future
work must obey.

### Implemented design handling

Design and Architecture are peers with different authority, not a graduation
pipeline. When intended design becomes implemented:

1. Keep normative intent, invariants, accepted constraints, and decision links in
   Design.
2. Move or rewrite implementation-detail orientation into Architecture when the
   project maintains Architecture docs.
3. Remove obsolete speculation from living Design docs rather than preserving it
   as active guidance.
4. Record major rationale in decision records, not Architecture.

For example, "workers treat Layer 0 as navigation hints rather than copied
design-document bodies" remains a Design rule after implementation. The modules,
functions, and storage paths that implement that rule belong in Architecture if
the project maintains it.

### Unpublished planning material

`.streamliner/shaping/` remains unpublished planning material. Shaping notes can
inform workstream formation, but they are not part of the published docs site and
are not authoritative project documentation.

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

### The builder is the design authority

Orchestrators and workers draft design-doc changes. The builder is the final authority on intended design. The cognitive load is review, not blank-page authoring, but the authority is explicit: design docs reflect builder intent.

## Design section artifacts

The Design section has three artifact types.

### 1. Design index — "Where do I start?"

One per project. The hub for cold readers. It provides:

- A short project overview
- Reading order through the design set
- The list of living design docs
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
  concepts/
    context-package.md
  decisions/
    001-use-react-flow.md
    002-planning-repo-as-git.md
    ...
```

Workstream artifacts live separately. The workstream references the design layer; it does not duplicate it.

## Interaction with workstreams

### Design docs do not reference workstreams

Design docs describe the project. Workstreams are transient execution vehicles. Reverse relationships (which workstreams touch this design area?) are derived from workstream references and code scope, never stored as backlinks inside design docs.

### Context package integration

The design layer is **Layer 0** of the [context package](concepts/context-package.md). Agents read the design docs directly as part of their context assembly.

Workstream `designRefs` point into this layer as starting points for attention and context assembly; they do not reduce the design layer to an allowlist.

### Design changes surface through PRs

When a worker's implementation changes the intended design, the design-doc updates appear in the PR diff. The reviewer — whether the orchestrator, a review agent, or the builder — sees those changes and evaluates whether they are consistent with the project's direction. No separate declaration mechanism is needed; the PR is the signal.

### What belongs in the brief vs. the design layer

| Concern | Design docs | Brief |
|---|---|---|
| Scope | Whole project | One workstream |
| Time horizon | Slow-changing | Fast-changing |
| Authority | Intended architecture and design decisions | Execution plan and operational state |
| Update style | Rewrite in place / append-only for decisions | Rewrite in place |
| Audience | Any workstream touching the project | Agents in this workstream |

The brief's `Decisions` section remains useful for **workstream-local execution decisions** but does not duplicate project-wide design decisions that already live in the design layer.
