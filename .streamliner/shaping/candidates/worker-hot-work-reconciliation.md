# Node Handoff, Boundary Pressure & Reconciliation

## Stage

Shaped; expanded under 2026-06 coverage partition (adds boundary pressure + node-level work-loss).

## Coverage Partition (2026-06 refactor)

**Workstream:** WS-D — Node Handoff, Boundary Pressure & Reconciliation. **One outcome:** node
discoveries (divergence, blockage, completion) become legible, owned, and reconciled — nothing
silently lost. **Owns (C4 content):** the node **field-report** content + lifecycle, typed
**boundary pressure / split requests**, **node-level deferral->debt** (#124 residual), hot-work
support, and orchestrator reconciliation.

**Builds on shipped doctrine (#114):** the required `reconciliation-note.md` and its disposition
vocabulary already exist in `WORKSTREAM-FORMAT.md`; this workstream operationalizes them in
runtime/product — it does **not** re-author the note.

**Wave sequencing:** (1) field reports + reconciliation runtime; (2) hot-work support; (3) boundary
pressure / split requests — **surfacing-only first** (a node raises a typed pressure message; the
orchestrator disposes manually) before any automated geometry mutation.

**Seams:** field-report **transport** = WS-C; **no-open-debt gate** at close = WS-F; **artifact
slot** = WS-A. **Depends on:** WS-A, WS-C, Role & Context Packages.

## Seed Idea

Define how worker sessions should understand and support hot work: builder-directed momentum work that expands beyond the narrow issue or node script while the builder is actively present in the session. Workers should not reflexively push back when the builder intentionally goes off script. They should support the builder's momentum, keep track of what changed, and give reconciliation enough information to update downstream issues, graph nodes, docs, and exports.

This should also feed into end-of-workstream closure review: the orchestrator needs to inspect hot work and reconciliation history before closing a final workstream PR, especially when the final PR includes multiple completed node issues.

## Why It Matters

Streamliner is designed for autonomous execution by default, but the builder can still become fully present in a session. Sometimes the builder has focus, sees the running system, understands the product feel, and can make rapid high-quality changes that do not follow the original node script.

That is not a failure mode. It is a legitimate high-leverage builder activity.

The problem is not that hot work happens. The problem is when hot work remains invisible to the workstream artifacts. If the session treats all off-script work as scope creep, it slows the builder down at exactly the wrong moment. If it ignores the divergence completely, the orchestrator cannot reconcile issues, dependencies, docs, or downstream exports afterward.

Hot work support should therefore optimize for **momentum first, reconciliation second**.

## Candidate Scope

### In Scope

- Define hot work as builder-directed presence inside a worker session.
- Make worker guidance supportive rather than restrictive: do not refuse or over-warn when the builder intentionally expands the work.
- Clarify that the builder owns the judgment of whether hot work is worth doing.
- Capture lightweight evidence of what changed so reconciliation can update artifacts afterward.
- Define node closeout communication as a first-class workstream mechanism:
  workers should write an orchestrator-visible field report back to the
  workstream files so reconciliation has a durable place to start.
- Define how the orchestrator/reconciler consumes node field reports to update graph nodes, issues, docs, exports/imports, and closure review.
- Connect hot work to worker role guidance from the Agent/Skill Context workstream.

### Out of Scope

- Preventing the builder from exceeding the node or issue boundary during active presence.
- Requiring workers to fully adjudicate workstream boundaries before helping the builder.
- Treating hot work as autonomous worker scope expansion.
- Designing a rigid approval workflow for hot work.

### Deferred

- Automatic detection of hot work from diffs.
- UI indicators for "builder hot work in progress."
- Structured runtime timeline for hot-work sessions.
- Metrics about how often hot work reveals bad workstream geometry.

## Core Framing

Hot work is not worker-initiated scope expansion. It is **builder-directed work during active presence**.

The worker should assume:

- the builder is allowed to redirect the session;
- the builder may intentionally work outside the node's original issue;
- the builder may be acting on product judgment, momentum, or live system feedback that the worker cannot fully evaluate;
- the worker's job is to assist and preserve context, not police the builder.

The main caveat is workstream boundary drift. Even there, the worker should not become a hard gate. The builder owns the responsibility to use workstreams well. If hot work appears to cross a boundary, the worker can flag it lightly and then continue if the builder proceeds.

If the builder knowingly chooses to go off the rails, the worker's responsibility changes. It stops trying to keep the session on the original rails and starts keeping an accurate account of the mess:

- what changed;
- which original issue/node assumptions no longer hold;
- what downstream issues may be obsolete or incomplete;
- what docs/design/export contracts may need updates;
- what reconciliation needs to inspect later.

This is the key distinction: the worker may identify that rails are being left, but the builder can override that. After override, the worker should prioritize continuity and reconciliation evidence.

The lesson loop happens during reconciliation and closure review:

- Did the hot work stay inside the workstream?
- Did it reveal a boundary problem?
- Should downstream issues or workstreams change?
- Should the builder adjust future workstream geometry?

## Worker Behavior During Hot Work

Workers should:

- follow the builder's direction when the builder is actively present;
- avoid reflexive refusal or repeated scope warnings;
- keep the immediate coding loop fast;
- ask only when an ambiguity blocks implementation;
- preserve useful notes about what changed and why;
- call out major risk once, then continue if the builder chooses to proceed;
- switch into "mess accounting" mode after the builder intentionally overrides scope concerns;
- make final reporting concrete enough for reconciliation.

Workers should not:

- insist on returning to the original node issue when the builder is intentionally expanding;
- require formal approval before each off-script change;
- silently hide the fact that the work diverged from the issue;
- decide on their own to expand scope when the builder is not directing it.

## Reconciliation Contract

After hot work, the worker must make the divergence legible through a durable
orchestrator-visible handoff channel. Today that channel does not really exist:
the orchestrator does not see the node session's final response unless the
builder manually copy/pastes it, and there is not yet a standard workstream file
where node sessions report what happened. The workstream therefore needs to
define node closeout communication as a first-class mechanism, not just a worker
behavior preference.

The closeout should be worker-authored because the worker and builder know the
intent behind the divergence. The orchestrator should use it as the starting
point for reconciliation, then audit it against the PR diff, commits, tracker
discussion, tests, and changed workstream artifacts as needed. Orchestrator-only
forensic reconstruction should be a fallback, not the primary communication
path.

### Communication Mechanism

The seed direction is a **node field report** written back into the Streamliner
workstream files at a conventional per-node location. When reconciliation runs,
the orchestrator can look for the field report associated with the node and use
it as the worker's account of what happened.

This field report should include details about hot work when hot work happened,
but the exact format, required sections, schema, lifecycle, and path convention
should be designed by the formed workstream. The important requirement at this
stage is the communication shape:

- node sessions write a closeout/field report into the workstream artifact area;
- each report is associated with a specific node;
- the orchestrator knows where to look for that report during reconciliation;
- the report is the worker-authored handoff, while diffs and tracker state remain
  verification sources.

This elevates closeout communication from incidental session output into a
Streamliner workstream file convention. Future design can decide the exact file
location, naming, commit semantics, and lifecycle, but the product should not
depend on manual copy/paste or PR-body conventions for reconciliation.

## Reconciliation Timing

Reconciliation should happen as an operator/orchestrator behavior after a node concludes, especially after parallel node work closes out mid-wave. When the node closes out, the orchestrator looks for the node's field report and reconciles the workstream artifacts:

- update graph node status and dependencies;
- adjust issue status, scope, or follow-ups;
- update the brief if durable workstream state changed;
- update docs/design/export/import notes if needed;
- identify whether hot work revealed bad workstream geometry.

This does not need to be a worker-side approval workflow. It should be documented as part of how builders and orchestrators operate Streamliner.

## Boundary Philosophy

The worker can use three levels of response:

| Situation | Worker behavior |
|---|---|
| Builder clearly directs off-script work inside the apparent workstream purpose | Help immediately; record for reconciliation. |
| Builder directs work that may exceed the workstream boundary | Flag the possible boundary concern once, then continue if the builder proceeds; keep detailed reconciliation notes. |
| Builder explicitly says to go off the rails | Stop debating scope; assist the builder and account for the resulting divergence. |
| Worker independently notices extra work without builder direction | Do not expand silently; report or ask depending on risk. |

This preserves the builder's authority while still keeping workstream artifacts honest.

## Closure Review Link

Workstream closure review should inspect node field reports and final diffs to determine whether:

- hot work was reconciled into the brief and graph;
- completed issues accurately reflect what shipped;
- downstream issues were updated or superseded;
- design, architecture, and user docs match the final behavior;
- any exports/imports changed availability or contract;
- the workstream boundary was exceeded in a way that should become a lesson for future shaping.

## Dependencies

### Depends On

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because this behavior likely belongs in worker role guidance.
- [Workstream Design Mode](workstream-design-mode.md), for the shaping and handoff conventions.

### Enables

- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because hot work may reveal or alter downstream dependencies.

### Related Candidates

- [Documentation System](documentation-system.md), because the behavior may need to be documented for both users and agents.

## Workstream Shape

This should be a workstream-sized effort to define and implement hot-work support across role guidance, launch context, reconciliation, and closure review.

Likely work areas:

- Update worker role instructions so builder-directed hot work is supported instead of resisted.
- Define node field reports as the closeout communication channel from worker
  sessions back to the orchestrator.
- Decide where field reports live in or alongside workstream files, how they are
  associated with nodes, and how reconciliation discovers them.
- Define lightweight field-report expectations for hot work without
  over-specifying the final structure during shaping.
- Define orchestrator reconciliation behavior after node closeout.
- Connect node field reports to workstream closure review.
- Update user/agent documentation explaining hot work as a builder-presence mode.

## Open Questions

- How should Streamliner teach builders that hot work is powerful but can reveal bad workstream geometry?

## Handoff Brief

Create a Worker Hot Work and Reconciliation workstream.

The workstream should define and implement guidance for worker sessions when the builder becomes actively present and intentionally works beyond the original node or issue script. Hot work is builder-directed momentum work, not autonomous worker scope expansion. Workers should support the builder, avoid reflexive scope pushback, and switch into mess-accounting mode when the builder knowingly goes off the rails.

The workstream should update worker role guidance, launch/context instructions, and user-facing operating documentation so workers know to assist while preserving enough narrative for reconciliation. Because the orchestrator does not currently see node-session final responses, the workstream should define node field reports as the explicit closeout communication channel. The seed direction is that a node session writes a field report back into a specific, orchestrator-discoverable location in or alongside the Streamliner workstream files. The formed workstream should decide the exact location, lifecycle, and structure.

The workstream should define how orchestrators reconcile hot work after node closeout, especially when parallel node work concludes mid-wave. Reconciliation should start from the worker-authored field report, verify against the PR diff, commits, tracker discussion, tests, and changed workstream artifacts, then update graph nodes and dependencies, adjust or create downstream issues, update brief/docs/design/export information when needed, and surface any workstream-boundary lessons for future shaping.

This workstream imports role-context expectations from Streamliner Agent and Skill Context and exports reconciliation behavior that Multi-Workstream Dependencies and Work Geometry Canvas can use when hot work changes cross-workstream imports, exports, or branch-local availability.
