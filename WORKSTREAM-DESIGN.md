# Workstream Design

> Working note for Streamliner workstream design philosophy. This document is
> intentionally top-level and easy to revise while the workstream design practice
> is still evolving.

## Purpose

Streamliner workstream design is the practice of shaping work into executable
geometry: boundaries, waves, nodes, gates, checkpoints, imports, exports, and
handoff artifacts. Good workstream design lets the developer allocate attention
to high-leverage decisions while workers execute PAW-sized missions with enough
context and autonomy.

This document complements:

- [DOCTRINE.md](DOCTRINE.md), which defines the developer, orchestrator, and
  worker roles.
- [ORCHESTRATION.md](ORCHESTRATION.md), which describes node creation,
  reconciliation, and wave progression.
- [NODE-SPEC-FORMAT.md](NODE-SPEC-FORMAT.md), which defines the mission-type
  order a worker receives for one node.
- [WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md), which defines how workstreams,
  nodes, checkpoints, and runtime state appear in artifacts.

## Core heuristic

Shape workstreams around **confidence transitions**, not implementation
checklists.

The question is not:

> What tasks can we list?

The question is:

> What states must become true, in what order, so that the developer, workers,
> gates, or downstream workstreams can rely on them?

Waves, nodes, checkpoints, and gates are different tools for encoding those
transitions. The ideas in this document are design criteria, not hard rules.
Formation sessions should use them to reason about the work, then record why a
different shape is better when the workstream calls for it.

## Waves and parallel nodes

One useful way to think about waves is as **sequential confidence plateaus**. A
later wave usually should not begin just because one implementation track has
produced something real; it should begin when the workstream has reached a state
the developer can inspect, validate, or use as the basis for the next promotion
decision.

Parallelism often belongs inside a wave. If several nodes can run under the same
accepted contract and together produce one usable confidence state, consider
grouping them into the same wave rather than splitting them into separate
sequential waves. The dependencies inside the wave can still express partial
ordering:

- two nodes may both depend on the previous gate and run in parallel;
- a third node may depend on both of those nodes and finish the wave;
- the wave checkpoint groups all three because the durable outcome depends on
  the combined result.

This helps keep "wave" from becoming a synonym for implementation sequence. A
wave is not necessarily "backend first, UI second." A more useful question is:
"what state becomes newly true before the next promotion decision?" If backend
substrate and UI monitoring are only useful together, they may be one wave with
parallel nodes, not two waves.

### Formation proposes the first executable shape

A formed workstream should not count its own formation as Wave 1. Formation is
the shaping activity that creates enough structure to start: the workstream
brief, graph, tracker issue, initial node specs, gates, checkpoints, and design
references. Those artifacts make the workstream executable, but they do not mean
the workstream's design is fully settled.

Wave 1 should start with the first real confidence transition after formation:
research, design clarification, contract definition, implementation, validation,
or another executable node that a worker can complete and a downstream node,
gate, or workstream can rely on. If the only plausible Wave 1 is "form this
workstream," the candidate is not ready to become an active workstream yet; keep
shaping it, or create a pre-formation design session outside the workstream's
wave graph.

For non-trivial or high-autonomy workstreams, Wave 1 is often best treated as a
design or contract wave. Its job is to turn the formed shape into accepted
boundaries, design references, validation criteria, authority limits, and
implementation strategy that later workers can safely rely on. This is often
where developer presence has the highest leverage. Later autonomous execution
usually fails because Wave 1 left an important contract, dependency, harness, or
gate condition ambiguous.

### Common macro-shape

A strong default shape for serious workstreams is:

1. **Design/contract wave:** establish the intended design, contracts,
   boundaries, validation criteria, and authority limits.
2. **Implementation wave or waves:** execute under those accepted contracts,
   splitting nodes only where independent confidence or safe parallelism justifies
   the coordination cost.
3. **Validation-loop wave:** harden the result through tests, harnesses,
   playbooks, scenario runs, or agent-driven loops that exercise realistic use
   and produce evidence.
4. **Demonstration gate:** show that the intended capability or confidence state
   is real, inspectable, and acceptable to the developer or downstream consumer.

This is guidance, not ceremony. Small workstreams may collapse several of these
steps into one node or gate. Complex workstreams should be explicit about which
parts of the pattern they are using and why any part is being skipped.

### Validation-loop waves

