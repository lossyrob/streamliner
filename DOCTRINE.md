# Streamliner Doctrine: Agent Orchestration for Autonomous Development

A reinvention of military command principles for AI agent orchestration, designed for a world where subordinates are brilliant blank slates, communication is instant, feedback is cheap, and the operator's scarcest resource is attention.

---

## The operating reality

We are not commanding an army. We are a single developer managing many concurrent workstreams through AI coding agents. The constraints and advantages are fundamentally different from military operations:

**What we lack (vs. military subordinates):**
- Persistent memory — every session starts cold
- Shared doctrine — no years of training, no implicit understanding
- Continuity of identity — the "subordinate" that planned isn't the one that implements; sessions are ephemeral
- Situational awareness — agents only know what's in their context window

**What we have (that the military doesn't):**
- Instant, lossless communication — git commits, files, structured data
- Cheap, fast feedback — CI, tests, PR review, `git revert`
- Perfect recall within a session — agents don't forget what they've read
- Highly capable generalists — agents can do anything if given the right context
- Reproducibility — you can re-run a session with different context and get a different result
- Parallel execution — multiple agents working simultaneously with no coordination overhead beyond the artifacts
- **Operator omnipresence** — the operator can instantly be present at any level of any workstream, participating directly in any session, then withdraw back to strategic oversight

**the operator's (developer's) constraint:**
Attention is the bottleneck. Not time, not capability — attention. The system must be designed so that the developer's attention is required only at moments where human judgment, taste, and strategic thinking create irreplaceable value. Everything else should flow autonomously.

---

## The three-level hierarchy

Instead of military echelons, Streamliner operates with exactly three levels:

```
Operator (Developer)
  └── Orchestrator (AI session managing a workstream)
        └── Worker (AI session executing a single node)
```

Each level has a distinct role, distinct authority, and distinct information needs.

### Operator (the developer)

**Role:** Strategic direction, taste, judgment calls, approval at gates.

**What they decide:**
- What workstreams to pursue (portfolio-level)
- The purpose and approach of each workstream (via the brief)
- Whether to proceed at gates (validation checkpoints)
- Aesthetic and architectural judgment that agents can't make
- Resolution of conflicts between workstreams

