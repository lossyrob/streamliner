# Streamliner Doctrine: Agent Orchestration for Autonomous Development

A reinvention of military command principles for AI agent orchestration, designed for a world where subordinates are brilliant blank slates, communication is instant, feedback is cheap, and the operator's scarcest resource is attention.

Streamliner uses three durable context surfaces:

1. the **project design layer** (`DESIGN-DOCS.md`)
2. the **workstream layer** (brief + graph)
3. the **node/tracker layer** (node specs, worker plans, PRs)

The doctrine explains how those surfaces work together.

---

## The operating reality

We are not commanding an army. We are a single developer managing many concurrent workstreams through AI coding agents. The constraints and advantages are fundamentally different from military operations.

**What we lack (vs. trained human subordinates):**

- persistent memory - every session starts cold
- shared doctrine - no years of training or implicit understanding
- continuity of identity - the session that planned may not be the session that implements
- ambient awareness - agents only know what is in their context window

**What we have (that military command structures do not):**

- instant, lossless communication through files, commits, and structured data
- cheap feedback through tests, CI, PR review, and rollback
- highly capable generalists that can work any problem if given the right context
- reproducibility - a new session can pick up the same artifacts and continue
- cheap parallelism - many workers can execute simultaneously
- operator omnipresence - the operator can instantly engage any session at any level, then withdraw

**The operator's true constraint:**

Attention is the bottleneck. Not capability. Not raw time. Attention.

The system must require operator attention only where human judgment, taste, design authority, or risk evaluation create irreplaceable value.

---

## The three-level hierarchy

Streamliner uses exactly three operating levels:

```text
Operator (developer)
  -> Orchestrator (AI session managing a workstream)
       -> Worker (AI session executing a single node)
```

Each level has different authority and different information needs.

### Operator

**Role:** Sets direction, owns design, reviews high-leverage moments, and allocates attention.

**What the operator decides:**

- which workstreams to pursue
- the intended design of the project
- the purpose, approach, and boundaries of each workstream
- whether to pass gates
- how to resolve consequential conflicts or design mismatches

**What the operator does not decide by default:**

- node-by-node decomposition
- day-to-day sequencing inside a workstream
- implementation details within a node

**Design principle:** The operator should be able to step away for hours or days, then return to a clear picture of what changed, what is healthy, and what requires judgment.

### Orchestrator

**Role:** Translates project design plus workstream intent into an executable plan, manages wave progression, reviews worker output for alignment, and updates workstream artifacts as reality unfolds.

**What the orchestrator decides:**

- how to decompose the workstream into nodes and dependencies
- which nodes belong to which wave
- which design docs and decisions are relevant to the workstream and to a given node
- when a worker can proceed autonomously vs. when review is needed
- whether a discovered mismatch is a routine design-doc update or a `decision-needed` escalation
- how to update the brief and graph based on shipped reality

**What the orchestrator does not decide:**

- the project's intended design direction
- whether to proceed past a gate
- product-level architecture changes that should be owned by the operator

**Design principle:** The orchestrator is a session, not a daemon. Any new orchestrator session should be able to read the design layer and workstream artifacts and become productive immediately.

### Worker

**Role:** Executes one node: plan, implement, update or flag design impact, and produce reviewable artifacts.

**What the worker decides:**

- implementation approach inside the issue boundaries
- code structure, naming, and detailed execution decisions
- how to handle local technical realities
- whether the node required a design-doc update or a `decision-needed` flag

**What the worker does not decide:**

- scope expansion
- project-wide architecture changes
- whether to silently ignore a mismatch with intended design

**Design principle:** Workers should almost never stop and wait for input. They either proceed from context or flag explicitly.

---

## The context package: solving the blank-slate problem

Human teams carry shared context in memory and habit. Our agents do not.

The solution is an explicit **context package** built from committed artifacts.

It is designed to be:

- **complete** - everything needed to act responsibly
- **layered** - each level gets what it needs
- **progressive** - broad context first, deeper context only when needed
- **bounded** - small enough to fit inside a useful context budget

### Layer 0: Project Design Context

This is the project's intended design:

- relevant `current` design docs
- accepted decision records
- the design index as the cold-reader entry point

This layer answers:

- what system are we trying to build?
- what design constraints are already in force?
- what rationale must be honored?

`draft` design docs are not default worker truth. They only enter worker context when the workstream or issue explicitly references them because the node is participating in shaping that draft.

### Layer 1: Workstream Intent

This is the workstream's durable intent:

- **Purpose**
- **Approach**
- **Design References**
- **Boundaries**

This is how the operator narrows the project-level design into a specific effort.

