# Streamliner Document Index

> Entry point for agents and developers who need to understand Streamliner's
> product direction, operating model, and artifact formats.
>
> Point an agent at this file. It can then decide which documents to load
> based on what context it needs.

## Product direction

| Document | What it covers |
|---|---|
| [PRODUCT-THESIS.md](PRODUCT-THESIS.md) | **Start here.** Why Streamliner exists: execution compression relocates the bottleneck from doing work to designing work geometry. The three-stage cognitive transition (task conductor → workstream architect → portfolio operator), the failure modes of poorly designed parallel work, and what Streamliner is for. |
| [PRODUCT-SPEC.md](PRODUCT-SPEC.md) | The full product specification: who it's for, core concepts (design layer, workstreams, work geometry, briefs, nodes, waves, context package, attention levels), the three pillars, operating rhythm, architecture, V1 scope, and open questions. |
| [PORTFOLIO-LAYER.md](PORTFOLIO-LAYER.md) | Working draft for the product layer above individual workstreams: startup shell, cross-workstream coordination through public checkpoints, session visibility across environments, ad-hoc session handling, and UI direction. |
| [CAMPAIGNS.md](CAMPAIGNS.md) | The portfolio-level unit of committed work: a campaign is an intent-bounded group of workstreams (plus side issues) shaped together to cover a declared body of intent. Covers the hierarchy (project → campaign → workstream → wave → node), intent- vs time-bounding (campaigns vs releases), concurrency and the main effort, the campaign as a lens over the candidate backlog, and the consolidation cycle. |

## Operating model

| Document | What it covers |
|---|---|
| [DOCTRINE.md](DOCTRINE.md) | How the operating model makes workstream-level thinking work in practice. Roles (developer, orchestrator, worker), the Layer 0–3 context package, information flow through artifacts, presence and engagement spectrum, the operating rhythm (shape → execute → wave transition → gate review), feedback loops, context authority, and design influences from military command doctrine. |
| [ORCHESTRATION.md](ORCHESTRATION.md) | How workstream-level orchestration happens when interactive sessions, SDK-backed tasks, UI actions, runtime state, and artifact reconciliation coexist. Orchestration as a workstream function rather than a single session's authority, with reconciliation as work-geometry feedback. |
| [WORKSTREAM-DESIGN.md](WORKSTREAM-DESIGN.md) | Working philosophy for shaping Streamliner work geometry: confidence transitions, sequential waves, parallel nodes, PAW-sized worker missions, validation-loop waves, demonstration gates, and split/merge heuristics. |
| [VALIDATION-LOOPS.md](VALIDATION-LOOPS.md) | Operating guidance for validation-loop waves: realistic exercise, discovered gaps, bounded repairs, reruns, earned confidence, and gate evidence. |
| [HOT-WORK.md](HOT-WORK.md) | The phase-change moment when steady autonomous execution gives way to rapid, high-context developer–agent iteration. What hot work is, why it's a named concept, and how the operating model accounts for it. |

## Artifact formats and references

| Document | What it covers |
|---|---|
| [WORKSTREAM-FORMAT.md](WORKSTREAM-FORMAT.md) | Reference specification for workstream artifacts: the brief (`brief.md`), the dependency graph (`graph.json`), node specs, runtime state separation, layout options, update semantics, and full examples. |
| [NODE-SPEC-FORMAT.md](NODE-SPEC-FORMAT.md) | How to write a Layer 3 node spec — the issue body or local spec file that a worker session executes from. Standard sections, rules for alignment with the doctrine, and anti-patterns. |
| [DESIGN-DOCS.md](DESIGN-DOCS.md) | The project-level design layer: why it exists, core model (intended state not implementation snapshots), document families (design index, living design docs, decision records), frontmatter format, status semantics, derived catalog, workstream interaction, and context package integration. |

## Temporary role prompts

| Document | What it covers |
|---|---|
| [.streamliner/roles/project-workstream-designer.md](.streamliner/roles/project-workstream-designer.md) | Temporary prompt package for sessions that shape ambiguous intent into candidate workstreams, boundaries, dependencies, and handoff briefs. |
| [.streamliner/roles/workstream-creator.md](.streamliner/roles/workstream-creator.md) | Temporary prompt package for sessions that turn one shaped candidate into executable workstream artifacts, gates, checkpoints, and first-wave specs or issues. |

## Planning and roadmap

| Document | What it covers |
|---|---|
| [WORKSTREAM-ROADMAP.md](WORKSTREAM-ROADMAP.md) | Suggested next waves of Streamliner workstreams: what makes a good workstream boundary, Wave 1 (dev box observability, portfolio shell, graph session overlays), Wave 2 (WSL observability, session curation, launch/recovery), parallelization model through exported checkpoints, and rules of thumb. |

## Design docs (under `docs/design/`)

The repo-scoped design layer lives under `docs/design/`. Start with
[docs/design/index.md](docs/design/index.md) for the reading order and
satellite document list.
