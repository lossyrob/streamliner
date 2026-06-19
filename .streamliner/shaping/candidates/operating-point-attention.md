# Operating Point & Attention

## Stage

Shaped; foundational candidate.

## Seed Idea

Give Streamliner a single home for the work-geometry **values & attention layer** — the *operating
point* (capability x stakes x attention) expressed as concrete, per-scope knobs, plus the surfacing
discipline that decides when builder attention is spent. These concepts are defined in the
work-geometry model (the preference stop, the human floor, spread, posture, the care knob, encoded
beliefs) and were prototyped together in the backlog-orchestrator skill, but nothing in Streamliner
owns them yet.

## Why It Matters

The same handful of attention/values primitives are needed in several places:

- **boundary-pressure surfacing** — deciding whether a node's discovery interrupts the builder,
  records a non-blocking note, or silent-defaults;
- **gates and closeout** — the human-floor review that decides whether work proceeds;
- **autonomous execution** — the per-scope autonomy/merge disposition that says how hands-off a run is.

If each of those implements its own notion of "how hands-on the builder is," "what counts as a
preference fork," and "how to record a deferred preference," they will drift apart — the same
split-ownership failure the product thesis warns about, but for attention. One owner keeps the
operating-point model coherent and lets the others consume a stable contract.

This is also the layer that makes weaker-model + more-structure + more-attention reach the same
safety as frontier-model + autonomy: the operating point is the dial the builder sets per scope.

## Candidate Scope

### In Scope

- The per-scope **operating point**: the **care knob** (attention threshold mapping to hard-stop /
  preference-debt / silent-default), **posture** (prototype <-> craft, which sets the horizon),
  accepted **stakes**, and deployed **capability** — the substitutable dials.
- **Sizing as an operating-point input** (S/M/L drives process/effort routing). The size *field*
  lives in the workstream format substrate; its *meaning and routing* live here.
- **Preference-debt records** — when a fork is real but not worth a stop, the system picks and
  records "I chose X; flip it if you care," surfaced at the next checkpoint.
- **Encoded core beliefs** — settled norms that resolve a class of fork without a stop (for example,
  "fix what's broken when low-risk, even if it expands scope"). Durable, authored, and they lower
  the asking rate over time.
- **Human-floor surfacing** — the well-lit bet: options, a recommendation, the rationale, and what
  the model cannot see; never gate, never silent-default a consequential fork.
- **Autonomy / disposition setting** — the per-scope "how much autonomy at a gate" control (e.g.
  auto-proceed vs route-to-human).

### Out of Scope

- Automatic **spread estimation** internals — start from builder-set knobs, not an estimator that
  computes divergence.
- The gate/closeout interaction surface (the checkpoint/closeout candidate) and the boundary-pressure
  mechanics (the reconciliation candidate) — they *consume* this layer; they do not own it.
- The node size field in the document schema (the format-substrate candidate owns the field).

### Deferred

- Learning the care knob from observed builder reactions.
- Auto-estimated, basis-relative spread.

## Dependencies

### Depends On

- The workstream format substrate, for the scope metadata and size fields these knobs attach to.

### Enables

- The reconciliation / boundary-pressure candidate (surfacing decisions), the checkpoint/closeout
  candidate (human-floor gate), the autonomous-execution engine (merge disposition), and the
  backlog (per-item care/posture).

### Related Candidates

- Role & Context Packages — encoded beliefs and surfacing guidance may be expressed partly as role
  context.

## Reference Material

Grounded in the work-geometry model's values & attention layer (the preference stop, the human
floor, spread/posture/care, preference-debt, encoded beliefs). The backlog-orchestrator skill in
`lossyrob/skills` is a working reference implementation that exercises the care knob, posture,
preference-debt reporting, and the human-floor merge gate together.

## Workstream Shape

Likely waves: (1) the per-scope operating-point model and knobs (care, posture, size routing,
autonomy disposition); (2) preference-debt records and their surfacing at checkpoints; (3) encoded
core beliefs. Each wave exports a stable slice of the attention/values contract for consumers.

## Open Questions

- At what scope do the knobs attach — workstream, wave, node, run, or all of them with inheritance?
- Do encoded beliefs live here, in role context, or split between them?
- How much should be builder-set knobs versus system-estimated, and where is the boundary?

## Handoff Brief

Create an Operating Point & Attention workstream that gives Streamliner one owner for the values &
attention layer: the per-scope operating point (care knob, posture, sizing routing, autonomy
disposition), preference-debt records, encoded core beliefs, and the human-floor surfacing
discipline. It should export a stable contract consumed by boundary-pressure surfacing, gates and
closeout, the autonomous-execution engine, and the backlog, so attention behavior stays consistent
across Streamliner rather than being reinvented per feature. Start from builder-set knobs and the
concrete designs proven in the backlog-orchestrator skill; defer auto-estimated spread.
