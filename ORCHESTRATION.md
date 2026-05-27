# Streamliner Orchestration

> How workstream-level orchestration happens when planning, UI-launched workers,
> SDK-backed tasks, runtime state, and artifact reconciliation all coexist.

Streamliner treats orchestration as a **workstream function**, not as the memory
or authority of one long-lived chat session.

An interactive Copilot CLI session can perform orchestration. A background SDK
invocation can perform orchestration. A UI action can trigger orchestration work
without talking to any currently open chat. What makes the action orchestration
is not where it runs, but what it does: read the durable context, preserve the
workstream's intent, coordinate execution, and keep the artifacts aligned with
reality.

The durable identity of a workstream is:

- the project design layer
- the workstream brief and graph
- node specs and tracker state
- local runtime state
- pending orchestration facts that have not yet been reconciled

The durable identity is not the transcript of the session that happened to shape
or manage the work last.

See [DOCTRINE.md](DOCTRINE.md) for the operating model and
[WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md) for the committed artifact format.

## Orchestration is a function, not a session

The doctrine's invariant is that any new orchestrator invocation should be able
to read the design layer and workstream artifacts and become productive
immediately.

This document sharpens that idea:

**Orchestration is the role. Sessions and invocations are implementations of the
role.**

That distinction matters because Streamliner needs to support several concrete
paths:

- the operator talks to an interactive Copilot CLI session to shape the
  workstream
- the UI launches a worker session for a node
- a background SDK invocation reconciles completed work against the graph
- a future autonomous coordinator notices pending work and proposes updates

These paths should not depend on a single living orchestrator chat being the
parent process. They should all operate through the same durable workstream
surfaces.

## Two directions of workstream change

Workstream artifacts change in two directions.

### Top-down orchestration

Top-down orchestration changes intent.

It answers:

- What is this workstream trying to accomplish?
- Where are the boundaries?
- What should the next wave be?
- Which nodes should exist?
- Which work should receive developer attention?
- Which design references matter first?

Top-down orchestration updates:

- the brief's Purpose, Approach, Design References, Boundaries, Decisions, and
  Open Questions
- the graph's nodes, dependencies, gates, attention levels, and tracker links
- node specs and their inherited decisions
- design docs or decision records when project intent changes

This is the mode the operator uses when talking with an orchestrator session to
plan, reshape, or reason about the work.

#### Node creation and session cost

When top-down orchestration creates or reshapes nodes, it should account for the
cost of launching, reviewing, and reconciling worker sessions. A node is the
largest coherent unit of work that one worker can execute with good context,
clear boundaries, and reviewable output. It is not a checklist item and should
not mirror every phase of the worker's internal plan.

Balance coherence against parallelism. Bias toward fewer, heavier nodes when the
work fits in one context and the interrelated changes are safer for one worker to
reason through sequentially. Split a wave into multiple nodes when the work can
run safely in parallel under a stable contract and the wall-clock speedup is
likely to survive launch, review, merge, and reconciliation cost. Parallelism is
a first-class reason to split, but "can be listed separately" is not enough.

Other split reasons include different expertise or roles, independent validation
surfaces, external dependency boundaries, failure isolation, context limits, or
separately consumable outputs.

Later-wave node breakdowns are hypotheses. At promotion time, the orchestrator
reviews what actually shipped, then may split a coarse sketch node to unlock safe
parallelism or manage real complexity, merge adjacent nodes, or replace the
sketch with a different node shape before creating tracker issues or local specs.

#### Closeout observation lane

During execution, the operator may discover small polish and cleanup items while
using the feature. The orchestrator should capture those items without
reflexively turning each one into hot work or a separate node. The items can
accumulate before the final closure phase.

Use a closeout observation lane when the items are bounded, low-risk, and tightly
coupled to the current workstream. The orchestrator records them, triages them,
and later materializes related entries into a normal closeout node with a tracker
issue when that is more efficient than many small worker launches, usually near a
gate or closure point.

