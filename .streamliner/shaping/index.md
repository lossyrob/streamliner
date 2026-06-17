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

> **2026-06 coverage partition.** Candidates are organized into a settled partition of owned
> workstreams plus downstream/parked work. Each candidate carries a `## Coverage Partition`
> section with its workstream id, owned contract, and seams. See the per-candidate notes for detail.

### Core + foundational workstreams

| Candidate | Stage | Coverage role |
|---|---|---|
| [Workstream Format & Coverage Substrate](candidates/workstream-format-coverage-substrate.md) | Shaped | **WS-A (NEW, foundational)** — graph.json schema, waves-as-objects, node kind/size, debt/deferral, artifact slots, validate-on-load. Absorbs #125, #7, #120. |
| [Role & Context Packages](candidates/streamliner-agent-skill-context.md) | Shaped | **Foundational** — designer/orchestrator/worker/closure role + context packages. Consumed by WS-C/WS-D/WS-E. |
| [Workstream Design Altitude](candidates/workstream-design-mode.md) | Shaped | **WS-B** — design doc above the brief, top-level shareable workstream issue, project=portfolio language. |
| [Session Actor Control Plane](candidates/session-actor-control-plane.md) | Seeded | **WS-C** — local actor fabric + bound orchestrator. **Adopts Telex** as transport. |
| [Node Handoff, Boundary Pressure & Reconciliation](candidates/worker-hot-work-reconciliation.md) | Shaped | **WS-D** — field reports, boundary pressure/split requests, node-level deferral→debt, reconciliation. Builds on #114. |
| [Project Surface & Orientation](candidates/project-surface-and-issue-launches.md) | Shaped | **WS-E** — owns the Project boundary; orientation view (early wave); issue launches (later wave). |
| [Checkpoint and Closeout Experience](candidates/checkpoint-closeout-experience.md) | Shaping | **WS-F** — gate validation, closeout batch node, no-open-debt gate. Folds validation playbooks; operationalizes #114. |
| [Cross-Workstream Dependencies & Geometry](candidates/multi-workstream-dependencies.md) | Shaped | **WS-G** — import/export/availability + external blockers. Consumes Project from WS-E. |

### Downstream candidates (consume a core workstream)

| Candidate | Stage | Coverage role |
|---|---|---|
| [Work Geometry Canvas](candidates/work-geometry-canvas.md) | Shaping | **Downstream of WS-G** — renders the dependency/availability model; visual spikes available. |
| [Session Attention Widget](candidates/session-attention-widget.md) | Seeded | **Downstream of WS-C** — attention/lifecycle surfaces (#122); Telex attention-level convergence. |
| [Workstream Closeout Narrative](candidates/workstream-closeout-narrative.md) | Seeded | **Associated with WS-F** — optional long-form artifact; MVP runbook ships standalone. |

### Consolidated (folded into a workstream; historical pointers)

| Candidate | Stage | Coverage role |
|---|---|---|
| [External Dependency Tracking](candidates/external-dependency-tracking.md) | Consolidated | → **WS-G** (external/non-workstream blockers). |
| [Convergent Validation Playbooks](candidates/convergent-validation-playbooks.md) | Consolidated | → **WS-F** (validation-loop wave). |

### Parked / out of scope

| Candidate | Stage | Coverage role |
|---|---|---|
| [Autonomous Wave Progression](candidates/autonomous-wave-progression.md) | Parked | Resume after PAW track + WS-C + WS-F. |
| [Automated PAW Review Loop](candidates/automated-paw-review-loop.md) | Out of scope | Handled on the separate PAW track. |

### In-flight / promoted (unchanged by this refactor)

| Candidate | Stage | Coverage role |
|---|---|---|
| [Documentation System](candidates/documentation-system.md) | Promoted | Formed under `.streamliner/workstreams/documentation-system/`. |
| [SDK-Managed Worker Runtime](candidates/sdk-managed-worker-runtime.md) | Promoted | Formed; WS-C coordinates/imports the managed runtime. |
| [Streamliner Performance and Robustness](candidates/streamliner-performance-robustness.md) | Seeded | Operational hardening; tracked separately. |

> **Not dropped — tracked elsewhere.** Managed-runtime open issues (#85/#95/#98), devbox spikes
> (#15/#23/#24/#27/#28/#26), and the distributed-control-plane north star (#102/#123, cross-env
> devbox/WSL) belong to their existing workstreams or the north-star track, not to this partition.

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
