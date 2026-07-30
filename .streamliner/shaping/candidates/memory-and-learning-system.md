# Memory & Learning System

## Stage

Shaping; concept captured for later design work. Not ready for formation — this note holds the
architecture, provisional recommendations, and open questions so the thinking is not lost.

## Seed Idea

Give Streamliner a memory & learning system: a **durable record** of work and the **compiled views**
it distills into, so Streamliner *accrues values and learnings over time* — lowering the rate at
which it must interrupt the builder, and improving how future work is shaped. The work-geometry
model already supplies the skeleton (the *durable decision record* vs the *compiled encoding*, doc
07; the values layer of §10; production of records in §12). This candidate names it as a
first-class Streamliner concern.

The immediate driver: **intent = outcome + values**, and **values = core beliefs + preferences**. A
preference fork ("backward compatibility as binding debt vs disposable migration cost" — the essay's
own §10 example, hit live with the backlog-orchestrator) should be resolvable by a *stated value*
instead of interrupting the builder every time. That is what a disposition memory buys. The larger
prize is the learning loop: reconciliation notes, field reports, and builder reactions accrued
during execution should **fan out** to shape the next workstream, tune the operating point, craft
defeaters, and refine roles — Streamliner as a learning system, not just a coordinator.

## Why It Matters

- Without it, values and learnings scatter across chats, issues, and files, and the **asking rate
  never drops** — the builder answers the same kind of preference fork forever.
