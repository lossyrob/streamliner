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

> For how a subset of these candidates is grouped into the current campaigns (and
> which is the main effort), see [ROADMAP.md](../../ROADMAP.md). Candidates are the
> durable backlog; the roadmap selects and shapes a subset without modifying them.

| Candidate | Stage | Summary |
|---|---|---|
| [Workstream Format & Coverage Substrate](candidates/workstream-format-coverage-substrate.md) | Shaped | Foundational substrate: a canonical `graph.json` JSON Schema with validate-on-load, waves as first-class objects, node kind/size, debt/deferral state, and artifact-attachment slots. |
| [Workstream Design Mode](candidates/workstream-design-mode.md) | Shaped | Dogfood this session as a mode for turning ambiguous intent into candidate workstreams, dependency maps, and handoff briefs. |
| [Documentation System](candidates/documentation-system.md) | Promoted | Formed as `.streamliner/workstreams/documentation-system/`: unified docs site plus Streamliner product support for design, architecture, and user-guide doc families. |
| [Streamliner Agent and Skill Context](candidates/streamliner-agent-skill-context.md) | Shaped | Define Streamliner role context for designer, orchestrator, worker, closure review, and helper distribution edges. |
| [Worker Hot Work and Reconciliation](candidates/worker-hot-work-reconciliation.md) | Shaped | Support builder-directed hot work, PR/issue narration, and post-node reconciliation without worker guardrails. |
| [Multi-Workstream Dependencies](candidates/multi-workstream-dependencies.md) | Shaped | Define project-scoped import/export dependency semantics, availability states, and artifact authority boundaries. |
| [Work Geometry Canvas](candidates/work-geometry-canvas.md) | Shaping | Visualize multiple connected workstreams and their dependency/export geometry on one canvas; visual spikes are available for comparison. |
| [External Dependency Tracking](candidates/external-dependency-tracking.md) | Seeded | Represent approvals, access grants, stakeholder decisions, and other non-workstream blockers as part of work geometry. |
| [Automated PAW Review Loop](candidates/automated-paw-review-loop.md) | Shaping | Next-up after Session Launching: move former Wave 5 review automation into a dedicated review-orchestration workstream. |
| [Convergent Validation Playbooks](candidates/convergent-validation-playbooks.md) | Shaping | Add a validation-loop wave pattern that repeatedly runs executable validation playbooks, dispatches repair work from structured findings, and converges toward acceptance. |
| [SDK-Managed Worker Runtime](candidates/sdk-managed-worker-runtime.md) | Promoted | Formed as `.streamliner/workstreams/sdk-managed-worker-runtime/`: foundational SDK-managed graph-node runtime with local Wave 1 specs and export gate for Automated PAW Review Loop. |
| [Autonomous Wave Progression](candidates/autonomous-wave-progression.md) | Seeded | High-autonomy wave execution: SDK workers run nodes, PAW review hardens node PRs, a wave integrator merges into a wave branch, and the builder reviews at the wave gate. |
| [Project Surface and Issue Launches](candidates/project-surface-and-issue-launches.md) | Seeded | Add a first-class Project surface with project issue lists and PAW launch support for scoped GitHub issues that do not need full workstreams. |
| [Checkpoint and Closeout Experience](candidates/checkpoint-closeout-experience.md) | Shaping | Make checkpoints builder-facing validation surfaces; model closeout observations materializing into normal closeout batch nodes/issues before gates pass. |
| [Streamliner Performance and Robustness](candidates/streamliner-performance-robustness.md) | Seeded | Improve local API, multi-tab, backing-store, and background-worker responsiveness under real multi-workstream usage. |
| [Session Attention Widget](candidates/session-attention-widget.md) | Seeded | Provide tray/notification and always-on-top overlay surfaces for actionable session attention states outside browser tabs. |
| [Session Actor Control Plane](candidates/session-actor-control-plane.md) | Seeded | Treat selected terminal and SDK sessions as ephemeral, role-bound runtime actors with scoped autonomy, field reports, and local message/heartbeat semantics attached to work geometry. |
| [Workstream Closeout Narrative](candidates/workstream-closeout-narrative.md) | Seeded | Generate a chronological closeout narrative per workstream that an orchestrator session can produce on demand; consumed via an external GenAI podcast generator for zoomed-out reflection. |

## Operating notes

- Create a candidate note as soon as a distinct workstream idea appears.
- Keep early notes intentionally sparse; do not force clarity before discussion.
- Record dependencies as they are discovered, even if the dependent candidate is still only seeded.
- Rewrite notes in place as understanding changes.
- Promote workstream-shaped candidates into a focused formation session that creates the actual brief, graph, and initial issues.
- Keep promoted candidate notes as historical seed records and pointers to the
  formed workstream until Streamliner has a first-class candidate archive or
  lifecycle migration. Mark them `Promoted` and add a Promotion section rather
  than deleting them.