The closeout observation lane is gate-owned and conditional. Do not create an
empty closeout node just because the workstream is nearing closure. The closure
gate asks whether any closeout work remains. If none exists, the gate can pass.
If bounded polish exists, create or promote one closeout task node with a tracker
issue to handle the batch before the gate. That node/issue owns the checklist,
session, PR, review, and reconciliation mechanics. If the items are too large,
risky, or dependency-bearing, promote them out into normal work.

The normal process is:

1. The operator tells the orchestrator to add a closeout observation.
2. The orchestrator records the item on the workstream and does a quick triage:
   batch, promote, defer, or reject as out of scope.
3. The item stays parked until the orchestrator decides a closeout batch should
   be materialized as a normal node/issue or the closure gate needs to resolve it.
4. Reconciliation keeps closeout observations honest as items are completed,
   deferred, promoted, or dropped.

Each closeout observation should eventually be one of:

- **completed** in the closeout batch;
- **deferred** explicitly with rationale;
- **promoted** to its own node, tracker issue, candidate, or follow-on workstream;
- **dropped** because it no longer matters after reconciliation.

Promote an observation out into normal work when the item changes core semantics,
needs a design decision or gate, touches unrelated systems, carries meaningful
review risk, or produces an export another workstream depends on.

### Bottom-up reconciliation

Bottom-up reconciliation absorbs reality.

It answers:

- What actually happened?
- Which nodes completed, partially completed, or became obsolete?
- Which downstream nodes are now unblocked?
- What follow-up work was discovered?
- Did the work stay inside the workstream boundary?
- Did the work change intended design, update design docs, or flag a
  `decision-needed` case?

Bottom-up reconciliation updates:

- the brief's Current State, Decisions, and Open Questions
- graph statuses, dependencies, gates, and next-ready work
- tracker state summaries and node-level coordination notes
- design references if the relevant design surface changed

Reconciliation can propose top-down changes, but it should not silently rewrite
major intent. If completed work reveals that the workstream boundary, purpose,
or project design direction is wrong, reconciliation escalates that fact for
operator review.

The shorthand is:

> Top-down orchestration changes the map. Bottom-up reconciliation redraws the
> map to match the territory.

## Product concepts

Four product concepts keep the model coherent.

### Launch broker

The launch broker starts sessions and records their relationship to the
workstream.

When the UI launches a worker, it should not need to message an active
orchestrator chat. It should:

1. assemble the appropriate Layer 0-3 context package
2. create a runtime launch record or claim
3. start the worker session
4. attach the session to a project, workstream, and optionally a node
5. record the session in local runtime state

The same launch broker can be used by UI actions, an interactive orchestrator
session, or future SDK-backed automation. The parent channel is not important;
the recorded launch and attachment facts are.

### Workstream inbox

The workstream inbox is the queue of facts that may require orchestration
attention.

Inbox entries can include:

- worker completed a node
- PR opened, updated, merged, or failed checks
- tracker status changed
- session attached, detached, or disappeared
- developer marked a burst of hot work
- operator added or changed a closeout observation
- design docs changed
- graph and runtime state disagree
- downstream checkpoint became ready

The inbox is not the committed plan. It is an operational staging area for
facts that need to be interpreted against the workstream artifacts.

### Reconciler

The reconciler is the bottom-up orchestration function that processes inbox
facts, tracker state, code changes, and workstream artifacts.

It can run as:

- an interactive Copilot CLI request: "reconcile this workstream"
- a UI-triggered action: "run reconciliation"
- a background SDK invocation
- a future low-risk automatic pass

Its output is either:

- committed artifact updates, for low-risk cases the system is trusted to apply
- proposed artifact diffs, for reviewable cases
- work-design feedback for the builder
- an escalation, when the work revealed boundary pressure, design mismatch, or
  intent drift that needs operator judgment

### Interactive orchestrator

The interactive orchestrator is the operator-facing planning and reasoning
surface.

It is where the developer:

- shapes workstreams
- discusses product and design direction
- changes boundaries
- reviews wave plans
- approves or rejects meaningful reconciliation proposals
- decides how to respond to boundary pressure or design mismatches

The interactive orchestrator may ask a background reconciler to process facts,
but it is not the durable owner of the workstream's truth. The artifacts are.

## Invocation model

Streamliner should grow from manual orchestration toward assisted automation.

