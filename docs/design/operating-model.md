# Operating Model

A single builder manages many concurrent workstreams through stateless AI coding agents. Every agent session starts cold — no memory of previous sessions, no shared understanding, no continuity of identity. The builder is the sole authority on intended design. The artifact system is the sole source of truth.

## The Operating Reality

Agents are capable generalists that work any problem given the right context. They lack persistent memory, shared understanding, and ambient awareness. They see only what is in their context window.

The builder has:

- instant, lossless communication through files, commits, and structured data
- cheap feedback through tests, CI, PR review, and rollback
- cheap parallelism — many sessions execute simultaneously
- reproducibility — a new session reads the same artifacts and continues
- fluid presence — engage any session at any level, then withdraw

The builder's scarcest resource is the ability to design work well at scale. The operating model requires builder attention only where human judgment, taste, design authority, or risk evaluation create irreplaceable value.

## Roles

```text
Builder
  → Orchestrator (AI session managing a workstream)
      → Worker (AI session executing a single node)
```

### Builder

The builder designs workstreams, owns the project's intended design, and allocates attention to high-leverage moments.

**Decides:**

- which workstreams to pursue and their boundaries
- the intended design of the project
- purpose, approach, and boundaries of each workstream
- whether to pass gates
- how to resolve consequential conflicts or design mismatches

**Delegates by default:**

- node-by-node decomposition within a workstream
- sequencing inside a workstream
- implementation details within a node

The builder can step away for hours or days, then return to a clear picture of what changed, what is healthy, and what requires judgment.

### Orchestrator

An AI session that translates project design plus workstream intent into an executable plan. It manages wave progression, reviews worker output for alignment, and updates workstream artifacts as reality unfolds.

**Decides:**

- how to decompose the workstream into nodes and dependencies
- which nodes belong to which wave
- which design docs and decisions to surface first for each node
- when a worker proceeds autonomously vs. when review is needed
- whether a discovered mismatch is a routine update or an escalation requiring builder judgment
- how to update the brief and graph based on shipped reality

**Does not decide:** project design direction, gate passage, or product-level architecture changes.

The orchestrator is a logical role, not necessarily a single persistent session. It may be fulfilled by a single AI session, by SDK-driven helpers that fork sessions for specific tasks like plan review or PR review, or by a combination. Any new orchestrator session reads the design layer and workstream artifacts and becomes productive immediately.

### Worker

An AI session that executes one node: plan, implement, and produce reviewable artifacts.

**Decides:**

- implementation approach inside issue boundaries
- code structure, naming, and detailed execution
- how to handle local technical realities
- whether an unresolved design choice warrants escalating to the builder

**Does not decide:** scope expansion, project-wide architecture changes, or silent divergence from intended design.

Workers almost never stop and wait for input. They either proceed from context or flag explicitly.

## Context Package

The context package provides layered context so any new session — regardless of role — can be immediately productive. See [Context Package](concepts/context-package.md) for the full layer model (Layer 0 through Layer 3).

## Information Flow

Communication is instant, lossless, and file-backed.

### Upward

Workers report through artifacts, not through being remembered:

- code changes and PR
- plan/back-brief when needed
- design-doc updates if any
- flags for issues exceeding worker authority

Orchestrators report through workstream artifacts. Updates to the brief and graph are the orchestrator's communication to the builder.

Fast operational telemetry (session IDs, observed session state, tracker snapshots, launch claims) updates a machine-local runtime store. It informs the UI but does not rewrite the committed graph on every change.

### Downward

The builder communicates project direction through the design layer and workstream direction through the brief. If the intended system changes, the design docs change. If the execution strategy changes, the brief and graph change.

The orchestrator communicates through graph structure, node specs, and design references as entry points into the broader design layer. Workers need the artifacts, not the orchestrator's conversation history.

### Lateral

There is no default worker-to-worker conversation channel. Coordination happens through graph dependencies, shared design docs, coordination notes in node context, and orchestrator updates to the workstream.

## Presence

The builder can be present at any level — shaping a node, reviewing a plan, co-piloting an implementation, interrogating reasoning, or taking over a critical node — then withdraw without breaking the chain of execution.

### When the Builder Enters

The builder's most common engagement points are:

- **Plan review** — reviewing the implementation plan before work proceeds
- **Final PR review** — reviewing the completed work, asking questions, and requesting changes
- **Gate review** — hands-on testing of the running system at checkpoints

