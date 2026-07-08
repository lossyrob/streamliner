# Work-Geometry Model

> **Status: in-progress conceptual model — guiding, not yet a settled spec.** This is the conceptual
> model behind Streamliner's design. It is an **active work-in-progress**: the design should be built
> *toward* it, and it in turn is refined *by* what building reveals. Treat it as a **direction-setting
> reference**, not a frozen contract.
>
> **How to use it (settled vs influence-only).** Concepts that are settled enough to shape design
> decisions are marked by their confidence in the prose ("settled enough to build on," kernel claims,
> the operating-point and allocation stances). The harder, unsettled, or more abstract components —
> the frontier problems in §15, the EIG/experimental-design math in §5, the production-trust regress in
> §12, and the vision-model/durable-record direction — are **influence-only**: they inform how we think
> and what we watch for, but they are *not* design commitments. When in doubt, the substrate (Part I),
> coordination (Part II), and the operating point (§11) are the load-bearing, build-driving parts; the
> rest sharpens judgment.
>
> **Provenance and continued work.** This model was developed in a planning journal through a series of
> design conversations and adversarial "spar" reviews. The **canonical copy now lives here, in
> Streamliner**, and continues to be developed here. The originating research — a v1 theory sketch, a
> numbered split into detailed docs (referenced inline below as "doc 01"…"doc 07"), and the spar
> transcripts that ratified specific claims — remains in that planning journal as background; this
> document is self-contained and does not depend on it. The **Telex** project (a sibling repo) is the
> concrete message-fabric / transport layer referenced in §8–§9.
>
> ---
>
> **The organizing reframe.** The model was first written, deliberately, independent of its
> implementation target — and it spoke in **guarantee-semantics**: the system *ensures* coverage,
> validation *ensures* correctness, closure *invariants* hold. Confronted with the real substrate —
> interested, partial-sighted, prose-emitting, expensive LLM workers and a scarce human — those guarantees
> do not survive. The model rewrites them in **allocation-semantics**: the system **allocates scarce
> attention to maximize** faithful, covered, correct work; it does not guarantee it. **Faithfulness to
> builder intent is the builder's responsibility**; the system's job is to spend the builder's attention
> where it matters most and to leave the residual, honestly, to them. A partial win is the design, not a
> compromise.
>
> Allocation-semantics is only honest if it is **falsifiable**, so it carries one discipline (made
> operational in §13): *when the system allocates at a surfaced fork, it names the risk it is buying down
> and the residual it is leaving unprobed.* That discipline — **convert silent failure into owned, surfaced
> uncertainty** — is a *stance*, not a fourth grand unifier; it does not absorb the geometry (spread, §11)
> or the loss-class accounting (§5), which stand on their own.
>
> **A note on weight.** The heart of this model is the *geometry*: the tree, the two passes,
> witnessing and defeaters, and the human floor (Part I). The values layer (Part III) and the
> production-trust layer (Part IV) are real and load-bearing refinements, but they are refinements. They
> are placed after the substrate and kept in proportion.
>
> **Parked.** The authority / control-plane thread (the old "typed authorities" layer) is parked;
> see §14. The builder is sovereign; the system has voice, not veto.

---

## The kernel

```text
Intent is estimated; intent is outcome plus values.
Intent's determinacy is a spectrum: mostly capturable by shaping, non-denominable only at the tail.
Work produces artifacts; artifacts claim outcomes.
Outcomes are witnessed — but every record is produced, and producers are interested.
Witnesses and records rot.
Nodes meet boundary pressure; pressure is packaged and dispositioned by the owning level.
Validation runs backward to expose work loss and work incorrectness.
Value-forks are surfaced to the builder by how far the reachable futures diverge.
The builder configures the operating point; the structure substitutes for capability.
The system allocates scarce attention to maximize faithfulness; the builder owns faithfulness.
```

Lines 1–5 are the substrate (Part I). Lines 6–7 are coordination and validation (Part II). Line 8 is the
values layer (Part III). Line 9 is the operating-point/allocation stance (Part IV); the whole is read
through it.

---

# Part I — The substrate

## 1. Frame and the one goal

A **builder** uses a generation system (Streamliner) to build a real system — front end, back end, control
plane, data plane — too large to hold in one mind at once. The durable noun is **work geometry**, not
agent identity: a tree/DAG executed **forward** (work produces outcomes) and validated **backward**
(outcomes are witnessed against intent). The sessions that walk the graph are ephemeral; the graph and the
intent are durable. The goal:

> **Accomplish the maximum amount of work against the highest-leverage builder attention, faithful to
> builder intent, under resource and capability constraints.**

