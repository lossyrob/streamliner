# Documentation foundation design

## Node

- Workstream: `documentation-system`
- Node ID: `documentation-foundation-design`
- Type: research
- Status: ready

## Purpose

Make the documentation system foundation explicit before implementation begins.
This node resolves the related design questions around documentation authority,
the unified docs-site transition, and Streamliner's product model for optional
documentation families in one PAW-sized design session.

## Inputs

- `.streamliner/shaping/candidates/documentation-system.md`
- `.streamliner/workstreams/documentation-system/brief.md`
- `WORKSTREAM-FORMAT.md`
- `ORCHESTRATION.md`
- `docs/design/index.md`
- `docs/design/design-layer.md`
- `docs/design/workstream-format.md`
- `docs/design/concepts/context-package.md`
- Existing `docs/design/` VitePress setup and docs scripts
- `.streamliner/config.json`

## Scope

### In scope

- Define what belongs in Design, Architecture, and User Guide.
- Define which documentation family is Streamliner-native required context and
  which families are optional-but-recommended.
- Preserve the shaped rule that Design and Architecture are peers with different
  authority, not an automatic graduation pipeline.
- Clarify when implemented design should remain in Design, move/rewrite
  implementation orientation into Architecture, or be removed as obsolete
  speculation.
- Confirm that `.streamliner/shaping/` remains unpublished planning material.
- Decide the unified docs site root and section layout under `docs/`.
- Decide how existing `docs/design/` content is preserved as the Design section.
- Define the VitePress config migration approach, sidebar/navigation shape, and
  GitHub Pages publish expectation.
- Define the minimum starter content for User Guide and Architecture that makes
  Wave 2 inspectable and useful.
- Decide whether repo documentation config should use a nested `docs` object,
  retain `designDocsPath` plus new path fields, or use another migration shape.
- Define conventional default paths for Design, Architecture, and User Guide.
- Decide how optional docs should be represented in workstream artifacts:
  preserve `designRefs` plus add typed `docRefs`, evolve toward a typed
  reference model, or defer schema changes.
- Define how optional documentation hints should appear in worker context
  packages without copying full docs into every launch.
- Define how workers should report Design, Architecture, and User Guide impact in
  final summaries.
- Define how reconciliation should treat missing optional documentation families.
- Update the appropriate project design docs and/or decision records with the
  accepted model.

### Out of scope

- Migrating VitePress configuration.
- Writing the full starter User Guide or Architecture pages.
- Implementing config, schema, parser, API, context-package, UI, or worker-flow
  changes.
- Creating GitHub issues.
- Building stale-doc detection or automatic navigation generation.

## Expected output

- A durable design update and/or decision record that states the accepted
  documentation-family authority rules and product model.
- A Wave 2 implementation contract: docs-site root, section layout, navigation
  approach, starter-content minimum, VitePress/script/publish expectations, and
  likely files or areas to touch.
- A Wave 3 implementation contract: repo docs config/discovery shape,
  workstream-reference model, context-package hint behavior, worker
  documentation-impact reporting, reconciliation behavior, and migration notes.
- Recommended refinements to the brief or graph if the accepted design changes
  node boundaries before `documentation-foundation-gate`.

## Success criteria

- A cold worker can explain the difference between Design, Architecture, and User
  Guide without reading the shaping note.
- The accepted taxonomy explicitly states whether Architecture and User Guide are
  required, optional, or recommended.
- The accepted taxonomy protects Design as the normative intended-system context
  layer.
- Wave 2 implementers can move the docs site without rediscovering the intended
  information architecture.
- The contract says what "starter content" means for User Guide and Architecture.
- GitHub Pages publishability is addressed explicitly.
- Downstream implementers know how Streamliner discovers docs families.
- Existing Design behavior has a safe migration path.
- Optional Architecture and User Guide docs can be hinted to workers without
  becoming required inputs.
- Worker final summaries have a clear documentation-impact expectation.
- Missing optional docs have an explicit behavior.
- No production code is changed by this node.

## Documentation impact

This node is expected to update Design because it changes documentation-system
intent, docs-site direction, and Streamliner product behavior around
documentation discovery, context assembly, and reconciliation. It may create a
decision record if the taxonomy or config/schema choice needs durable rationale.
