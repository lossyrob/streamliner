# Work-Geometry Essay v3.5 — Plan Alignment (parked)

> **Parked review — not yet acted on.** This captures how the current campaign/candidate plan aligns
> with `work-geometry-essay-v3.5.md`, the rough edges found, and where each fix would fold. Pick it up
> in a focused session; the rough edges are *captured, not applied.*

## Headline

The plan is **strongly aligned on the skeleton**, by construction — the geometry/tree, the two passes
(the gate ladder), boundary pressure + mesh-vs-tree (Node Handoff + telex), the operating point,
allocation-not-guarantee, production independence (the auditor), and the human floor all map to
candidates. The rough edges are not structural gaps; they are places where **a discipline the essay
insists on has softened into a QA-loop, a tracker, or a guarantee** — the failure §2 names ("carry
less and you have an issue tracker and good intentions").

## Rough edges (prioritized) — and where each folds

1. **Validation is pass-rate convergence, not witness/defeater discipline (§6, ll.250-261).** Our
   validation-loop ("run playbook → repairs → converge to green") is exactly what §6 forbids ("never
   optimize pass-rate" — Goodhart). The essay wants **defeater-probes that span the failure space at
   matching arity**, ranked by **expected value of information against named loss classes**
   (outcome / correctness / value / drift / trust). The per-node witness ("the probe most likely to
   falsify the claim") is right; the *loop* isn't.
   → Fold into `convergent-validation-playbooks` + the validation section of `node-gate-flow.md`.
   *(Biggest conceptual edge. Note: crafted defeaters are a learning-system effect — see
   `memory-and-learning-system.md`.)*

2. **WS-A under-models the required node payload (§2, ll.105-108).** A node must carry, first-class
   and typed: **intent-slice · claimed-outcome · producer/provenance · witnesses + independence axes ·
   open debt · owner · affected-cone · preference forks + receipts.** WS-A lists kind/size/debt/slots —
   missing typed intent-slices, provenance, witnesses+axes, **affected-cone**, and preference receipts.
   → Fold into `workstream-format-coverage-substrate`.

3. **"Allocation, not guarantee" leaks back into the gates (§4, §11 ll.477-479, §14).** "No-open-debt
   gate," "validate coverage," "closure" read as *certifying*. Essay: closure invariants buy
   **map-consistency, not truth**, and closure is **provisional** (estimator-defect search always-on).
   → Framing pass on `checkpoint-closeout-experience` + the coverage language in `CAMPAIGNS.md`.

4. **The 4th operating-point dial is missing (§9, ll.359-367).** We say capability × stakes × attention
   (three). The essay names **four** — the fourth is **verifier and environment strength** (tests,
   sandbox, rollback, observability) — and warns against folding it into a vague "structure."
   → Fold into `operating-point-attention`. *(Easy, unambiguous.)*

5. **Unknown-axis residual + detector calibration (§10, ll.418-443).** We have spread/care/three-tier,
   but not the **unknown-axis residual** (fail-toward-surfacing when confidence that spread is low is
   itself low) or the detector's **precision/recall calibration** against reversals / "I wish you'd
   asked." (Calibration overlaps the Learning System's learning-signal capture.)
   → Fold into `operating-point-attention` (+ `memory-and-learning-system`).

6. **No research-programme measurement / geometry tax (§13, ll.557-634) — absent.** The essay is a
   *falsifiable* programme: false-done rate, escaped-rework cost, time-to-detection, interruption
   quality, and the **geometry tax** (the overhead the structure itself adds). We have diagnostics/
   logging but none of these. Without them we cannot tell whether the geometry pays for itself — and
   the essay stakes itself on losing if it doesn't.
   → **New candidate** (instrumentation / "does the geometry pay for itself").

**Minor refinements:**
- **Mechanical vs interpretive records (§11, ll.453-459).** Typed-before-trusted should *trust*
  mechanical records (CI result, telex delivery) as events while doubting only interpretive judgments;
  we currently lump all model output as claims. → note in `node-gate-flow` / Operating Point.
- **Extend vs re-carve (§7).** Make explicit that the orchestrator *extends within a carve* but only
  the builder *re-carves the basis*; we have it implicitly in plan-gate escalation. → note in Node
  Handoff / the gate flow.

## Status

Captured, not applied. When picked up: fold 1–5 into the listed candidates, create the measurement
candidate (6), and tuck in the minors. Source: `work-geometry-essay-v3.5.md` (730 lines, 14 sections);
a per-section extraction was produced during this review.
