# Work-Geometry Essay v3.5 — Plan Alignment (dialogue-updated)

> **Dialogue-updated review.** This began as a parked essay→plan alignment review of
> `work-geometry-essay-v3.5.md`. A theory↔ground telex dialogue (log: `essay-dialogue-log.md`) then
> worked through the rough edges below and converged them to one principle, and several have since been
> folded into the candidates. Per-edge status is marked inline; the plain-language result is under
> "What the dialogue settled."

## Headline

The plan is **strongly aligned on the skeleton**, by construction — the geometry/tree, the two passes
(the gate ladder), boundary pressure + mesh-vs-tree (Node Handoff + telex), the operating point,
allocation-not-guarantee, production independence (the auditor), and the human floor all map to
candidates. The rough edges are not structural gaps; they are places where **a discipline the essay
insists on has softened into a QA-loop, a tracker, or a guarantee** — the failure §2 names ("carry
less and you have an issue tracker and good intentions").

## What the dialogue settled — one principle

The theory↔ground pass worked all six seed concepts and collapsed them to a single practical rule that
turns up in three places:

> **Keep running the check you'd otherwise stop once things look green — at a rate that tracks how fast
> that area actually changes — and send each finding to whoever should act on it.**

- In the **memory system**: the check is a rule quietly re-confirming itself. The rate is how fast an
  untested rule decays back toward asking; a rule whose choice gets reversed drops back immediately.
- In the **validation loop**: the check is a fresh attempt to break the target after it passes. The
  rate is how often an independent probe brackets the loop; each finding routes to a repair (outcome
  problem) or a reframe (drift).
- In **closeout**: the check is a re-look at whether the ground moved under a decision already called
  done.

The "rate" is observed, not hand-set — each place watches its own churn (reversals, escaped defects
after green) and tunes itself. The single failure to watch for, everywhere: the tool asking less while
its choices get reversed more.

## Rough edges (prioritized) — and where each folds, with status

1. **Validation is pass-rate convergence, not witness/defeater discipline (§6, ll.250-261).** Our
   validation-loop ("run playbook → repairs → converge to green") is exactly what §6 forbids ("never
   optimize pass-rate" — Goodhart). The essay wants **defeater-probes that span the failure space at
   matching arity**, ranked by **expected value of information against named loss classes**
   (outcome / correctness / value / drift / trust). The per-node witness ("the probe most likely to
   falsify the claim") is right; the *loop* isn't.
   → Fold into `convergent-validation-playbooks` + the validation section of `node-gate-flow.md`.
   *(Biggest conceptual edge. Note: crafted defeaters are a learning-system effect — see
   `memory-and-learning-system.md`.)*
   → **Applied (commit D).** The validation candidate and node-gate-flow now define convergence as an
   independent probe finding nothing new (not the same playbook re-passing), keep the break-it role
   separate from the fix-it role, and count the loop's budget in validation runs. Written as plain
   rules; the essay's information-value-per-run ranking stays the theory behind them.

2. **WS-A under-models the required node payload (§2, ll.105-108).** A node must carry, first-class
   and typed: **intent-slice · claimed-outcome · producer/provenance · witnesses + independence axes ·
   open debt · owner · affected-cone · preference forks + receipts.** WS-A lists kind/size/debt/slots —
   missing typed intent-slices, provenance, witnesses+axes, **affected-cone**, and preference receipts.
   → Fold into `workstream-format-coverage-substrate`.
   → **Open.** Not touched in this pass; the typed node payload (intent-slice, provenance, witnesses +
   independence axes, affected-cone, preference receipts) still needs to fold into the format-substrate
   candidate.

3. **"Allocation, not guarantee" leaks back into the gates (§4, §11 ll.477-479, §14).** "No-open-debt
   gate," "validate coverage," "closure" read as *certifying*. Essay: closure invariants buy
   **map-consistency, not truth**, and closure is **provisional** (estimator-defect search always-on).
   → Framing pass on `checkpoint-closeout-experience` + the coverage language in `CAMPAIGNS.md`.
   → **Partly applied (commit A).** CAMPAIGNS.md now closes in two phases — coverage admits every slice
   (assigned, green-or-debt), then a separate check that where the workstreams connect they integrate —
   and frames the campaign-level look as buying map-consistency, not proof. The parallel framing pass on
   checkpoint-closeout is still open.

4. **The 4th operating-point dial is missing (§9, ll.359-367).** We say capability × stakes × attention
   (three). The essay names **four** — the fourth is **verifier and environment strength** (tests,
   sandbox, rollback, observability) — and warns against folding it into a vague "structure."
   → Fold into `operating-point-attention`. *(Easy, unambiguous.)*
   → **Applied (commit C).** operating-point-attention now carries the fourth dial (safety-net strength:
   tests, sandbox, rollback, observability) explicitly, alongside capability/stakes/attention.

5. **Unknown-axis residual + detector calibration (§10, ll.418-443).** We have spread/care/three-tier,
   but not the **unknown-axis residual** (fail-toward-surfacing when confidence that spread is low is
   itself low) or the detector's **precision/recall calibration** against reversals / "I wish you'd
   asked." (Calibration overlaps the Learning System's learning-signal capture.)
   → Fold into `operating-point-attention` (+ `memory-and-learning-system`).
   → **Partly applied (commits B, C).** The detector calibration landed as the memory health metric
   ("asks less without being wrong more," tracked per rule); the detection/resolution split landed in
   operating-point. The unknown-axis residual (lean toward surfacing when even the confidence that a
   fork is low-stakes is itself shaky) is still to write into the operating-point deep pass.

6. **No research-programme measurement / geometry tax (§13, ll.557-634) — absent.** The essay is a
   *falsifiable* programme: false-done rate, escaped-rework cost, time-to-detection, interruption
   quality, and the **geometry tax** (the overhead the structure itself adds). We have diagnostics/
   logging but none of these. Without them we cannot tell whether the geometry pays for itself — and
   the essay stakes itself on losing if it doesn't.
   → **New candidate** (instrumentation / "does the geometry pay for itself").
   → **Open — still wants its own candidate.** Nothing yet measures whether the geometry pays for
   itself (false-done rate, escaped-rework cost, time-to-detection, and the overhead the structure
   itself adds).

**Minor refinements:**
- **Mechanical vs interpretive records (§11, ll.453-459).** Typed-before-trusted should *trust*
  mechanical records (CI result, telex delivery) as events while doubting only interpretive judgments;
  we currently lump all model output as claims. → note in `node-gate-flow` / Operating Point.
- **Extend vs re-carve (§7).** Make explicit that the orchestrator *extends within a carve* but only
  the builder *re-carves the basis*; we have it implicitly in plan-gate escalation. → note in Node
  Handoff / the gate flow.

## Status

Dialogue complete; partially folded. Applied so far: edge 1 (commit D), edge 4 (commit C), and parts of
edges 3 (commit A) and 5 (commits B, C) — see the inline status per edge. Still open: edge 2 (node
payload → format substrate), the rest of edge 3 (checkpoint-closeout framing), the unknown-axis residual
in edge 5, edge 6 (the "does the geometry pay for itself" measurement candidate), and the two minors.
Sources: `work-geometry-essay-v3.5.md` (730 lines, 14 sections) and the converged telex dialogue
(`essay-dialogue-log.md`).
