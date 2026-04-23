# Streamliner Doctrine

> How the operating model makes workstream-level thinking work in practice.

See [PRODUCT-THESIS.md](PRODUCT-THESIS.md) for why this operating model exists.

When execution is cheap and fast, the bottleneck moves to the design of the
work itself. Streamliner's operating model exists to support the developer in
designing work well — defining boundaries, exporting contracts, allocating
attention to high-leverage moments — and then learning from each wave what
worked and what did not.

This document describes the operating model: the context system that solves the
blank-slate problem, the roles that execute work, how information flows through
artifacts, how the developer exercises presence, and how the operating rhythm
creates feedback loops on work design quality.

Streamliner uses three durable context surfaces:

1. the **project design layer** ([DESIGN-DOCS.md](DESIGN-DOCS.md))
2. the **workstream layer** (brief + graph)
3. the **node/tracker layer** (node specs, worker plans, PRs)

---

## The operating reality

A single developer manages many concurrent workstreams through AI coding agents.
The agents are capable but stateless. Each session starts cold, carries no
memory of previous sessions, and only knows what is in its context window.

**What agents lack:**

- persistent memory — every session starts fresh
- shared understanding — no years of training or implicit context
- continuity of identity — the session that planned may not implement
- ambient awareness — agents see only their context window

**What the developer has:**

- instant, lossless communication through files, commits, and structured data
- cheap feedback through tests, CI, PR review, and rollback
- capable generalists that can work any problem given the right context
- reproducibility — a new session can pick up the same artifacts and continue
- cheap parallelism — many sessions can execute simultaneously
- fluid presence — the developer can engage any session at any level, then withdraw

**The developer's true constraint:**

The developer's scarcest resource is the ability to design work well at scale.
Attention allocation is one component of that constraint. The operating model
should require developer attention only where human judgment, taste, design
authority, or risk evaluation create irreplaceable value.

---

## Roles

Streamliner uses three roles:

```text
Developer
  -> Orchestrator (AI session managing a workstream)
       -> Worker (AI session executing a single node)
```

### Developer

The developer designs workstreams, owns the project's intended design, and
allocates attention to high-leverage moments: shaping, gates, wave transitions,
and design mismatches.

**What the developer decides:**

- which workstreams to pursue, and their boundaries
- the intended design of the project
- the purpose, approach, and boundaries of each workstream
- whether to pass gates
- how to resolve consequential conflicts or design mismatches

**What the developer delegates by default:**

- node-by-node decomposition within a workstream
- sequencing inside a workstream
- implementation details within a node

**Design principle:** The developer should be able to step away for hours or
days, then return to a clear picture of what changed, what is healthy, and what
requires judgment.

### Orchestrator

An AI session that translates project design plus workstream intent into an
executable plan. It manages wave progression, reviews worker output for
alignment, and updates workstream artifacts as reality unfolds.

**What the orchestrator decides:**

- how to decompose the workstream into nodes and dependencies
- which nodes belong to which wave
- which design docs and decisions to surface first for each node
- when a worker can proceed autonomously vs. when review is needed
- whether a discovered mismatch is a routine design-doc update or a
  `decision-needed` escalation
- how to update the brief and graph based on shipped reality
- routine architectural calls scoped to the workstream — host process choice, module placement, integration sequencing — when no other workstream is constrained and the rationale fits in a paragraph; record them inline on the affected node spec rather than as ADRs (see [NODE-SPEC-FORMAT.md](NODE-SPEC-FORMAT.md))

**What the orchestrator does not decide:**

- the project's intended design direction
- whether to proceed past a gate
- product-level architecture changes that should be owned by the developer

**Design principle:** The orchestrator is a session, not a daemon. Any new
orchestrator session should be able to read the design layer and workstream
artifacts and become productive immediately.

### Worker

An AI session that executes one node: plan, implement, update or flag design
impact, and produce reviewable artifacts.

**What the worker decides:**

- implementation approach inside the issue boundaries
- code structure, naming, and detailed execution decisions
- how to handle local technical realities
- whether the node required a design-doc update or a `decision-needed` flag

**What the worker does not decide:**

- scope expansion
- project-wide architecture changes
- whether to silently ignore a mismatch with intended design

**Design principle:** Workers should almost never stop and wait for input. They
either proceed from context or flag explicitly.

---

## The context package

