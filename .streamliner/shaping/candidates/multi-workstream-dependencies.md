# Multi-Workstream Dependencies

## Stage

Seeded

## Seed Idea

Design how Streamliner represents multiple workstreams that have dependencies between them. This includes dependency metadata, orchestration roles, UI affordances, and the flow of checkpoint exports from one workstream into another.

Example dependency: the Agent/Skill Context workstream defines orchestrator-helper requirements for launching workers. The Distribution/Integration workstream must export a stable `streamliner launch-node` command/API contract, and the Session Launching workstream must export the underlying API-first launch pipeline. This is a cross-workstream dependency at the checkpoint/export level, not merely a loose related-work note.

## Why It Matters

Streamliner already models checkpoints inside one workstream, but cross-workstream coordination needs a way to say what another workstream can actually consume. A checkpoint says "this moment happened"; an export says "this usable thing is now available." Without that distinction, cross-workstream edges become vague whole-workstream dependencies that are hard to display, validate, or reconcile.

## Checkpoints, Exports, and Imports

### Checkpoint

A checkpoint is a named progress milestone inside a workstream. Existing Streamliner graphs model checkpoints as optional organizational markers that group related nodes and have planned/completed status.

In cross-workstream geometry, a checkpoint answers:

- What milestone has the workstream reached?
- Which wave or set of nodes does this summarize?
- Is this a moment where downstream work can inspect progress?
- Does this require builder validation before downstream work proceeds?

Checkpoints are about **time/progress/state**.

### Export

An export is a named output from a workstream that another workstream can consume.

Examples:

- stable CLI command contract: `streamliner launch-node`;
- schema or config shape;
- design decision or accepted design-doc update;
- architecture/user-guide documentation convention;
- implementation capability;
- generated artifact;
- launch/session identifier contract;
- role-helper manifest;
- checkpoint report or gate decision.

Exports are about **consumable interface/output**.

### Import

An import is the consuming side of an export: a dependency that says this workstream needs a specific output from another workstream.

Imports should be explicit about what is needed and why. "Depends on Distribution workstream" is less useful than "imports `streamliner launch-node` command contract from Distribution."

### Relationship

A checkpoint can produce zero, one, or many exports. An export can be created by a checkpoint, validated by a gate, or exist as a durable artifact produced by normal task work.

Cross-workstream edges should usually connect **import -> export**, with checkpoint/gate context used for visualization and status.

```text
Workstream A
  Checkpoint: CLI launch contract stable
    Export: streamliner launch-node command contract

Workstream B
  Import: orchestrator helper can launch node workers
    depends on Export: streamliner launch-node command contract
```

In the UI:

- The all-workstreams canvas can draw dotted lines between imports and exports, visually anchored to the checkpoints/gates that produce or validate them.
- The single-workstream graph can show an external dependency badge on the importing wave/checkpoint/node, including the producing workstream and export status.
- Whole-workstream dependencies should be a fallback for early shaping, not the ideal long-term representation.

### Gate

A gate is a checkpoint that requires builder judgment before the export should be considered safe for downstream consumption.

For example, a CLI command may exist technically, but the "Orchestrator can launch workers via CLI" export may not be consumable until a gate validates safety, diagnostics, and user experience.

## Branching and Export Availability

Branching strategy changes the meaning of an export. If every workstream lands directly on `main`, then an export becomes broadly consumable when it is merged. If each workstream accumulates work on a feature branch, an export may exist before it is globally integrated.

Streamliner should therefore model not only **what** an export is, but also **where** it is available and how safe it is to consume.

### Branching modes

