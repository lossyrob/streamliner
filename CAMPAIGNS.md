# Streamliner Campaigns

> The portfolio-level unit of committed work: a group of workstreams, shaped
> together to cover a declared body of intent.

A campaign is how Streamliner names the work between "a single workstream" and
"the whole portfolio." It is the unit a builder commits to when a body of
accumulated intent has grown large enough to need several coordinated
workstreams, but is still one coherent push of work.

This document defines the concept. A specific campaign — its declared intent and
the workstreams that cover it — lives in the roadmap and in shaping artifacts,
not here.

## What a campaign is

A **campaign** is a committed, intent-bounded group of workstreams — plus any
side issues that ride along — shaped together to cover a declared body of intent.

Define it by contrast with the units around it:

- A **workstream** covers one outcome behind one gate. It is an execution unit.
- A **project** is a durable context boundary: participating repositories, design
  docs, configuration. A project persists and hosts many campaigns over its life.
- A **campaign** sits between them. It is the unit the builder *shapes and
  commits to* when accumulated intent needs several coordinated workstreams to be
  covered, but still reads as one purpose.

A campaign is born from **consolidation**. During execution a builder accumulates
intent faster than they act on it: voice notes, side ideas, deferred problems,
observations about what the system needs next. Periodically that backlog is
consolidated — the builder crafts the **declared intent** and partitions it into
the workstreams and side issues that will cover it. That consolidation *is* the
shaping of a campaign.

## Where a campaign sits

A campaign is one altitude in a nested structure. Each level is bounded
differently, and conflating the levels is a recurring source of confusion.

| Level | Bounded by | Rough analog |
|---|---|---|
| **task** | a single step | subtask |
| **node** | one unit of work | story (PAW-sized) |
| **wave** | a confidence transition (not time) | — |
| **workstream** | one outcome + one gate | epic |
| **campaign** | a declared body of intent | program / initiative |
| **project** | a durable context (repos, design) | product / repo group |
| **portfolio** | the builder's whole surface | — |

Two mappings are worth stating plainly. A **workstream is like an epic** — a
bounded body of work with internal structure and a clear "done." A **campaign is
like a program or initiative** — a coordinated set of epics pursued toward a
declared objective. A campaign is larger than any one workstream, but more
transient and more *active* than a project, which simply persists.

Note that **wave is reserved for the intra-workstream confidence transition**. A
group of workstreams is a campaign, not a "wave of workstreams." Earlier drafts
of the roadmap used "wave" at the cross-workstream level; that usage is retired
to keep the word meaning one thing.

## Intent-bounded, not time-bounded

A campaign is bounded by **intent**, not by the calendar. It closes when its
declared intent is covered, however long that takes.

This is the distinction from a **release**. A release is a time/version cut: it
harvests whatever happens to be ready at a moment. A campaign covers a body of
intent that does not respect calendar boundaries. The two are **orthogonal
axes**, and binding them together — "the July release campaign" — reintroduces
exactly the rigidity the separation avoids: you would either pad the release to
wait for the intent, or guillotine the intent to make the date.

So they stay decoupled:

- A campaign **emits** increments as its workstreams land work.
- A release **harvests** across all active campaigns continuously. Work from one
  campaign can ship across several releases; one release can carry work from
  several campaigns.
- A campaign may name a **soft target release** for its main outcome as a goal —
  never as its boundary.