Mid-implementation interruption is rarely useful. The builder typically waits for a natural checkpoint — a plan to review, a PR to evaluate, or a gate to test.

### Presence Does Not Replace Artifacts

When the builder enters a session, artifacts remain the source of truth. Presence augments execution. It does not create hidden dependencies on remembered conversation.

### Visible Autonomy

Healthy autonomy is visible from the graph: nodes progressing, PRs appearing, without escalation. When the operational picture makes autonomous progress legible, the builder can trust it and reserve presence for moments of real leverage.

## Operating Rhythm

### Phase 1 — Workstream Shaping

The builder and orchestrator align on relevant project design, update design docs first if direction is changing, then produce the brief and graph. Wave 1 is detailed; later waves are sketched.

This is the most attention-intensive phase. Good workstream design here determines how much autonomous execution is possible later. Shaping focuses on the work geometry: boundaries, contracts, imports, exports, checkpoints, gates, and the feedback signals that would show the geometry is wrong.

Shaping can be incremental. A workstream can start with a provisional graph — the brief and graph do not need to be final before execution starts. For GitHub-backed workstreams, create the parent issue plus the first execution and design-session issues first, then create more node issues after the design is explicit and the graph is refined. The parent issue is a first-class artifact: it is the GitHub-visible grouping and progress surface for the workstream.

### Phase 2 — Autonomous Execution

The worker reads the context package (Layers 0–3), plans the implementation, optionally receives alignment review, implements, creates the PR, and flags any design-doc changes for review.

The builder's role during this phase is none unless flagged.

### Phase 3 — Wave Transition

The orchestrator reviews what the wave planned, what shipped, and what the design layer says the system is intended to become. It updates the brief, proposes the next wave, and brings the updated plan to the builder.

### Phase 4 — Gate Review

The builder evaluates whether the workstream is on track. Gate review is not just a checklist — it includes:

- **Hands-on testing** of the running system: does it work, does it feel right?
- **UX validation**: is the user experience what was intended, or do interaction patterns need adjustment?
- **Approach review**: were design-doc updates handled correctly?
- **Decision resolution**: do any unresolved design choices require the builder's judgment?

Gates are the primary moment when the builder uses the actual system rather than reviewing artifacts. When enough functionality exists that design decisions need to be validated against real usage, that is the right time for a gate.

## Alignment Mechanism

The worker's plan is its alignment check. The reviewer — usually the orchestrator, sometimes the builder — checks:

1. Does the plan serve the workstream's purpose?
2. Does it respect the workstream's boundaries?
3. Does it align with the design layer, starting with referenced design docs and decisions?
4. Does it conflict with parallel or downstream nodes?

If those pass, the worker proceeds. If not, the reviewer gives targeted correction. Not every node needs alignment review — the more architectural, ambiguous, or high-coordination the node, the more valuable review becomes.

## Artifact System

Everything important is a committed file. Nothing important lives only in chat history.

**Project design docs** — the project-level design authority, living in `docs/design/` with an index, domain docs, and decision records.

**Workstream artifacts** — the execution layer: `brief.md`, `graph.json`, and supporting docs, living in the workstream directory.

**Local runtime state** — fast-moving operational facts (session IDs, observed session state, tracker snapshots, launch metadata) in Streamliner's machine-local runtime store. The UI derives its live picture by combining the committed artifact layer with this runtime layer.

**Not artifacts:** orchestrator or worker chat history, dashboard state, session runtime state, tracker caches, or memory of what was "probably intended."

## Feedback Loops

Each wave is a cycle: **Shape → Execute → Review → Reshape.**

When boundaries are well-drawn, execution runs without intervention. When they are not, the builder sees it: cross-workstream blockers, sessions that don't fit the structure, outputs that can't be consumed downstream, branch-local exports that other workstreams accidentally depend on, and escalations revealing hidden coupling.

The speed of this feedback loop makes workstream design a learnable skill. An engineering manager running human teams gets this feedback over quarters. A builder directing autonomous agents gets it in days.

## Builder Attention Allocation

| Activity | Frequency | Leverage |
|---|---|---|
| Workstream shaping | Once per workstream or major pivot | Highest |
| Wave transition review | Once per wave | High |
| Gate review (including hands-on testing) | A few times per workstream | High |
| Design mismatch resolution | As flagged | High |
| Hands-on presence | By choice | Variable |
| Dashboard check | Routine | Low |

Everything else flows through orchestrators and workers operating from the artifact system.
