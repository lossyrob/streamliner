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
- Define the candidate -> active workstream -> archived workstream lifecycle and
  how it should appear in Streamliner UI.
- Define promotion and archive flows: turning a candidate into a formed
  workstream, and moving completed/stale workstreams out of the main active
  list without losing history.
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
- Formal schema for shaping notes.
- Fully automated promotion tooling that creates issues or workstream artifacts
  without a formation session.
- Bulk archive/migration tooling for existing workstream collections.

## Workstream Lifecycle Direction

The current dogfood artifact set lives under `.streamliner/shaping/`, but that
should not necessarily become the product model. The stronger product framing is
**workstream lifecycle**:

1. **Candidate workstream** — a shaped or partially shaped possible workstream.
2. **Active workstream** — a formed workstream with `brief.md`, `graph.json`,
   nodes, waves, gates, and execution/reconciliation state.
3. **Archived workstream** — a historical workstream that should not appear in
   the main active list by default but remains available for reference,
   dependency history, and learning.

In that framing, "shaping" is an activity, not the durable top-level category.
The durable object is a **candidate**. Candidate workstreams should probably live
in or alongside the workstream artifact area, rather than in a separate conceptual
silo that makes them feel disconnected from formed workstreams.

Possible future layout shape:

```text
.streamliner/
  workstreams/
    candidates/
      {candidate-id}.md
    {workstream-id}/
      brief.md
      graph.json
    archive/
      {archived-workstream-id}/
        brief.md
        graph.json
```

This is not a finalized path/schema decision. A formed workstream should decide
whether candidates are single markdown files, directories with supporting
artifacts, entries in an index plus detail files, or some hybrid. The important
direction is that Streamliner should model candidates, active workstreams, and
archived workstreams as related lifecycle states.

The old `.streamliner/shaping/` dogfood directory remains useful as the current
session's working scratchpad. Product work should be free to migrate or reinterpret
it as `.streamliner/workstreams/candidates/` or another lifecycle-oriented layout.

The lifecycle area still should not live under `docs/design/`: the design layer is
project-level intended-state authority, while candidates and active workstreams are
work planning/execution artifacts.

If Streamliner later supports a separate planning repository, the same structure can move there without changing the conceptual model.

## Candidate Lifecycle

| Stage | When it happens | Artifact state |
|---|---|---|
| Seeded candidate | A new idea appears in conversation. | Candidate has title and seed idea only. |
| Shaping candidate | The candidate is intentionally discussed. | Scope, why it matters, boundaries, dependencies, and open questions are filled in. |
| Ready candidate | The candidate has a clear workstream boundary and enough expectations for another session to form it. | Handoff brief is written for a focused formation session. |
| Active workstream | The builder promotes the candidate through formation. | A focused formation session creates the real workstream brief, graph, first-wave specs/issues, gates, and checkpoints. |
| Archived workstream | The workstream is completed, superseded, paused indefinitely, or no longer part of the active planning surface. | The workstream moves to an archive location or archived state and no longer appears in the default active list. |

The UI should make this lifecycle visible. A builder should be able to see
candidate workstreams, inspect and edit their shaping state, choose a candidate
to promote through a workstream creation/formation session, see active
workstreams in the main workstream list/canvas, and archive workstreams so the
active set stays fresh without losing history.

Archive should be reversible or at least historically inspectable. Archived
workstreams may still matter as dependency history or design lessons, but they
should be excluded from the default active workstream list and normal
multi-workstream canvas unless explicitly included.

### Promoted candidate records

Until Streamliner has first-class candidate archive/lifecycle tooling, promoted
candidate notes should be retained as historical seed records rather than
deleted. Mark the candidate `Promoted`, add a `Promotion` section that points to
the formed workstream path, and summarize the formation decisions that changed or
clarified the seed.

This keeps the dependency map readable: other candidates can still link to the
original candidate note, while the Promotion section tells a cold session where
the active workstream now lives. A future lifecycle migration can decide whether
promoted candidates move under `workstreams/candidates/archive/`, become
workstream-local `docs/initial-shaping.md`, or remain as promoted candidate
records.

## Checkpoint and Closeout Boundary

Dogfooding revealed that active workstreams need a way to accumulate closeout
observations, validate checkpoints, and materialize bounded polish into normal
closeout work. That behavior is important, but the detailed punch-list,
checkpoint, closeout-batch, tracker issue, and gate interaction model now belongs
to [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md).

Workstream Design Mode should stay focused on higher-level lifecycle questions:
how ideas become candidates, how candidates become active workstreams, how active
workstreams are archived, and how formation sessions receive enough context to
create executable artifacts. It should reference checkpoint/closeout behavior as
part of the active-workstream lifecycle, but it should not own the detailed
punch-list UI or execution semantics.

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
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md), because checkpoint validation and closeout behavior are part of active-workstream lifecycle, but their detailed punch-list and gate interaction model belongs there.

