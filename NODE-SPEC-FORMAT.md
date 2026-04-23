# Node Spec Format Reference

> How to write a Layer 3 node spec (the issue body, local spec file, or other tracker entry that a worker session executes from).

A node spec is the **mission-type order** for a single worker session. It is the smallest durable artifact in the Streamliner artifact system and the one most often written by an orchestrator (or the developer) under time pressure. The shape of this artifact directly determines how much autonomy a worker can exercise responsibly.

This document defines the standard sections, the rules that keep specs aligned with [DOCTRINE.md](DOCTRINE.md), and the anti-patterns that have shown up in practice.

## What a node spec is for

A node spec answers, for a single worker session:

- **What outcome am I committing to?** — observable, reviewable, decidable yes/no.
- **What durable context do I act from?** — pointers into Layers 0–2, not restated content.
- **What must I produce for downstream nodes?** — exported contracts and reference artifacts.
- **Where do my boundaries stop?** — what other nodes own, by reference.
- **Which architecture-level calls have already been made for me?** — inherited decisions.
- **What design impact should I expect?** — the surface most likely to need updating.

It is not a plan. It is not a recipe. It is not a specification of the implementation. The worker plans the implementation from this spec plus the layered context package it inherits.

## The role-of-spec rules

These are the rules an orchestrator applies when drafting or revising a spec. They follow directly from DOCTRINE.md.

### 1. Mission-type orders, not implementation plans

State the mission. Do not state the steps to accomplish it.

| Spec writes... | Spec does **not** write... |
|---|---|
| The outcome the worker commits to | The file paths, function names, or module layout to produce it |
| Boundaries (in scope / out of scope) | A list of UI affordances, button labels, copy, or layout |
| Required exports for downstream consumers | A test inventory or specific test names |
| Inherited decisions and references | An algorithm, data flow, or step-by-step approach |

The worker decides "implementation approach inside the issue boundaries, code structure, naming, and detailed execution decisions" (DOCTRINE §Worker). The spec must leave that room.

### 2. Reference, do not restate

If the design layer or an upstream node has already landed a contract — schema, ADR, exported types, interface — the spec **points to it** and does not copy its content. Restating invites drift and creates "which source wins" ambiguity.

A good Design References / Inputs section is short. A long one usually means the upstream node hasn't landed enough or the spec is duplicating it.

### 3. Inherit decisions; do not recommend them

A worker-facing node spec is not the place to surface project-wide architecture choices. If a consequential decision is required to do the work, it belongs upstream:

1. **Resolve it during shaping** — capture the call directly in the spec under "Inherited decisions" with a one-paragraph rationale, or open an ADR if it warrants one (see "When a decision needs an ADR" below).
2. **Spin off a spike node** — when the call genuinely needs investigation, the investigation is its own node that blocks this one.
3. **Flag as `decision-needed`** — only when the need surfaces *during* implementation, not while the spec is being written.

A node spec that says "the worker should pick between A, B, or C, and we recommend B" is a doctrine violation. The orchestrator (or developer) makes that call before the issue lands.

### 4. Design-impact expectation up front

Every spec names the design surface most likely to be touched: a specific design doc, decision record, or "none expected." This sets the worker up to land `updated-docs` or `decision-needed` declarations cleanly per DOCTRINE §"How information flows".

### 5. Scale density to attention level

| Attention level | Spec density |
|---|---|
| `parked` | Terse. Outcome, boundaries, design references. The worker runs without engagement. |
| `watch` | Standard. All sections, no engagement section. |
| `focus` | Standard plus an explicit Engagement section naming review moments the developer wants to participate in. |

Density does not mean prescriptiveness. A `focus` node spec has *more sections*, not *more implementation detail*.

### 6. Boundaries that point

Out-of-scope items name the node that owns them, when one exists. This makes the workstream graph self-documenting from any single node and prevents accidental scope absorption.

## Standard sections

A node spec has the following sections, in order. Sections may be omitted when truly empty (e.g., no Inputs from upstream nodes), but the order is fixed.

### Outcome

The observable state of the world when the node is done. Written so a reviewer can decide "yes, this is done" or "no, it isn't" without reading code.

One paragraph is usually right. If multiple outcomes are needed, the node may be doing too much and should be split.

### Design References

Pointers into Layer 0 (project design) and Layer 2 (workstream operational state) that the worker should read first. Each entry is a path or link with a one-line note on why it matters for *this* node. Not a copy of the content.

When prior nodes have landed exported contracts (schema files, decision records, interface definitions), they belong here.

### Inputs

Artifacts this node consumes from upstream nodes — usually the exported contract surface from a predecessor node. Reference the artifact, name what is being consumed, and stop.

Omit when the node has no upstream artifact dependencies beyond the design layer.

### Exports

What this node must make available for downstream nodes to depend on. Stable commitments only — types, files, schemas, public APIs, named documents. Not implementation details.

The exports list is the contract this node owns. It is the most important section after Outcome for downstream alignment.

Omit only when nothing downstream consumes from this node (rare).

### Boundaries

Two subsections:

- **In scope** — concise list of what this node owns.
- **Out of scope** — concise list of what this node does not own, each item naming the node that does (or "deferred" with a reason if no node exists yet).

### Inherited decisions

Architecture-level calls already made for this node, each with a one-paragraph rationale and a reference to the ADR if one exists. If a call was made during shaping but does not warrant an ADR, the rationale lives here in the spec.

This section makes the inheritance explicit so the worker does not re-litigate the choice.

Omit when the node inherits no consequential decisions.

### Design-impact expectation

