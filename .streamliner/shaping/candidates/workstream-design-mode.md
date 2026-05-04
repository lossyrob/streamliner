# Workstream Design Mode

## Stage

Shaped, still evolving through dogfooding.

## Seed Idea

This session is acting as a prototype of a higher-level Streamliner mode: a workstream design session. Its purpose is to turn ambiguous, cross-cutting builder intent into shaped candidate workstreams, dependency relationships, open questions, and handoff briefs that a separate workstream orchestrator can execute.

The mode sits above the normal orchestrator. The workstream designer decides what workstreams should exist; the workstream orchestrator runs one shaped workstream; workers execute graph nodes inside that workstream.

## Why It Matters

Streamliner currently helps execute work once it has a workstream shape, but fuzzy product and operating-model ideas often arrive before the right workstreams are obvious. Without a design mode, those ideas either stay in chat history or get forced too early into implementation plans.

Workstream design mode should make the geometry of the work explicit before execution begins.

## Candidate Scope

### In Scope

- Capture new candidate workstream ideas immediately in sparse shaping notes.
- Help the builder discuss one candidate at a time and progressively fill in scope, boundaries, dependencies, exportable interfaces, and handoff text at workstream scale.
- Detect dependencies between candidates and record them in the relevant shaping notes.
- Maintain an index of candidate workstreams and their shaping stage.
- Produce issue-ready or orchestrator-ready handoff briefs for candidates that are ready to promote.
- Preserve learning from dogfooding the process so Streamliner can later encode the mode as product behavior, documentation, a skill, or a custom agent.

### Out of Scope

- Executing the shaped workstreams directly inside the design session.
- Over-designing implementation details that should be left to the dedicated workstream orchestrator.
- Collapsing a workstream-sized idea into a narrow "first issue" or minimal first slice unless the builder explicitly wants that.
- Treating shaping notes as project-level design authority.
- Replacing `docs/design/` or committed workstream artifacts.
- Forcing every idea into a full workstream before it has been shaped.

### Deferred

- Automating candidate detection from conversation.
- First-class UI for shaping-stage candidates.
- Formal schema for shaping notes.
- Promotion tooling that creates issues or `.streamliner/workstreams/{id}/` artifacts automatically.

## Shaping Bundle Storage Decision

Nascent shaping bundles live under `.streamliner/shaping/`:

```text
.streamliner/
  shaping/
    index.md
    candidates/
      {candidate-id}.md
  workstreams/
    {workstream-id}/
      brief.md
      graph.json
```

The shaping directory lives alongside workstream artifacts because candidates are pre-workstream planning artifacts. It does not live under `docs/design/` because the design layer is the project-level intended-state authority, while shaping notes are transient, exploratory, and candidate-specific.

If Streamliner later supports a separate planning repository, the same structure can move there without changing the conceptual model.

## Shaping Bundle Lifecycle

| Stage | When it happens | Artifact state |
|---|---|---|
| Seeded | A new idea appears in conversation. | Candidate note has title and seed idea only. |
| Shaped | The candidate is intentionally discussed. | Scope, why it matters, workstream-scale deliverables, boundaries, and open questions are filled in. |
| Connected | Dependencies across candidates are detected. | Depends on, enables, and related candidates are recorded. |
| Ready for issue | The candidate has a clear workstream boundary and enough exported expectations for another session to orchestrate it. | Handoff brief is written for a tracker issue or orchestrator session. |
| Promoted | The builder chooses to execute it. | A real workstream and/or tracker issue is created. |

## Candidate Note Template

```markdown
# {Candidate Workstream}

## Stage

Seeded

## Seed Idea

{The rough idea as first captured.}

## Why It Matters

## Candidate Scope

### In Scope

### Out of Scope

### Deferred

## Dependencies

### Depends On

### Enables

### Related Candidates

## Workstream Shape

## Exported Interfaces and Dependencies

{What this candidate needs from other workstreams, what it promises to produce, and which checkpoints or artifacts should connect to other workstreams.}

## Open Questions

## Handoff Brief
```

## Dependencies

### Depends On

- None identified yet.

### Enables

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because plugin-provided roles should be based on a clear model of workstream designer, orchestrator, worker, and reconciler responsibilities.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because worker guidance should be shaped as part of the role/context system.
- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because cross-workstream modeling depends on knowing how candidate workstreams are identified and related during design.

### Related Candidates