## Shaping Depth Guidance

Workstream design mode should shape work at the level needed to start a focused formation/orchestrator session, not at the level needed to implement the work itself.

The design session should answer:

- What is the workstream-sized chunk of work?
- Why does it matter?
- What broad deliverables belong inside the workstream?
- What is out of bounds?
- What other candidate workstreams does it depend on or enable?
- What exportable interfaces, checkpoints, or artifacts need to connect this workstream to others?
- What decisions are necessary before a focused formation session can create the real workstream artifacts?

The design session should avoid:

- Prematurely decomposing the work into detailed nodes.
- Minimizing the workstream into a first GitHub issue.
- Answering local implementation questions that the dedicated orchestrator can resolve.
- Treating "first useful slice" as the primary shaping goal for large workstreams.

The right output is a big-enough shape: enough boundary, dependency, and interface clarity that a dedicated orchestrator can build the workstream, not a full design or implementation plan.

## Project Workstream Design vs Workstream Formation

Dogfooding this session revealed two distinct activities that had been blended together:

1. **Project workstream design** — shallow-to-medium exploration across several candidate workstreams within one project. It names candidates, captures why they matter, identifies broad boundaries, detects imports/exports, and maps how the workstreams fit together.
2. **Focused workstream formation** — deeper work on one promoted candidate. It turns the candidate artifact into actual workstream artifacts: `brief.md`, `graph.json`, parent issue, initial node issues, wave/checkpoint structure, and any design-session nodes needed before execution.

The current session is mostly the first activity. It should not bottom out every candidate into full artifacts, because doing so would collapse project-level geometry work into a long sequence of individual workstream planning sessions.

The gap is that the existing "Workstream Orchestrator" role sounds execution-heavy. Streamliner likely needs to make formation explicit, probably as its own skill/mode:

- **Project Workstream Design** — shape many candidate workstreams and their geometry within one project.
- **Workstream Formation** — take one shaped candidate and bottom out the design into artifacts.
- **Workstream Orchestration / Execution** — run the formed workstream through waves, workers, reconciliation, and closure.

Recommended framing: formation is adjacent to the orchestrator's realm of authority and may be performed by the same logical session, but it should be an explicit stage/mode and likely a separate skill. The same session may later continue as the execution orchestrator, but the behavior is different:

| Activity | Main question | Output |
|---|---|---|
| Project workstream design | What workstreams should exist in this project and how do they fit together? | Candidate artifacts, dependencies, handoff briefs. |
| Workstream formation | How should this one workstream become executable? | `brief.md`, `graph.json`, parent issue, initial nodes/issues, gates/checkpoints. |
| Workstream execution | How does this workstream progress through workers, waves, reconciliation, and closure? | PRs, updated graph/brief, completed nodes, exports. |

This suggests a new handoff standard: a shaped candidate is not necessarily ready for execution; it is ready for formation. The formation session can continue scoped design thinking, create the artifacts, and then move into execution or hand off to an execution-oriented orchestrator.

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
| Artifact | The durable file-backed representation of intent, plan, state, or output: design docs, candidate notes, briefs, graphs, node specs, decision records, and future doc catalogs. |
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

## Current Dogfood Slice

The current dogfood slice created a lightweight `.streamliner/shaping/` artifact
set. That location is now best understood as an experimental scratchpad for the
candidate lifecycle, not necessarily the final product layout:

1. Add a candidate index.
2. Add sparse candidate notes for current ideas.
3. Fill the workstream-design-mode note with the lifecycle, storage, UI, and role decisions discovered in this session.
4. Continue updating candidate notes as discussion reveals scope, dependencies, and handoff briefs.

## Open Questions

- Should candidate notes eventually have frontmatter or a JSON companion so Streamliner can render them in the UI?
- Should candidate dependencies be duplicated in both notes for readability, centralized in the index, or stored in a future structured graph?
- What is the threshold for promoting a candidate from candidate note to focused formation?
- What exact layout should represent candidate, active, and archived workstreams?
- Should archive be a folder move, a state field, or both?
- What is the UI shape for promoting a candidate into a workstream creation session?
- What is the UI shape for archiving and browsing historical workstreams?
- What handoff should Workstream Design Mode provide to Checkpoint and Closeout
  Experience without duplicating that candidate's punch-list and gate model?
- Should workstream design mode become a custom agent, a skill, product UI, or all three at different maturity stages?
- Should focused workstream formation be a named mode of the orchestrator, a separate role, or both?

## Handoff Brief

Not ready yet. The first handoff should likely ask an orchestrator to build first-class support for workstream design mode after this dogfooding session produces enough examples.
