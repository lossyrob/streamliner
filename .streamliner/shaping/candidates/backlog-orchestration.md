# Backlog Orchestration

## Stage

Shaped; the backlog-orchestrator skill is a working reference implementation.

## Seed Idea

Make the **Backlog** a first-class Streamliner surface — the holding area for *out-of-geometry work*
— and drain it with an autonomous orchestration loop. Work that falls out of workstreams becomes
loose issues, and workstreams in motion produce deferred work that belongs to no existing
workstream. Today that work scatters across GitHub issues and memory. The backlog-orchestrator skill
in `lossyrob/skills` already proves the execution flow (triage issues, drive each to a PR through
PAW worker sessions coordinated over telex, gate at the human floor, merge or route, advance). This
candidate ships that flow natively in Streamliner, built on the absorbed primitives rather than
re-implemented as a one-off.

## Why It Matters

The backlog is the concrete home for the deferral side of the consolidation cycle. Without it:

- loose and deferred work has no durable, navigable surface — only a flat GitHub issue list;
- the work-loss invariant has nowhere to land (deferred items quietly stay open or vanish);
- the high-spread attention notes the builder makes mid-work ("this matters, not now") are lost.

A first-class backlog turns out-of-geometry work into a managed surface, and backlog runs turn it
into shipped PRs with the same human-floor discipline used everywhere else.

## Core Model

### The Backlog (first-class surface)

The backlog holds **out-of-geometry work**: loose issues, work deferred out of a workstream/node,
and high-spread builder-attention notes. It is **source, sink, and on-ramp**:

- **In (sink):** the "filed" disposition from node field reports / reconciliation (the reconciliation
  candidate) lands here; the builder also files high-spread attention notes directly, with their
  care/spread.
- **Out (source):** backlog runs drain it.
- **Up (promote):** an item that grows graduates into a candidate or workstream.

Each item carries **size** (from the format substrate), **care/posture** (from Operating Point &
Attention), and a **disposition** that must reach a terminal state — filed / folded / skipped(+reason)
/ done / moot. **No item stays open**, the same forcing function the reconciliation note applies at
closeout.

### Backlog runs (the engine pointed at the backlog)

A run triages selected items, then sequentially: launches a PAW implementer (and optional reviewer)
worker actor, coordinates the review cycle over telex, runs a human-floor merge gate, harvests and
dispositions any deferred work, and advances. The orchestrator owns the durable run ledger; workers
own only their worktree/PR.

### One engine, two sources

The run loop is **not backlog-specific**. The same engine drives a workstream's wave of nodes
(committed geometry) or a backlog batch (loose, out-of-geometry). The engine should be built once
with **source adapters**; this candidate owns the backlog source and surface, and shares the engine
with the autonomous-wave-progression candidate.

## Absorbed Components

This feature is a **composition** over primitives owned elsewhere; it should consume them, not
re-implement them:

| Primitive | Owner |
|---|---|
| item size (S/M/L) and its routing | format substrate + Operating Point & Attention |
| care knob, posture, preference-debt, human-floor merge gate, encoded beliefs | Operating Point & Attention |
| actor identity, mailbox, telex message protocol | the actor-fabric candidate |
| field reports + deferred-work disposition state machine | the reconciliation candidate |
| gate / closeout interaction | the checkpoint/closeout candidate |
| project issue list the backlog draws from | the project-surface candidate |

The backlog-orchestrator skill is the **reference implementation**, staged in `lossyrob/skills`;
the target is native Streamliner, not a wrapper around the skill.

## Candidate Scope

### In Scope

- The backlog as a first-class surface: capture/intake (from field reports and builder notes),
  curation/triage (size, care, posture, disposition), and promote-up paths.
- Backlog runs via the shared autonomous engine: orchestrator-actor launch, telex-coordinated
  worker sessions, human-floor merge gate, deferred-work disposition, run ledger/reporting.
- The backlog **source adapter** for the shared engine.

### Out of Scope

- The shared engine internals beyond the backlog adapter (shared with autonomous-wave-progression).
- The primitives owned by their layers (size, attention/preference, telex, deferred state machine,
  gate).
- Correctness review of worker PRs (PAW handles that).

### Deferred

- Parallel (non-sequential) runs.
- Cross-project backlogs.

## Dependencies

### Depends On

- The actor-fabric candidate (orchestrator + worker actors over telex), Operating Point & Attention
  (care/preference/human-floor), the format substrate (size), the reconciliation candidate (deferred
  capture + field reports), the checkpoint/closeout candidate (gate), and the project-surface
  candidate (the issue list).

### Enables

- A first-class home for out-of-geometry work, and autonomous draining of it.

### Related Candidates

- `autonomous-wave-progression` — the workstream-source face of the same engine.
- `automated-paw-review-loop` — the optional reviewer mode inside a run.

## Workstream Shape

Likely waves: (1) the backlog surface + intake + curation/triage; (2) the backlog source adapter and
a sequential run on the shared engine; (3) run ledger/reporting and deferred-work disposition;
(4) promote-up and high-spread note capture.

## Open Questions

- Where does a backlog item live — a GitHub issue with Streamliner metadata, a Streamliner-owned
  record, or both?
- How is "out-of-geometry" represented relative to the project issue list and to workstream nodes?
- How much of the run experience is Streamliner-native UI versus a Streamliner-managed orchestrator
  session running the proven skill logic?

## Handoff Brief

Create a Backlog Orchestration workstream that makes the Backlog a first-class Streamliner surface
for out-of-geometry work (loose issues, deferred work, high-spread attention notes) and drains it
with autonomous backlog runs. The backlog is a source, sink, and on-ramp: it receives "filed"
deferrals from node reconciliation and builder notes, carries size and care/posture per item, holds
every item to a terminal disposition, and lets items promote up into workstreams. Runs reuse the
shared autonomous-execution engine (orchestrator + PAW workers over telex + human-floor merge gate +
deferred disposition) through a backlog source adapter. Build it as a composition over the absorbed
primitives — size, attention/preference, telex, deferred state machine, gate, project issue list —
using the backlog-orchestrator skill as the reference implementation, shipped natively rather than
wrapped.