- The reconciliation note (#114) and closeout narrative already *produce* learnings, but nothing
  *compiles or consults* them. They are a raw record with no compiled view.
- "Turning Streamliner into a learning system" is the concrete form of PRODUCT-THESIS's
  **feedback-loop accelerator** — the bet that the builder learns work-design faster because
  consequences arrive faster. Memory is what turns those consequences into durable leverage.

## Core Model — two layers

```
RAW DURABLE RECORD   (geometry-keyed, model-agnostic, never migrates)
  decision notes · field reports · reconciliation notes + learnings · builder reactions
  (reversals, "I wish you'd asked") · preference-fork receipts
        │  distill / recompile (model-relative, recomputable)
        ▼
COMPILED VIEWS   (scoped, recompilable)
  • System knowledge  → Design / Architecture / User Guide     [documentation-system — leverage first]
  • Disposition / values → core beliefs + preferences + policies + vision arcs   [the new store]
  • Process knowledge → shaping heuristics · operating-point defaults · defeater/validation
                        libraries · role context
        │  consulted by
        ▼
EFFECTS
  surfaced-fork detector · next campaign/workstream shaping · operating-point defaults ·
  crafted defeaters for the validation loop · role context · design decision records
        ▲  feedback: reversals · regrets · outcomes  ───────────────────────────────┘
```

**Two distinct stores, one discipline, one surface.** The **disposition store** holds compiled
beliefs the detector consults. The **attention ledger** holds *deferred items* — typed as
work / preference-debt / note — each owed a terminal disposition and surfaced at a checkpoint; the
**Backlog is the work-typed view of this ledger**. They are different kinds (values vs deferred
items), unified only by the "nothing stays open" discipline and the checkpoint surface — not one
table.

**Disposition lives in two places** (per §2's "not a memory patch"): per-node/per-fork records
(preference receipts, debt, intent-slices) are **geometry fields** in the workstream-format
substrate; cross-cutting **beliefs/policies** are the scoped **disposition store**. Both stay
geometry-keyed/scoped — not a free-floating retrieval store.

## Working recommendations (provisional — to validate in later design)

- **Two stores** (disposition beliefs + attention ledger), not one and not three.
- **Rules decay unless re-confirmed.** A rule earns its quiet by continuing to be right: it applies
  silently while fresh confirming cases keep arriving, fades back toward asking if it goes untested
  for a while, and drops straight back to asking the moment a choice it made gets reversed. This
  replaces an earlier "builder-set resurface-when-X trigger" idea, which required forecasting when a
  rule would go stale — the thing you can't predict. Decay needs no forecast: a stale or contradicted
  rule surfaces itself.
- **Don't auto-promote agent "learnings" into rules.** A worker's self-reported lesson stays a
  *candidate* until something corroborates it — either the builder reacting to it, or an independent
  check. Uncorroborated lessons never silently become rules; that is how a corpus would fill with
  confident-but-wrong folklore.
- **A rule that suppresses a question should occasionally surface it anyway**, to confirm it still
  holds — more often for rules that change fast, rarely for stable ones.
- **Health metric: the tool asks less without being wrong more.** Track, per rule, whether it is
  saving a question while its choices are *not* getting reversed more often. Asking-less while
  reversals-rise means it is suppressing questions it should ask — the failure to watch for.
- **Capture the signal from day one** — record the choices the system makes on your behalf (so a
  later change that undoes one is a detectable reversal) plus a lightweight builder **"should have
  asked / this was wrong"** affordance at review and closeout. This is the no-regret first slice: it
  feeds both the decay/contradiction rule above and the health metric.
- **Streamliner owns the memory** (not the agent substrate) — though it may sync builder/project
  scope with agent memory.
- **Design seam:** a value that is also an architecture stance **cross-references, not duplicates**;
  home it by *how-to-work (disposition)* vs *what-the-system-is (design)*.

## Relationship to other candidates

- **Operating Point & Attention** — *consumes* the disposition store (its "encoded core beliefs"
  live here); the surfaced-fork detector queries it.
- **Documentation System** (promoted) — the **system-knowledge** compiled view; leverage first, do
  not duplicate. Its reconciliation documentation-impact flow is already a raw→compiled path.
- **Workstream Format & Coverage Substrate** — owns the per-node geometry fields (receipts, debt,
  intent-slices) that are the per-instance half of disposition.
- **Node Handoff, Boundary Pressure & Reconciliation** — reconciliation notes / field reports are
  the primary raw-record source.
- **Checkpoint & Closeout Experience** — the checkpoint is where the attention ledger is surfaced
  and drained, and where learnings are harvested.
- **Backlog Orchestration** — the work-typed view of the attention ledger.

## Grounding in the work-geometry model and essay

- **doc 07 (durable decision record)** — the raw-record vs compiled-encoding split; "recompiled per
  model generation"; locus partition (worker / gate / builder / reconciliation); assembled, not
  authored.
- **§10 (values)** — preferences migrate into core beliefs, lowering the asking rate; the detector
  is calibrated on reversals and "I wish you'd asked" events; preference-debt doubles as the
  belief-drift detector.
- **§12 (records are produced)** — the corpus is model-agnostic but only as honest as its production
  discipline; interpretive records are suspect by vantage.
- **PRODUCT-THESIS** — the feedback-loop accelerator.

## Gaps the model/essay leave open (the reason this is later design)

1. **Cross-workstream / cross-campaign accrual is under-developed.** The essay is largely
   single-workstream; v2 *parks* apprenticeship/taste-transfer and multi-builder. A corpus distilled
   across many workstreams into reusable heuristics/beliefs is a genuine extension, not just an
   implementation.
2. **The distillation step** — who/what turns raw learnings into rules, and when. *Direction
   settled (later dialogue):* it is a **rule, not a taste call** — promote a candidate lesson only
   when corroborated (builder reaction or an independent check), so a consolidation pass can run it
   without inventing judgment. The remaining open part is the cadence (periodic pass vs on-close).
3. **Learning honesty.** A worker's self-reported "learning" is the least independent record there
   is; the builder's reactions (reversals) are the trustworthy ground truth. *Direction settled:*
   don't auto-promote self-reports; require corroboration, and let the decay/contradiction rule pull
   stale rules back. The corpus stays mostly raw by design — compiled rules are a thin, earned layer.
4. **Geometry-keyed, not RAG.** Keep the raw record per-node/workstream/fork and beliefs scoped —
   the §2 discipline that makes this more than retrieval.
5. **Disposition ↔ design seam** unresolved where a value is also an architecture stance.

## Open Questions

- One attention ledger spanning work + preference-debt + notes, or separate per type?
- How are beliefs scoped and inherited (builder → project → team → campaign → workstream → node)?
  How do team-level values arrive (multi-builder, deferred)?
- What is the distillation mechanism and cadence (manual reconciliation vs an agent)?
- How is a "reversal" detected reliably from the geometry, and what is the builder regret affordance?
- How much disposition is geometry fields vs the store, exactly?
- How does this reframe or extend the Documentation System (does it gain a fourth "disposition"
  family, or stay system-only)?
- What is the minimal first slice — likely: preference receipts + a belief store + the regret
  affordance — that starts the corpus accruing without the full learning fan-out?
- How does the broad learning fan-out (shaping, operating-point defaults, defeater libraries) get
  built incrementally without overcommitting?

## Handoff Brief

Not ready. Hold for a dedicated design pass. The settled direction: a two-layer memory & learning
system (a geometry-keyed durable record distilled into scoped compiled views — disposition,
system-knowledge, process-knowledge), with the disposition store and the day-one learning-signal
capture (receipts + regret affordance) as the most concrete first slice, and the cross-workstream
learning fan-out as the high-value but less-developed frontier.
