# Documentation Foundation Design

## Overview

This work defines Streamliner's documentation-system foundation for the
`documentation-system` workstream. It turns the shaped documentation model into
durable Design authority so downstream workers can implement a unified docs site
and optional documentation-family product support without rediscovering the
taxonomy.

The implementation is documentation-only. It adds accepted decision record 011,
updates the Design layer, and records Wave 2 and Wave 3 implementation contracts
for documentation structure, discovery, worker context, documentation-impact
reporting, reconciliation, and no-frontmatter design-doc conventions.

## Architecture and Design

### High-Level Architecture

Streamliner now recognizes three project documentation families:

| Family | Authority | Required status |
|---|---|---|
| Design | Normative intended-system context: intended behavior, invariants, constraints, accepted direction, and rationale references | Streamliner-native required context |
| Architecture | Descriptive current-codebase orientation: module maps, runtime/data flow, storage, extension points, and where-to-look guidance | Optional but recommended |
| User Guide | User-facing task documentation: setup, workflows, commands, visible behavior, operations, and troubleshooting | Optional but recommended |

Design remains the required Layer 0 context family for Streamliner-managed work.
Architecture and User Guide are optional capabilities Streamliner can discover,
hint, and help maintain when present.

### Design Decisions

The accepted model is captured in
`docs/design/decisions/011-documentation-family-foundation.md`.

Key decisions:

- Publish Streamliner's docs as one unified VitePress site rooted at `docs/`.
- Preserve existing `docs/design/` content as the Design section.
- Add peer top-level sections for User Guide (`docs/guide/`) and Architecture
  (`docs/architecture/`).
- Treat Design and Architecture as peers with different authority, not a
  graduation pipeline.
- Keep normative intent, invariants, accepted constraints, and rationale links in
  Design even after implementation.
- Move or rewrite implementation-detail orientation into Architecture when that
  optional family exists.
- Remove obsolete speculation from living Design docs instead of preserving it as
  active guidance.
- Keep shaping/candidate-workstream planning material unpublished and
  non-authoritative, regardless of its current repository path.
- Do not require YAML frontmatter for design docs or decision records; status,
  authority, decision metadata, relationships, and last-updated information come
  from maintained markdown tables, links, and git.
- Evolve repo documentation config toward a nested `docs` catalog while
  preserving `designDocsPath` as a backward-compatible read alias.
- Preserve `designRefs` for normative Design references and add typed `docRefs`
  for optional Architecture/User Guide hints.

### Integration Points

The design is anchored in existing docs:

- `docs/design/design-layer.md` owns the documentation-family authority model.
- `docs/design/workstream-format.md` owns the unified-site implementation
  contract, repo documentation catalog, `docRefs`, worker documentation-impact
  summary format, and reconciliation behavior.
- `docs/design/concepts/context-package.md` owns how optional documentation hints
  appear in generated worker context.
- `docs/design/product.md`, `docs/design/index.md`,
  `docs/design/decisions/README.md`, and
  `docs/design/.vitepress/config.ts` keep high-level orientation and navigation
  consistent.
- `DESIGN-DOCS.md` and `.github/skills/design-docs/SKILL.md` align future
  author/agent guidance around no required YAML frontmatter.

## User Guide

### Prerequisites

This work does not add user-facing runtime behavior. Readers need only the
repository documentation site or source files.

### Basic Usage

For design orientation, start at `docs/design/index.md`, then read:

1. `docs/design/design-layer.md` for the documentation-family taxonomy.
2. `docs/design/decisions/011-documentation-family-foundation.md` for the
   accepted decision and alternatives.
3. `docs/design/workstream-format.md` for Wave 2 and Wave 3 implementation
   contracts.
4. `docs/design/concepts/context-package.md` for worker context-package hint
   behavior.

### Advanced Usage

Downstream Wave 2 implementers should use the unified-site contract to migrate
VitePress from `docs/design` to `docs`, add a site landing page, add starter
Guide and Architecture pages, preserve Design navigation, and ensure the static
build is publishable through GitHub Pages.

Downstream Wave 3 implementers should use the product-support contract to add
docs-family discovery, nested `docs` config handling, `designDocsPath`
compatibility, typed `docRefs`, optional documentation hints in context
packages, worker documentation-impact reporting, and reconciliation behavior.

## API Reference

### Key Components

No production APIs or reusable code components were added.

### Configuration Options

This work defines the intended future configuration shape but does not implement
it:

- `repos.<repoId>.docs.design.path` defaults to `docs/design` and is required by
  default.
- `repos.<repoId>.docs.architecture.path` defaults to `docs/architecture` and is
  optional by default.
- `repos.<repoId>.docs.userGuide.path` defaults to `docs/guide` and is optional
  by default.
- `designDocsPath` remains a backward-compatible alias for
  `docs.design.path`; if both are present, `docs.design.path` wins.

Design-document metadata is intentionally not a configuration surface. If a
future machine-readable design catalog is needed, it should be implemented as
future product work derived from the design index, decision tables, links, git,
and workstream references rather than manual frontmatter.

Any remaining frontmatter in legacy design docs or accepted decision records is
not authoritative and can be removed later as metadata-only cleanup.

## Testing

### How to Test

Build the existing design docs site:

```powershell
npm run docs:build
```

Review the updated docs as a cold worker and confirm the following are clear
without reading the issue or shaping note:

- What belongs in Design, Architecture, and User Guide.
- Which families are required vs. optional.
- How implemented design is handled.
- What Wave 2 must build for the unified docs site.
- What Wave 3 must implement for docs discovery, references, context hints,
  worker reporting, and reconciliation.
- That design docs start with `# Title`, with status/authority in the design
  index and decision metadata in decision tables rather than YAML frontmatter.

### Edge Cases

- Missing Architecture or User Guide docs are optional unavailable hints, not
  launch blockers.
- Workers should not create optional documentation families opportunistically
  unless their node explicitly includes that structure.
- Shaping/candidate-workstream planning material remains non-authoritative and
  should not be published, even if its current repository path changes.

## Limitations and Future Work

This node intentionally does not migrate the VitePress site, create full starter
Guide or Architecture content, implement config/schema/parser/API/UI changes, or
create GitHub issues. Those responsibilities remain with downstream Wave 2 and
Wave 3 nodes after `documentation-foundation-gate`.
