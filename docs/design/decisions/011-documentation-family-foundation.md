---
kind: decision
number: 11
status: accepted
date: 2026-05-10
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 011. Documentation family foundation

## Context

Streamliner already treats Design docs as project-level intended-system context,
and the current docs site is rooted at `docs/design/`. The documentation-system
workstream needs to broaden that into one publishable documentation system
without weakening Design as Streamliner's normative context layer.

The workstream also needs downstream implementation contracts before Wave 2 and
Wave 3 begin:

1. Wave 2 needs enough information to move from a Design-only VitePress site to
   one unified docs site with inspectable starter content.
2. Wave 3 needs a product model for discovering optional docs, flowing them into
   worker context, and reconciling documentation impact.

## Decision

### Documentation families

Streamliner recognizes three project documentation families:

| Family | Authority | Required status |
|---|---|---|
| Design | Normative intended-system context: intended behavior, invariants, constraints, accepted direction, and decision rationale references | Streamliner-native required context |
| Architecture | Descriptive current-codebase orientation: module maps, runtime/data flow, storage, extension points, and where-to-look guidance | Optional but recommended |
| User Guide | User-facing task documentation: setup, workflows, commands, visible behavior, operations, and troubleshooting | Optional but recommended |

Design and Architecture are peers with different authority, not stages in a
graduation pipeline. Implemented design remains in Design when it is still
normative. Implementation-detail orientation can move or be rewritten into
Architecture when that family exists. Obsolete speculation is removed from
living Design docs instead of being preserved as active guidance.

`.streamliner/shaping/` remains unpublished planning material. It can inform
workstream formation but is not part of the docs site and is not authoritative
project documentation.

### Wave 2 unified-site contract

Streamliner's published docs should be one VitePress site rooted at `docs/`.
The source layout should preserve existing Design content under `docs/design/`
and add peer sections for User Guide and Architecture:

```text
docs/
  index.md
  guide/
    index.md
  architecture/
    index.md
  design/
    index.md
    concepts/
    decisions/
  .vitepress/
    config.ts
```

Wave 2 should move VitePress configuration to the unified `docs/` root, update
`npm run docs:*` scripts to run against `docs`, and produce a static artifact
suitable for GitHub Pages. Top-level navigation should expose User Guide,
Architecture, and Design as peer sections. Design decision records remain under
the Design section and must stay discoverable.

Minimum starter content means:

1. a site landing page that names the three families, states their authority
   boundaries, and routes readers to the right section;
2. a User Guide index with installation/startup pointers, the primary workflows
   Streamliner supports today, and an honest starter-status note;
3. an Architecture index with a current high-level codebase map, major runtime
   processes, important source directories, state/storage locations, and
   where-to-look guidance;
4. the existing Design docs preserved as the normative intended-system section.

Wave 2 does not need to document every user task or every subsystem.

### Wave 3 product-support contract

Repo documentation config should evolve toward a nested `docs` catalog:

```json
{
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

`designDocsPath` remains a backward-compatible read alias for
`docs.design.path`. If both are present, `docs.design.path` wins. Conventional
defaults are `docs/design`, `docs/architecture`, and `docs/guide`, with
`docs/user-guide` accepted as a User Guide discovery fallback when config is
absent.

Workstream artifacts should preserve `designRefs` for normative Design hints and
add typed `docRefs` for optional Architecture and User Guide hints. `docRefs`
carry a documentation family, repo ID, repo-root-relative path, and optional
purpose. Missing optional docs are surfaced as unavailable optional hints, not as
launch blockers.

Context packages should continue to treat Design as Layer 0 authority. Optional
Architecture and User Guide references appear as documentation hints: links plus
purpose statements, not copied full docs and not hard required reading.

Workers should report documentation impact in final summaries:

- Design changed, unchanged, or needs follow-up.
- Architecture changed, unchanged, absent, or needs follow-up.
- User Guide changed, unchanged, absent, or needs follow-up.

Reconciliation uses that signal to update downstream nodes, create follow-up
documentation work, or deliberately leave missing optional families absent.
Missing Architecture or User Guide docs are not failed launches and do not make a
worker create optional doc families unless the node explicitly includes that
structure.

### Workstream graph and brief refinements

The accepted model does not require changing the current
`documentation-system` node boundaries before `documentation-foundation-gate`.
The existing downstream Wave 2 node can consume the unified-site contract, and
the existing downstream Wave 3 node can consume the product-support contract.
Wave promotion should use this decision to detail those nodes and their issues.

## Alternatives considered

**Separate docs sites per audience.** Rejected. Separate sites would make
authority boundaries harder to see, fragment GitHub Pages publishing, and leave
Design looking like a standalone product instead of one section of the project
documentation system.

**Keep only path-specific config fields.** Rejected. Adding
`architectureDocsPath` and `userGuideDocsPath` would be simple initially, but it
does not scale as a documentation catalog and makes family metadata such as
`required` awkward. The nested `docs` catalog is clearer, while
`designDocsPath` remains a compatibility alias.

**Replace `designRefs` with one typed reference model immediately.** Rejected.
`designRefs` already communicates normative Design authority and is embedded in
existing workstream semantics. Optional documentation hints should not dilute
that meaning. A future schema can unify references if it preserves Design's
special authority explicitly.

**Treat missing optional docs as blockers or unavailable required inputs.**
Rejected. Architecture and User Guide are recommended but optional. Blocking
worker launch would force every project to create them before Streamliner can be
useful and would encourage agents to invent thin placeholder docs.

**Move implemented design out of Design into Architecture.** Rejected. Design is
the durable source of intended-system rules whether or not they are implemented.
Architecture orients readers to the current implementation; it does not replace
normative Design.

## Consequences

- `design-layer.md` owns the documentation-family authority model.
- `workstream-format.md` owns repo docs config, `docRefs`, worker documentation
  impact, reconciliation, and the unified-site implementation contract.
- `concepts/context-package.md` owns how optional documentation hints appear in
  generated worker context.
- Wave 2 implementers can migrate VitePress and create starter docs without
  rediscovering information architecture.
- Wave 3 implementers can add docs-family discovery and context-package support
  while preserving existing `designRefs` behavior.
