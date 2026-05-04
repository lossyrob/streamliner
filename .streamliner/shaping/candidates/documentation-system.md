# Documentation System

## Stage

Shaped; ready to move on.

## Seed Idea

Define a clearer documentation system for Streamliner that separates project-level design docs from current architecture orientation and user-facing documentation. The current design docs capture intended system direction, but there may also need to be a high-level architecture map of the current codebase and MS Learn-style user documentation suitable for GitHub Pages.

## Why It Matters

Streamliner has multiple documentation audiences and authority layers that are starting to blur:

- Users need task-oriented guidance for installing, configuring, and operating Streamliner.
- Contributors and agents need a high-level current architecture map so they do not rediscover the codebase from scratch.
- Design docs need to remain the project-level intended-state authority that Streamliner can reliably surface as agent context.

Without a clearer taxonomy, documentation can drift into the wrong layer: user docs can become design authority, design docs can become implementation snapshots, and agent-facing architecture notes can become stale or too detailed.

## Candidate Scope

### In Scope

- Define a single published documentation site for Streamliner.
- Split published docs into three top-level content areas:
  - User Guide: user-facing, task-oriented product documentation.
  - Architecture: high-level current-codebase orientation for contributors and agents.
  - Design: intended system, design docs, concepts, and decision records.
- Keep `.streamliner/shaping/` out of the published docs site; shaping notes are planning artifacts, not public documentation.
- Decide how current `docs/design` VitePress usage should evolve into a broader `docs` site.
- Decide which documentation families are Streamliner-native expectations versus project-specific recommendations.

### Out of Scope

- Writing the full user guide.
- Fully documenting every subsystem in the architecture section.
- Publishing `.streamliner/shaping/` content as documentation.
- Replacing design docs as the primary intended-system context layer for agents.

### Deferred

- Automated stale-doc detection.
- UI affordances for surfacing user, architecture, or design docs from Streamliner.
- Tooling that automatically updates navigation when architecture or user docs are added.
- Project-template generation for optional architecture and user-guide docs.

## Decisions and Working Assumptions

- The docs should publish as one unified site, not separate sites per audience.
- The published site should include User Guide, Architecture, and Design sections.
- Workstream shaping notes should remain under `.streamliner/shaping/` and should not be published as docs.
- VitePress is likely the right mechanism for this project because it is already installed and currently builds `docs/design` through `npm run docs:*`.
- The likely implementation direction is to broaden the VitePress root from `docs/design` to `docs`, then make Design one section of the site rather than the whole site.
- Design docs are a Streamliner-native concept: Streamliner expects projects to have or reference a design layer because it is important agent context.
- Architecture docs and user-guide docs may be Streamliner-recommended rather than hard-required: Streamliner can suggest, link, and contribute to them when present without requiring every project to maintain them.
- Design docs should not shrink by moving all implemented design into architecture. Design remains the durable statement of intended system behavior and constraints, whether already implemented or not.
- Architecture docs should absorb implementation orientation, codebase maps, current component responsibilities, data-flow summaries, and "where to look" guidance that helps humans and agents navigate the current code.
- Once a design becomes implemented, the design doc may shrink only by removing speculative scaffolding, stale alternatives, and implementation-detail prose. The normative intent, invariants, constraints, and accepted decisions stay in Design.

## Design and Architecture Relationship

Design and Architecture should be peers with different authority, not a pipeline where content automatically graduates out of Design into Architecture.

### Design

Design answers: **What is the intended system, and what constraints or decisions should future work obey?**

Design includes both implemented and not-yet-implemented intent. That makes it suitable as a Streamliner-native context layer: every project can have a design authority even if it does not maintain separate architecture docs.

Implemented design should remain in Design when it is still normative. For example, "workers read Layer 0 as navigation hints, not as a copied design bundle" remains a design rule even after implemented.

### Architecture

Architecture answers: **How is the current codebase organized, and where should a human or agent look to understand it?**

