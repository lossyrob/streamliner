# Work Geometry Canvas

## Stage

Seeded

## Seed Idea

Explore Streamliner as a system for revealing work geometry: the shape, status, and interconnectedness of multiple workstreams. The imagined UI is a single canvas showing multiple workstream graphs connected by dotted lines where checkpoint exports or dependencies flow into other workstreams.

Concrete example: the [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md) candidate needs an orchestrator-helper instruction that can call `streamliner launch-node`. That capability is exported by the Distribution/Integration workstream described in GitHub issue #40, which itself imports the stable API-first launch pipeline from the Session Launching workstream. This should eventually be visible both in an all-workstreams canvas and as an external dependency indicator inside a single-workstream graph.

## Why It Matters

## Candidate Scope

### In Scope

### Out of Scope

### Deferred

## Dependencies

### Depends On

- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because the canvas needs durable dependency semantics before it can render cross-workstream geometry meaningfully.

### Enables

- None identified yet.

### Related Candidates

- [Workstream Design Mode](workstream-design-mode.md), because both focus on making the shape of work visible and navigable.

## First Useful Slice

## Open Questions

- What is the minimum useful visualization of cross-workstream geometry?
- Should the first UI show full graphs, collapsed workstream cards, or both?
- How should statuses, blocked work, and dependency lines be visually encoded?
- Should external dependencies attach to whole workstreams, waves, checkpoints, or explicit exported artifacts?
- In the single-workstream view, how should Streamliner show that a node/wave/checkpoint is waiting on an export from another workstream?

## Handoff Brief
