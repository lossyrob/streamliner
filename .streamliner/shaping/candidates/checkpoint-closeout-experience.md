# Checkpoint and Closeout Experience

## Stage

Seeded

## Seed Idea

Give Streamliner a stronger builder-facing experience around checkpoints, gates,
closeout, and punch lists.

The emerging workflow is that agents may increasingly execute most wave work
autonomously until they reach a checkpoint. At that point, Streamliner should
help the builder quickly validate the wave: what changed, what to manually
inspect, what commands or UI paths to try, what acceptance criteria matter, and
what feedback should become punch-list work, promoted follow-up work, or gate
failure.

This also connects to closeout punch lists. While a workstream is running, the
builder notices polish items that should be handled before closure but should not
interrupt the current node as hot work. Those items should be visible in the UI,
associated with the current workstream/checkpoint context, and resolved before
the relevant gate or final closeout checkpoint passes.

## Why It Matters

The value of autonomous wave execution depends on high-quality builder validation
at the right moments. If checkpoint review is just "look at the PR and graph",
the builder has to rediscover how to validate the wave, remember pending polish,
and manually decide whether the work is ready to continue.

A structured checkpoint experience would make the builder's interaction faster
and more reliable:

- agents can work through nodes until a checkpoint;
- the checkpoint presents a verification playbook;
- the builder can run focused manual validation quickly;
- feedback can become punch-list items, promoted work, or gate-blocking issues;
- closeout becomes a visible state rather than a vague final review.

## Candidate Scope

### In Scope

- Define checkpoint/gate UI expectations for builder validation.
- Define a verification playbook concept: what to inspect, what to run, what
  success should look like, and which links/artifacts matter.
- Define how punch-list items appear in the workstream UI during execution.
- Define how punch-list items attach to checkpoint/gate/closeout context.
- Define builder actions at checkpoints: pass, fail/block, add punch-list item,
  mark item done, defer item, promote item to node/issue/candidate/workstream.
- Define final workstream closeout checkpoint behavior.
- Clarify how automated wave execution pauses at checkpoints for builder review.

### Out of Scope

- Fully automating all validation.
- Replacing human builder judgment at gates.
- Redesigning the entire work geometry canvas.
- Building a general task tracker unrelated to workstream checkpoints.
- Making every punch-list item a graph node.

### Deferred

- Rich analytics around checkpoint pass/fail rates.
- Cross-project checkpoint templates.
- Fully generated validation playbooks from code/test analysis.
- Mobile or notification-first checkpoint review.

## Product Model

Checkpoint experience should treat a checkpoint or gate as a **builder interaction
surface**, not only a graph milestone.

At a checkpoint, the UI should help answer:

- What work just completed?
- What changed in the product or workstream?
- What should the builder manually verify?
- What commands, UI routes, screenshots, logs, or docs should be inspected?
- What acceptance criteria decide whether the checkpoint passes?
- Which punch-list items are outstanding?
- Which items can be batched, deferred, promoted, or dropped?
- Are downstream nodes or workstreams safe to proceed?

The checkpoint is where the automation hands the work back to the builder with a
concise playbook. The punch list is the running feedback queue that the checkpoint
uses to decide whether to pass, batch closeout work, or promote follow-up work.

## UI Ideas

Possible UI surfaces:

- A checkpoint detail panel/card in the workstream graph.
- A "Ready for builder validation" state on gates/checkpoints.
- A verification playbook section with manual steps and expected results.
- A punch-list panel filtered to the active workstream and checkpoint/closeout
  context.
- Quick actions for punch-list triage: batch, promote, defer, done, drop.
- A "launch closeout batch" action when enough bounded items are ready.
- A final closeout checkpoint view that summarizes completed nodes, outstanding
  punch-list items, exports, docs impact, and downstream readiness.

## Dependencies

### Depends On

- [Workstream Design Mode](workstream-design-mode.md), for lifecycle semantics,
  candidate/active/archive state, and closeout punch-list guidance.
- Session Launching and Tracking workstream, for graph/node/session status and
  runtime overlay primitives.

### Enables

- [Work Geometry Canvas](work-geometry-canvas.md), because checkpoints and
  closeout state should be visible in higher-level work geometry.
- [Automated PAW Review Loop](automated-paw-review-loop.md), because automated
  wave/review execution needs clear builder intervention points.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md),
  because checkpoint review can consume node field reports and reconcile hot-work
  impacts.

### Related Candidates

- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because
  checkpoint pass/fail state may affect export availability.
- [External Dependency Tracking](external-dependency-tracking.md), because
  checkpoint gates may block on external approvals or decisions.

## Workstream Shape

This could be a small-to-medium workstream if scoped to one workstream detail UI:
checkpoint detail, verification playbook display, punch-list visibility, and
basic pass/block/promote/defer actions.

It becomes larger if it also includes automation for "run all ready nodes until
the checkpoint", generated validation playbooks, cross-workstream checkpoint
exports, or deep integration with review loops.

Likely work areas:

- Define checkpoint/gate builder interaction model.
- Decide where verification playbooks live: graph summary, gate node spec,
  workstream support file, generated runtime state, or a new artifact.
- Define punch-list item storage and lifecycle in relation to checkpoints.
- Add UI for checkpoint validation and punch-list triage.
- Add closeout checkpoint behavior for final workstream review.
- Define how automated node/wave execution stops and reports at checkpoints.

## Exported Interfaces and Dependencies

Potential exports:

- Checkpoint/gate validation UI model.
- Verification playbook artifact or field convention.
- Punch-list item lifecycle and triage states.
- Closeout checkpoint behavior.
- Requirements for wave automation to pause and hand off at checkpoints.

Potential imports:

- Workstream graph checkpoints and gate nodes.
- Session/runtime overlay state from Session Launching and Tracking.
- Node field reports from Worker Hot Work and Reconciliation.
- Review-loop state from Automated PAW Review Loop when reviews are part of the
  checkpoint confidence signal.

## Open Questions

- Is this a standalone workstream or a first wave inside Workstream Lifecycle /
  Workstream Design Mode product support?
- Should verification playbooks be authored by the orchestrator, generated by
  workers, or both?
- Where should punch-list items live so they are durable enough for reconciliation
  but not as heavyweight as graph nodes?
- Should final workstream closeout be a special checkpoint type or just a
  conventional gate/checkpoint pattern?
- What is the minimum UI that makes checkpoint validation meaningfully faster?
- How much of "run all nodes until checkpoint" belongs here versus in automated
  orchestration/session runtime work?

## Handoff Brief

Not ready yet. Shape whether this should be a standalone Checkpoint and Closeout
Experience workstream or part of broader Workstream Lifecycle support. The key
product direction is that checkpoints become builder-facing validation surfaces
with verification playbooks and visible punch-list triage, so autonomous wave
execution can pause at useful points for fast human judgment.
