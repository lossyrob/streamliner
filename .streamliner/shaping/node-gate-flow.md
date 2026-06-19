# Node Gate Flow — orchestrator, node sessions, and builder attention

> **Shaping reference, not committed design.** This sketches the end-to-end control
> flow of a single node through the **gate ladder**: the workstream orchestrator, the
> implementer / reviewer / auditor / validator node sessions, and the builder,
> coordinated over **telex** with PR actions on **GitHub**. It makes the
> work-geometry backward pass concrete — §5 witnessing, §7 boundary pressure, §12
> production-independence — and grounds the **Operating Point & Attention**, **Node
> Handoff, Boundary Pressure & Reconciliation**, **Checkpoint & Closeout**, and
> **Backlog Orchestration / Autonomous Execution** candidates. It is a frame to react
> to, not a spec; the open choices are noted at the end.

The spine: every gate is one shape — a **locus** produces a typed judgment → the
controller routes it → the **operating point × spread** decides hard-stop /
preference-debt / silent-default → a **disposition + records** result → **telex**
carries the transition. The builder is spent only where it pays.

## Sequence

```mermaid
sequenceDiagram
    actor B as Builder
    participant WO as Workstream Orchestrator
    participant IMP as Implementer node
    participant REV as Reviewer node
    participant AUD as Cold-read Auditor
    participant VAL as Validator
    participant GH as GitHub

    Note over B,WO: Builder sets the operating point (care · posture · stakes)<br/>→ which gates fire + how much independence to buy
    B->>WO: Shape workstream, set node operating point
    WO->>IMP: Launch node (spec + context package, model/review depth by size & kind)

    rect rgb(235,243,255)
    Note over IMP,WO: Gate 1 — Plan review (before code is written)
    IMP->>IMP: Produce plan (PAW plan phase)
    IMP-)WO: plan-ready (telex)
    WO->>WO: Review plan for workstream fit
    alt boundary pressure / split / scope or frame drift
        opt high-spread or constitutional
            WO-)B: surface decision packet (telex: interrupt)
            B--)WO: ruling
        end
        WO-)IMP: disposition — amend-scope / split / reframe (telex)
    else fits the geometry
        WO-)IMP: proceed (telex)
    end
    end

    rect rgb(244,244,244)
    Note over IMP,WO: Implementation (mid-flight pressure allowed)
    loop until PR opened
        IMP->>IMP: implement
        opt discovers boundary pressure
            IMP-)WO: split-request / pressure (telex)
            WO-)IMP: disposition (telex)
        end
    end
    IMP->>GH: open PR
    end

    rect rgb(238,252,238)
    Note over IMP,REV: Gate 2 — PR review (correctness, quality)
    IMP-)REV: review-ready (telex)
    REV->>GH: post review
    loop until approved
        REV-)IMP: re-review requested (telex)
        IMP->>GH: push fixes
        IMP-)REV: review-ready (telex)
    end
    REV-)IMP: +1 (telex)
    end

    rect rgb(255,250,232)
    Note over WO,AUD: Gate 3 — Independent audit (cold read, frame-origin independent)
    opt stakes warrant (operating point)
        WO-)AUD: audit-requested (telex)
        AUD->>GH: cold-read PR vs node intent
        AUD-)WO: audit-findings (+ independence axes covered) (telex)
        opt frame drift / silent descope / false-done
            WO-)IMP: reopen (telex)
        end
    end
    end

    rect rgb(255,250,232)
    Note over WO,VAL: Gate 4 — Validation (one EIG-chosen probe, not the full defeater DAG)
    opt stakes warrant (operating point)
        WO-)VAL: validate (telex)
        VAL->>VAL: run the realistic probe most likely to falsify the claim
        VAL-)WO: result / defeater-found (telex)
        opt defeater found
            WO-)IMP: reopen affected work (telex)
        end
    end
    end

    rect rgb(255,238,245)
    Note over IMP,B: Gate 5 — Merge gate (human floor / preference)
    loop merge sentry (CI, conflicts)
        IMP->>GH: keep PR mergeable
    end
    IMP->>GH: post field report on the issue
    IMP-)WO: merge-ready (telex)
    WO->>WO: human-floor / preference review (reads field report)
    alt operating point allows auto-merge
        WO->>GH: squash-merge
        WO-)IMP: merged → stand-down (telex)
    else route to builder (high-spread / preference)
        WO-)B: human-review-pending — well-lit bet (telex: interrupt)
        B->>GH: review + merge
        IMP-)WO: merged (telex)
        WO-)IMP: stand-down (telex)
    end
    end

    rect rgb(235,243,255)
    Note over WO,B: Gate 6 — Closeout / reconciliation
    WO->>WO: reconcile field report, then disposition deferred work (file→backlog / fold / drop)
    opt residual risk / coverage gap
        WO-)B: surface for closure decision (telex: next-checkpoint)
    end
    WO->>WO: no-open-debt check → close node
    end
```

## Legend

**Loci and the independence ladder.** Each gate adds a locus independent of the work
on a different axis, terminating at the builder:

- **Orchestrator** — frame/scope independence (owns the workstream geometry).
- **Reviewer** — correctness (separate session; independence is *partial* — may share
  the implementer's frame/prompt).
- **Auditor** — cold frame-origin independence; catches the frame drift and false-done
  the sharing-frame reviewer misses (§12). Records *which axes* it is independent on.
- **Validator** — success-criterion independence; witnesses that the outcome obtains.
- **Builder** — values; the terminal witness (§6 human floor).

**Telex vs GitHub.** Telex carries the async coordination wakeups + pointers between
sessions (`plan-ready`, `proceed`, `split-request`, `review-ready`, `audit-requested`,
`validate`, `merge-ready`, `human-review-pending`, `merged`, `stand-down`). GitHub stays
the source of truth for PRs, reviews, and merges.

**The operating point is the dial.** It decides (a) **which gates fire and how much
independence to buy** — gates 3 and 4 fire only when stakes warrant; the merge gate
auto-merges or routes to the builder — and (b) **surface-worthiness** at each gate
(hard-stop / preference-debt / silent-default). A low-stakes prototype node may skip the
audit and validation and auto-merge; a high-stakes craft node runs the full ladder up to
a human-floor merge.

**Builder attention points.** Up front (sets the operating point), and then only at:
plan-gate escalation (high-spread geometry), the merge route-to-human, and closure
residual risk. Everything else runs without the builder.

**Gates are also harvest points.** The plan gate harvests early splits/deferrals; the
merge gate harvests preference-debt + a risk receipt; the closeout gate harvests deferred
work into the backlog. Attention layer + gates + backlog + work-loss are one system.

## What is buildable now vs. seeded vs. deferred

- **Now (cheap, high value):** Gate 1 (plan review — catches geometry problems before
  code), Gate 5 (merge gate — the backlog-orchestrator skill already does it), Gate 6
  (closeout — partly shipped via the reconciliation note, #114). These need only the
  actor fabric/telex, the orchestrator role, boundary-pressure handling, and the
  operating point deciding which fire.
- **Medium:** Gate 3 (the cold-read auditor) — one extra independent session.
- **Seed, not the full system:** Gate 4 (validation) — start with a single EIG-chosen
  probe, not the defeater DAG.
- **Deferred:** the full defeater DAG, basis-relative spread estimation, the probe economy.

## What stays open

- Whether Gate 3 (audit) and Gate 4 (validation) are one independent-witness locus or two.
- How much of Gate 1's disposition is orchestrator-automatic vs. builder-surfaced.
- Whether the gate ladder is declared as a per-node-kind default profile
  (design / implementation / validation), then overridden by the operating point.
