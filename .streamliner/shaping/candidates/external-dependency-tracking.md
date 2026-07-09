# External Dependency Tracking

## Stage

Seeded

## Seed Idea

Represent dependencies that are not produced by another Streamliner workstream: approvals, access grants, PM or design decisions, internal platform processes, external resource readiness, vendor/team responses, or other events the builder does not directly control.

Examples:

- Waiting for identity approval before using an internal resource.
- Waiting for a PM to decide product behavior.
- Waiting for a design decision owned by another team.
- Waiting for access to data, environment, service, or credentials.
- Waiting for an upstream process to produce an artifact.

## Why It Matters

Streamliner can model workstream-to-workstream dependencies through imports and exports, but real work also waits on outside processes. If those dependencies stay in chat or memory, the builder loses the operational picture: workstreams appear blocked without a visible reason, downstream planning cannot account for the delay, and the eventual arrival of an external artifact is easy to miss.

External dependencies should become part of the work geometry without pretending every external actor is a Streamliner workstream.

## Initial Framing

An external dependency is like an import whose producer is outside Streamliner.

It should answer:

- What are we waiting for?
- Who or what owns it?
- Which workstream, node, checkpoint, or gate is blocked by it?
- What evidence or artifact will prove it has landed?
- What should happen when it lands?
- Is there a workaround, expiry, escalation path, or follow-up?

## Candidate Scope

### In Scope

- Define a representation for external dependencies that can block workstreams, nodes, checkpoints, or gates.
- Distinguish external dependencies from cross-workstream imports/exports.
- Define statuses for external dependencies such as requested, waiting, landed, validated, stale, blocked, or superseded.
- Define how an external dependency records owner/provider, links, expected artifacts, unblock criteria, and affected work.
- Explore how Streamliner should notify or surface that an external dependency landed.
- Explore how landed evidence should be recorded for reconciliation and downstream planning.

### Out of Scope

- Replacing external systems as the authority for approvals, PM decisions, identity workflows, or project management.
- Automatically integrating with every external dependency source in the first slice.
- Treating external stakeholders or systems as fake workstreams.

### Deferred

- Automated polling from Microsoft 365, GitHub, internal approval systems, or chat tools.
- Escalation workflows and reminder cadences.
- Portfolio-level dependency dashboards across unrelated projects.

## Dependencies

### Depends On

- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because external dependencies should reuse import/export thinking where appropriate while distinguishing non-workstream providers.

### Enables

- [Work Geometry Canvas](work-geometry-canvas.md), because external blockers may need to render alongside cross-workstream dependencies.

### Related Candidates

- [Workstream Design Mode](workstream-design-mode.md), because shaping sessions should capture dependencies that are outside the builder's control.

## Workstream Shape

This may be workstream-sized if it grows into a general dependency model across workstream artifacts, runtime status, notifications, and UI. A narrow first slice could be smaller: manually record an external dependency on a node/workstream, show it as a blocker, and mark it landed with links/evidence.

## Exported Interfaces and Dependencies

Potential exports:

- External dependency data model.
- Status vocabulary for non-workstream dependencies.
- UI pattern for external blockers in single-workstream and project-scoped views.
- Reconciliation behavior for "dependency landed, update affected work."

Potential imports:

- Import/export semantics from Multi-Workstream Dependencies.
- Project-scoped rendering from Work Geometry Canvas.

## Open Questions

- Should external dependencies live in the workstream graph, project metadata, runtime state, or a hybrid?
- Should external dependencies attach to nodes, checkpoints, gates, workstreams, or project-level planning?
- What is the minimal manual workflow before any automation exists?
- Which external dependency sources should Streamliner eventually poll or summarize?

## Handoff Brief

Not ready yet. Shape whether this is a small extension to dependency semantics, a UI/workflow feature, or a full workstream around external dependency tracking.