A validation wave can be more than "run tests." It may create or extend a
harness, playbook, autonomous loop, scenario runner, or manual-agent loop that
repeatedly exercises the new behavior, finds issues, fixes them, and produces
reviewable evidence. The confidence transition is that the work can survive
realistic use before the developer is asked to accept it.

Use validation-loop waves when the workstream involves autonomy, UI/UX, runtime
behavior, safety, cross-node integration, or any workflow where a static code
review is unlikely to expose the important failures.

### New operating primitives

Some workstreams introduce a new operating primitive rather than a single product
surface: a runtime mode, actor model, orchestration loop, storage authority
model, or cross-environment coordination mechanism.

For these workstreams, avoid splitting concept, substrate, and first dogfood into
separate workstreams unless each creates an independently consumable confidence
state. Often the first meaningful transition is that the concept, minimal
substrate, and one real use together prove the primitive is usable.

Keep the boundary tight. The first workstream should prove the primitive with the
smallest real loop that exercises it; downstream features that merely consume the
primitive should usually become later workstreams.

## Gates and checkpoints

Checkpoints and gates serve different purposes:

| Concept | Purpose |
|---|---|
| **Checkpoint** | Names a milestone state that a set of nodes collectively reaches. It is graph metadata, not executable work. |
| **Gate** | Represents a deliberate validation or acceptance step that blocks downstream nodes until passed. It is a node in the graph. |

A checkpoint can be enough when the workstream reaches an objectively
verifiable milestone and the next work can continue safely under already
accepted decisions. A gate is useful when downstream work would be expensive,
misleading, unsafe, or externally consequential if the current result is wrong.

Common reasons to add a gate include:

- **Contract validation:** downstream workers will build against a schema,
  runtime contract, interface, or design decision.
- **UX validation:** the developer needs to judge whether an experience feels
  right before hardening or expanding it.
- **Safety validation:** permissions, cleanup, cancellation, unattended
  execution, or destructive actions are involved.
- **External acceptance:** another workstream, team, platform, or stakeholder
  must consume or accept an export.
- **Closure or export:** the workstream is about to declare outputs stable or
  hand them to downstream work.
- **Demonstrated capability:** the workstream needs to prove that its intended
  outcome works in a concrete walkthrough, scenario, or end-to-end run.

Not every checkpoint needs a gate. Gates request developer attention, so adding
one without a meaningful decision can recreate micromanagement. A wave might
skip a gate when the prior gate already settled the consequential judgment, the
output is verifiable through artifacts or tests, the next work can fail cheaply,
and no product, safety, or external-consumption decision is being made.

As a formation heuristic, each wave should either end in a gate or have an
explicit reason why a checkpoint-only transition is sufficient. A workstream's
final transition should usually include a demonstration or walkthrough gate, not
merely a statement that nodes landed or issues closed.

## Node design

### Node principle

Split nodes for **independent confidence**, not merely for independently
nameable implementation areas.

The question is not:

> Could this be a separate task?

The question is:

> If this node completes, does the workstream learn or gain something durable
> enough that another worker, gate, or downstream workstream can rely on it?

A node is a worker-session mission. It is not a checklist item, not a phase list,
and not a mirror of the worker's internal implementation plan.

Design-focused nodes are valid when downstream execution depends on an accepted
contract, design decision, validation criterion, or authority boundary. They
should still produce reviewable outputs that change what later workers can
safely do; they are not essays inside the graph.

### PAW-sized nodes

Streamliner workers often run a full PAW-style loop: understand the mission,
plan, implement, update or flag design impact, validate, prepare reviewable
output, and reconcile what changed. That loop is powerful, but it has real
overhead.

Good nodes therefore tend to be **larger than ordinary checklist tasks**. They
should represent the largest coherent unit of work that one worker can execute
with:

- enough context to reason well;
- clear in-scope and out-of-scope boundaries;
- an observable outcome;
- reviewable artifacts;
- explicit exports for downstream work when applicable.

Avoid creating a node for every field, button, endpoint, enum value, test pass,
or implementation phase unless that unit creates an independent confidence
transition.

### Independent confidence transitions

A proposed node is stronger when completion creates one of these confidence
states:

