# Workstream Shaping

This directory holds nascent workstream ideas before they are promoted into full Streamliner workstreams. Shaping notes are working artifacts: they capture fuzzy intent, clarify boundaries, record cross-workstream dependencies, and mature into issue or orchestrator handoff briefs.

Shaping notes are not project-level design authority. Durable product and architecture intent still belongs in `docs/design/`; executed work belongs in `.streamliner/workstreams/`.

## Lifecycle

| Stage | Meaning | Expected content |
|---|---|---|
| Seeded | A candidate idea has been noticed but not deeply discussed. | Title, seed idea, and maybe initial relationships. |
| Shaped | The candidate has been intentionally discussed. | Scope, non-goals, first useful slice, and open questions. |
| Connected | Dependencies with other candidates or workstreams have been identified. | Depends on, enables, and related candidates. |
| Ready for issue | The candidate has enough clarity to hand to execution. | Handoff brief suitable for a tracker issue or orchestrator prompt. |
| Promoted | The builder chooses to execute the work. | A real workstream under `.streamliner/workstreams/` and/or a tracker issue. |

## Current candidates

| Candidate | Stage | Summary |
|---|---|---|
| [Workstream Design Mode](candidates/workstream-design-mode.md) | Shaped | Dogfood this session as a mode for turning ambiguous intent into candidate workstreams, dependency maps, and handoff briefs. |
| [Documentation System](candidates/documentation-system.md) | Shaped | Unified docs site plus Streamliner product support for design, architecture, and user-guide doc families. |
| [Streamliner Agent and Skill Context](candidates/streamliner-agent-skill-context.md) | Shaped | Define Streamliner role context for designer, orchestrator, worker, closure review, and helper distribution edges. |
| [Worker Hot Work and Reconciliation](candidates/worker-hot-work-reconciliation.md) | Seeded | Teach worker sessions how to handle hot work inside workstream boundaries and communicate downstream impact. |
| [Multi-Workstream Dependencies](candidates/multi-workstream-dependencies.md) | Seeded | Represent dependencies across workstreams in metadata, orchestration, and UI. |
| [Work Geometry Canvas](candidates/work-geometry-canvas.md) | Seeded | Visualize multiple connected workstreams and their dependency/export geometry on one canvas. |

## Operating notes

- Create a candidate note as soon as a distinct workstream idea appears.
- Keep early notes intentionally sparse; do not force clarity before discussion.
- Record dependencies as they are discovered, even if the dependent candidate is still only seeded.
- Rewrite notes in place as understanding changes.
- Promote only the first useful slice, not the entire concept space.
