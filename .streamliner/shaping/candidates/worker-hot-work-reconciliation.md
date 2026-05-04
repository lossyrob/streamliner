# Worker Hot Work and Reconciliation

## Stage

Seeded

## Seed Idea

Define how worker sessions should understand and support hot work: work that expands beyond a narrow issue or node boundary while still staying inside the broader workstream boundary. Workers should not reflexively push back on all additional work; they should understand how to evaluate boundaries, communicate scope changes, and give reconciliation enough information to update downstream issues or graph nodes.

This should also feed into end-of-workstream closure review: the orchestrator needs to inspect hot work and reconciliation history before closing a final workstream PR, especially when the final PR includes multiple completed node issues.

## Why It Matters

## Candidate Scope

### In Scope

### Out of Scope

### Deferred

## Dependencies

### Depends On

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because this behavior likely belongs in worker role guidance.
- [Workstream Design Mode](workstream-design-mode.md), for the shaping and handoff conventions.

### Enables

- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because hot work may reveal or alter downstream dependencies.

### Related Candidates

- [Documentation System](documentation-system.md), because the behavior may need to be documented for both users and agents.

## First Useful Slice

## Open Questions

- How should a worker distinguish acceptable hot work inside the workstream boundary from scope creep outside it?
- What exact change summary should a worker provide so reconciliation can update downstream issues?
- Should hot work require an explicit marker in the final response, a structured artifact, or graph metadata?
- What evidence should the orchestrator review at workstream close to confirm hot work was reconciled correctly?

## Handoff Brief