| Mode | Shape | Strengths | Geometry risk |
|---|---|---|---|
| Mainline node PRs | Each worker PR targets `main`; exports become real when merged. | Simplest import/export semantics; downstream work consumes integrated code. | Hard when review attention is scarce or workstream changes are large/incomplete. |
| Workstream feature branch | Worker PRs target a workstream branch; final workstream PR targets `main`. | Lets a large workstream build coherently before final review. | Exports are branch-local until merged; downstream workstreams may need to consume unmerged branches. |
| Integration branch / stack | Multiple related workstream branches merge into an integration branch before `main`. | Useful for tightly coupled workstreams. | Adds another artifact surface and can hide divergence from `main`. |
| Contract-first mainline | Exported contracts land on `main` early behind flags/stubs while implementation continues on branches. | Downstream work can build against stable contracts. | Requires discipline to keep contracts honest and not over-stub. |

### Export availability states

An export should have an availability state separate from its conceptual definition:

| State | Meaning | Consumer behavior |
|---|---|---|
| Proposed | The export is shaped but not implemented. | Consumers can plan around it but should not execute against it. |
| Branch-local | The export exists on a workstream branch. | Consumers can import it only if they intentionally base on or reference that branch. |
| Preview | The export is available through a preview artifact, package, docs draft, API preview, or integration branch. | Consumers can experiment but should treat it as unstable. |
| Mainline | The export is merged to `main` and available to ordinary downstream work. | Consumers can depend on it normally. |
| Validated | The export has passed a gate or compatibility check. | Consumers can treat it as safe for downstream waves. |
| Superseded | The export was replaced or abandoned. | Consumers must migrate or remove dependency. |

### Recommended model

The best default is a hybrid:

1. Prefer mainline exports for stable contracts, schemas, docs conventions, and small product seams.
2. Allow workstream feature branches for large coherent bodies of work.
3. Treat feature-branch outputs as **branch-local exports** until merged or explicitly promoted to preview/mainline.
4. Let downstream workstreams import branch-local exports only when the dependency is explicit and visible.
5. Use gates/checkpoints to promote exports from branch-local or preview to validated/mainline consumption.

This preserves the benefits of workstream feature branches without pretending that unmerged work is globally available.

### UI implications

The all-workstreams canvas should show not only that Workstream B imports Export X from Workstream A, but also where Export X currently lives:

- `main` / merged;
- workstream branch;
- integration branch;
- preview artifact;
- draft docs/design;
- unavailable/proposed.

The single-workstream view should make external branch dependencies visible. For example:

```text
External import: streamliner launch-node command contract
Producer: Distribution/Integration #40
Availability: branch-local on feature/distribution-cli
Status: preview; not merged to main
Risk: this workstream must either target that branch, wait for merge, or use a contract stub.
```

This turns branching into part of the work geometry rather than an invisible git detail.

### Practical guidance

When review attention is scarce and workstreams are large, a workstream branch is reasonable. But cross-workstream exports should be made explicit:

- If another workstream only needs the **contract**, land the contract on `main` early if possible.
- If another workstream needs unmerged **implementation**, model that as a branch-local import and show the risk.
- If several workstreams need to converge before `main`, create an explicit integration branch/checkpoint rather than ad-hoc rebasing.
- Final workstream review should validate that exported contracts, docs, and downstream imports still match what actually shipped.

## Candidate Scope

### In Scope

### Out of Scope

### Deferred

## Dependencies

### Depends On

- [Workstream Design Mode](workstream-design-mode.md), because candidate-workstream dependency detection is a precursor to durable cross-workstream dependency modeling.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because reconciliation may modify downstream workstream dependencies as hot work changes scope.

### Enables

- [Work Geometry Canvas](work-geometry-canvas.md), because the canvas needs a dependency model to render.

### Related Candidates

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because a higher-level designer or portfolio agent may need to reason across workstreams.

## First Useful Slice

## Open Questions

- Is the workstream design session also the orchestrator for the workstream being designed, or is it a distinct higher-level role?
- What metadata should represent a dependency between workstreams?
- How should checkpoint exports/imports be represented?
- Which dependency relationships belong in committed artifacts versus runtime state?
- Should cross-workstream edges connect to workstreams, waves, checkpoints, explicit exports, or individual nodes?
- How should a single-workstream graph display an external dependency and its status?

## Handoff Brief