The hard phrase is *faithful to builder intent*. v2's stance on it is explicit: the system does not
*guarantee* faithfulness — it **allocates** the scarce thing (builder attention, and machine effort) to
maximize it, and the builder owns the remainder. Every "ensures" in what follows is shorthand for "spends
effort toward, under budget, and routes the residual to the builder."

## 2. The four-layer chain

Turning a fuzzy want into a witnessed reality passes through four distinct things; conflating any two is a
recurring source of bugs.

| Layer | Symbol | What it is |
|---|---|---|
| **Intent** | `I` | What the builder wants to be true in the world. The anchor. |
| **Outcome** | `O` | A state that, *if it obtains*, satisfies a slice of `I`. The real referent of "done." |
| **Work** | `W` | The activity that produces an outcome. The expenditure. |
| **Artifact** | `A` | The residue of work; the carrier of an outcome (code, doc, config). |

**The chain:** `W` produces `A`; `A` realizes `O`; `O` covers a slice of `I`. "Done" defaults to the wrong
layer — a node naturally reports *work expended* (`W` burned, `A` exists) when what we care about is
*outcome achieved* (`O` obtains). The gap between work-done and outcome-achieved is where silent failure
hides.

**Intent is an estimand, not a fixed target — but its determinacy is a spectrum, not a constant.** `I` is
fuzzy, partly unknown even to the builder, and it moves — and not only by choice. **Intent forms through
execution:** the builder discovers what they wanted by seeing outcomes take shape. So any plan is an
*estimator* of `I`, a claimed cover ("this work, if done, realizes `I`"), never `I` itself. And `I` is an
**estimand with no denominator** — but that claim is about the **tail, not the whole**. There is no
enumerable set of "all the things that must be true" *in the limit*; it does not follow that every piece of
work sits at that limit. Much intent is **captured well enough to execute** once a builder has shaped it.

> **Captured determinacy: three regimes over a declared basis.** Over a *declared basis* (the axes that
> matter for this work — see §11), a work item sits in one of three regimes, and the regime is used only for
> **routing**:
> - **Operationally closed** — enough intent is captured to execute and EXTEND within the current carve.
>   Most forks silent-default.
> - **Partially open** — known gaps, ambiguity, or preference uncertainty remain; proceed with checkpoints
>   or clarification.
> - **Constitutionally open** — the basis/carve itself may be wrong; this is the **non-denominable tail**
>   where "no denominator" remains fully active and the human floor (§6, RE-CARVE) applies.
>
> Two guards keep this from quietly re-introducing a denominator. (1) **Closure is provisional, not
> epistemic finality.** Operational closure licenses *execution*, never "intent known"; **estimator-defect
> search stays always-on** as a cheap basis-shift check — *has the declared basis changed, cracked, or
> become suspect?* (this is the always-on form of no-surprise frame-drift detection, §15). (2) **Constitution
> risk is named, not erased.** It is not a separate axis — but the constitutionally-open regime must stay
> explicitly named, or "closed" gets misread as "safe from re-carve."

> **Coverage is estimator-relative, never intent-absolute.** Because `I` has no denominator *at the tail*,
> the system does **not** maximize "coverage of intent." It maximizes **coverage of the current
> intent-estimator while actively searching for estimator defects** (the EXTEND/RE-CARVE work of §6). Every
> "coverage" and "maximize" below is read this way; the humility ("no denominator") and the optimization
> rhetoric ("maximize") cohere precisely at this estimator-relative grain, and the always-on defect search is
> what keeps even an operationally-closed estimator from being mistaken for `I`.