| Confidence type | Meaning |
|---|---|
| **Viability confidence** | The workstream knows whether a technical or product path is possible. |
| **Contract confidence** | Downstream workers can build against a stable interface, schema, decision, or semantic contract. |
| **Substrate confidence** | A real capability exists behind an interface, even if not fully surfaced everywhere yet. |
| **UX confidence** | The developer can inspect or use the behavior and judge whether it feels right. |
| **Integration confidence** | Adjacent systems can rely on the capability behaving coherently across boundaries. |
| **Operational confidence** | Failure, pause, cleanup, recovery, or safety paths are dependable enough for use. |
| **Operational-loop confidence** | A new human/agent/system loop works end-to-end with the intended roles, feedback, and authority boundaries. |
| **Export confidence** | Another node, wave, or workstream can consume a named output. |
| **Demonstration confidence** | The intended capability can be shown, exercised, or walked through in a way that validates the workstream's purpose. |

If a proposed node does not create one of these states, it is probably an
internal task inside a larger node.

### When to split

Split a work area into separate nodes when the split is likely to improve
throughput, safety, or clarity after accounting for launch, review, merge, and
reconciliation cost.

Good split reasons include:

- **Stable contract boundary:** one node can export a contract another worker can
  consume without waiting for all implementation details.
- **Safe parallelism:** two workers can proceed at the same time under a stable
  contract without stepping on each other.
- **Different expertise or role:** the work calls for meaningfully different
  context, such as runtime substrate work versus UI feel.
- **Independent validation:** one result needs developer approval before riskier
  downstream work proceeds.
- **External dependency boundary:** progress waits on access, approval, platform
  behavior, or another team.
- **Failure isolation:** speculative or risky work should not be bundled with
  straightforward integration.
- **Context limit:** one worker would need too much codebase or design context to
  do the combined mission well.
- **Separately consumable output:** another node, wave, or workstream can use one
  output even if the rest of the workstream is not done.

Parallelism is a first-class reason to split. "Can be listed separately" is not.

### When to keep work together

Keep related work in one node when the pieces must be reasoned about together to
produce a coherent outcome.

Work usually belongs together when:

- the pieces are lifecycle states of one behavior;
- the output is not useful until the pieces are combined;
- splitting would force workers to re-litigate the same design choices;
- the dependency contract between the pieces is unstable or mostly imaginary;
- coordination cost would outweigh wall-clock speedup;
- review would have to understand the combined behavior anyway.

For example, "add a status enum," "persist runtime metadata," and "surface PR
ready state" may be real implementation tasks, but they may belong inside one
"managed runtime lifecycle" node if the confidence transition is the coherent
lifecycle behavior.

### Node sizing test

A well-shaped node should usually satisfy this sentence:

> After this node lands, **{specific downstream actor}** can now **{rely on,
> inspect, decide, or build}** **{specific durable thing}**.

Examples:

- After a capability research node lands, the developer can decide whether the
  workstream should proceed on the proposed substrate.
- After a contract-design node lands, implementation workers can build without
  re-litigating lifecycle semantics.
- After a runtime-substrate node lands, UI workers can consume real state through
  an agreed interface.
- After a monitoring UI node lands, the developer can judge whether visibility is
  sufficient for non-terminal execution.
- After a closure/export gate passes, a downstream workstream can depend on the
  exported contract.

If the sentence is hard to fill in, the proposed node is probably too small, too
internal, or not shaped enough.

## Formation checklist

When forming or reshaping a workstream, ask:

1. What confidence transition does each wave create?
2. What confidence transition does each node create?
3. Who consumes each result: developer, worker, gate, downstream node, or
   downstream workstream?
4. Is each node a mission-type order, or is it just a checklist item?
5. Would one worker have enough context to execute each node coherently?
6. Would splitting unlock safe parallelism that survives coordination cost?
7. Does a node need a gate before downstream work proceeds?
8. What stable export, if any, must downstream work be able to reference?
9. Are later-wave node breakdowns still hypotheses that should be revisited at
   promotion time?
10. Does a node belong in the current wave as parallel/internal work, or does it
     create a distinct confidence plateau that should wait for a later wave?
11. Does each wave need a gate, or is a checkpoint-only transition sufficient?
     Why?
12. Does Wave 1 begin after formation with executable work, rather than spending
    a wave or node on forming the workstream itself?
13. For non-trivial work, should Wave 1 establish design, contract, validation,
    or authority confidence before later implementation proceeds autonomously?
14. What validation loop, harness, scenario, or playbook will harden the result
    before final acceptance?
15. How will the final workstream outcome be demonstrated or walked through?
16. If this workstream creates a new operating primitive, what smallest real use
    proves the primitive without absorbing every downstream consumer?

The orchestrator can bias toward fewer, heavier nodes during formation, then
split later-wave sketches when real complexity, contract boundaries, or safe
parallelism become clearer.