- [Documentation System](documentation-system.md), because the shaping process may produce documentation conventions and may rely on clear separation between design, architecture, user, and shaping docs.
- [Work Geometry Canvas](work-geometry-canvas.md), because both are concerned with making the shape of work visible.

## Shaping Depth Guidance

Workstream design mode should shape work at the level needed to start a dedicated orchestrator session, not at the level needed to implement the work itself.

The design session should answer:

- What is the workstream-sized chunk of work?
- Why does it matter?
- What broad deliverables belong inside the workstream?
- What is out of bounds?
- What other candidate workstreams does it depend on or enable?
- What exportable interfaces, checkpoints, or artifacts need to connect this workstream to others?
- What decisions are necessary before an orchestrator can begin?

The design session should avoid:

- Prematurely decomposing the work into detailed nodes.
- Minimizing the workstream into a first GitHub issue.
- Answering local implementation questions that the dedicated orchestrator can resolve.
- Treating "first useful slice" as the primary shaping goal for large workstreams.

The right output is a big-enough shape: enough boundary, dependency, and interface clarity that a dedicated orchestrator can build the workstream, not a full design or implementation plan.

## Work Geometry Primitives

Workstream design mode should treat Streamliner as a system for making work geometry explicit. The goal is not just to name workstreams, but to understand how the chunks of work fit together: where they touch, what they exchange, what must happen before what, and where builder judgment is required.

Existing design docs already imply these primitives:

| Primitive | Meaning in workstream design |
|---|---|
| Workstream | A workstream-sized body of work with its own orchestrator, brief, graph, and durable boundary. |
| Boundary | The edge around a workstream: what belongs inside, what belongs outside, and what should not silently leak. |
| Contract | The expectation one workstream creates for another: an API, artifact, behavior, doc convention, schema, UI affordance, or operating rule. |
| Export | A concrete output another workstream can consume: a decision, design doc update, schema, config shape, checkpoint result, published artifact, or implementation capability. |
| Import | A dependency this workstream needs from another workstream before it can proceed safely or finish cleanly. |
| Dependency | A sequencing or alignment relationship between workstreams, nodes, checkpoints, or exported artifacts. |
| Checkpoint | A named moment where progress becomes inspectable and potentially consumable downstream. In cross-workstream design, checkpoints are good candidates for export/import edges. |
| Gate | A checkpoint requiring builder judgment before downstream work proceeds. Gates protect later work from building on unvalidated assumptions. |
| Wave | A planning horizon. Near work is detailed; later work stays sketchy until earlier outputs make the next geometry clearer. |
| Artifact | The durable file-backed representation of intent, plan, state, or output: design docs, shaping notes, briefs, graphs, node specs, decision records, and future doc catalogs. |
| Role | The authority boundary between builder, workstream designer, orchestrator, worker, and reconciler. Misplaced authority creates bad geometry. |
| Feedback signal | Evidence that the geometry is wrong or incomplete: cross-workstream blockers, outputs that cannot be consumed, sessions that do not fit the boundary, hidden coupling, or unresolved design escalations. |

During shaping, the designer should look especially for **edges**:

- Where does this candidate need an import from another workstream?
- What exports will this candidate produce for others?
- Which exports are decisions versus implementation artifacts versus documentation versus runtime/product capabilities?
- Which edges need checkpoints or gates?
- Which boundaries are likely to leak through hot work?
- Which feedback signals would tell us later that the workstream was shaped incorrectly?

This elevates workstream design from "make a list of projects" to "design the geometry of parallel AI-assisted work."

## First Dogfood Slice

Create and dogfood a lightweight `.streamliner/shaping/` artifact set:

1. Add a shaping index.
2. Add sparse candidate notes for current ideas.
3. Fill the workstream-design-mode note with the storage, lifecycle, and role decisions discovered in this session.
4. Continue updating candidate notes as discussion reveals scope, dependencies, and handoff briefs.

## Open Questions

- Should shaping notes eventually have frontmatter or a JSON companion so Streamliner can render them in the UI?
- Should candidate dependencies be duplicated in both notes for readability, centralized in the index, or stored in a future structured graph?
- What is the threshold for promoting a candidate from shaping note to tracker issue?
- Should workstream design mode become a custom agent, a skill, product UI, or all three at different maturity stages?

## Handoff Brief

Not ready yet. The first handoff should likely ask an orchestrator to build first-class support for workstream design mode after this dogfooding session produces enough examples.
