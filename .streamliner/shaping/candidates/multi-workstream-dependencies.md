# Cross-Workstream Dependencies & Geometry

## Stage

Shaped; reframed under 2026-06 coverage partition (cedes Project to WS-E; folds external deps).

## Coverage Partition (2026-06 refactor)

**Workstream:** WS-G — Cross-Workstream Dependencies & Geometry. **Owns (C6-export):** the
import/export model, export **availability** states, and the project-scoped dependency graph.
**Folds in:** External Dependency Tracking (`external-dependency-tracking.md`) for non-workstream
blockers (approvals, access, decisions).

**Project ownership CEDED to WS-E:** the "Project grouping" content below is now a **consumer** of
the Project boundary owned by WS-E Project Surface — not an owner. Treat those sections as
historical context; the durable Project owner is WS-E.

**Depends on:** WS-A (schema fields), WS-E (Project frame). **Enables:** Work Geometry Canvas
(downstream renderer of this model).

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

## Artifact Authority Boundary

The dependency model should keep the durable source of truth close to the work it describes:

- **Exports live with the producing workstream.** A workstream declares the outputs it intends to make consumable: contracts, docs conventions, implementation capabilities, schemas, decisions, checkpoint results, or branch-local previews.
- **Imports live with the consuming workstream.** A workstream declares which external exports it needs and why.
- **Project metadata frames the search space.** It says which workstreams are related enough to scan together, which repos participate, and which unrelated or archived workstreams should stay out of the view.
- **Runtime state derives and enriches.** Streamliner can scrape exports/imports across active workstreams at runtime, resolve statuses, detect missing providers, show availability, and help shape new workstreams around existing or proposed exports.

This lets shaping sessions discover useful hooks: when a new candidate workstream is being shaped, Streamliner can surface exports that existing workstreams have promised or produced, making it easier to connect new work to existing work geometry.

The Project should not become the only place dependencies live. It should provide the frame and optional indexes; workstreams remain self-describing.

## Project Grouping

Multi-workstream dependencies need a boundary for "which workstreams can reasonably appear together." Rendering every workstream Streamliner has ever tracked would be noise, and cross-workstream edges only make sense inside some shared domain of work.

Streamliner already has adjacent concepts:

- `.streamliner/config.json` describes a Streamliner project: workstreams directory plus participating repos.
- `graph.json.projectKey` provides a stable namespace for routing and runtime state.
- The tracked workstream registry uses `/workstreams/{projectKey}/{workstreamId}`.
- Decision 007 intentionally made the registry a portfolio-shell step without introducing project grouping or cross-workstream coordination.

This workstream should promote a first-class **Project** grouping concept.

Naming decision: use **Project** for the grouping boundary of related workstreams. Use **Portfolio** only for the builder's broader collection of projects.

Rationale:

- A project is the natural scope for related workstreams that can depend on each other.
- A project can span multiple repositories, so it is not the same as a source repo.
- A portfolio sounds like the builder-level collection of projects, including unrelated efforts that should not render on the same work-geometry canvas by default.
- Existing `projectKey` language already points in this direction.

### Proposed concept

A Project is a committed or configured grouping boundary for related workstreams. It can span multiple repositories and is not the same as a Git repository.

Project responsibilities could include:

- name, id, and description for a body of related work;
- participating repositories and their roles;
- workstreams included in the project view;
- default design/docs locations;
- project-level dependency index or derived dependency cache;
- active/archived workstream status;
- cross-workstream import/export visibility rules;
- branch/integration strategy conventions for the project.

### Relationship to workstreams

Workstreams should remain self-describing: exports live with producing workstreams, imports live with consuming workstreams. A Project should not become the only place where dependencies are defined.

Instead, the Project can provide the **frame**:

- which workstreams should be scanned together;
- which repos participate;
- which imported/exported edges should be rendered together;
- which archived or unrelated workstreams should be excluded by default;
- where project-level metadata or derived indexes live.

### Possible storage models

| Model | Description | Tradeoff |
|---|---|---|
| Existing config grows | Extend `.streamliner/config.json` to include project metadata and dependency/index settings. | Simple, but config may become too broad. |
| Project file | Add a committed `.streamliner/project.json` or `streamliner.json` that owns grouping metadata. | Clear project boundary, but new schema. |
| Runtime source grouping | Keep grouping in local tracked-workstream registry state. | Good for local navigation, weak for shared work geometry. |
| Hybrid | Committed project config defines durable grouping; runtime registry tracks local discovery, health, and archive state. | Most flexible, but needs clear authority boundaries. |

Recommended direction: hybrid. Durable project grouping and dependency intent should be committed/configured; local discovery, scan health, archive state, and source paths stay runtime-local.

### UI implications

The single-workstream view can use the Project frame to show external dependencies only from relevant related workstreams.

The all-workstreams canvas should probably be a project-scoped view first:

```text
Project: Streamliner
  Repos: streamliner, plugin/distribution repo if separate
  Active workstreams:
    Documentation System
    Agent/Skill Context
    Worker Hot Work and Reconciliation
    Multi-Workstream Dependencies
    CLI / Distribution / Integration
```

The user should be able to switch projects rather than seeing unrelated workstreams on the same canvas. A later portfolio-level view may summarize multiple projects, but it should not be the default dependency-resolution frame.

## Candidate Scope

### In Scope

- Define a durable import/export model across workstreams.
- Define the relationship between checkpoints, gates, exports, and imports.
- Define export availability states, including proposed, branch-local, preview, mainline, validated, and superseded.
- Define how project grouping frames which workstreams are scanned and rendered together.
- Define the authority boundary between workstream artifacts, project metadata, and runtime-derived dependency views.
- Define how a single-workstream view should surface external dependencies at a high level.

### Out of Scope

- Building the full all-workstreams canvas UI; this belongs to [Work Geometry Canvas](work-geometry-canvas.md).
- Fully specifying the final JSON schema; the formation/orchestrator session can decide implementation details.
- Replacing each workstream's graph as the local source of truth for its own plan.

### Deferred

- Automated dependency inference from diffs or PRs.
- Rich dependency health scoring.
- Cross-project dependency visualization.
- Branch/integration automation beyond representing availability.

## Dependencies

### Depends On

- [Workstream Design Mode](workstream-design-mode.md), because candidate-workstream dependency detection is a precursor to durable cross-workstream dependency modeling.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because reconciliation may modify downstream workstream dependencies as hot work changes scope.

### Enables

- [Work Geometry Canvas](work-geometry-canvas.md), because the canvas needs a dependency model to render.

### Related Candidates

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because a higher-level project workstream designer may need to reason across workstreams.

## Workstream Shape

This should be a workstream-sized effort to make cross-workstream dependencies first-class enough for orchestration and UI rendering.

Likely work areas:

- Add or design import/export fields for workstream artifacts.
- Define project grouping and how it relates to existing `projectKey`, config, and registry state.
- Derive a project-scoped dependency graph by scraping workstream imports/exports.
- Surface external dependency status inside a single-workstream graph.
- Track export availability across proposed, branch-local, preview, mainline, validated, and superseded states.
- Provide enough derived data for the Work Geometry Canvas workstream to render project-scoped multi-workstream geometry.

## Open Questions

- Should project/grouping metadata live in existing `.streamliner/config.json`, a new committed project file, runtime registry state, or a hybrid?
- What is the minimum schema needed for exports/imports before the Work Geometry Canvas can build on it?
- How much of export availability should be committed artifact state versus derived runtime state?

These are formation-time design questions, not blockers for shaping. The core product direction is settled enough: dependencies should mature from vague workstream-level edges into explicit import/export edges, framed by Projects and enriched by runtime discovery.

## Handoff Brief

Create a Multi-Workstream Dependencies workstream.

The workstream should make cross-workstream dependencies first-class enough for Streamliner to reason about, reconcile, and eventually render. It should define a durable model for **imports**, **exports**, **checkpoints**, **gates**, and **export availability**. A checkpoint is a progress milestone; an export is a consumable output; an import is the consuming workstream's dependency on a specific export. Whole-workstream dependencies can remain an early-shaping fallback, but the model should prefer explicit `import -> export` edges once work is concrete.

The workstream should introduce **Project** as the grouping boundary for related workstreams. A Project can span multiple repositories and should frame which workstreams are scanned, rendered, and considered relevant for dependency resolution. Use **Portfolio** only for the builder's broader collection of projects, not the default work-geometry or dependency-resolution scope.

The workstream should preserve artifact authority boundaries:

- exports live with the producing workstream;
- imports live with the consuming workstream;
- project metadata frames scan/render scope and participating repos;
- runtime state derives and enriches status, availability, conflicts, missing providers, and archive/source health.

The workstream should model export availability separately from export definition. Initial states should include proposed, branch-local, preview, mainline, validated, and superseded. Branch-local exports are especially important because large workstreams may accumulate changes on feature branches before merging to `main`, and downstream workstreams need to know when they are depending on unmerged or preview work.

Expected implementation/design areas:

- define the import/export schema shape for workstream artifacts;
- define how checkpoints and gates produce, validate, or summarize exports;
- decide whether Project metadata extends existing `.streamliner/config.json`, uses a new committed project file, relies on runtime source grouping, or adopts a hybrid model;
- derive a project-scoped dependency graph by scanning related workstreams;
- surface external dependencies and availability inside a single-workstream graph;
- provide the minimum derived data needed for the Work Geometry Canvas workstream to render project-scoped multi-workstream geometry.

This workstream imports shaping conventions from Workstream Design Mode and hot-work reconciliation expectations from Worker Hot Work and Reconciliation. It exports dependency semantics that the Work Geometry Canvas can render and that Agent/Skill Context can use when designer/orchestrator roles reason across workstreams.