| Stage | Behavior |
|---|---|
| **Manual** | The operator or an interactive orchestrator session explicitly asks to reconcile a workstream. |
| **Assisted** | The UI shows pending reconciliation signals, such as "3 items need reconciliation," and offers a run action. |
| **Semi-auto** | The system runs SDK-backed reconciliation after safe triggers such as worker completion or PR merge, then presents proposed diffs. |
| **Trusted auto** | Low-risk bookkeeping lands automatically; boundary changes, intent changes, design-impact escalations, and learning review still remain visible. |

The early product should prefer manual or assisted reconciliation. Artifact
mutation is consequential, and the system needs trust before it rewrites durable
workstream state automatically.

Even later, reconciliation should not fully disappear. Streamliner can automate
evidence collection, diff summaries, candidate status updates, and low-risk
bookkeeping, but the builder-visible learning signal remains part of the
practice.

## Reconciliation triggers

Reconciliation is normal process. It is not specific to hot work.

Useful triggers include:

- worker completes a node
- PR opens or merges
- checkpoint or gate is reached
- closeout observation is added, resolved, deferred, or promoted
- wave transition begins
- developer finishes direct presence or hot work
- runtime state and graph state diverge
- tracker state changes outside Streamliner
- operator explicitly asks for reconciliation

The question is not "was the work hot?" The question is whether enough happened
that the brief, graph, or node specs may no longer describe reality.

## Reconciliation as builder learning

Reconciliation is not only artifact maintenance. It is how the builder learns
the craft of workstream design.

The reconciler should help answer:

- Did the workstream boundary hold?
- Did the work reveal legitimate boundary pressure or boundary expansion?
- Did the node specs give workers enough autonomy without leaving them adrift?
- Did contracts and checkpoints unblock downstream work cleanly?
- Did the design references point workers at the right intended design?
- Did the builder's attention go to high-leverage moments?
- Was direct intervention inspired by new front-line insight, or was it recovery
  from avoidable planning drift?

That last distinction matters.

**Inspired intervention** happens when the builder uses or reviews something
that has become real and sees a better direction that could not reasonably have
been known upfront. The system should support this. It is one of the main ways
the builder converts vivid feedback into better work.

**Recovery intervention** happens when the builder has to step in because the
boundary, contract, spec, or design context failed to guide execution. This is
also useful, but it is a work-design learning signal. The right response is not
to hide it or treat it as failure; the right response is to ask what future
shaping can make clearer.

Boundary expansion can be inspired or recovery-driven too. Sometimes execution
reveals a larger architectural surface that was not discoverable upfront.
Sometimes it reveals that shaping missed a dependency or left a shared contract
too vague. Reconciliation should distinguish those cases rather than flattening
all boundary change into failure.

For meaningful reconciliation, the output should include a short work-design
feedback note alongside any artifact updates or proposals. The note should be
practical, not performative:

- what held
- what drifted
- what was discovered at the front line
- what future shaping should do differently

This keeps reconciliation from becoming invisible automation. Streamliner should
not merely keep the workstream plan synchronized with reality; it should help
the builder learn why reality diverged from the plan.

### Reconciliation notes and promotion

When a wave, gate, hot-work burst, or completed workstream teaches something
about the work geometry, reconciliation emits a compact reconciliation note.
This is not a generic retrospective. It is a lower-authority learning artifact
about boundaries, contracts, context gaps, gate timing, attention allocation,
and downstream impact.