### Layer 2: Operational State

This is the current situation of the workstream:

- **Current State**
- **Decisions**
- **Open Questions**

This layer orients the orchestrator and operator to what just happened, what is in flight, and what comes next. It is a durable summary, not a telemetry feed. Session heartbeats, tracker caches, and launch metadata live outside the committed artifact layer.

### Layer 3: Node Context

This is what a worker receives for a specific node:

- wave context
- node spec (issue body or local spec file)
- coordination notes
- any node-specific design narrowing carried in the node spec or coordination notes

The worker is never supposed to reconstruct the whole workstream from scratch. It receives the project design, the workstream's intent, the current situation it actually needs, and the node's specific mission.

---

## The communication protocol

The doctrine assumes communication is instant, lossless, and file-backed.

### Upward communication

**Workers report through artifacts, not through being remembered.**

The worker's output is:

- code changes and PR
- plan/back-brief when needed
- design-doc updates, if any
- an explicit design-impact declaration: `none`, `updated-docs`, or `decision-needed`
- flags for issues that exceed worker authority

**Orchestrators report through workstream artifacts.**

Updates to the brief and graph are the orchestrator's communication to the operator.

**Fast operational telemetry reports through local runtime state.**

Session IDs, heartbeats, tracker snapshots, and launch claims update a machine-local runtime store. They inform the UI's operational picture, but they do not rewrite the committed graph on every change.

### Downward communication

**The operator communicates project direction through the design layer and workstream direction through the brief.**

If the intended system changes, the design docs change.
If the execution strategy changes, the brief and graph change.

**The orchestrator communicates through graph structure, node specs, and design references.**

Workers do not need the orchestrator's conversation history. They need the artifacts that resulted from it.

### Lateral communication

There is no default worker-to-worker conversation channel.

Coordination happens through:

- graph dependencies
- shared design docs
- coordination notes in node context
- orchestrator updates to the workstream

This keeps coordination explicit and durable.

---

## Operator presence: the superpower the military does not have

In military command, presence is expensive and localized. In Streamliner, the operator can instantly be present at any level, then disappear again just as quickly.

That changes delegation fundamentally.

The operator can:

- shape a specific node before a worker starts
- review a worker's plan directly
- co-pilot an implementation in flight
- interrogate reasoning inside a live session
- take over a critical node completely
- withdraw without breaking the chain of execution

### The engagement spectrum

Every node sits on a spectrum:

```text
Full autonomy <-------------------------------> Full operator presence
```

- **parked** - run fully autonomously unless flagged
- **watch** - let it run, but surface the result
- **focus** - operator intends to engage directly at some point in the lifecycle

The graph is the engagement control surface.

### Presence does not replace artifacts

When the operator enters a session, the artifacts remain the source of truth:

- design docs still hold intended design
- the brief still holds workstream intent and operational state
- the issue still holds node-level outcome

Presence augments execution. It does not create hidden dependencies on remembered conversation.

### The anti-pattern: presence addiction

Zero-cost presence creates a temptation to hover over everything. If the operator personally intervenes on every node, the whole point of Streamliner collapses.

The system should make healthy autonomy visible so presence stays deliberate.

---

## The operating rhythm

### Phase 1: Workstream shaping

The operator and orchestrator:

1. align on relevant project design
2. update design docs first if the intended direction is changing
3. produce the brief
4. produce the graph
5. detail Wave 1
6. sketch later waves

**Output:** committed design-doc updates if needed, plus committed workstream artifacts.

### Phase 2: Autonomous execution

The worker:

1. reads Layer 0 through Layer 3
2. plans the implementation
3. optionally receives alignment review
4. implements
5. updates referenced design docs or flags a consequential mismatch
6. creates the PR
7. declares design impact

The operator's role during this phase is none unless flagged.

### Phase 3: Wave transition

The orchestrator reviews:

- what the wave planned
- what actually shipped
- what the design layer says the system is intended to become

Then it updates the brief, updates design references if needed, proposes the next wave, and brings the updated plan to the operator.

### Phase 4: Gate review

At gates, the operator evaluates:

- did the wave deliver the intended result?
- does the design still look right?
- were design-doc updates handled correctly?
- do any `decision-needed` cases need resolution before proceeding?

---

## The alignment mechanism: lightweight back-brief

The worker's plan is the back-brief.

The reviewer - usually the orchestrator, sometimes the operator - checks four things:

1. Does the plan serve the workstream's purpose?
2. Does it respect the workstream's boundaries?
3. Does it align with the referenced design docs and decisions?
4. Does it conflict with parallel or downstream nodes?

