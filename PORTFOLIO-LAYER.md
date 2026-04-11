# Streamliner Portfolio Layer

> Working draft for the product layer above individual workstreams.

Streamliner today is organized around a single workstream graph. That is the
right primary surface for execution inside a workstream. But the operator's
first question when opening Streamliner is usually not "which node is next in
this one graph?" — it is "what is happening right now across my active work?"

The portfolio layer answers that question. It gives the operator a place to
stand above any single workstream: see concurrent workstreams across projects,
see live sessions across environments, notice ad-hoc sessions, and then drill
into the right graph or session.

## Core model

| Entity | Meaning |
|---|---|
| **Portfolio** | The top-level operator surface across projects, workstreams, and sessions. Primarily a UI and runtime concept. |
| **Project** | A logical body of work with its own design context and participating repositories. Contains one or more concurrent workstreams. |
| **Workstream** | The existing execution unit: brief, dependency graph, and nodes. |
| **Public checkpoint** | A milestone or contract that a workstream exports for others to depend on. The preferred unit of cross-workstream coordination. |
| **Session** | A live AI execution context, whether Streamliner launched it or not. |
| **Session attachment** | A binding between a session and a project, workstream, or node. May be automatic, operator-curated, or provisional. |
| **Environment** | A runtime location: local Windows, local WSL, dev box Windows, dev box WSL, or others later. |

## What the portfolio layer does

### Startup shell

When Streamliner opens, the operator sees:

- active projects and their workstreams
- active and recent sessions across environments
- ad-hoc sessions not yet attached to any workstream

From there, the operator drills into a workstream graph, a specific session, or
an environment view. The graph takes over once the operator is inside a
workstream.

### Cross-workstream coordination

Workstreams run in parallel. When they depend on each other, the dependency
should target a public checkpoint — a named milestone or contract — rather than
an arbitrary internal node.

A workstream's internal node structure stays internal. Cross-workstream coupling
is visible through the small set of checkpoints each workstream exports. A node
inside one workstream can be locally blocked on another workstream's checkpoint
while the rest of the workstream continues.

This keeps the useful property that workstreams are large autonomous units of
execution. If a project requires many fine-grained cross-workstream node
dependencies, the workstream boundaries probably need rethinking.

### Session visibility across environments

The portfolio layer presents a unified session view across all registered
environments. Observability comes first: the operator can see what is running
on the dev box, in local WSL, or elsewhere before any launch or join capability
exists for that environment.

### Ad-hoc sessions

Sessions that were not launched by Streamliner are still visible. An ad-hoc
session can stay ad hoc, or the operator can attach it to a project, workstream,
or node when that becomes useful. Attachment is a gradual act, not a gate.

## Artifacts and runtime state

The portfolio layer follows the existing split between committed artifacts and
local runtime state. Session discovery, heartbeats, attachment state, and launch
metadata are runtime concerns. The portfolio view reads artifacts, runtime
state, and tracker state together, but the fast-moving parts stay local.

## UI direction

An initial portfolio UI has four views:

1. **Home** — projects, workstreams, sessions, unattached sessions
2. **Project** — workstreams and their exported checkpoints
3. **Environment** — sessions grouped by host and runtime location
4. **Workstream** — the existing graph-first surface

A good home view plus a good workstream view is enough to validate the model
early.

## Evolution path

### Phase 1: Visibility

- startup shell with project and workstream navigation
- ad-hoc session discovery
- environment-aware session listing

### Phase 2: Coordination

- public checkpoint summaries across workstreams
- cross-workstream blocker visibility
- session attachment state

### Phase 3: Presence and control

- join, launch, and recovery flows
- operator-presence controls from the portfolio shell

Visibility comes first because the operator needs to trust what they see before
acting on it.

## Open questions

1. Where do public checkpoints live as durable data — inside workstream
   artifacts, in a separate portfolio artifact, or as a derived view?
2. How much of session attachment should be automatic versus operator-curated?
3. What is the smallest useful project model for grouping workstreams across
   repositories?
4. Which startup view should dominate: projects, active sessions, or
   workstreams?
5. How should ad-hoc sessions be promoted into workstream context without
   ceremony?
