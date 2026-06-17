# Autonomous Wave Progression

## Stage

Parked (2026-06 coverage partition).

## Coverage Partition (2026-06 refactor)

> **Parked** — named debt, not dropped. Resume after the PAW track plus WS-C (actor fabric) and
> WS-F (checkpoint/closeout) land: autonomous progression should consume a proven local actor
> substrate and a real closure gate rather than inventing them.

## Seed Idea

After SDK-managed graph-node launch and Automated PAW Review Loop exist, Streamliner should support a high-autonomy path where SDK workers progress through a shaped wave without the builder reviewing every node PR. Node workers execute against a wave feature branch, PAW review loops harden each node PR, a wave-level integration function reviews node PRs in workstream context, accepted node PRs merge into the wave branch, and Streamliner continues until a wave gate produces a builder-facing wave PR with clear verification instructions.

The core product idea is:

> Autonomy inside the wave. Judgment at the gate.

## Why It Matters

Streamliner's doctrine reserves builder attention for shaping, wave transitions, gates, design mismatches, and other high-leverage moments. Some work will still need builder presence at every node PR, but other work can safely run at higher autonomy when the wave boundary, node specs, review criteria, and escalation rules are clear.

Autonomous wave progression turns that doctrine into an execution mode. The builder defines the wave geometry and gate criteria up front, then Streamliner manages node execution, review, integration, reconciliation, and downstream readiness until the wave reaches a gate.

This is the natural follow-on to:

- SDK-managed graph-node workers, which give Streamliner programmatic execution ownership;
- Automated PAW Review Loop, which gives each node PR a local implementation/review/fix cycle;
- reconciliation notes and work-design feedback, which keep the builder learning from what happened rather than merely receiving a completed pile of code.

The node PR becomes an internal integration unit. The wave PR becomes the builder-facing judgment unit.

## Candidate Scope

### In Scope

- Define a wave-level autonomous execution mode for shaped waves.
- Define how SDK-managed workers execute ready nodes against a wave feature branch.
- Define node PR branch/target rules where node PRs target the wave branch, not the main integration branch.
- Define a wave-level integration function that reviews node PRs in workstream context after PAW review succeeds.
- Define merge, reject, retry, and escalation behavior for node PRs before they enter the wave branch.
- Reconcile node completion, merge results, downstream readiness, and wave progress after each accepted node.
- Continue through ready nodes until the wave reaches a gate, blocks, exhausts ready work, or escalates.
- Generate or update a wave PR that contains the combined wave work and gives the builder clear verification, testing, design-impact, risk, and gate-review instructions.
- Define authority boundaries: what may be auto-merged into the wave branch, what requires builder escalation, and what must never merge automatically into the main branch.
- Decide whether autonomous wave progression requires explicit wave metadata in `graph.json` or can initially derive wave execution state from checkpoints, gates, dependencies, and runtime state.

### Out of Scope

- Replacing terminal-first launch or builder-present node execution.
- Automatically merging the final wave PR into the main integration branch.
- Full multi-workstream dependency visualization.
- Remote/devbox autonomous execution.
- General CI/CD release automation after the wave PR merges.
- Replacing PAW review. This candidate assumes node-level PAW review exists and adds wave-level integration above it.
- Treating the wave integrator as a persistent agent persona or synthetic teammate. It is a workstream function.

### Deferred

- Automatic classification of which waves or nodes are safe for autonomous progression.
- Rich policy UI for autonomous wave execution.
- Cross-workstream auto-progression where one workstream's checkpoint automatically unlocks another workstream's wave.
- Trusted-auto progression beyond the wave gate.
- Historical analytics on autonomous wave success/failure rates.

## Decisions and Working Assumptions

- The first cut should be explicitly builder-selected per wave. Streamliner should not infer that a wave is autonomous by default.
- Node workers should branch from the current wave branch, and node PRs should target the wave branch.
- The wave branch is the accumulation surface for autonomous work inside the wave.
- The wave PR targets the normal integration branch and is always builder-reviewed in the first cut.
- The wave-level reviewer/integrator may merge node PRs into the wave branch, but must not silently change wave intent, gate criteria, public exports, project design authority, or cross-workstream contracts.
- PAW review answers whether the node implementation is locally good. The wave integrator answers whether the node PR should enter the wave branch given the whole workstream context.
- Reconciliation should run after each node PR integration so graph status, downstream readiness, open questions, closeout observations, and design-impact state stay aligned with reality.
- The wave PR body should be generated from workstream state and review evidence, not improvised by the last node worker.
- The builder-facing wave gate remains the first safety boundary. Node-level autonomy is allowed because the wave branch isolates the work until gate review.