The reconciliation note is a durable workstream artifact. It lives at
`<workstream>/reconciliation-note.md`, follows the structure in
[WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md#the-reconciliation-note-reconciliation-notemd),
and is rewritten in place — a single learning summary per workstream that
deepens as the work progresses.

#### When it is produced

| Trigger | Reconciliation note expectation |
|---|---|
| Final closure gate | **Required.** Closure does not pass until the note exists and every promotion candidate has an explicit disposition. |
| Wave or checkpoint gate where the work taught something nontrivial | **Recommended.** Extend the existing note in place. |
| Hot-work burst that changed plan or scope | **Recommended** when the lesson is durable enough to inform future shaping. |
| Routine reconciliation with no learning to record | None required. The note should not be edited just to prove reconciliation happened. |

#### Closure-gate rule

A workstream's final closure gate does not pass until:

1. `reconciliation-note.md` exists for this workstream.
2. Every `Closeout Observation` in the brief has a disposition (completed,
   deferred with rationale, promoted, or dropped). This is the existing
   closeout observation lane rule, surfaced here because closure depends on it.
3. Every promotion candidate in the reconciliation note has an explicit
   disposition: landed (with a link to where it landed), deferred with
   rationale, or dropped because reconciliation showed it does not matter.

These rules apply to *the closure gate*, not to every reconciliation pass. A
mid-workstream reconciliation that does not change the closure picture does
not need to revise the note.

#### Promotion

Promotion keeps authority explicit. A lesson may remain a workstream-local
note, become a workstream-local brief decision, turn into node-spec guidance,
become a checkpoint contract, or be promoted into the design layer or a
decision record. Nothing becomes authoritative merely because an agent wrote
it down.

Each promotion candidate names its target authority so the disposition is
verifiable: "Brief decision in workstream X", "New section in
`docs/design/Y.md`", "ADR draft at `docs/design/decisions/NNN-Z.md`", "New
shaping candidate at `.streamliner/shaping/candidates/W.md`", or "Out of
scope — dropped because…".

#### Distinct from any closeout narrative

A workstream may also produce a longer-form prose narrative under `docs/` for
reflective consumption (for example, feeding an external podcast generator).
That artifact is optional, story-shaped, and intended for the operator's own
consolidation away from in-the-moment work. It does not satisfy the
closure-gate rule — the reconciliation note does. The two artifacts can
reference each other but serve different audiences.

## Authority boundaries

Reconciliation is allowed to maintain artifact truth. It is not allowed to
silently change operator intent.

Low-risk reconciliation can update:

- node statuses that directly match tracker or PR state
- Current State summaries
- downstream readiness after declared exports land
- stale Open Questions that were clearly answered
- design-impact declarations already supplied by workers

Reviewable reconciliation should propose diffs for:

- adding, deleting, or obsoleting nodes
- changing dependencies or gates
- changing attention levels
- changing the brief's Approach or Boundaries
- changing Design References
- modifying node specs that workers have not yet started

Escalation is required for:

- boundary pressure involving another workstream
- boundary expansion that changes ownership, dependencies, public checkpoints, or
  shared contracts
- project-level design changes
- conflicting worker outputs
- design-impact `decision-needed`
- completed work that invalidates the workstream's purpose or major plan

This keeps bottom-up reconciliation safe. It can absorb reality aggressively
without becoming an unreviewed source of strategic direction.

## Relationship to hot work

[Hot work](HOT-WORK.md) is an operating mode: the moment when steady autonomous
execution becomes rapid, high-context developer-agent iteration.

Hot work often creates a stronger need for reconciliation because the work may
move faster than the graph. But it does not have a special reconciliation
protocol. It produces facts like any other work:

- code changed
- nodes advanced, merged, or became obsolete
- design understanding shifted
- boundary pressure may have appeared
- boundary expansion may need top-down orchestration
- follow-up work may have been discovered

The normal reconciler absorbs those facts into the workstream artifacts.

Hot work is one reason reconciliation exists. It is not the only reason.

## Relationship to UI-launched workers

Launching from the UI should be first-class. The operator should not have to
route every worker through an interactive orchestrator chat for the work to be
legible.

The UI launch path should:

- assemble context from the same artifact model an orchestrator would use
- create runtime records through the launch broker
- attach the worker to the appropriate project, workstream, and node
- emit inbox facts that reconciliation can later process

This makes UI-launched work and orchestrator-launched work converge on the same
operational model.

## The doctrine in one paragraph

The workstream's source of truth is its artifact set plus local runtime and
inbox state, not any single chat transcript. Orchestration is a role that can be
performed by interactive sessions, UI actions, SDK invocations, or future
automation. Top-down orchestration changes intent; bottom-up reconciliation
absorbs reality. The launch broker starts and attaches sessions, the inbox
collects facts, the reconciler turns those facts into artifact updates or
proposals, and the interactive orchestrator remains the operator's surface for
planning, review, and judgment.
