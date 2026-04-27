# Hot Work

> The phase-change moment when steady autonomous execution gives way to a burst of rapid, high-context developer–agent iteration inside a workstream.

Most agent-directed development is **cool**. The developer shapes a workstream, workers pick up nodes, PRs land, the operational picture updates. The developer watches, checks in at gates, and otherwise leaves execution alone. That is the default mode Streamliner is designed for.

Then something changes. A node ships, the developer uses what was built, and the act of using it produces a flood of real insight — about the design, about what is missing, about what the next step actually is. The developer does not want to file that insight as a backlog item and come back tomorrow. They want to **strike while the iron is hot**: work directly with an agent, make rapid changes, try things, reshape the work as the understanding deepens.

That phase is **hot work**.

## Why name it

Naming matters because hot work is not a deviation from the operating rhythm. It is a recognizable and recurring event that Streamliner's model should account for on its own terms.

Without a name for it, hot work looks like one of two things it isn't:

- an ad-hoc override of the plan, to be minimized
- a failure of upfront shaping, to be corrected next time

It is neither. Hot work is the tightest version of the feedback loop Streamliner is built to accelerate: shape, execute, review, reshape — collapsed into a single intense burst, triggered by the developer gaining real-world insight that no amount of upfront planning could have surfaced.

Automation makes most development cool and steady. The developer plods alongside the agents, making sure the work is moving. Then things get hot, fast — like a Streamliner train getting to top speed. The developer gets into flow, makes real progress, and sometimes has to redraw the map afterward, but only because they now have a better idea of the direction than when they started.

Giving that moment a name makes it:

- **legible** — the developer and orchestrator can both recognize it and respond to it
- **supported** — the operating model can describe what to do before, during, and after
- **observable** — Streamliner can eventually surface it, count it, and use it as a signal about workstream design quality

## The metaphor

Hot work borrows from metalworking. Metal is shaped when it is hot: malleable, responsive, reshapeable under the hammer. Once it cools, the shape is locked in. The craftsman works the material while the window is open and lets it rest when it isn't.

The metaphor carries three things that matter:

1. **Heat is a temporary condition.** The developer does not operate hot all the time and should not try to. The window opens when conditions are right — typically when something just became real enough to produce feedback — and it closes naturally as the insight is absorbed into the work.
2. **The anvil is the workstream boundary.** Hot work is intense and rapid, but it is shaped against a fixed surface. The workstream's purpose, boundaries, and contracts are the anvil. Strikes land against that surface and take shape from it. Work that would escape the anvil is not hot work on this node — it is a different workstream or a shaping activity.
3. **Hot work is work, not improvisation.** The craftsman is not abandoning the plan. They are acting on the material's current state with a clear intent. The result is a better part than could have been made from a cold, over-specified plan.

## What hot work is

Hot work has a recognizable shape:

- **Trigger:** the developer gains real insight from using, testing, or closely reviewing something that just became real.
- **Mode:** the developer engages directly with an agent (or several), iterating quickly — changing behavior, reshaping pieces, digging into how things were built, redirecting the approach.
- **Duration:** usually short relative to the workstream — minutes to hours, not days. Hot work that lasts days is a signal the workstream boundary needs rethinking.
- **Containment:** work stays inside the workstream's ownership boundary. The developer is free to move fast *within* that container. Work that wants to bleed across the boundary is a signal, not a license.
- **Output:** real changes land. Code moves, behavior changes, sometimes the plan itself needs updating. Hot work is not a conversation — it produces durable artifacts.
- **Resolution:** when the heat passes, ordinary workstream reconciliation accounts for what happened. The brief and graph are updated to reflect the new shape of the work and the new understanding of the direction.

## What hot work is not

Hot work is a specific thing. Some adjacent modes look similar but are not the same:

- **Not planned workstream shaping.** Shaping is a deliberate, attention-intensive activity producing a brief, graph, and Wave 1 node specs. Hot work happens after shaping, often much later, triggered by a specific encounter with the work as it becomes real.
- **Not routine developer presence.** Developer presence — entering a session to review or co-pilot — can be cool. Hot work is the high-intensity subset of presence, where rapid iteration is driven by fresh insight and produces real change.
- **Not an emergency.** Hot work is opportunistic, not reactive. Something unexpectedly broken is a different event with a different response.
- **Not casual scope expansion.** Hot work stays inside the workstream boundary. A temptation to expand scope is a signal to either spin up a new workstream, park the idea, or shift into boundary renegotiation. It is not a license to let hot work bleed silently.
- **Not side-questing.** Hot work serves the workstream's purpose directly. It is the fastest path to the workstream's intended end state, not a detour.