**What they don't decide:**
- How to decompose a workstream into nodes (orchestrator's job)
- How to implement a specific node (worker's job)
- Whether a PR is technically correct (automated + agent review)
- Sequencing and dependency management (orchestrator + graph)

**Design principle:** the operator should be able to step away for hours or days and return to a clear picture of what happened, what needs attention, and what decisions are waiting. The system works *for* them, not *with* them at every step. But when the operator *chooses* to engage, they can drop into any level instantly — see "Operator presence" below.

### Orchestrator (workstream-level AI session)

**Role:** Translate the Commander's Intent into an executable plan, manage wave progression, review worker output for alignment, update the plan based on reality.

**What they decide:**
- How to decompose the workstream into nodes and dependencies
- Wave composition — which nodes are detailed now vs. sketched for later
- Issue content — what goes into each node's spec
- Whether a worker's plan aligns with workstream intent (the alignment review)
- How to update the graph and brief as work progresses
- When to escalate to the operator (flag for attention vs. proceed autonomously)

**What they don't decide:**
- The workstream's purpose or approach (operator's domain)
- Implementation details within a node (worker's domain)
- Whether to proceed past a gate (operator's call)

**Design principle:** The orchestrator is a session, not a daemon. It runs when needed (wave planning, worker review, status assessment), reads the durable artifacts, does its work, and commits updates. A new orchestrator session picking up the same workstream should be fully productive from the artifacts alone.

### Worker (node-level AI session)

**Role:** Execute a single node — plan the implementation, write the code, create the PR.

**What they decide:**
- Implementation approach within the bounds of the issue spec and workstream approach
- Code structure, naming, internal design
- How to handle unexpected technical realities
- Whether something discovered during implementation should be flagged to the orchestrator

**What they don't decide:**
- Scope changes (flag to orchestrator, don't unilaterally expand)
- Architectural decisions that affect other nodes (flag to orchestrator)
- Whether to skip or defer parts of the spec (flag to orchestrator)

**Design principle:** Workers are the most autonomous level. They should almost never need to pause and wait for input. The issue spec + workstream context should be sufficient for them to complete their node independently. When they can't proceed, they flag — they don't block.

---

## The context package: solving the blank-slate problem

Military subordinates carry years of shared context implicitly. Our agents carry none. The solution is an explicit **context package** — a structured bundle of information that gives each level everything it needs to operate autonomously.

The context package replaces shared doctrine with shared documents. It's designed to be:
- **Complete** — everything the agent needs, nothing it doesn't
- **Layered** — each level gets the layers relevant to its role
- **Small enough to fit in context** — total budget ~2000 tokens for the brief, plus issue content

### Layer 1: Workstream Intent (read by all levels)

This is the reinvented Commander's Intent. It solves the blank-slate problem by encoding what years of shared context would otherwise provide. Three components:

**Purpose** (2-3 sentences)
Why this workstream exists. What the end state looks like. What problem it solves for the operator. This almost never changes.

**Approach** (1-3 paragraphs)
How we're building this. Key architectural decisions, technology choices, patterns, constraints. This is the equivalent of "shared doctrine" — it tells agents how to think about decisions in this workstream. Updated as understanding deepens.

**Boundaries** (bulleted list)
What's in scope, what's explicitly out, what's deferred. This prevents scope creep — the #1 failure mode when autonomous agents encounter interesting problems adjacent to their task.

### Layer 2: Operational State (read by orchestrator + operator)

This is the current situation — what the military OPORD's "Situation" paragraph covers. It enables the orchestrator (or a new orchestrator session) to immediately orient.

**Current state** (rewritten each time it changes)
What just happened. What's in flight. What's blocked. What the current wave is and where it stands. What the next orchestrator action should be.

This section is **fully rewritten** every time the orchestrator updates it. It is never appended to. It always reads as the current truth.

**Decisions** (running list, edited not appended)
Key choices made and why. Structured as "We chose X because Y." Entries are removed when they're no longer relevant (the decision has been superseded or is now obvious from the approach). This prevents the section from growing unboundedly.

**Open questions** (running list)
Things that haven't been decided yet that affect planning. Removed when resolved. If an open question becomes a decision, it moves to Decisions.

### Layer 3: Node Context (read by workers)

This is what a worker session receives when it picks up a node. It provides the nested intent — workstream purpose (two levels up) + wave context (one level up) + issue detail (own level).

**Workstream context snippet** — Purpose + Approach + Boundaries from Layer 1. Copied or referenced, not summarized.

**Wave context** (2-3 sentences) — What wave this node is part of, what the wave is trying to achieve, what other nodes are running in parallel that this node should be aware of.

**Issue spec** — The detailed specification for this node. Outcome-oriented (what the node should accomplish), not prescriptive (how to implement it step by step). Includes success criteria the worker can verify.

**Coordination notes** (optional) — Anything the worker needs to know about adjacent nodes: "Node X is implementing the config module; import from `src/config.py`, don't create your own." These prevent collision between parallel workers.

---

## The communication protocol

Military communication is unreliable, high-latency, and lossy. Ours is instant, lossless, and persistent (git). This changes the communication design completely.

### Upward communication (worker → orchestrator → operator)

**Workers report through artifacts, not conversation.** A worker's output is:
- Code changes (the PR)
- A plan document (PAW planning output — this is the "back-brief")
- Flags (documented in the PR or a structured artifact: "I discovered X that affects the workstream")

The orchestrator doesn't need to be "in the room" with the worker. It reviews artifacts asynchronously. This is possible because communication is lossless — everything the worker learned is captured in the PR and plan.

**Orchestrators report through the workstream artifacts.** Updates to the brief and graph are the orchestrator's communication to the operator. the operator reads the Current State section and the graph visualization to understand what's happening across all workstreams without entering any individual session.

**Escalation is explicit and structured.** When a worker or orchestrator encounters something that needs the operator's attention, it's flagged in a way that surfaces in the dashboard — not buried in a conversation transcript. Possible mechanisms:
- Node attention set to "focus" (surfaces in the graph)
- Gate status requiring operator approval
- An explicit "needs-operator-input" flag

### Downward communication (operator → orchestrator → worker)

**the operator communicates through the brief.** Updates to Purpose, Approach, or Boundaries are how the operator steers the workstream. The orchestrator picks these up on its next read.

**The orchestrator communicates through issues and the graph.** New nodes, updated specs, changed dependencies — these are the "orders" to workers. Workers don't need to read the orchestrator's conversation history; they read their issue spec and the workstream context snippet.

**There is no lateral communication.** Workers don't talk to each other. Coordination happens through the graph (dependency edges) and through coordination notes in the node context. If two workers need to be aware of each other's output, the orchestrator handles this by adding coordination notes or by sequencing them (making one depend on the other).

---

## Operator presence: the superpower the military doesn't have

In a physical military, the operator is bound by geography. A brigade operator cannot instantly be on the front line with a rifle squad, then back at headquarters reviewing the operational picture, then at a different squad on a different front. Movement takes time. Presence at one location means absence from everywhere else. The entire doctrine of delegation exists partly because of this constraint.

**We don't have this constraint.** The developer can instantly:
- Join a worker session mid-implementation and pair on a tricky problem
- Do hands-on work shaping for a specific node before the worker picks it up
- Review a plan or PR interactively with the agent, not just asynchronously
- Take over execution of a critical node entirely
- Interrogate any agent at any level about its reasoning or state

This is not a minor advantage — it fundamentally changes the delegation model. In the military, delegation is a one-way commitment: once you delegate, re-engaging at that level has high cost (travel, communication overhead, disruption of the chain). In Streamliner, engagement is **zero-cost and instantly reversible**. the operator can be present for five minutes, provide direction, and withdraw — and the session continues exactly where it was.

### The engagement spectrum

Instead of a binary "delegated / not delegated" model, every node exists on a continuous engagement spectrum:

```
Full autonomy ◄──────────────────────────────────► Full Operator presence
     │                    │                    │                    │
  Autonomous         Orchestrator         Operator             Operator
  execution          reviews plan         reviews plan         co-pilots or
  (no review)        (back-brief)         or PR directly       works the node
```

The default position is toward the left — autonomous execution. But the operator can slide any node rightward at any time, for any reason:

- **"This node is architecturally critical"** → operator reviews the plan directly instead of delegating to the orchestrator
- **"I have strong opinions about how this should look"** → operator does work shaping for the issue before the worker starts
- **"This worker seems stuck"** → operator drops into the session, diagnoses the problem, provides direction, withdraws
- **"I want to see how this implementation feels"** → operator reviews the PR interactively, not just reads the diff
- **"This is a learning opportunity"** → operator watches the worker execute to calibrate how much autonomy to grant on future similar nodes

### How the system supports this

**The graph is the engagement control surface.** Each node's attention level (focus / watch / parked) signals the operator's desired engagement:
- **focus** — operator wants to be involved in this node's lifecycle (review plan, review PR, possibly co-pilot)
- **watch** — operator wants to see the output but trusts the autonomous process
- **parked** — fully autonomous, operator doesn't need to see this unless flagged

**Sessions are joinable, not just observable.** The session control panel doesn't just show what workers are doing — it provides a way to enter any session and interact. This means:
- the operator can read a worker's plan and provide feedback directly in the session
- the operator can ask the worker "why did you choose this approach?" and get an answer
- the operator can say "actually, let's try it this way" and the worker adapts

**Presence doesn't break the chain.** When the operator drops into a worker session, the workstream artifacts (brief, graph, issue spec) remain the source of truth. the operator's in-session guidance augments the context but doesn't replace it. If the session crashes after the operator leaves, a new session can still pick up from the artifacts — the operator's input was either captured in committed artifacts (updated spec, plan adjustment) or was tactical enough that losing it is acceptable.

**Withdrawal is clean.** the operator can leave a session at any point without creating an orphaned state. The worker has its context package and can continue. Nothing about the operator's presence creates a dependency that blocks progress when they leave.

### What this changes about the doctrine

Operator presence means the hierarchy isn't rigid — it's **fluid**. The three levels (operator / orchestrator / worker) describe default operating roles, not fixed positions. At any moment:

- the operator can act as the orchestrator for a specific workstream (doing wave planning directly instead of through an orchestrator session)
- the operator can act as a worker for a specific node (implementing it themselves with agent assistance)
- the operator can be the reviewer for a specific plan or PR (bypassing the orchestrator's review)

The system should make these mode shifts **frictionless** — clicking a node in the graph and entering the session, not configuring a new workflow. The default is autonomy; presence is an override that the operator invokes at will and releases at will.

### The anti-pattern: presence addiction

The risk of zero-cost presence is that the operator never actually delegates. If every node is "important enough" to review personally, the system degenerates into the operator doing everything with AI assistance — which is where the user started before Streamliner. 

The design must make the cost of presence visible: when the operator is engaged with one node, they're not reviewing the five other workstreams that are running. The dashboard should show not just "what needs attention" but implicitly communicate "everything else is running fine without you." The default must be autonomy, with presence as a conscious choice, not a habit.

---

## The operating rhythm

Instead of the military's deliberate planning process (MDMP), the operating rhythm is designed for the developer's actual workflow — bursts of attention interspersed with autonomous agent execution.

### Phase 1: Workstream shaping (operator + orchestrator)

the operator has a body of work in mind. Through conversation with an orchestrator session, they produce:
- The workstream brief (Layer 1 + Layer 2)
- The initial dependency graph
- Wave 1 detailed with issue specs
- Later waves sketched (nodes with titles and summaries, no specs)

This is the most attention-intensive phase. the operator is making strategic decisions, defining the approach, setting boundaries. This is irreplaceable human judgment.

**Duration:** One focused session. Maybe 30-60 minutes.
**Output:** Committed brief + graph + Wave 1 issues.

### Phase 2: Autonomous execution (workers, monitored by orchestrator)

Workers pick up Wave 1 nodes and execute. Each worker:
1. Reads its context package (workstream context + issue spec)
2. Plans the implementation (PAW planning phase)
3. Optionally: orchestrator reviews the plan for alignment (the back-brief — can be automated or skipped based on confidence)
4. Implements
5. Creates PR
6. Flags anything that affects the workstream

the operator's role during this phase: **none**, unless flagged. Workers execute autonomously. the operator checks the dashboard periodically (or is notified of flags) but doesn't actively participate.

**Duration:** Hours to days, depending on wave size.
**Operator attention:** Near zero unless flagged.

### Phase 3: Wave transition (operator + orchestrator)

When Wave 1 nodes are mostly complete (PRs merged, gates passed), the orchestrator:
1. Reviews what actually shipped vs. what was planned
2. Updates the brief's Current State and Decisions
3. Proposes Wave 2 composition — promotes sketched nodes to detailed specs, adjusts dependencies based on reality, potentially adds or removes nodes
4. Presents the updated plan to the operator for review

the operator reviews the wave transition: Does the updated plan still serve the purpose? Do the new issue specs capture the right work? Are the boundaries still right? This is the second moment of irreplaceable human judgment.

**Duration:** 15-30 minutes of Operator attention.
**Output:** Updated brief + graph + Wave 2 issues.

Then Phase 2 repeats.

### Phase 4: Gate review (operator)

Gates are explicit checkpoints where the operator evaluates whether the workstream is on track. A gate might be:
- "The basic app shell works" (functional gate)
- "The architecture supports the V1 feature set" (design gate)
- "Wave 1 is complete and the approach is validated" (wave gate)

the operator reviews gate criteria, tests the output if needed, and either passes the gate (allowing downstream work to proceed) or sends feedback that adjusts the plan.

**Duration:** 15-60 minutes depending on the gate.
**Operator attention:** High, but infrequent and high-leverage.

---

## The alignment mechanism: lightweight back-brief

Military back-briefs are verbal, interactive, and time-consuming. Our version is designed for the instant-communication, cheap-feedback world:

**The worker's plan IS the back-brief.** When a worker produces a PAW implementation plan, it's stating "here's what I understood the intent to be, and here's how I plan to execute." The orchestrator (or operator, for critical nodes) reviews this plan against the workstream intent.

**The review checklist is three questions:**
1. Does the plan serve the workstream's purpose? (intent alignment)
2. Does the plan respect the workstream's boundaries? (scope check)
3. Does the plan conflict with parallel or downstream nodes? (coordination check)

If all three pass, the worker proceeds. If any fail, the orchestrator provides specific correction and the worker replans. This is fast — minutes, not hours — because communication is instant and the review is structured.

**Not every node needs a back-brief.** Low-risk nodes (clear spec, no coordination concerns, independent scope) can skip the review and go straight to implementation. High-risk nodes (ambiguous spec, coordination with other nodes, architectural implications) should always be reviewed. The orchestrator decides which based on the node's characteristics.

---

## The artifact system

Everything is a committed file. Nothing lives only in conversation history.

### The workstream directory

```
workstreams/
  └── robin/
        ├── brief.md          ← Layers 1 + 2 (intent + operational state)
        ├── graph.json         ← The dependency graph
        └── docs/              ← Optional supporting documents
              └── ...            (architecture diagrams, research, etc.)
```

### brief.md structure

```markdown
# {Workstream Title}

## Purpose
{2-3 sentences: why this exists, what the end state is}

## Approach
{1-3 paragraphs: how we're building this, key decisions, patterns}

## Boundaries
- In: {what's in scope}
- Out: {what's explicitly excluded}
- Deferred: {what we'll consider later}

## Current State
{Rewritten each update: what just happened, what's active,
what's next, what needs attention}

## Decisions
- {Decision}: {rationale}
- ...

## Open Questions
- {Question}
- ...
```

Total target: under 400 lines. If it's longer, the approach section is too detailed (push details to issue specs) or the decisions section needs pruning.

### graph.json

The existing workstream schema. Nodes, edges, statuses, attention levels, issue links, wave membership. This is structured data, not prose — it's queried and visualized, not read linearly.

### What's NOT an artifact

- Orchestrator conversation history — ephemeral, not committed
- Worker conversation history — ephemeral, not committed
- Status dashboards — derived from graph + GitHub state, not stored
- Change logs — git history provides this naturally

---

## Where the operator's attention goes

The system is designed to minimize Operator attention while maximizing its impact. Here's where the developer's time goes, ranked by leverage:

| Activity | Frequency | Duration | Leverage |
|---|---|---|---|
| Workstream shaping | Once per workstream | 30-60 min | Highest — defines everything |
| Wave transition review | Once per wave | 15-30 min | High — steers the plan based on reality |
| Gate review | A few per workstream | 15-60 min | High — validates the approach is working |
| Hands-on presence | As chosen by operator | 5-60 min | Variable — highest for taste-sensitive or architecturally critical nodes |
| Flag response | As needed | 5-15 min | Medium — unblocks or redirects |
| Dashboard check | Daily | 5 min | Low — situational awareness |

Everything else — decomposition, issue writing, plan review, implementation, PR creation, status tracking — is handled by orchestrators and workers operating from the artifacts.

---

## What this design drops from military doctrine

| Military concept | Why we drop it | What replaces it |
|---|---|---|
| Elaborate planning process (MDMP) | Too heavy for one developer | Conversational shaping session |
| Formal OPORD structure | Over-structured for our scale | The brief + graph pair |
| Warning orders (WARNO) | No need to "alert" agents in advance | Sketched future-wave nodes in the graph |
| Sustainment/logistics paragraph | Agents don't need resupply | Repo + tooling config in issue context |
| Command succession planning | Sessions are ephemeral by design | Any new session can pick up from artifacts |
| After-Action Reports | Too ceremonial | Wave transitions naturally incorporate this |
| Formal back-brief process | Too slow | Worker plan as implicit back-brief, reviewed by orchestrator |
| Rigid delegation boundaries | operator is geographically bound | Operator presence — fluid engagement at any level, any time |

## What this design keeps from military doctrine

| Military concept | How it's adapted |
|---|---|
| Commander's Intent | → Purpose + Approach + Boundaries in the brief |
| Mission-type orders | → Outcome-oriented issue specs, not prescriptive implementation steps |
| Nested intent (two levels up) | → Context package with workstream + wave + issue layers |
| FRAGO (fragmentary orders) | → Edit brief in place; git history is the operations log |
| Disciplined initiative | → Workers adapt to ground truth but flag scope/architecture issues |
| Intent decay as named risk | → Alignment review as the mechanism to catch it |
| OODA loop | → The operating rhythm: observe (dashboard) → orient (brief) → decide (wave plan) → act (launch workers) |
| Bounded autonomy | → Each level has clear "decides" vs. "flags" boundaries |
| Commander's presence on the front | → Elevated to a core capability: instant, zero-cost engagement at any level via the engagement spectrum |

---

## The design in one paragraph

The developer shapes workstreams through focused conversations, producing a brief (purpose, approach, boundaries, current state) and a dependency graph. Orchestrator agents manage wave progression — decomposing work into nodes, writing issue specs, reviewing worker plans for intent alignment, and updating the plan as reality unfolds. Worker agents execute independently from a context package (workstream intent + wave context + issue spec) and report through artifacts (PRs, plans, flags). The developer's attention is reserved for shaping, wave transitions, gate reviews, and responding to flags — high-leverage moments that require human judgment. But at any moment, the developer can exercise Operator presence: dropping into any node at any level to shape the work, review interactively, co-pilot the implementation, or interrogate the reasoning — then withdraw cleanly, with autonomous execution continuing uninterrupted. The default is autonomy; presence is a superpower applied by choice. Everything is coordinated through committed artifacts and the dependency graph, not through conversation.