If those pass, the worker proceeds. If not, the reviewer gives targeted correction and the worker replans.

Not every node needs a back-brief. The more architectural, ambiguous, or high-coordination the node is, the more valuable review becomes.

---

## The artifact system

Everything important is a committed file. Nothing important should live only in chat history.

### 1. Project design docs

Design docs live in a dedicated directory — typically `docs/design/` in the source repo, but they can also live in a separate design repo or the planning repo.

```text
{repo}/
  docs/
    design/
      index.md
      {domain}.md
      decisions/
        001-{slug}.md
```

This is the project-level design authority.

### 2. Workstream artifacts

Workstream artifacts live in their own directory — typically in a planning repo, but they can also live in the source repo or a dedicated workstream repo.

```text
workstreams/
  {id}/
    brief.md
    graph.json
    docs/
```

This is the execution layer.

### 3. Local runtime state

Fast-moving operational facts live in Streamliner's machine-local runtime store rather than in Git:

```text
~/.streamliner/state/
  {projectKey}/
    {workstream-id}/
      runtime.json
      sessions.json
      tracker-cache.json
```

This layer holds things like:

- active session IDs and heartbeats
- launch metadata
- tracker and PR snapshots
- transient coordination facts that should not create merge churn

`projectKey` comes from the workstream graph (or falls back to the primary repo ID / sole repo ID when omitted). The filenames above are illustrative, and runtime entries should record originating cwd/worktree path when multiple worktrees share the same project namespace.

The UI derives its live operational picture by combining the committed artifact layer with this runtime layer.

### brief.md structure

```markdown
# {Workstream Title}

## Purpose
...

## Approach
...

## Design References
- `repoId:docs/design/index.md`
- `repoId:docs/design/{domain}.md`

## Boundaries
...

## Current State
...

## Decisions
...

## Open Questions
...
```

### graph.json

Structured workstream data: nodes, edges, durable statuses, attention levels, checkpoints, repos, and `designRefs`.

### What is not an artifact

- orchestrator chat history
- worker chat history
- dashboard state
- session heartbeats and launch metadata
- tracker caches and PR snapshot overlays
- memory of what was "probably intended"

---

## Where the operator's attention goes

| Activity | Frequency | Leverage |
|---|---|---|
| Workstream shaping | Once per workstream or major pivot | Highest |
| Wave transition review | Once per wave | High |
| Gate review | A few times per workstream | High |
| Design mismatch resolution | As flagged | High |
| Hands-on presence | By choice | Variable but potentially very high |
| Dashboard check | Routine | Low |

Everything else should flow through orchestrators and workers operating from the artifact system.

---

## What this design drops from military doctrine

| Military concept | Why we drop it | What replaces it |
|---|---|---|
| Elaborate planning process (MDMP) | Too heavy for one operator | Conversational shaping plus committed artifacts |
| Formal OPORD structure | Over-structured for this scale | Design docs + brief + graph |
| Warning orders | No need to pre-alert agents | Sketched later-wave nodes |
| Formal logistics/sustainment planning | Not the limiting factor here | Repo and tooling context |
| Command succession planning | Sessions are ephemeral by design | Any new session can resume from artifacts |
| Ceremony-heavy AARs | Too slow and heavy | Wave transitions and gate review |
| Rigid delegation boundaries | Operator can engage anywhere instantly | Presence as a fluid override |

---

## What this design keeps from military doctrine

| Military concept | How it is adapted |
|---|---|
| Commander's Intent | Project design docs plus Purpose, Approach, and Boundaries |
| Mission-type orders | Outcome-oriented node specs, not prescriptive steps |
| Nested intent | Layer 0 through Layer 3 context package |
| Disciplined initiative | Workers adapt locally but flag consequential mismatches |
| Intent decay as named risk | Alignment review and design-impact declarations catch it |
| OODA loop | Observe (dashboard) -> orient (artifacts) -> decide (review) -> act (launch or redirect) |
| Presence on the front | Elevated into a core capability via joinable sessions |

---

## The doctrine in one paragraph

The operator owns the intended design and the high-level direction of work. That intent becomes durable through repo-scoped design docs and workstream artifacts. Orchestrators turn project design plus workstream intent into wave-based plans, choose the right design references for each node, and keep the brief and graph aligned with reality while fast operational telemetry lives in a separate local runtime layer. Workers execute nodes from a layered context package, update or flag design impact explicitly, and report through code, PRs, and committed artifacts rather than through remembered conversation. The operator's attention is reserved for shaping, wave transitions, gate reviews, design mismatches, and selectively entering sessions when presence creates leverage. The default is autonomy. The source of truth is the artifact system, not the chat transcript.
