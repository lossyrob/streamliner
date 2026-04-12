---
kind: design-doc
status: current
last_updated: 2026-04-12
update_semantics: rewrite-in-place
authoritative_for: "Operating model: roles, context package, information flow, and operating rhythm"
scope_tags:
  - operating-model
  - roles
  - context-package
code_paths: []
references_decisions: []
---

# Operating Model

A single developer manages many concurrent workstreams through stateless AI coding agents. Every agent session starts cold — no memory of previous sessions, no shared understanding, no continuity of identity. The developer is the sole authority on intended design. The artifact system is the sole source of truth.

## The Operating Reality

Agents are capable generalists that work any problem given the right context. They lack persistent memory, shared understanding, and ambient awareness. They see only what is in their context window.

The developer has:

- instant, lossless communication through files, commits, and structured data
- cheap feedback through tests, CI, PR review, and rollback
- cheap parallelism — many sessions execute simultaneously
- reproducibility — a new session reads the same artifacts and continues
- fluid presence — engage any session at any level, then withdraw

The developer's scarcest resource is the ability to design work well at scale. The operating model requires developer attention only where human judgment, taste, design authority, or risk evaluation create irreplaceable value.

## Roles

```text
Developer
  → Orchestrator (AI session managing a workstream)
      → Worker (AI session executing a single node)
```

### Developer

The developer designs workstreams, owns the project's intended design, and allocates attention to high-leverage moments.

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

The developer can step away for hours or days, then return to a clear picture of what changed, what is healthy, and what requires judgment.

### Orchestrator

An AI session that translates project design plus workstream intent into an executable plan. It manages wave progression, reviews worker output for alignment, and updates workstream artifacts as reality unfolds.

**Decides:**

- how to decompose the workstream into nodes and dependencies
- which nodes belong to which wave
- which design docs and decisions are relevant to each node
- when a worker proceeds autonomously vs. when review is needed
- whether a discovered mismatch is a routine update or a `decision-needed` escalation
- how to update the brief and graph based on shipped reality

**Does not decide:** project design direction, gate passage, or product-level architecture changes.

The orchestrator is a session, not a daemon. Any new orchestrator session reads the design layer and workstream artifacts and becomes productive immediately.

### Worker

An AI session that executes one node: plan, implement, update or flag design impact, and produce reviewable artifacts.

**Decides:**

- implementation approach inside issue boundaries
- code structure, naming, and detailed execution
- how to handle local technical realities
- whether a design-doc update or `decision-needed` flag is warranted

**Does not decide:** scope expansion, project-wide architecture changes, or silent divergence from intended design.

Workers almost never stop and wait for input. They either proceed from context or flag explicitly.

## The Context Package

The context package replaces the shared understanding that human teams carry in memory. It is an explicit, layered set of committed artifacts — complete, progressive, and bounded.

### Layer 0 — Project Design Context

The project's intended design: relevant `current` design docs, accepted decision records, and the design index as the cold-reader entry point.

Answers: What system are we building? What constraints are in force? What rationale must be honored?

`draft` design docs enter worker context only when the workstream or node explicitly references them because the node is shaping that draft.

### Layer 1 — Workstream Intent

The workstream's durable intent: Purpose, Approach, Design References, and Boundaries.

This is how the developer narrows project-level design into a specific effort — defining the workstream's boundaries and design surface.

### Layer 2 — Operational State

The current situation: Current State, Decisions, and Open Questions.

This layer orients the orchestrator and developer to what just happened, what is in flight, and what comes next. It is a durable summary, not a telemetry feed. Session heartbeats, tracker caches, and launch metadata live outside the committed artifact layer.

### Layer 3 — Node Context

What a worker receives for a specific node: wave context, node spec, coordination notes, and any node-specific design narrowing.

The worker never reconstructs the whole workstream. It receives project design, workstream intent, operational state, and the node's specific mission.

## Information Flow

Communication is instant, lossless, and file-backed.

### Upward

Workers report through artifacts, not through being remembered:

- code changes and PR
- plan/back-brief when needed
- design-doc updates if any
- an explicit design-impact declaration: `none`, `updated-docs`, or `decision-needed`
- flags for issues exceeding worker authority

Orchestrators report through workstream artifacts. Updates to the brief and graph are the orchestrator's communication to the developer.

Fast operational telemetry (session IDs, heartbeats, tracker snapshots, launch claims) updates a machine-local runtime store. It informs the UI but does not rewrite the committed graph on every change.