A campaign can still carry a **horizon** — a loose temporal anchor ("the next
several weeks," a season) — for naming and orientation. The horizon is
descriptive, not contractual; the intent is what scopes and closes the campaign.

## Concurrency and the main effort

Multiple campaigns can exist at once, in different **theaters** — different areas
or subsystems of the work. But the scarce resource is **builder attention**, and
attention cannot be spread across every theater at full intensity.

So in practice one campaign is the **main effort**: the theater that gets
priority of attention. Other campaigns run as *supporting* (lower intensity) or
sit *proposed* until they become the main effort. This is the portfolio-level
expression of the same scarcity the work-geometry model spends everywhere: when
the budget is attention, concurrency is only safe with a designated focus.

The main effort is deliberately left as a **builder practice, not an encoded
mechanism**. It is learned by running campaigns, and the right discipline will
become clear with real experience rather than being specified up front.

One forward-looking note: in a **multi-builder** project, the main effort likely
differs per builder. Campaign ownership — which builder is accountable for which
campaign — is a promising coordination mechanism for several high-output builders
sharing one project. That is out of scope today and recorded as a future
direction, not a current feature.

## What a campaign holds

A campaign is captured as a plan (in the roadmap, and in shaping artifacts as it
matures). It holds:

- **Declared intent** — the crafted statement of what this campaign makes true,
  consolidated from the accumulated backlog. The anchor everything else covers.
- **Theater / scope** — the area of the system it operates in; what is in and out.
- **Covering workstreams** — which workstreams cover the intent, each with its own
  outcome and review question.
- **Side issues** — bounded one-off work that rides along without needing a
  workstream.
- **Seams** — the cross-workstream contracts and ownership inside the campaign,
  and the exports it imports from or provides to other campaigns.
- **Sequencing and main effort** — the dependency order, what runs in parallel,
  and where attention concentrates.
- **Coverage map** — which workstream or issue covers each slice of the declared
  intent, so nothing is silently dropped. The "no work loss" receipt, one level up.
- **Horizon and target release(s)** — loose and optional.
- **State** — see lifecycle below.

## A lens over the backlog, not a mutation of it

A campaign is a **lens over the durable candidate backlog**, not a rewrite of it.

Shaping candidates are durable idea records. A campaign **selects and shapes** a
subset of them into committed, covered work; it does not edit the identity of a
candidate to record that a campaign happened to include it. A candidate's own
note describes the idea on its own terms. The campaign — in the roadmap — is what
says "for this push, these candidates become these workstreams, owned and
sequenced thus."

Two consequences follow:

- **Candidates outlive campaigns.** A candidate not included in the current
  campaign is not "parked" or downgraded; it simply was not selected this round.
  Its stage reflects its own maturity, not the campaign's scope.
- **The reference points one way.** The campaign plan references candidates;
  candidates do not carry campaign metadata. This keeps both legible: a cold
  reader understands a candidate without decoding a campaign, and understands a
  campaign without reading every candidate.

## The campaign cycle

Campaigns are produced by a recurring cycle — consolidation, the same operation a
builder already does to shape a single workstream, performed one level up:

1. **Accumulate** — during execution, capture deferred intent: voice notes, side
   ideas, observations, problems noticed but not yet acted on.
2. **Declare** — consolidate the backlog into a declared intent for the next push.
3. **Shape** — partition the intent into covering workstreams plus side issues,
   name the seams, and sequence them. This produces the campaign.
4. **Execute** — run the workstreams; the campaign is the frame the builder
   operates against.
5. **Reconcile and roll forward** — as workstreams close, update coverage; intent
   left uncovered, plus new notes accumulated during execution, become input to
   the next campaign's consolidation.

The cycle repeats. Each turn, the builder crafts the intent as declared, covers
it, and learns where the coverage was wrong — the same feedback loop Streamliner
runs at every other altitude.

## The same shape at every altitude

A campaign is not a new kind of thing. It is the Streamliner shape — **declare
intent, cover it, validate the coverage, reconcile** — applied at portfolio
altitude. The same shape runs at the node, the wave, the workstream, and the
campaign. A campaign is to its workstreams what a workstream is to its nodes:
a declared intent, a covering structure, and a check that the structure covered
the intent.

## State and lifecycle

A campaign moves through informal states:

- **Proposed** — shaped enough to name, not yet committed.
- **Main effort** — the active campaign currently getting priority of attention.
- **Supporting** — active but at lower intensity behind the main effort.
- **Closing** — workstreams landing; coverage being reconciled.
- **Closed** — the declared intent is covered (or its remainder explicitly rolled
  forward).

Closure is kept **informal** for now. A campaign-level closure gate — an explicit
review that validates the declared intent was covered and harvests lessons — is a
likely future addition, but it should emerge from running real campaigns rather
than be specified before the need is felt.

## Open questions

- **Closure gate.** Will campaigns want an explicit close/reconcile gate, and what
  does it validate? Let the need emerge from practice.
- **Cross-project campaigns.** A campaign is project-scoped for now. Whether a
  campaign can span projects is left open.
- **Multi-builder ownership.** Campaign ownership as a coordination mechanism
  between builders sharing a project is a promising direction, not yet designed.
- **Release tie-in.** How campaign emission relates to concrete release/milestone
  tooling, if at all.