Architecture is descriptive and current-state oriented. It should avoid restating all intended behavior from Design. Instead, it should summarize the codebase shape: major modules, runtime processes, storage locations, data flow, extension points, and sharp edges that are expensive to rediscover.

### Graduation rule

When intended design becomes implemented:

1. Keep normative intent, invariants, and accepted constraints in Design.
2. Move or rewrite implementation-detail orientation into Architecture if the project maintains architecture docs.
3. Remove obsolete speculation from Design rather than preserving historical alternatives.
4. Record major rationale in decision records, not Architecture.

This preserves Architecture as optional/recommended while keeping Design reliable as the required Streamliner context layer.

## Discovery and Worker Flow

Documentation discovery should be deterministic first and agent-discovered second. Agents should not have to repeatedly infer whether a repo has architecture or user-guide docs, but Streamliner also should not require every project to configure optional documentation families up front.

### Repository documentation catalog

Streamliner should maintain a documentation catalog per registered repo. The catalog can be assembled from:

1. Explicit configuration in `.streamliner/config.json`.
2. Conventional paths when config is absent.
3. Agent discovery only as a fallback or enrichment step.

The existing config already supports `designDocsPath` per repo with a default of `docs/design`. A future docs-aware config could extend that pattern:

```json
{
  "version": 1,
  "workstreamsDir": "workstreams",
  "repos": {
    "streamliner": {
      "path": "..",
      "docs": {
        "design": {
          "path": "docs/design",
          "required": true
        },
        "architecture": {
          "path": "docs/architecture",
          "required": false
        },
        "userGuide": {
          "path": "docs/guide",
          "required": false
        }
      }
    }
  }
}
```

Open naming question: this could be a new `docs` object, or it could preserve `designDocsPath` and add `architectureDocsPath` and `userGuideDocsPath`. A `docs` object is cleaner for future doc families, but a migration path should preserve existing `designDocsPath`.

### Conventional defaults

If no optional docs config exists, Streamliner can look for conventional roots:

- `docs/design` for Design.
- `docs/architecture` for Architecture.
- `docs/guide` or `docs/user-guide` for User Guide.

Design keeps special treatment because it is Streamliner-native context. Architecture and User Guide are discovered capabilities: if present, Streamliner can surface and encourage them; if absent, workers should not fail or invent them.

### Workstream references

Current workstreams have `designRefs` because design is the normative project context layer. Architecture and user-guide docs should probably not be forced into `designRefs`.

Instead, future workstreams may need a more general documentation hint model:

```json
{
  "docRefs": [
    {
      "kind": "architecture",
      "repoId": "streamliner",
      "path": "docs/architecture/session-system.md",
      "purpose": "Current code map for launch context and registry modules"
    },
    {
      "kind": "userGuide",
      "repoId": "streamliner",
      "path": "docs/guide/sessions.md",
      "purpose": "User-facing behavior affected by this workstream"
    }
  ]
}
```

This keeps `designRefs` focused on intended-system authority while allowing workstreams to surface optional docs that workers may need to read or update.

### Context package flow

The worker context package should continue to treat Design as Layer 0 authority. Optional docs should flow as orientation and documentation-impact hints, not as required reading:

- **Design hints:** normative; read when alignment or intended behavior matters.
- **Architecture hints:** descriptive; read when codebase orientation or subsystem boundaries matter.
- **User Guide hints:** user-facing; update when behavior, setup, workflows, or visible UX changes.

This could appear in the worker context as a short "Documentation hints" section near Layer 0, with links and purpose statements. It should avoid copying full docs into the context package.

### Worker update responsibilities

Workers should update docs when their task changes the thing that doc family owns:

| Change type | Expected documentation behavior |
|---|---|
| Intended system behavior, invariant, or architectural constraint changes | Update Design and/or add a decision record. |
| Code organization, subsystem responsibilities, runtime flow, storage, or operational sharp edges change | Update Architecture if that doc family exists. |
| User-visible workflow, setup, command, UI behavior, or troubleshooting path changes | Update User Guide if that doc family exists. |