**Shaping is the operation that raises captured determinacy.** Work-shaping front-loads the uncovering of
intent so a workstream can reach operational closure before it commits (this is the "formalized EIG
extraction" of §15). Shaping does not merely *uncover* a pre-existing target — it also **constitutes** it:
the builder discovers preferences by being forced to choose, compare, and reject. So shaping converts
latent, partial, or unformed intent into an executable estimator through elicitation, commitment, *and*
constitution. The regime a workstream lands in is therefore not a fixed property of the work; it is an
**operating point the builder configures** (§11).

**Intent = outcome + values.** The intent of a piece of work is not only the outcome that must obtain; it
is also the **values** that pick, among the many valid ways to reach that outcome, the one that is *good
for what is being built*. Values decompose into **core beliefs** (durable, encoded, clear) and
**preferences** (live, per-fork, ideally small). This is developed in Part III; it is named here because it
is part of the ontology of intent, not an add-on. A run that realizes the outcome while ignoring the values
has not covered intent.

> **On authorship (the parked correction).** v1 called the builder the "sole legitimate author" of `I`.
> v2 keeps builder sovereignty but drops the authority machinery that grew around it. Reality, policy,
> legal, and social constraints may all appear in captured intent or in evidence; their role is to inform
> witnesses, assumptions, and the builder's choices — not to make the generation system an authority over
> the builder. The active question at a node is never "who is permitted?" but "is this inside my delegated
> scope and frame, and if not, what do I send upward?"

## 3. The carrier: the multi-level DAG

- **Node** — the atom of execution. Owns a slice of work, has a definition-of-done (its claimed outcome),
  and must be **independently closeable** (a node's completion does not secretly depend on reopening a
  sibling).
- **Level** — a scope of composition: **node ⊂ wave ⊂ workstream ⊂ program ⊂ portfolio**. Each level owns
  an intent-slice at its scope and the emergent outcome of composing the level below it. The builder's real
  case is a **program**, not a single tree; concepts that get stressed by that scale (coverage roll-up,
  drift at multiple levels, cross-level renegotiation, information scoping across the tree) are first-class,
  not footnotes.
- **Edge** — a dependency: ordering and/or a flow of context/outcome. Edges are also where lateral
  communication is legitimate (§8).

The DAG is not merely a plan; it is an **attention-allocation schedule** — how a bounded total attention
budget is spent across a problem too large to hold at once.

## 4. Two passes over one tree

The same tree is traversed in two directions; this duality is the core structural claim.

- **Forward (execution):** `I → (plan = estimator) → W → A → O → compose upward`. The incompleteness of the
  estimator shows up as **forward discovery**: work the plan missed.
- **Backward (validation):** at each level boundary, witness the composed outcome against the intent-slice
  that level owns. Because `I` has no denominator, validation never *completes* — it **accumulates
  confidence**. A missing or misplaced outcome is **backward discovery** (validation reveals uncovered
  intent), feeding the same disposition machinery as forward discovery.

The backward pass is credit assignment (localize blame → reopen the responsible node), but the analogy to
gradient descent **tears** in three honest places: (1) **no gradient** — only pass/fail, so corrections are
coarse re-plans; (2) **the label moves** — you validate against a fuzzy, partly-authored `I`; (3) **partial
support** — validation covers only a slice, so unwitnessed paths get zero error signal.

## 5. Witnessing, defeaters, and the probe economy

**Validation** is the activity (accumulate confidence that `O` serves `I`). A **witness** is one
evidence-act yielding a verdict. Validation = accumulation of witnesses, and a witness can be taken two
ways, only one of which decomposes:

- **Positive / constructive** — directly exhibit that `O` realizes `I`. For non-compositional properties
  this is **deep**: the property lives in the wiring, so the witness must hold the whole composed output at
  once (expensive).
- **Contrapositive / refutational** — do not prove coherence; **fail to find** incoherence. Each
  **defeater-probe** asks one small question ("does failure mode `W` occur?"); a wall of independent "no"s
  stands in for the positive whole-witness you could not afford.

> **The asymmetry that makes refutation decompose: failures are local even when correctness is global.**
> Correctness lives everywhere; a defeater lives somewhere. So `¬(global property)` factors into a
> disjunction of concrete local probes even when the property itself does not factor. The positive witness
> has irreducible **depth**; the contrapositive witness has **breadth** — embarrassingly parallel probes.

What refutation does not escape, it relocates: **enumeration-completeness** ("N probes, all green" bounds
risk only if the probe set spans an open, fuzzy failure space) and **arity** — the **depth→arity law**:
catching a failure that needs `k` components jointly bad requires a probe of arity ≥ `k`; full `t`-wise
coverage costs ~`C(n,t)`. Compositionality is therefore a spectrum indexed by failure-arity.

**Probe allocation is adaptive experimental design.** Each probe is an experiment with a cost and an
expected confidence-gain; probes overlap (value is submodular) and a returned defeater re-prices the rest
(adaptive). The right greedy rule is **highest expected-information-gain (EIG) per unit cost, re-ranked
after each batch** — and the objective MUST be EIG/entropy-reduction over defeater-location, **not
pass-rate**, because optimizing pass-rate drives *measured* risk to zero while *true* risk hides in the
unprobed region. This is a disciplined heuristic, not a theorem, outside its modeled support — which is
most of the interesting territory.

This **EIG-per-cost** engine recurs three times in v2 and is worth holding onto: it governs validation
probes here, **builder-attention on value-forks** (§11), and **how much to trust a produced record**
(§12). One optimizer rule, but **not one scalar.** The three uses buy down *different* named loss classes
— here **correctness-loss**, at value-forks **value-loss** (and **drift-loss**), at records **trust-loss**,
with **outcome-loss** underneath — in different currencies (factual, value, epistemic-source). EIG is a
**family resemblance, a shared selection rule over distinct loss classes**, not a single homogeneous
quantity. When the controller actually *trades across* budgets ("ask the builder this fork" vs "run one
more probe" vs "audit this record"), the conversion between loss classes must be made **explicit**, not
smuggled through the analogy. Held this way the unification is real; collapsed into one scalar it would be
the over-tidy error the model elsewhere warns against.

## 6. The human floor

The optimizer needs a prior over the space of failures. The high-arity tail is exactly the region where the
**failure-predicate is not yet constituted** — you cannot put probability mass on an event not yet in your
model of what can fail. So the permanent human floor is not "handled badly"; it is **outside the support
entirely**. The optimizer governs the modeled middle; the floor is its complement. They partition.

The floor's signature is **non-stationarity**: a closed static objective would have no floor. The floor
exists because **constitution keeps growing the event-space from the top** — every newly-named failure-kind
or newly-authored intent enlarges the domain. The one act the optimizer cannot perform is **expanding its
own support**, and it splits in two:

- **EXTEND** — add a predicate within the current partition. Monotone; increasingly delegable as capability
  rises.
- **RE-CARVE** — change the partition; declare existing categories mis-cut. Non-monotone; **the permanent
  human floor.** An axis is "fake" iff it fails to track what the builder *wanted* — fakeness is
  intent-relative.

So **validation = EXPLOIT** (reduce entropy within the support; delegable) and **shaping = EXPLORE** (expand
the support; the RE-CARVE part is the floor). Escalation exists to route the one operation reserved to a
human: **constitution** — authoring intent that did not exist. The builder is not the root of the tree; the
builder is the **escape hatch past the automated tower**. Every automated level can *witness*; none can
*constitute*.

This is exactly the **constitutionally-open** regime of §2: EXTEND-within-the-carve is what an
operationally-closed workstream delegates, while a basis that may itself be mis-cut (RE-CARVE) is the
non-denominable tail that stays human. Captured determinacy is therefore "how far can the automated tower
EXTEND before it needs a human to RE-CARVE?" — and rising capability lifts that line (more EXTEND
delegable) without ever erasing the RE-CARVE floor.

---

# Part II — Coordination

## 7. Scope renegotiation and boundary pressure

Each node runs a local loop: do the next step; on a discovery, classify it; dispose locally or package it
upward. The useful primitive is not "split" but **boundary pressure**:

> **Boundary pressure occurs when a node cannot continue locally without risking work loss, extra work,
> incorrect work, or frame drift.**

Pressure types (an observational vocabulary, not a final ontology): **expansion / shrink / shift** (the
work is bigger / smaller / different than assigned), **seam** (the issue lives between nodes), **rehome**
(it belongs elsewhere), **frame** (local success no longer matches the parent's), **validation** (a claim
lacks evidence), **dependency**, **duplication**, **constitution** (captured intent is insufficient). The
generic transition is `pressure → message → decision-packet? → disposition → tree-mutation? →
validation-token? → debt`.

A **decision packet** arrives decision-ready: what changed, why the child cannot decide it locally, the
options, and the tree mutation that would follow. The **parent disposes** with the lowest change that
preserves intent coverage — answer / reject-as-non-goal / amend-scope / split-sibling / insert-seam /
rehome / open-probe / branch-defer-up / escalate-with-added-frame. Escalation is not a failure; *raw*
escalation is. Each level adds framing so the packet that reaches a human is a decision-ready constitution
prompt, not an alert.

**Debt** is the explicit record of unfinished or uncovered obligation. *Debt is not failure; hidden debt is
failure.* The governing anti-loss invariants — coverage-or-debt, claim-to-scope, seam-ownership at the
lowest common parent, no-silent-frame-mutation, witness-binding, debt-monotonicity, affected-cone reopening
— are the backbone of the backward pass. **In v2 they are read as allocation targets, not guarantees**
(§13): they describe the map the system tries to keep honest, not a promise that it is true.

## 8. Message passing: mesh and tree

The tree is the **ownership** topology, not the only **transport** topology. Routing every message up to a
common ancestor and back would be faithful but slow; pure lateral chatter would be fast but lose ownership.
The rule:

> **Mesh for working communication; tree for durable disposition. Messages travel by the cheapest useful
> path; effects that mutate work geometry are committed at the owning level.**

So a message carries a `route` (how it traveled) distinct from its `durableOwner` (who must record any
geometry change). Status, dependency-alignment over an existing edge, clarifying questions, and artifact
handoffs may go direct; scope/seam/frame/rehome changes must land at the owner. The concrete transport for
this — durable addresses for responsibilities, ephemeral leases for the sessions that serve them,
structured messages, disposition receipts, store-and-forward, and answerback liveness — is being built as
the **Telex** project, the dumb-deterministic layer beneath the controller (§9). *(Detail: doc 04;
transport: Telex `PRODUCT-THESIS.md` / `DESIGN.md`.)*

## 9. The controller over indeterministic workers

> **Work geometry is a deterministic control algorithm over an indeterministic worker substrate.**

LLM sessions do the fuzzy work — interpret, generate, validate, critique, propose. The controller does the
crisp work — store records, route once typed, apply tree mutations, track debt, compute affected cones,
schedule validation, decide closure state. The stack is **three machine layers plus the sovereign builder**:

| Layer | Deterministic? | Role |
|---|---|---|
| **Message fabric** (Telex) | yes, *dumb on purpose* | addresses, leases, delivery, receipts, answerback, audit |
| **Work-geometry controller** | partly | records, invariants, routing-once-typed, mutations, debt, cones, scheduling |
| **LLM worker / probe** | no | generate, classify, witness, defeat |
| **Builder** | sovereign | constitute intent; own values and faithfulness |

The crucial discipline — and the hinge to Part IV — is **typed-before-trusted**: the controller may ask a
model for judgment, but never treats the answer as an untyped fact. It is ingested as a claim, a witness, a
classification *proposal*, an artifact, or a message. Determinism here buys **auditability and
non-silence**, not correctness: the controller can ensure uncertainty is *represented, owned, and
revisitable*. It cannot make heuristic generation or validation reliable. That honesty is the bridge to the
re-fit: the loop's inputs are all **produced**, and production is where they live or die.

---

# Part III — Values and attention

## 10. The preference stop and the values layer

There are three different stops, and the model long conflated them:

- **Permission** — "may I?" Gating / approval / authority. **Parked.** The wrong stop.
- **Constitution** — "what do you even want here?" The outcome is undefined; the builder authors it (§6).
- **Preference** — "the outcome is reachable several ways with different properties and futures — which is
  yours?" The outcome is *not* in question; only which valid realization carries the builder's values.

The preference stop is grounded in **risk-ownership of *good***, not a feeling of ownership and not a claim
that the builder out-predicts the model. Even where the model's call would be defensible, **the builder
carries the consequence**, so the builder takes the call and bets on themselves. Voice-not-veto follows: the
model owes a recommendation; the builder owns the bet. The system's duty is to make that bet **well-lit** —
options, a recommendation, the rationale, what the model cannot see, and where its recommendation is weak —
never to gate, and never to let the builder bet blind by silently defaulting a consequential fork.

Values split into **core beliefs** (durable, encoded) and **preferences** (live). Preferences migrate into
core beliefs by deliberate builder effort, which *lowers the asking rate over time* — encoded beliefs
resolve a class of fork without a stop. Articulating beliefs (and arcs, §11) is a **builder skill**; so is
tuning the knobs, representing taste just-in-time where it is needed, reflecting without being led, and —
the meta-skill — getting better at laying in the judgment that produces quality.

## 11. Spread, posture, and the attention budget

The decisive term is **vision-leverage** — how much a choice matters to the future the builder is steering
toward. It is **part of intent** (its latent component), **emergent, intuition-shaped, and permanently
unobservable**; it sits on the floor of §6. The system must never try to *observe* it. It must detect the
**forks where it would be decisive**, by a move that separates two things:

- **Spread** — how divergent are the reachable futures under different resolutions of the fork? A model can
  estimate it — but only **basis-relative**, not absolute (see below).
- **Ranking** — which divergent future is *correct*? A function of the vision; unobservable.

> **Spread is basis-relative, not vision-independent.** Estimating "how divergent are the futures"
> presupposes *axes of divergence*, and which axes matter is itself vision-laden — so a purely "structural"
> spread would silently smuggle the vision back in (two paths can be near-identical in diff size yet far
> apart in reversibility, architectural commitment, or trust). v2 therefore defines spread as **divergence
> over a declared basis** — reversibility, architectural commitment, user-visible behavior, future option
> loss, cost-to-flip, semantic coupling, and touched vision arcs — **plus an explicitly tracked
> unknown-axis risk** for divergence the declared basis misses. The system estimates *declared-basis
> spread*, never "true vision spread," and the unknown-axis term is itself a fail-toward-surfacing signal
> (it feeds the second arm below). The declared basis is a knob the builder can extend; over-enumerating
> candidate axes and pruning by the builder's reaction is the intended way it is learned.

Interrupt on **high spread**, because high spread is exactly when the ranking matters — and the ranking is
the builder's. Low spread defaults safely, not because the system knows the builder's taste but because
**when futures barely differ, the ranking is irrelevant.** Projecting futures needs a **horizon**, supplied
cheaply by **posture** (a per-scope baseline: prototype↔craft) made **spikey** by **vision arcs** — named
long-range intent threads that spike the horizon on the forks they touch. `horizon(fork) = max(posture,
longest arc the fork participates in)`. Arcs are the *encodable fragments* of the otherwise-latent vision.

Crucially, **spread is expected information gain about the vision** — the same EIG-per-cost engine as §5.
Interrupting on spread both *protects the decision* and *learns the vision* (the answer is a maximally
informative sample of the latent ranking). So **builder attention is a budget**, allocated by:

```text
interrupt_value = futures_spread × permanence × open_taste(unresolved by belief) / interruption_cost
```

with a second arm — **stop also when confidence that spread is low is itself low** (fail toward surfacing),
because the two mis-tunings are asymmetric: over-asking kills leverage (visible, tunable down);
under-asking kills *good* (invisible — the builder never sees the fork). The decision is **three-tier**, not
binary, mapped to attention levels: **hard-stop** (interrupt) / **preference-debt** (next-checkpoint,
non-blocking — the system picks but records "I chose X; flip it if you care") / **silent-default**. A
per-scope **care knob** sets the threshold (this is what the old "involvement slider" actually was).
Preference-debt doubles as the **drift detector for core beliefs** — beliefs rot when the vision moves, and
re-surfacing a default catches a stale belief.

### The operating point: capability × stakes × attention, and structure substitutes for capability

Posture, care, and the determinacy regime (§2) are not three unrelated dials; they are facets of one
choice — **the operating point the builder configures for a workstream.** Its inputs:

- **deployed capability** — frontier model vs cheaper model;
- **accepted stakes / risk** — how reversible, how invested, how much a miss costs;
- **spent attention** — how hands-on the builder is (the care knob).

These are **substitutable against a target safety.** The reason a builder can safely drop to a weaker model
is that **the work-geometry structure substitutes for capability**: backward validation, witnesses,
defeaters, and scope renegotiation catch the intent-coverage failures the model itself would miss. So
*weaker-model + more-structure + more-attention* reaches the same safety as *frontier-model + less-structure
+ autonomy*. The builder picks where on that surface to sit, **per workstream** — and the choice sets which
determinacy regime the work runs in (lower capability or higher stakes pushes toward partially-open /
attention-dense; higher capability or lower stakes toward operationally-closed / autonomous).

Two consequences are load-bearing. First, **the model supports the full span symmetrically** — fully
autonomous and attention-dense are both first-class operating points, not a default and an exception; there
is no "common case." Second, this reframes the geometry's reason for being: **the structure exists to widen
the range of (capability, stakes) a builder can safely operate in.** The autonomous end leans on the model;
the attention-dense end leans on the structure; it is the *same machinery*, dialed to different reliance.
(Rising capability lifts the affordable-arity frontier of §5 and the EXTEND/RE-CARVE line of §6 at once — it
moves the operating point, it does not remove the floor.)

The payoff for the controller: coverage cannot be measured over intent (no denominator), but the work's
**decision points can be enumerated** — so coverage relocates to **fork-space**: *outcome-coverage + did
every high-spread fork get surfaced or resolved by an encoded belief.* This is the prospective sibling of
backward validation: §5 doubts the past; spread-detection doubts the fork ahead. *(Detail: doc 06.)*

---

# Part IV — Production and the implementation re-fit

This is the part the original model, written implementation-naive, did not have. It is the result of asking:
*who actually produces each record the controller consumes, and can they truthfully?*

## 12. Records are produced: the ask and production-independence

Every input to the controller — an outcome claim, a frame snapshot, a message's effect-type, a debt token, a
witness, a decision record — is an **utterance by an interested, limited, often self-referential producer.**
This breaks the implicit "records are honest facts" assumption hardest where the **producer is the subject**:
a worker self-reporting its own coverage has the most incentive to claim done and the least perspective to
judge it; a drifted node reports its drifted frame as correct; debt is logged only if the party that
benefits from hiding it admits it.

Two design moves follow.

**(a) The ask precedes the schema.** A record's shape is whatever its producing context can emit
**truthfully, at low burden, as a by-product of work it is already doing.** A dense form with empty fields
invites *fabrication* — and a corpus of confident fabrication is worse than empty. So production is
**prose-first** (an agent that does not know a thing simply does not write it) and **assembled, not
authored**: different loci emit different truthful slices, keyed by a stable id, stitched later. Fields are
partitioned by *who can know them* — the worker knows its decision/alternatives/uncertainty; it cannot know
spread, the builder's reaction, or whether a fork even mattered. *(Detail: doc 07.)*

**(b) Production independence.** The scattered fixes the model kept reinventing — the cold-reader for frame
drift, defeater-independence, the locus partition — are one principle:

> **A record about X is produced or witnessed by a locus independent of X, where the stakes warrant.**

This has a concrete substrate already in the workflow: a node is served by **more than one session** — an
**implementer**, and a **reviewer** that runs PAW Review and fields re-review requests. A **third
session-per-node can be an independent auditor that constructs the spread** (and the fork classification) the
implementer cannot honestly produce — moving *detection off the actor*. Detection and execution are split:
the implementer emits what it deliberated; an independent locus assigns significance. The regress — who
witnesses the witness? — terminates, by design, at the **builder** (§6, §13).

> **Independence is partial, and must be recorded as such.** A separate session is not automatically an
> independent witness: it may share the implementer's frame, prompt/context, incentive, model lineage,
> artifact access, success criterion, or blind spot. So independence is **not binary** — it is asserted
> along **named axes** (role · prompt/context · incentive · model-lineage · artifact-access · success-
> criterion · frame-origin), and a witness records *which* axes it is independent on and which it shares.
> "Where the stakes warrant" then means: buy independence on the axes most likely to carry the error, and
> leave the shared axes as named residual (the §13 receipt). A reviewer that shares the implementer's frame
> is no witness against *frame* drift, however separate its session.

A consequence for the durable record and the vision model: the corpus is **model-agnostic** (raw decisions
and outcomes that survive model changes) but only as **honest** as its production discipline — it is not
*bias-agnostic*. The model-relative compiled encoding (beliefs, context phrased for one reasoner) is
recompiled per model generation from that record; the record itself never migrates. The no-regret immediate
action is therefore narrow and cheap: **start the honest prose decision-note habit now**, keyed to nodes,
and capture the builder's own reaction separately — the dataset accrues from the first line.

## 13. The governing stance: allocation, not guarantee

The master re-fit, applied consistently:

> **Wherever the model says the system *ensures / guarantees / computes* X, read: the system *allocates
> effort to maximize* X under a scarce shared budget, *names who produces* the evidence, *degrades* to what
> that producer can honestly give, and *routes the residual* to the builder — who owns faithfulness by
> design, not by the system's failure.**

Three things this fixes:

- **Closure "invariants" (§7) guarantee map-consistency, not truth.** "Every intent slice is covered or has
  explicit debt" holds over the *records*; if debt is under-produced, it holds on paper while false in fact.
  Truth-confidence is a *separate, budgeted* claimant.
- **Verification and preference are one budget.** Trusting a record (spending independent-witness effort,
  ultimately builder attention) competes with surfacing a value-fork. They are allocated by the same
  EIG-per-cost rule (§5, §11). The system cannot verify everything; it spends verification where an
  undetected dishonesty would most damage intent — and the builder owns the unverified remainder.
- **Routing-to-builder is not itself an escape hatch.** "Route the residual to the builder" only works if
  it does not become a way to dump unbounded uncertainty onto the scarce resource. So a routed residual
  must be **compressed**: a decision packet carrying consequence, reversibility, a default recommendation,
  and batching with its peers. A surfaced issue the builder cannot act on is **unresolved debt, not
  success** — surfacing without compression is just silent failure relabeled.
- **Graceful degradation is a hard requirement.** The model must produce value at *single workstream,
  prose-only capture, builder-as-only-witness*, and improve as instrumentation (typed gates, the auditor
  session, reconciliation that writes outcomes back, more tree levels) arrives. The heuristic scales with
  what is available; it does not presuppose the full apparatus.

### The allocation receipt — what makes "allocation, not guarantee" falsifiable

The reframe is only honest if a *bad* allocation is identifiable; otherwise "we allocated but could not
guarantee" excuses every miss, and allocation-semantics is a slogan. The discipline that prevents this is
deliberately **light**, because a per-decision justification tax would re-import the heavyweight
project-management apparatus the model elsewhere refuses to become. So the receipt is required **only at a
surfaced fork** — a moment where the system *explicitly* chooses among meaningful ways to spend
attention/evidence/review. **Most work is silent-default and logs nothing.** At a surfaced fork, the
allocation records four things:

1. the **named risk** it is buying down (an outcome / correctness / value / trust / drift loss);
2. the **evidence** the allocation is expected to produce;
3. the **residual unprobed region** it is knowingly leaving;
4. **why this over the next-best** use of the same attention.

This is a **risk receipt, not a work plan**: it says "here is the uncertainty we chose to surface and own,"
never "this is now covered." It rides on stops that already exist (gates, value-forks, audits), so it adds
no new bureaucracy — and it is the minimum price of the claim. The honest caveat, carried as a frontier
question (§15): the receipt is only light if *deciding a fork is surfaced-worthy* is itself cheap; if that
judgment costs as much as the receipt, the discipline collapses toward either bureaucracy or silence — the
same unobservable-leverage problem one level down.

### Falsifiable predictions

Because the stance is meant to be a buildable theory and not a self-sealing vocabulary, it must predict
deltas against simpler baselines — claims that could come out false:

- explicit pressure-disposition (§7) yields **fewer hidden frame-drift failures** than task-status
  reporting;
- EIG-ranked validation (§5) finds **more consequential defects per unit cost** than pass-rate-oriented
  validation;
- preference-debt logs (§11) **predict later builder corrections** better than recency- or random-surfacing;
- independent-witness records (§12) reduce **false-done claims** relative to self-reports.

If these do not hold where instrumented, the corresponding mechanism is wrong, not merely unlucky.

This stance is not a retreat from the formal model. It is the formal model **re-fitted to its substrate** —
and it is why the builder having a job (representing taste, tuning knobs, owning faithfulness) is correct,
not a gap to be engineered away.

---

# Part V — Boundaries, frontier, and method

## 14. Parked, deliberately

- **Authority / governance** (v1's typed authorities, the old Layer 2, warrant/stake/legitimacy). It is the
  threat model of the *system being built*, not of the *builder building it*. Domain authority (RBAC,
  identity, scopes) is ordinary content; transport access-control (who may occupy/message an address) is a
  Telex-layer concern. Neither is a governance plane over the builder.
- **Multi-builder vision.** Whose taste ranks a fork across a team — a code-owners-style concern, solved in
  the small by the builder skill "coordinating with other builders." Out of scope now.
- **Apprenticeship / taste transfer.** A human concern, set aside as distracting in the near term.
- **Scope is one builder, specifically, first.** The "improve the builder's trajectory at the human task"
  ambition is real but not generalized yet.

## 15. Frontier and method

The hard, still-open problems: **no-surprise frame drift** (drift that passes every declared check because
the producer of the frame is the subject of the drift); **vision-leverage's permanent unobservability**
(managed via spread, never solved); the **production-trust regress** (managed via independence + budget,
terminating at the builder); the **surfaced-fork identification cost** (the §13 allocation receipt and the
§11 interrupt are only light if deciding *"is this fork surfaced-worthy?"* is cheap — if that judgment is as
expensive as the receipt, the discipline collapses toward bureaucracy or silence; this is the unobservable-
leverage problem one level down, and it is the largest live residual after Spar 9); the **drifted-owner
disposition** (boundary pressure is dispositioned by the owning level with "the lowest change that preserves
intent coverage," but if that level is itself frame-drifted, the lowest change *conserves* the error —
possibly more central than frontier); and **shaping as formalized EIG extraction** — front-load the durable,
high-spread spec+preference+vision before committing a workstream; it raises captured determinacy toward
operational closure (§2), and it both *uncovers and constitutes* intent; defer the model-relative and
drift-prone to just-in-time.

**On the determinacy spectrum and the "common case."** A note (Spar 10) corrected an over-reach: "intent
has no denominator" was stated globally but is really a *tail* claim (§2), and there is **no common case** to
privilege. A workstream's determinacy regime is *configured*, not fixed — it follows the builder's operating
point of capability × stakes × attention (§11), and is itself moved by model capability over time. So the
model is built to support the **full span symmetrically**: the fully-autonomous workstream and the
attention-dense one are both first-class. The residual worth watching is whether the **declared basis**
(§11) becomes ceremonial overhead on routine low-spread work — if so, let the basis be implicit by default
and explicit only as spread, novelty, or re-carve risk rises.

And the **method itself**, made explicit: this model was developed independent of its implementation target
on purpose, and is refined by a loop — *define the formal system → apply it to implementation possibilities
→ discover incongruences → re-fit the formal model with those constraints → repeat.* The model is never
finished; it is **kept honest** — which is, fittingly, exactly what it asks of the work it describes. Now
that it lives in Streamliner, each turn of that loop is fed by real Streamliner development: where the model
guides a design choice and the choice reveals an incongruence, that is the signal to re-fit the model here.

---

*Background (in the planning journal where this model originated, not required to read this doc): a v1
theory sketch; a numbered split into detailed docs — referenced inline as "doc 01" (substrate), "doc 04"
(scope/messaging), "doc 05" (controller), "doc 06" (values), "doc 07" (the record/the ask); and the spar
transcripts (Spar 9, Spar 10) that ratified specific claims. This document is self-contained; those are
provenance and deeper detail.*

*Settled-vs-frontier at a glance. **Build-driving (settled enough to design toward):** the geometry and two
passes (Part I); boundary pressure and disposition (§7); mesh-vs-tree routing (§8); the controller stack and
typed-before-trusted (§9); the three stops and the preference stop (§10); spread / posture / care / the
three-tier surfacing (§11); the operating point and structure-substitutes-for-capability (§11);
allocation-not-guarantee with the surfaced-fork receipt (§13); captured-determinacy regimes (§2).
**Influence-only (informs judgment, not a design commitment):** the EIG/experimental-design math (§5); the
production-trust regress and independent-auditor session (§12); the falsifiable predictions, still untested
(§13); and the open frontier problems (§15) — chiefly no-surprise frame drift, surfaced-fork identification
cost, and drifted-owner disposition.*