Agents start every session as blank slates. Human teams carry shared context in
memory and habit. The context package replaces that with an explicit, layered
set of committed artifacts.

It is designed to be:

- **complete** - everything needed to act responsibly
- **layered** - each level gets what it needs
- **progressive** - broad context first, deeper context only when needed
- **bounded** - small enough to fit inside a useful context budget

### Layer 0: Project Design Context

This is the project's intended design:

- the design index plus front-loaded `current` design docs
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

This is how the developer narrows the project-level design into a specific
effort — defining the workstream's boundaries and design surface.

### Layer 2: Operational State

This is the current situation of the workstream:

- **Current State**
- **Decisions**
- **Open Questions**

This layer orients the orchestrator and developer to what just happened, what is
in flight, and what comes next. It is a durable summary, not a telemetry feed.
Session heartbeats, tracker caches, and launch metadata live outside the
committed artifact layer.

### Layer 3: Node Context

This is what a worker receives for a specific node:

- wave context
- node spec (issue body or local spec file)
- coordination notes
- any node-specific design narrowing carried in the node spec or coordination notes

The worker is never supposed to reconstruct the whole workstream from scratch. It receives the project design, the workstream's intent, the current situation it actually needs, and the node's specific mission.

---

## How information flows

Communication is instant, lossless, and file-backed.

### Upward

**Workers report through artifacts, not through being remembered.**

The worker's output is:

- code changes and PR
- plan/back-brief when needed
- design-doc updates, if any
- an explicit design-impact declaration: `none`, `updated-docs`, or `decision-needed`
- flags for issues that exceed worker authority

**Orchestrators report through workstream artifacts.**

Updates to the brief and graph are the orchestrator's communication to the
developer.

**Fast operational telemetry reports through local runtime state.**

Session IDs, heartbeats, tracker snapshots, and launch claims update a
machine-local runtime store. They inform the UI but do not rewrite the committed
graph on every change.

### Downward

**The developer communicates project direction through the design layer and
workstream direction through the brief.**

If the intended system changes, the design docs change.
If the execution strategy changes, the brief and graph change.

**The orchestrator communicates through graph structure, node specs, and design
references.**

Workers do not need the orchestrator's conversation history. They need the
artifacts that resulted from it.

### Lateral

There is no default worker-to-worker conversation channel.

Coordination happens through:

- graph dependencies
- shared design docs
- coordination notes in node context
- orchestrator updates to the workstream

This keeps coordination explicit and durable.

---

## Presence

The developer can instantly be present at any level — shaping a node before a
worker starts, reviewing a plan, co-piloting an implementation, interrogating
reasoning, or taking over a critical node completely — then withdraw without
breaking the chain of execution.

### The engagement spectrum

Every node sits on a spectrum:

```text
Full autonomy <-------------------------------> Full developer presence
```

- **parked** - run fully autonomously unless flagged
- **watch** - let it run, but surface the result
- **focus** - developer intends to engage directly at some point in the lifecycle

The graph is the engagement control surface.

### Presence does not replace artifacts

When the developer enters a session, the artifacts remain the source of truth:

- design docs still hold intended design
- the brief still holds workstream intent and operational state
- the issue still holds node-level outcome

Presence augments execution. It does not create hidden dependencies on
remembered conversation.

### Visible autonomy

The developer should not need to dig into sessions to know things are operating
smoothly. Healthy autonomy must be visible from the graph: nodes progressing,
PRs appearing, design-impact declarations arriving without escalation.

When the operational picture makes autonomous progress legible, the developer
can trust it and reserve presence for moments where it creates real leverage.

---

## The operating rhythm

### Phase 1: Workstream shaping

The developer and orchestrator:

1. align on relevant project design
2. update design docs first if the intended direction is changing
3. produce the brief
4. produce the graph
5. detail Wave 1
6. sketch later waves

**Output:** committed design-doc updates if needed, plus committed workstream
artifacts. This is the most attention-intensive phase — good workstream design
here determines how much autonomous execution is possible later.

### Phase 2: Autonomous execution

The worker:

1. reads Layer 0 through Layer 3
2. plans the implementation
3. optionally receives alignment review
4. implements
5. updates the relevant design docs in the design layer — starting from the references, but not limited to them — or flags a consequential mismatch
6. creates the PR
7. declares design impact

The developer's role during this phase is none unless flagged.

### Phase 3: Wave transition

