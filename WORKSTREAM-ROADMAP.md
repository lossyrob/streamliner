# Streamliner Workstream Roadmap

> Working draft for the next wave and following wave of Streamliner workstreams.

This document records a recommended way to shape the next large chunks of work
after the current session-launching-and-tracking line establishes a first usable
runtime model. The goal is not to lock the sequence permanently. The goal is to
pick workstreams that are large enough to matter, small enough to own cleanly,
and parallelizable through explicit checkpoints rather than through wishful
thinking about total independence.

## What makes a good workstream?

A workstream is a good boundary when it has:

1. one meaningful outcome
2. one main review question
3. one clear owner for the core design decisions

If a body of work is too small to justify its own shaping, gates, and autonomous
execution, it should probably be a node in a workstream rather than a workstream
itself.

If a body of work contains multiple independently valuable outcomes, it should
probably split into multiple workstreams that coordinate through checkpoints.

## Why these are good choices

The suggested workstreams below are chosen to preserve a few useful properties:

- **Graph-first inside a workstream.** The workstream graph stays the primary
  surface once the operator is inside a specific workstream.
- **A shell above the graph.** Startup needs a higher-level surface for
  concurrent workstreams, cross-project visibility, and ad-hoc sessions.
- **Checkpoint-based parallelism.** Other workstreams should be able to proceed
  after an exported contract or milestone, without waiting for full completion.
- **Node-level blockage instead of whole-workstream blockage.** Work can keep
  moving inside a workstream until it reaches the point that truly depends on an
  external checkpoint.
- **Clean ownership of shared decisions.** Shared code is fine. Shared ownership
  of the same runtime contract or UX contract is where parallelism breaks down.

## Assumed outputs from the current workstream

The current session-launching-and-tracking workstream does not need to be
completely finished before the next wave starts. It does, however, need to
export a few usable checkpoints:

1. **session-runtime-v1** - a first normalized session/runtime snapshot shape
2. **single-box-tracking-v1** - one working environment with visible session
   tracking
3. **node-binding-v1** - an initial story for binding runtime session state to a
   workstream node

If those checkpoints land early, downstream workstreams can start even while the
tail of the current workstream continues.

## Suggested Wave 1

Wave 1 should turn Streamliner from a single-workstream viewer into the start of
a multi-workstream portfolio view. The hard priority is the dev box.

| Workstream | Main outcome | Why it belongs in Wave 1 |
|---|---|---|
| **Dev box observability** | Streamliner can discover and normalize detectable Copilot sessions on the dev box, whether or not Streamliner launched them | This is the first unblocker for real usage; the product becomes useful on the machine that matters most |
| **Portfolio shell** | Streamliner opens to a top-level surface that shows projects, workstreams, and ad-hoc sessions before the operator drills into a graph | The graph remains primary within a workstream, but startup needs a shell above any single graph |
| **Graph session overlays and attachment UX** | A workstream graph can show attached sessions, unmatched sessions, and runtime overlays without turning artifacts into telemetry logs | This closes the gap between the portfolio view and the graph-first workstream experience |

### Wave 1 notes

#### Dev box observability

This workstream should own:

- dev box host registration
- session discovery on the dev box
- normalization into the shared runtime/session shape
- health, freshness, and failure states for discovered sessions

This workstream should not own:

- the entire startup shell UX
- general launch flows
- cross-environment support beyond the dev box

Its main review question is simple: **Can Streamliner see the real session
universe that matters on the dev box, and is that view trustworthy enough to use
operationally?**

#### Portfolio shell

This workstream should own:

- the startup/home surface above any single workstream
- project/workstream navigation
- first-class presentation of ad-hoc sessions
- a clean split between "portfolio view" and "workstream graph"

It should deliberately avoid becoming a giant merged node graph. It is a
portfolio view, not a universal DAG viewer.

Its main review question is: **Does the operator have a good place to start when
the answer is not "open this one graph"?**

#### Graph session overlays and attachment UX

This workstream should own:

- how runtime session state appears on a node
- how unmatched or ad-hoc sessions are represented relative to a workstream
- how the operator manually or semi-manually attaches a session to a workstream
  or node
- the UI rules that keep runtime state projected rather than committed

Its main review question is: **Does the graph remain clean and durable while
still feeling operationally alive?**

## Suggested Wave 2

Wave 2 should widen the environment surface and begin the first real control
flows once observability is trustworthy.

| Workstream | Main outcome | Why it belongs in Wave 2 |
|---|---|---|
| **Local WSL observability** | Streamliner can discover and normalize sessions in local WSL | This extends the same session fabric into the next most valuable environment |
| **Dev box WSL observability** | Streamliner can discover and normalize sessions in WSL running on the dev box | This completes the first meaningful cross-environment matrix you care about |
| **Session curation and join basics** | The operator can promote an ad-hoc session into a known workstream context and join it intentionally | This turns visibility into useful presence without jumping all the way to rich control |
| **Cross-environment launch and recovery basics** | Streamliner can start known-good launches in target environments and recover the operator view when sessions disappear or machines bounce | This is the first control-plane step that is worth doing after observability is solid |

### Wave 2 notes

Wave 2 should build on the same shared session/runtime shape rather than invent
environment-specific models.

The order inside Wave 2 should follow your practical value sequence:

1. local WSL
2. dev box WSL
3. join and curation basics
4. launch and recovery basics

That sequence keeps the next environment adapters from waiting on a larger
control-plane effort.

## How these workstreams parallelize

These workstreams are parallelizable, but not because they are independent.
They are parallelizable because they can consume explicit outputs from one
another.

The pattern should be:

1. **One workstream defines a shared contract.**
2. **Other workstreams start once that contract reaches a stable checkpoint.**
3. **Integration overlap happens near the tail, not at the head.**

That is the right kind of overlap. Two workstreams can both touch the same code
areas if only one of them owns the underlying contract decisions.

### Preferred dependency shape

Prefer dependencies like:

- "Portfolio shell depends on session-runtime-v1"
- "Graph overlays depend on node-binding-v1"
- "Dev box WSL observability depends on the shared adapter contract"

Avoid dependencies like:

- "everything depends on the whole dev box workstream finishing"
- "this workstream depends on three arbitrary internal nodes in another
  workstream"

When cross-workstream dependencies are real, they should usually target a small
set of exported checkpoints rather than a large chunk of internal execution.

## Rules of thumb for future waves

- **Favor one outcome over one subsystem.** "Dev box observability" is better
  than "all session infrastructure."
- **Favor one review question over one implementation area.** The workstream
  should be easy to judge at a gate.
- **Let nodes absorb local blockage.** A workstream can keep making progress even
  if one downstream node waits on another workstream's checkpoint.
- **Do not split ownership of a shared contract.** If two workstreams are both
  still defining the same core shape, the split happened too early.
- **Do not force every dependency into one giant graph.** Above the workstream
  level, the system should coordinate through summaries and checkpoints.

## Current recommendation

If the goal is to make Streamliner genuinely usable soon, the near-term center
of gravity should be:

1. **Dev box observability**
2. **Portfolio shell**
3. **Graph session overlays and attachment UX**

Then expand outward through:

1. **Local WSL observability**
2. **Dev box WSL observability**
3. **Session curation and join basics**
4. **Cross-environment launch and recovery basics**

That keeps the next wave aligned with your real operating environment while also
moving the product toward a multi-workstream portfolio view rather than a
single-workstream graph viewer.