Workers should not create optional doc families opportunistically unless the task explicitly includes documentation structure. If a needed optional doc family is absent, the worker should report the documentation impact so reconciliation or a follow-up workstream can decide whether to create it.

### Reconciliation flow

Worker final summaries should include documentation impact:

- Design changed or should change.
- Architecture changed or should change.
- User Guide changed or should change.
- Optional doc family was absent.

The orchestrator/reconciler can then update downstream issues or graph nodes. This is especially important for hot work: if a worker expands scope inside the workstream boundary and changes user-visible behavior or subsystem shape, reconciliation needs to know which docs and downstream tasks are affected.

## Dependencies

### Depends On

- [Workstream Design Mode](workstream-design-mode.md), for the shaping process and handoff conventions.

### Enables

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because agents and skills need authoritative orientation material to load.

### Related Candidates

- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because worker-facing guidance may live in plugin docs, role docs, or operating-model docs.

## Workstream Shape

This should be a full workstream, not a narrow documentation skeleton task. The workstream should own both the initial documentation implementation and the product changes needed for Streamliner to understand the expanded documentation model.

Broad deliverables:

1. Define the top-level docs site structure under `docs/`.
2. Preserve existing design docs as the Design section.
3. Build initial User Guide content sufficient for first-time users to understand and operate Streamliner.
4. Build initial Architecture content sufficient for contributors and agents to orient to the current codebase.
5. Update VitePress configuration and docs scripts so the unified site builds from `docs` and can publish through GitHub Pages.
6. Document and encode the authority rules:
   - User Guide explains how to use Streamliner.
   - Architecture orients contributors and agents to the current implementation.
   - Design states intended system direction and decisions.
   - Shaping notes stay in `.streamliner/shaping/` and are not published.
7. Add Streamliner product support for discovering, representing, and flowing architecture/user-guide docs where appropriate:
   - repo documentation catalog/config shape,
   - conventional path detection,
   - optional documentation hints in workstreams or launch context,
   - worker/reconciliation expectations for documentation impact.

The orchestrator for this workstream should decide the internal waves and first implementation slice. The shaping goal here is to establish the broad workstream boundary and the core product/documentation model, not to pre-plan every node.

## Likely Work Areas

- Docs-site migration from `docs/design` to unified `docs`.
- User Guide initial content.
- Architecture initial content.
- Design-doc preservation and navigation inside the unified site.
- Streamliner config/catalog support for optional documentation families.
- Workstream/context-package participation for optional documentation hints.
- Worker/reconciliation documentation-impact guidance.

## Open Questions

- Should current-state architecture live under `docs/architecture/`, inside `docs/design/`, or in another documentation root?
- What content belongs in architecture docs if agents can inspect the code directly?
- Should Streamliner only require the design layer while recommending architecture and user-guide docs when useful?
- Should Streamliner templates include optional `docs/architecture` and `docs/guide` placeholders?
- Should workstream graphs keep `designRefs` plus add `docRefs`, or should `designRefs` evolve into a typed documentation-reference model?
- Should missing optional docs be reported as `unavailableInputs`, documentation impact, or both?
- Should worker final-response structure include a standard documentation-impact section?

## Handoff Brief

Create a Documentation System workstream for Streamliner.

The workstream should establish a unified GitHub Pages-publishable documentation site rooted at `docs/`, preserving existing Design docs as the normative intended-system section while adding initial User Guide and Architecture sections. It should also update Streamliner product behavior so documentation families can be discovered, represented, and flowed into workstreams and worker context appropriately.

The workstream should treat Design as Streamliner-native required context and Architecture/User Guide as optional-but-recommended doc families. It should preserve `designRefs` as the normative design-context mechanism while evaluating how optional documentation hints should participate in repo config, workstream artifacts, context packages, worker documentation-impact reporting, and reconciliation.

The orchestrator should decide internal waves and issue decomposition. The shaped boundary is documentation taxonomy plus the initial docs implementation plus product support for optional documentation families.