The orchestrator reviews:

- what the wave planned
- what actually shipped
- what the design layer says the system is intended to become

Then it updates the brief, updates design references if needed, proposes the
next wave, and brings the updated plan to the developer.

### Phase 4: Gate review

At gates, the developer evaluates:

- did the wave deliver the intended result?
- does the design still look right?
- were design-doc updates handled correctly?
- do any `decision-needed` cases need resolution before proceeding?

---

## The alignment mechanism

The worker's plan is its alignment check.

The reviewer — usually the orchestrator, sometimes the developer — checks four
things:

1. Does the plan serve the workstream's purpose?
2. Does it respect the workstream's boundaries?
3. Does it align with the design layer, starting with the referenced design docs and decisions?
4. Does it conflict with parallel or downstream nodes?

If those pass, the worker proceeds. If not, the reviewer gives targeted
correction and the worker replans.

Not every node needs alignment review. The more architectural, ambiguous, or
high-coordination the node is, the more valuable review becomes.

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

Node specs (the issue body, local spec file, or other tracker entry a worker session executes from) are the Layer 3 artifact in this layer. See [NODE-SPEC-FORMAT.md](NODE-SPEC-FORMAT.md) for the standard sections, mission-type-order rules, and where routine architectural calls are recorded.

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

## Where the developer's attention goes

| Activity | Frequency | Leverage |
|---|---|---|
| Workstream shaping | Once per workstream or major pivot | Highest |
| Wave transition review | Once per wave | High |
| Gate review | A few times per workstream | High |
| Design mismatch resolution | As flagged | High |
| Hands-on presence | By choice | Variable but potentially very high |
| Dashboard check | Routine | Low |

Everything else should flow through orchestrators and workers operating from the
artifact system.

---

## Feedback loops

The operating model creates feedback loops that help the developer improve at
workstream design over time.

Each wave is a cycle:

1. **Shape** — the developer designs the workstream's boundaries, contracts, and
   gates
2. **Execute** — autonomous agents execute the work
3. **Review** — the developer evaluates what shipped, where boundaries were
   wrong, where contracts were insufficient, and where attention was misallocated
4. **Reshape** — the developer applies those lessons to the next wave

When boundaries are well-drawn, execution runs without intervention. When they
are not, the developer sees it: too many cross-workstream blockers, sessions
that don't fit the structure, outputs that can't be consumed downstream,
escalations that reveal hidden coupling.

The speed of this feedback loop is what makes workstream design a learnable
skill. An engineering manager running human teams gets this feedback over
quarters. A developer directing autonomous agents gets it in days.

---

## Design influences

Several concepts in this operating model have roots in military command
doctrine, adapted for a context where subordinates are stateless, communication
is instant, and the developer can be present at any level at zero cost.

| Military concept | How it appears here |
|---|---|
| Commander's Intent | Project design docs plus workstream Purpose, Approach, and Boundaries. The developer's intent is made durable and explicit so any new session can act on it. |
| Mission-type orders | Outcome-oriented node specs rather than prescriptive implementation steps. Workers decide how to accomplish the mission. |
| Nested intent | The Layer 0–3 context package. Each level receives the intent of the levels above it, progressively narrowed. |
| Disciplined initiative | Workers adapt locally but flag consequential mismatches rather than silently diverging from intended design. |
| Intent decay | A named risk. Alignment review and design-impact declarations exist specifically to catch it before it compounds. |

The military analogy breaks down in important ways: sessions are ephemeral, not
trained units; the developer can engage anywhere instantly; and feedback is
cheap enough to make iterative learning the norm rather than the exception.
These differences shaped the operating model as much as the similarities did.

---

## The doctrine in one paragraph

The developer owns the intended design and the high-level direction of work.
That intent becomes durable through repo-scoped design docs and workstream
artifacts. Orchestrators turn project design plus workstream intent into
wave-based plans, choose the right design references for each node, and keep
the brief and graph aligned with reality while fast operational telemetry lives
in a separate local runtime layer. Workers execute nodes from a layered context
package, update or flag design impact explicitly, and report through code, PRs,
and committed artifacts rather than through remembered conversation. The
developer's attention is reserved for shaping, wave transitions, gate reviews,
design mismatches, and selectively entering sessions when presence creates
leverage. The default is autonomy. The source of truth is the artifact system,
not the chat transcript.