## Wave Integrator Function

Autonomous wave progression likely needs a new logical function: the **Wave Integrator**.

The Wave Integrator is not an agent persona. It is the workstream function that decides whether a reviewed node PR should be merged into the wave branch.

Expected inputs:

- workstream `brief.md`;
- workstream `graph.json`;
- selected wave/checkpoint/gate context;
- node spec and linked tracker state;
- node PR diff and metadata;
- PAW review-loop result and unresolved findings;
- relevant design docs and decision records;
- current wave branch state;
- runtime/session evidence when useful.

Expected behavior:

- inspect whether the node PR satisfies the node mission;
- check whether the work stays inside the workstream and wave boundary;
- check whether the PR preserves wave coherence and downstream contracts;
- verify design-impact declarations and identify `decision-needed` cases;
- merge the node PR into the wave branch when safe;
- request changes or send the node back through worker/review loop when not safe;
- escalate to the builder for boundary pressure, design mismatch, public export changes, or unsafe integration;
- emit reconciliation facts after merge, rejection, retry, or escalation.

Expected outputs:

- merge into wave branch;
- request changes / retry instruction;
- builder escalation;
- reconciliation note or work-design feedback when the node reveals geometry issues;
- updated node readiness/unblock facts for downstream progression.

## Branch and PR Model

A likely first branch topology:

```text
main
  ^
  |
wave/{workstream-id}/{wave-id}
  ^
  |
node/{workstream-id}/{node-id}
```

The exact naming convention should be decided during formation or design, but the ownership semantics matter more than the string shape:

- node branches are worker-owned;
- node PRs target the wave branch;
- the wave branch is Streamliner-managed for this autonomous wave;
- the wave PR targets the normal integration branch;
- final wave PR merge remains builder-owned in the first cut.

The wave branch should be visible to Streamliner as part of the wave execution state. The candidate should decide whether branch identity belongs in committed workstream artifacts, runtime state, checkpoint metadata, or a new explicit wave model.

## Wave PR / Gate Packet

At the gate, Streamliner should generate or update a builder-facing wave PR. The wave PR is the review packet for the whole confidence transition.

Expected sections:

```markdown
# Wave {n}: {checkpoint title}

## Workstream purpose
...

## Wave goal
...

## What changed
- Node A: ...
- Node B: ...
- Node C: ...

## Gate criteria
- [ ] ...
- [ ] ...

## Builder verification steps
1. ...
2. ...
3. ...

## Design impact
- Design docs updated: ...
- Decisions needed: ...
- No design impact: ...

## Exports now available
- `{checkpoint-id}`: ...
- Contract / behavior / API / UI state: ...

## Known risks and follow-ups
- ...

## Reconciliation summary
- Boundary held/leaked: ...
- Context gaps: ...
- Deferred closeout observations: ...
```

The builder should be able to review the wave PR without spelunking through every node session. Node PRs and PAW review evidence should remain linked for audit, but the wave PR should be the coherent gate surface.

## Escalation Rules

Escalate to the builder when autonomous wave progression encounters:

- node work that changes intended project design beyond node/workstream authority;
- wave boundary expansion or ownership ambiguity;
- public checkpoint/export shape changes;
- downstream dependency invalidation;
- repeated disagreement between PAW review and wave integration review;
- semantic mismatch even when tests pass;
- proposed changes to gate criteria;
- merge conflicts that reveal design coupling rather than mechanical overlap;
- wave branch drift from the brief's Purpose, Approach, or Boundaries;
- unsafe cleanup, destructive action, or permission ambiguity;
- a node PR that cannot be evaluated against its spec.

Do not escalate for routine implementation decisions inside a node, minor test/doc fixes that stay inside boundaries, mechanical merge conflicts with deterministic safe resolution, or small closeout observations that can be batched.

## Candidate Workstream Shape

A future formed workstream might use this shape:

### Wave 1 — Wave branch and integration contract

Define the execution contract for autonomous waves:

- wave branch identity and lifecycle;
- node branch and node PR target rules;
- graph/runtime representation for wave branch, node PRs, and integration state;
- merge eligibility and failure states;
- authority boundaries for auto-merge into wave branch versus builder escalation.

