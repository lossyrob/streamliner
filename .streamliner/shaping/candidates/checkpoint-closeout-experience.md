# Checkpoint and Closeout Experience

## Stage

Shaping; primary for WS-F (2026-06 coverage partition; folds validation playbooks + closeout narrative).

## Coverage Partition (2026-06 refactor)

**Workstream:** WS-F — Checkpoint & Closeout Experience. **Owns (C6-interaction):** the
builder-facing gate/checkpoint validation surface, the **closeout batch node/issue**, and the
**no-open-debt closure gate**. **Operationalizes the shipped closure-gate rule (#114)** ("every
promotion candidate has a disposition before the closure gate") in product.

**Folds in:** Convergent Validation Playbooks (`convergent-validation-playbooks.md`) as the
validation-loop wave pattern. **Associates:** Workstream Closeout Narrative
(`workstream-closeout-narrative.md`) as the optional long-form artifact.

**Seam with WS-D:** WS-D **creates** debt (node-level deferral); WS-F **validates** that no
undisposed debt remains at the gate (the #124 split). **Depends on:** WS-A, WS-D.
**Enables:** WS-G (export availability), Autonomous Wave Progression.

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

The Session Launching and Tracking Wave 4 closeout exposed an important product
shape: punch lists should not become a durable parallel task system. Lightweight
capture during execution is useful, but once a closure gate is ready and real
closeout work remains, Streamliner should materialize a normal closeout batch
node with a tracker issue. That node/issue owns the checklist, session, PR,
review, and reconciliation mechanics; the gate depends on it or records why each
remaining item was deferred, promoted, or dropped.

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
- closeout work can be launched, tracked, reviewed, and reconciled through normal
  workstream node mechanics instead of hidden in brief prose;
- closeout becomes a visible state rather than a vague final review.

## Candidate Scope

### In Scope

- Define checkpoint/gate UI expectations for builder validation.
- Define a verification playbook concept: what to inspect, what to run, what
  success should look like, and which links/artifacts matter.
- Define how punch-list items appear in the workstream UI during execution.
- Define how punch-list items attach to checkpoint/gate/closeout context.
- Define how accumulated punch-list observations materialize into one closeout
  batch node and tracker issue when unresolved closeout work remains.
- Define a closeout issue checklist/disposition convention: completed, deferred,
  promoted, or dropped.
- Define how a closure gate depends on the closeout batch node while issue-sized
  items may be promoted to separate nodes or tracked as external blockers.
- Define builder actions at checkpoints: pass, fail/block, add punch-list item,
  mark item done, materialize closeout batch, defer item, promote item to
  node/issue/candidate/workstream.
- Define final workstream closeout checkpoint behavior.
- Define how the current orchestrator session can enter closeout mode and attach
  itself to the final gate or closeout batch node.
- Clarify how automated wave execution pauses at checkpoints for builder review.

### Out of Scope

- Fully automating all validation.
- Replacing human builder judgment at gates.
- Redesigning the entire work geometry canvas.
- Building a general task tracker unrelated to workstream checkpoints.
- Making every punch-list item a graph node. The expected execution shape is one
  closeout batch node for bounded polish, with individual items promoted only
  when they become too large, risky, or dependency-bearing for the batch.
- Replacing normal graph node, tracker issue, PR, and session mechanics with a
  separate punch-list execution system.

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

Closeout should have three distinct lifecycle surfaces:

1. **Observation lane** - lightweight captured polish during execution. Items may
   live in runtime state, the brief, or a workstream-local support file, but they
   are not yet launched work.
2. **Closeout batch node** - a normal graph task with a tracker issue, created or
   promoted when a closure gate is ready and bounded closeout work remains. The
   issue owns the punch-list checklist, item dispositions, implementation PR, and
   reconciliation comments.
3. **Closure gate** - validates the checkpoint/workstream outcome. If unresolved
   closeout work exists, the gate depends on the closeout batch node or on
   promoted issue-sized nodes. If no closeout work remains, the gate can pass
   without creating an empty closeout node.

Issue-sized work should escape the batch. For example, a portability seam or
other dependency-bearing task may run in its own worker session; the closeout
node or gate records that promotion and waits for the separate node only when it
blocks closure.

## UI Ideas

Possible UI surfaces:

- A checkpoint detail panel/card in the workstream graph.
- A "Ready for builder validation" state on gates/checkpoints.
- A verification playbook section with manual steps and expected results.
- A punch-list panel filtered to the active workstream and checkpoint/closeout
  context.
- Quick actions for punch-list triage: batch, promote, defer, done, drop.
- An "add closeout observation" action that captures polish without immediately
  launching work.
- A "materialize closeout batch" action that creates or updates the normal graph
  node and tracker issue that will own bounded closeout work.
- A "promote item" action that turns a punch-list item into a separate
  node/issue/candidate/workstream and links that disposition from the batch.
- An "attach current session as closeout session" action for final gates where
  the orchestrator session transitions into closeout mode instead of launching a
  separate worker.
- A "gate blocked by closeout node" state that makes the final gate's dependency
  on unresolved closeout work explicit.
- A final closeout checkpoint view that summarizes completed nodes, outstanding
  closeout node/item dispositions, exports, docs impact, and downstream
  readiness.

## Dependencies

### Depends On

- [Workstream Design Mode](workstream-design-mode.md), for broader
  candidate/active/archive lifecycle semantics. This candidate owns the detailed
  checkpoint, gate, and closeout punch-list interaction model.
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
- Define punch-list observation storage and lifecycle before materialization.
- Define closeout batch node materialization and tracker issue checklist format.
- Define closure gate dependency behavior for closeout batch nodes and promoted
  issue-sized items.
- Add UI for checkpoint validation and punch-list triage.
- Add UI/actions for materializing closeout batches and attaching sessions to
  closeout mode.
- Add closeout checkpoint behavior for final workstream review.
- Define how automated node/wave execution stops and reports at checkpoints.

## Exported Interfaces and Dependencies

Potential exports:

- Checkpoint/gate validation UI model.
- Verification playbook artifact or field convention.
- Punch-list item lifecycle and triage states.
- Closeout batch node materialization contract.
- Closeout issue checklist/disposition convention.
- Closeout checkpoint behavior.
- Gate dependency semantics for closeout batch nodes and promoted blockers.
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
- How much of the lightweight observation lane needs durable storage before a
  closeout batch node is materialized?
- Should closeout batch materialization be a manual builder action, an
  orchestrator recommendation, or automatic when a closure gate becomes ready
  with unresolved bounded items?
- Should final workstream closeout be a special checkpoint type, or should it be
  a conventional gate plus optional closeout batch node pattern?
- How should a gate display promoted issue-sized closeout items that are running
  in separate sessions?
- What is the minimum UI that makes checkpoint validation meaningfully faster?
- How much of "run all nodes until checkpoint" belongs here versus in automated
  orchestration/session runtime work?

## Handoff Brief

Not ready yet. Shape whether this should be a standalone Checkpoint and Closeout
Experience workstream or part of broader Workstream Lifecycle support. The key
product direction is a checkpoint-to-closeout lifecycle: checkpoints become
builder-facing validation surfaces with verification playbooks; closeout
observations accumulate lightly; unresolved bounded closeout work materializes
into a normal closeout batch node/issue; and the closure gate passes only after
that node and any promoted blockers are resolved or explicitly dispositioned.