## Why the boundary matters

Workstream boundaries are usually framed as preventing collisions — keeping parallel workstreams from stepping on each other. Hot work reveals another reason boundaries matter:

**Good boundaries create safe zones for rapid unplanned work.**

Inside a well-drawn boundary, the developer can get as hot as they want. Code changes, plan changes, direction shifts — all of it is contained. No other workstream depends on the internals being left alone. Workstream reconciliation remains a local act.

Inside a poorly drawn boundary, hot work is dangerous. Every rapid change risks invading territory that another workstream owns, breaking a contract another workstream relies on, or duplicating work happening elsewhere.

This reframes boundary design as a *liberating* constraint rather than a restrictive one. The better the boundary, the more freedom the developer has to act on insight when the moment comes. That is a new argument for investing in boundary design quality at shaping time.

## Boundary pressure and boundary expansion

The workstream boundary is not just a list of files. It is the set of
responsibilities, contracts, assumptions, and design surfaces that other
workstreams are entitled to treat as stable.

That makes some hot work more complicated. A burst can remain faithful to the
workstream's purpose while revealing that the original boundary was too small or
that the blast radius of the right change is larger than shaping understood.
This is not side-questing. It is the workstream discovering that the real design
surface is bigger than the map said.

There are three useful cases:

| Case | Meaning | Response |
|---|---|---|
| **Contained hot work** | Changes stay inside the declared ownership boundary and do not alter external contracts. | Reconcile locally. |
| **Boundary pressure** | Work wants to touch adjacent architecture, shared contracts, or another workstream's dependency surface, but broad changes have not yet been committed. | Slow down, capture the pressure, and decide whether to add a checkpoint, open a design question, or coordinate with another workstream. |
| **Boundary expansion** | The workstream's purpose genuinely requires a larger architectural or dependency change than originally scoped. | Shift from hot work into top-down orchestration: redraw boundaries, revise dependencies, update design docs or ADRs, and decide whether to expand, split, or gate the work. |

The rule of thumb:

> Move fast inside the boundary. When the boundary itself becomes the thing being
> changed, switch from hot work to orchestration.

This does not mean the work is wrong. Boundary expansion can be the correct
result of front-line discovery. The important thing is that it becomes explicit
before other autonomous work depends on stale assumptions.

Signals that hot work is changing the boundary include:

- changing an exported contract another workstream depends on
- changing a shared data model or runtime contract
- changing the meaning of a public checkpoint
- changing which workstream owns a responsibility
- altering dependency ordering between workstreams
- updating project design docs in a way that affects more than this workstream
- invalidating assumptions downstream nodes or workstreams are already using

When those signals appear, the right term is **boundary renegotiation**. The
renegotiation can end by expanding this workstream, splitting off a new
workstream, coordinating through a public checkpoint, or stopping at a gate for
operator review. The key is that the change is handled as workstream design, not
as local iteration.

## Where hot work fits in the operating rhythm

Hot work does not replace any existing phase. It cuts across them as an orthogonal event.

| Phase | Relationship to hot work |
|---|---|
| **Phase 1: Workstream shaping** | Rare here — shaping is already attention-intensive and deliberate. When it happens, it usually means shaping is done and initial execution can begin. |
| **Phase 2: Autonomous execution** | Most common trigger. A worker ships something, the developer uses it, insight arrives, hot work begins. |
| **Phase 3: Wave transition** | Occasional. Reviewing what shipped across a wave can surface insights worth acting on immediately rather than deferring to the next wave. |
| **Phase 4: Gate review** | Occasional. A gate review can tip into hot work when the developer decides to reshape rather than just pass or reject. |

The default phase is autonomous execution. Hot work is the punctuation.

## Hot work and feedback loops

The [product thesis](PRODUCT-THESIS.md) argues that Streamliner accelerates the developer's ability to learn workstream design because execution is now fast enough to produce feedback within a single wave. Hot work is the **tightest possible version** of that feedback loop:

1. **Shape** — the workstream plan says a node should produce X
2. **Execute** — a worker produces X
3. **Review** — the developer uses X and learns something no plan could have surfaced
4. **Reshape** — the developer and an agent reshape the next steps in real time, then the orchestrator updates the artifacts

Cool execution gets this feedback in days. Hot work gets it in minutes. Both matter. The operating model should support both.

Hot work does not need a special cooldown protocol. It produces facts that flow
through ordinary [workstream reconciliation](ORCHESTRATION.md): completed work,
obsolete planned work, discovered follow-ups, design impact, and boundary
pressure. Hot work increases the likelihood that reconciliation is needed
urgently, but reconciliation is a general orchestration function, not a
hot-work-specific ritual.

## Inspired vs. recovery hot work

Hot work is not one moral category. It can happen for different reasons, and
those reasons teach different lessons.

**Inspired hot work** happens when the developer reaches the front line, uses or
closely reviews something real, and sees a better direction that could not
reasonably have been discovered during upfront shaping. This is healthy. The
system gave the developer enough structure to get to a useful moment and enough
freedom to act when the moment arrived.

**Recovery hot work** happens when the developer has to intervene because the
workstream boundary, contract, node spec, design reference, or attention plan did
not guide autonomous execution well enough. This is also useful, but it is a
learning signal. The point is not to blame the plan or the worker. The point is
to ask what future shaping could make clearer.

The same distinction applies to boundary expansion. Inspired boundary expansion
happens when the larger design surface only becomes visible once the work is
real. Recovery boundary expansion happens when shaping missed an obvious
dependency or left a shared contract vague. Both can be handled, but they teach
different lessons.

The goal is not to prevent hot work. Inspired hot work is one of the most
valuable parts of the operating model: the builder gets into flow, moves fast,
and converts vivid front-line understanding into better work. The goal is to
reduce avoidable recovery hot work by learning from it.

During reconciliation, the orchestrator should help classify what kind of hot
work occurred:

- Was the heat caused by new insight that only appeared once the work was real?
- Or was the heat caused by a boundary, contract, or spec that failed to guide
  the work?
- What should the next shaping pass preserve, and what should it change?

That makes hot work feedback to both the plan and the builder. The artifacts get
updated, and the builder gets better at designing the next workstream.

## Hot work as a signal

Because hot work is observable (it is an intense burst of activity tied to a workstream), it can be used as a signal about the quality of work design over time:

- **Frequent hot work on one workstream:** the initial shaping may have been too detailed too early, and the workstream is absorbing the real plan through iteration. Or it may be that this workstream is especially rich in design surface and hot work is the right mode for it.
- **Hot work that repeatedly creates boundary pressure:** the boundary may have been drawn too narrowly or the exported contracts may be under-specified. The workstream may need resplitting, expansion, or a clearer public checkpoint.
- **Hot work that repeatedly produces major graph rewrites:** the planning granularity was too high upfront. Future workstreams could start with sketchier plans and rely on hot work to refine.
- **Never any hot work:** either the work is unusually well-specified upfront (rare), or the developer is missing the moments when insight arrives and failing to act on them. The latter is a skill gap worth closing.

These are heuristics, not rules. But they are the kind of heuristics that the portfolio operator begins to notice as they run more waves, and they inform how they shape work next time.

## Open threads

This document names and frames hot work. It does not yet specify:

- **Reconciliation details.** What concrete updates can ordinary workstream reconciliation make automatically, what should be proposed for review, and what must escalate?
- **Boundary-pressure detection.** What concrete signals should Streamliner surface when hot work is changing a shared contract, public checkpoint, or another workstream's dependency assumptions?
- **UI and session surfaces.** Should the portfolio or workstream graph reflect that a node is currently hot? How?
- **Relationship to attention level.** Does a node need to be `focus` for hot work to begin, or can hot work emerge from a `watch` or `parked` node the moment the developer engages?
- **Hot work across workstreams.** Hot work is single-workstream by definition. But what about the moment where insight from one workstream reshapes another? That is something else — shaping, probably — but worth naming to keep hot work tightly scoped.

Those threads are handled in follow-up passes through the doctrine and supporting docs.
