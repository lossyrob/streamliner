# Work Geometry Canvas

## Stage

Shaping; visual spike available for review.

## Seed Idea

Explore Streamliner as a system for revealing work geometry: the shape, status, and interconnectedness of multiple workstreams. The imagined UI is a single canvas showing multiple workstream graphs connected by dotted lines where checkpoint exports or dependencies flow into other workstreams.

Concrete example: the [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md) candidate needs an orchestrator-helper instruction that can call `streamliner launch-node`. That capability is exported by the Distribution/Integration workstream described in GitHub issue #40, which itself imports the stable API-first launch pipeline from the Session Launching workstream. This should eventually be visible both in an all-workstreams canvas and as an external dependency indicator inside a single-workstream graph.

## Why It Matters

The canvas is the first place where Streamliner's higher-level thesis becomes visible: the builder is not only managing individual issues or isolated workstream graphs, but the geometry of multiple related workstreams inside a project. A useful canvas should help the builder see blockers, branch-local risks, unstable exports, validation gates, and whether workstream boundaries are shaped well.

This is hard to reason about abstractly. The right visualization may be collapsed cards, full embedded graphs, timeline lanes, or a hybrid. Before shaping the workstream too tightly, compare throwaway visual spikes against realistic mock data.

## Spike Artifacts

Static throwaway HTML spikes live under:

```text
.streamliner/shaping/spikes/work-geometry-canvas/
```

Open `index.html` to compare:

- `cards.html` — collapsed workstream cards connected by import/export edges.
- `graphs.html` — several mini workstream graphs rendered on one canvas with edges attached to specific nodes.
- `lanes.html` — timeline/swimlane view focused on checkpoints, gates, imports, exports, and availability.

The mock project uses the candidate workstreams from this shaping session plus Session Launching and Distribution/Integration #40 to make dependency geometry concrete.

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
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md), because checkpoint validation and punch-list state need to be visible inside and across workstreams.

## First Useful Slice

Pending review of the visual spikes. The likely first slice should be whichever view makes project-scoped cross-workstream dependency awareness easiest to understand with realistic density.

## Common Workstream Shape Hypothesis

As more candidate workstreams accumulate, a common shape is emerging:

1. **Shaping / formation** — ambiguous intent becomes a bounded workstream with a brief, graph, initial waves, gates, imports, exports, and tracker-backed first nodes.
2. **Design foundation wave** — the workstream makes the intended approach explicit: design sessions, decisions, schema choices, UX direction, architecture boundaries, or operating rules.
3. **Substrate / enabling wave** — the workstream builds the minimum infrastructure, data model, context surface, configuration, or tooling needed before user-visible work can proceed.
4. **First usable slice wave** — the workstream produces a real, testable capability. This may be rough, but it proves the path and gives the builder something to evaluate.
5. **Integration / overlay wave** — the capability is connected to adjacent surfaces: UI state, runtime overlays, session registry, GitHub integration, docs, downstream imports, or cross-workstream dependencies.
6. **Validation / gate wave** — the builder validates the running system, resolves design mismatches, and decides whether downstream work can safely build on the outputs.
7. **Automation / hardening wave** — follow-on automation, safety policies, review loops, edge cases, richer configuration, and cleanup happen after the core shape is proven.
8. **Closure / export wave** — the workstream's outputs become explicit exports for downstream workstreams: schemas, APIs, commands, docs conventions, role guidance, UI capabilities, or operational practices.

Not every workstream needs every phase. Small workstreams may compress several phases into one wave. Large platform workstreams may repeat the sequence across several major capabilities.

The key idea: a **wave is a confidence transition**, not just a time box. A wave should create a new state that can be inspected, validated, consumed, or used to refine later work.

### What makes a wave a wave?

A wave boundary is useful when it changes one of these things:

- **Confidence** — a design assumption is now proven or rejected.
- **Consumability** — an export becomes available for downstream work.
- **Visibility** — the builder can see or use a meaningful slice.
- **Authority** — a decision, doc, or schema becomes the reference point for later work.
- **Coordination** — downstream nodes or workstreams can now be promoted.
- **Risk** — a gate is needed before other work builds on the result.

This means waves should usually correspond to checkpoints/gates/exports, not arbitrary batches of tasks.

### Visual implication

The Atlas/canvas probably wants a top-down flow:

```text
Shaping / formation
  ↓
Design foundation
  ↓
Substrate / enabling capability
  ↓
First usable slice
  ↓
Integration / overlay
  ↓
Validation / gate
  ↓
Automation / hardening
  ↓
Closure / exports
```

Each workstream is a vertical progression through time. Cross-workstream edges should usually connect an upstream wave's export/checkpoint/gate to a downstream wave's import or blocker.

When a wave turns green, its exports become visually available to flow downward or sideways into dependent workstreams. Branch-local or preview exports should look available but risky; validated/mainline exports should look safe to consume.

This suggests a canvas that is more like a **river/tree of work** than a flat project dashboard: workstreams descend through waves, and exports flow between them at the points where one stream becomes usable by another.

## Open Questions

- What is the minimum useful visualization of cross-workstream geometry?
- Should the first UI show full graphs, collapsed workstream cards, or both?
- How should statuses, blocked work, and dependency lines be visually encoded?
- Should external dependencies attach to whole workstreams, waves, checkpoints, or explicit exported artifacts?
- In the single-workstream view, how should Streamliner show that a node/wave/checkpoint is waiting on an export from another workstream?

## Handoff Brief