### Downward

The developer communicates project direction through the design layer and workstream direction through the brief. If the intended system changes, the design docs change. If the execution strategy changes, the brief and graph change.

The orchestrator communicates through graph structure, node specs, and design references. Workers need the artifacts, not the orchestrator's conversation history.

### Lateral

There is no default worker-to-worker conversation channel. Coordination happens through graph dependencies, shared design docs, coordination notes in node context, and orchestrator updates to the workstream.

## Presence and Engagement

The developer can be present at any level — shaping a node, reviewing a plan, co-piloting an implementation, interrogating reasoning, or taking over a critical node — then withdraw without breaking the chain of execution.

### Engagement Spectrum

Every node sits on a spectrum from full autonomy to full developer presence:

- **parked** — run fully autonomously unless flagged
- **watch** — let it run, but surface the result
- **focus** — developer intends to engage directly at some point in the lifecycle

The graph is the engagement control surface.

### Presence Does Not Replace Artifacts

When the developer enters a session, artifacts remain the source of truth. Presence augments execution. It does not create hidden dependencies on remembered conversation.

### Visible Autonomy

Healthy autonomy is visible from the graph: nodes progressing, PRs appearing, design-impact declarations arriving without escalation. When the operational picture makes autonomous progress legible, the developer can trust it and reserve presence for moments of real leverage.

## Operating Rhythm

### Phase 1 — Workstream Shaping

The developer and orchestrator align on relevant project design, update design docs first if direction is changing, then produce the brief and graph. Wave 1 is detailed; later waves are sketched.

This is the most attention-intensive phase. Good workstream design here determines how much autonomous execution is possible later.

### Phase 2 — Autonomous Execution

The worker reads Layers 0–3, plans the implementation, optionally receives alignment review, implements, updates or flags design impact, creates the PR, and declares design impact.

The developer's role during this phase is none unless flagged.

### Phase 3 — Wave Transition

The orchestrator reviews what the wave planned, what shipped, and what the design layer says the system is intended to become. It updates the brief, updates design references, proposes the next wave, and brings the updated plan to the developer.

### Phase 4 — Gate Review

The developer evaluates: Did the wave deliver the intended result? Does the design still look right? Were design-doc updates handled correctly? Do any `decision-needed` cases need resolution?

## Alignment Mechanism

The worker's plan is its alignment check. The reviewer — usually the orchestrator, sometimes the developer — checks:

1. Does the plan serve the workstream's purpose?
2. Does it respect the workstream's boundaries?
3. Does it align with referenced design docs and decisions?
4. Does it conflict with parallel or downstream nodes?

If those pass, the worker proceeds. If not, the reviewer gives targeted correction. Not every node needs alignment review — the more architectural, ambiguous, or high-coordination the node, the more valuable review becomes.

## Artifact System

Everything important is a committed file. Nothing important lives only in chat history.

**Project design docs** — the project-level design authority, living in `docs/design/` with an index, domain docs, and decision records.

**Workstream artifacts** — the execution layer: `brief.md`, `graph.json`, and supporting docs, living in the workstream directory.

**Local runtime state** — fast-moving operational facts (session IDs, heartbeats, tracker snapshots, launch metadata) in Streamliner's machine-local runtime store. The UI derives its live picture by combining the committed artifact layer with this runtime layer.

**Not artifacts:** orchestrator or worker chat history, dashboard state, session heartbeats, tracker caches, or memory of what was "probably intended."

## Feedback Loops

Each wave is a cycle: **Shape → Execute → Review → Reshape.**

When boundaries are well-drawn, execution runs without intervention. When they are not, the developer sees it: cross-workstream blockers, sessions that don't fit the structure, outputs that can't be consumed downstream, escalations revealing hidden coupling.

The speed of this feedback loop makes workstream design a learnable skill. An engineering manager running human teams gets this feedback over quarters. A developer directing autonomous agents gets it in days.

## Developer Attention Allocation

| Activity | Frequency | Leverage |
|---|---|---|
| Workstream shaping | Once per workstream or major pivot | Highest |
| Wave transition review | Once per wave | High |
| Gate review | A few times per workstream | High |
| Design mismatch resolution | As flagged | High |
| Hands-on presence | By choice | Variable |
| Dashboard check | Routine | Low |

Everything else flows through orchestrators and workers operating from the artifact system.
