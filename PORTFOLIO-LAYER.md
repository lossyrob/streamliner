# Streamliner Portfolio Layer

> Working draft for the product layer above individual workstreams.

This document extends the current product direction with a high-level model for
the layer above a single workstream graph. The goal is not to replace the graph.
The goal is to explain how Streamliner grows into a tool for operating across
many workstreams, many projects, and many live sessions without collapsing into
one giant undifferentiated dashboard.

## Why this layer exists

Inside a workstream, the graph should remain the primary surface.

Above a workstream, the operator still needs a place to:

- see concurrent workstreams across one project or several projects
- see active sessions across environments
- notice ad-hoc sessions that are not yet attached to a workstream
- move from "what is active right now?" to the right workstream graph or session
- understand cross-workstream blockers without flattening all node structure into
  one super-graph

The existing product direction already implies this need:

- the graph is primary **within** a workstream
- Streamliner should support multiple concurrent workstreams
- Streamliner should show live sessions across environments

Those ideas want a layer above the workstream view.

## Core position

The portfolio layer is:

- a **navigation layer**
- a **visibility layer**
- a **coordination layer**

It is **not**:

- a replacement for the workstream graph
- a giant merged dependency graph for every node everywhere
- a justification for storing runtime telemetry in committed artifacts
- a worker-to-worker chat fabric

## Core model

| Entity | Meaning | Notes |
|---|---|---|
| **Portfolio** | The top-level operator surface across projects, workstreams, and sessions | This is primarily a UI/runtime concept, not necessarily a single committed artifact |
| **Project** | A logical body of work with its own design context and participating repositories | A project may contain several concurrent workstreams |
| **Workstream** | The existing execution unit with a brief and dependency graph | The graph remains primary inside it |
| **Public checkpoint** | A milestone or contract exported by a workstream for other workstreams to rely on | This is the preferred unit of cross-workstream dependency |
| **Session** | A live AI execution context that may or may not have been launched by Streamliner | Sessions may be attached or ad hoc |
| **Session attachment** | A binding between a session and a project, workstream, or node | This may be automatic, operator-curated, or provisional |
| **Environment** | A runtime location such as local Windows, local WSL, dev box Windows, or dev box WSL | Environments shape discovery, launch, and join flows |

## The key design idea

**Graph-first, not graph-only.**

That means:

- when the operator is inside a workstream, the graph is the main surface
- when the operator opens Streamliner cold, the first question is often not
  "which node is next in this one graph?"
- the first question is often "what is happening right now across my active
  work?"

The portfolio layer exists to answer that startup question cleanly.

## Responsibilities of the portfolio layer

### 1. Startup shell

Streamliner should have a top-level shell that can show:

- active projects
- active workstreams
- active sessions
- ad-hoc or unattached sessions
- recent workstreams
- environments with live activity

From there, the operator drills into a workstream graph, a session, or an
environment-focused view.

### 2. Cross-workstream coordination

The portfolio layer should make it possible to say:

- this workstream can proceed until checkpoint X
- this other workstream exports checkpoint X
- this node is locally blocked because checkpoint X is not ready yet

This is different from flattening every node relationship into one graph.

The preferred model is:

1. workstreams keep their internal node structure private by default
2. workstreams expose a small set of public checkpoints
3. other workstreams depend on those checkpoints when necessary

That keeps most blockage local while still making real cross-workstream coupling
visible.

### 3. Session visibility across environments

The portfolio layer should present a coherent session universe across:

- local Windows
- local WSL
- dev box Windows
- dev box WSL
- later environments if needed

This does not require launch parity on day one. Observability should come
before rich control.

### 4. Ad-hoc session handling

Not every useful session will begin life as a perfectly launched,
workstream-attached session.

The portfolio layer should treat these as first-class:

- a visible ad-hoc session can stay ad hoc
- it can later be attached to a project or workstream
- it can later be attached to a specific node when that becomes useful

That avoids a false binary between "fully managed" and "not visible at all."

## Relationship to artifacts and runtime state

The portfolio layer should preserve the existing split:

- **Committed artifacts** carry design intent and workstream execution structure
- **Local runtime state** carries session discovery, heartbeats, attachment
  state, launch metadata, and other fast-moving facts

The portfolio layer is mostly a runtime-projected surface. It should read
artifacts, runtime state, and tracker state together, but it should not turn
that fast-moving view into a Git-managed telemetry log.

## Relationship to workstream boundaries

The portfolio layer should make large autonomous workstreams easier to run in
parallel, not harder.

That means:

- a workstream should still own one meaningful outcome
- internal node dependencies should stay inside the workstream whenever possible
- cross-workstream dependencies should target public checkpoints
- whole-workstream blocking should be the exception, not the default

If the operator keeps needing many arbitrary cross-workstream node dependencies,
one of two things is probably wrong:

1. the workstream boundaries are too fuzzy
2. the public checkpoints are not explicit enough

## UI direction

An initial portfolio-layer UI could include:

1. **Home / cockpit view** - projects, workstreams, sessions, unattached sessions
2. **Project view** - current workstreams and their exported checkpoints
3. **Environment view** - sessions by host/runtime location
4. **Workstream view** - the existing graph-first surface

The first useful version does not need every one of these views to be rich. A
good home view plus a good workstream view may be enough to validate the model.

## Possible evolution path

### Phase 1: Visibility

- startup shell
- project/workstream navigation
- ad-hoc session list
- environment-aware session discovery

### Phase 2: Coordination

- public checkpoint summaries
- cross-workstream blockers
- clearer attachment state between sessions and workstreams

### Phase 3: Presence and control

- join flows
- launch flows
- recovery flows
- richer operator-presence controls from the portfolio shell

This ordering keeps the early system grounded in reality: you need to be able to
see the work before you can sensibly control it.

## Design constraints

- **The graph remains primary inside a workstream.**
- **The portfolio layer must not become a generic PM dashboard.**
- **Ad-hoc sessions are first-class, not edge cases.**
- **Cross-project visibility matters from the start.**
- **Runtime facts remain runtime facts.**
- **Checkpoint exports are the main cross-workstream contract surface.**

## Open questions

1. Where should public checkpoints live as durable data: inside workstream
   artifacts, in a separate portfolio artifact, or as a derived view?
2. How much of session attachment should be automatic versus explicitly curated
   by the operator?
3. What is the smallest useful project model for grouping workstreams across
   repositories?
4. Which startup view should dominate first: projects, active sessions, or
   workstreams?
5. How should ad-hoc sessions be promoted into formal workstream context without
   feeling heavy?

## Summary

The portfolio layer is the product move that lets Streamliner grow from
"graph-first workstream viewer" into "graph-first operator cockpit."

It adds a layer above individual workstreams for:

- startup navigation
- cross-workstream coordination
- cross-project visibility
- environment-aware session discovery
- first-class treatment of ad-hoc sessions

The workstream graph stays primary where it should stay primary. The new layer
exists so the operator has a coherent place to stand before choosing which graph
or session to enter.