### Wave 2 — Wave Integrator function

Implement or specify the post-PAW-review function that evaluates node PRs in workstream context and decides merge/retry/escalate.

### Wave 3 — Auto progression loop

Implement the loop that finds ready nodes, launches SDK workers, waits for PAW review results, invokes the wave integrator, merges accepted node PRs, reconciles state, unlocks downstream work, and continues until the wave gate or an escalation.

### Wave 4 — Wave PR and gate packet

Generate the builder-facing wave PR with combined work, verification steps, gate criteria, design-impact summary, risks, exports, and reconciliation summary.

### Gate — Autonomous wave usability

Validate whether the builder can trust Streamliner to progress through a bounded wave without reviewing every node PR, while still receiving clear escalation, evidence, and verification instructions at the gate.

## Dependencies

### Depends On

- [SDK-Managed Worker Runtime](sdk-managed-worker-runtime.md), because Streamliner needs first-class SDK-owned worker lifecycle, progress, cancellation/takeover, PR/completion evidence, and cleanup hooks before it can run nodes autonomously.
- [Automated PAW Review Loop](automated-paw-review-loop.md), because node PRs should pass implementation/review/fix cycles before wave-level integration decides whether to merge them into the wave branch.
- Session launching/tracking substrate, now completed as a workstream export, because graph-node launch, registry binding, runtime overlays, PAW context, and PR/session linkage are required substrate.

### Enables

- Higher-trust autonomous execution for shaped waves.
- Builder review at wave gates instead of every node PR when appropriate.
- More meaningful wave PRs that summarize coherent confidence transitions.
- Future portfolio-level progression where workstreams advance through public checkpoints with less manual routing.

### Related Candidates

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because the Wave Integrator and orchestrator helpers need consistent role/context guidance.
- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because autonomous wave exports may unblock other workstreams through public checkpoints.
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md), because wave gates and closeout observations define the builder-facing validation boundary.
- [Workstream Design Mode](workstream-design-mode.md), because autonomous progression only works when the wave was shaped with clear boundaries, contracts, and gate criteria.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because node work, hot work, and wave integration all need clear reconciliation behavior.

## Open Questions

- Does autonomous wave progression require explicit `waves` metadata in `graph.json`, or can the first cut derive wave execution state from checkpoints, gates, dependencies, and runtime state?
- Where should wave branch identity live: committed graph, runtime state, checkpoint metadata, or a new wave execution record?
- What is the exact relationship between checkpoint, gate, wave branch, and wave PR?
- Should node attention levels affect auto-integration policy, e.g. `focus` requires builder review while `watch` or `parked` can integrate after PAW + wave review?
- Should wave attention exist separately from node attention?
- How should failed node PRs retry: same branch/PR, new attempt branch, or return to the same SDK session?
- How much evidence from PAW review and wave integration should be included in the wave PR body versus linked as supporting artifacts?
- What deterministic backend actions are required for safe node-PR merge, conflict handling, branch cleanup, and wave PR creation?
- How does autonomous wave progression interact with closeout observations and closure gates?
- What is the smallest first slice that proves the model without building a hidden CI bot with opinions?

## Handoff Brief

Create an Autonomous Wave Progression workstream.

The workstream should define and implement a builder-selected high-autonomy execution path for shaped waves. Inside an autonomous wave, SDK-managed node workers execute ready nodes against a wave feature branch. Each node PR passes through Automated PAW Review Loop first. A wave-level integration function then reviews the node PR in the context of the workstream brief, graph, wave/checkpoint, node spec, design docs, and PAW review evidence. If safe, it merges the node PR into the wave branch and triggers reconciliation. Streamliner continues through ready nodes until the wave gate, a blocker, or an escalation.

The workstream should preserve a strict authority boundary: node PRs may be auto-merged into the wave branch, but the wave PR targeting the main integration branch remains builder-reviewed in the first cut. The wave gate should produce a builder-facing wave PR/gate packet with what changed, node PR links, tests, verification steps, design impact, exports, known risks, closeout observations, and reconciliation summary.

The workstream should decide whether the existing graph/checkpoint model is sufficient for autonomous wave execution or whether explicit wave metadata is required. It should also define the Wave Integrator function, escalation rules, branch/PR lifecycle, reconciliation triggers, and how attention levels affect autonomous progression. Keep the model aligned with Streamliner's thesis: autonomy inside the wave, builder judgment at the gate.