One sentence naming the design surface most likely to need an update during this node — e.g. "Expect `updated-docs` on `docs/design/session-system.md` runtime overlay section" — or "None expected." Sets the bar for the worker's `updated-docs` / `decision-needed` declaration.

### Success criteria

Outcome-level checks the reviewer applies. Each criterion should map to something observable from outside the implementation: a behavior, a committed artifact, a downstream node that can now start. Not "passes unit tests for X."

### Engagement (focus nodes only)

Named review moments the developer intends to participate in: alignment review on the worker's plan, a design review after a specific commit, a demo before merge. Skip this section entirely on `watch` or `parked` nodes.

## When a decision needs an ADR

Not every consequential choice deserves an append-only decision record. The ADR bar is roughly:

- Will this decision constrain work in a *different* workstream or future wave?
- Will a future reader ask "why was this chosen?" in a way that the design doc itself can't answer?
- Is the rationale long enough that putting it inline would crowd out the surrounding doc?

If yes to any, write an ADR before the spec lands. If no, document the call inline in **Inherited decisions** with a sentence noting it should be promoted to an ADR if downstream work proves it consequential.

The default is to *not* write an ADR. Decisions accumulate cheaply in spec inheritance and design-doc updates; ADRs accumulate cheaply only when each one is genuinely load-bearing.

### Where routine calls live

Most orchestrator-scale calls — host process choice, module placement, integration sequencing, scoped-to-this-workstream defaults — do not meet the ADR bar. They have a two-rung home:

1. **Node-local routine calls** live in the affected node's **Inherited decisions** section. This is the right home when the call shapes one node and downstream nodes inherit through that node's exports.
2. **Workstream-local routine calls** that shape multiple nodes can also land in the brief's `Decisions` section. Per [PRODUCT-SPEC.md](PRODUCT-SPEC.md), the brief's `Decisions` section is for workstream-local execution choices — not project-wide architecture, but exactly the right place for cross-node calls that don't deserve a full ADR.

The design layer (design docs and decision records) remains the home for *intended system design*. Orchestrator routine calls are about *how this workstream executes against that intended design* and stay out of the design layer to preserve its authority.

If a routine call later proves consequential — another workstream is constrained by it, or a future reader needs a "why" the design doc can't answer — promote it to an ADR at that point. Inheriting the call inline today does not foreclose that.

## Anti-patterns

A spec is doing too much when it contains any of the following. Each is a signal to revise.

- **File paths in the body.** `src/foo/bar.ts` is a worker decision. The exception is when the path *is* the export contract (e.g. "publish a schema at `src/x-schema.ts`") and downstream nodes will import from it.
- **Function or component signatures.** Workers design these.
- **Specific UI copy, button labels, or layout details.** Outcome describes behavior; design describes appearance norms; the worker chooses copy and layout.
- **Test case enumeration.** "Unit tests for X, Y, Z" is a worker concern. "Behavior is verifiable end-to-end via the iterative UI harness" is a success criterion.
- **Recommendations between architecturally distinct options.** Pick one upstream, or spin off a spike, or genuinely leave it open with a `decision-needed` expectation.
- **Restating content from a referenced design doc or upstream contract.** Reference and stop.
- **A "three pieces" / "five steps" decomposition.** That is a plan. Workers produce the plan from the spec; the spec produces the mission.
- **Vague outcome with concrete deliverables list.** Inverted: outcomes should be concrete, deliverables (when listed) should be the small set of artifacts that prove the outcome.
- **Long Deliverables checklist.** A long deliverables list usually encodes implementation steps. Prefer Outcome + Exports + Success criteria.

## Worked contrast (sketch)

**Over-prescriptive (anti-pattern):**

> ## Scope
>
> Three concrete pieces:
>
> 1. Implement `SessionRegistryStore` at `src/session-registry/`. Use write-then-rename. Implement `subscribe` with discriminated `upsert` / `delete` / `rebuild` events.
> 2. Open design question: pick between Vite middleware, standalone daemon, or Electron. Recommendation: Vite middleware.
> 3. UI: list rows with title, description excerpt, repo/cwd, lifecycle badge, color swatch, `lastSeenAt` relative time. Actions: New manual session, Pause/Resume, Archive, Delete with confirm.

**Mission-type (aligned):**

> ## Outcome
>
> A builder can list, create, edit, and archive sessions in the dashboard, and every change survives a Windows restart.
>
> ## Inputs
>
> - `src/session-registry-schema.ts`, `src/session-registry-contract.ts` — the shape and store contract this node implements.
>
> ## Exports
>
> - A working implementation of `SessionRegistryStore` that downstream nodes (`session-relaunch`, `session-event-observation`) can consume without amending the contract.
> - The dashboard route the builder reaches the registry through.
>
> ## Inherited decisions
>
> - Host process: dashboard hosts the store in-process via the local Node server (no separate daemon yet). Rationale: keeps the surface area small for Wave 2; no other consumer needs the store yet. Promote to ADR if a CLI or background watcher is added.
>
> ## Design-impact expectation
>
> Expect `updated-docs` on `docs/design/session-system.md` for any runtime detail surfaced beyond what Decision 005 already specified. No new ADR expected.

The mission-type version is shorter, leaves implementation room, and inherits the architectural call instead of asking the worker to make it.

## Where this fits

This document is the Layer 3 analogue of [WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md). The workstream format defines `brief.md` and `graph.json`; this format defines what goes inside a node's tracker entry (GitHub issue body, local spec file, or other platform).

DOCTRINE.md describes *why* node specs are mission-type orders. This document is *how* to write one that holds up to that doctrine.
