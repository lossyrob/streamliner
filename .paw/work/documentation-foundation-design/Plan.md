# Documentation Foundation Design Plan

## Problem and approach

Issue #93 is a Wave 1 design-foundation node for the `documentation-system`
workstream. The output should be durable design authority, not production code:
define Streamliner's documentation-family taxonomy, the unified docs-site
transition contract for Wave 2, and the product-support contract for optional
documentation families in Wave 3.

The implementation will update existing Design documentation where it owns the
model, add a decision record for the accepted foundation, and keep design-doc
navigation/frontmatter consistent. The work will not migrate VitePress, create
starter User Guide or Architecture pages, implement schema/config/parser/API/UI
changes, or create GitHub issues.

## Work items

1. `lite:documentation-foundation-design:work:taxonomy-authority`
   - Update the design-layer documentation to define Design, Architecture, and
     User Guide authority boundaries.
   - State that Design is Streamliner-native required context and Architecture
     plus User Guide are optional-but-recommended families.
   - Preserve Design/Architecture as peers with different authority and clarify
     implemented-design handling.
   - Confirm `.streamliner/shaping/` remains unpublished planning material.

2. `lite:documentation-foundation-design:work:wave-contracts`
   - Update the workstream/context-package design docs with the Wave 2 contract:
     unified docs root under `docs/`, section layout, preservation of
     `docs/design/`, VitePress/sidebar/script migration expectations, GitHub
     Pages publishability, and minimum starter content for Architecture and User
     Guide.
   - Update the Wave 3 contract: repo docs config/discovery shape, conventional
     default paths, typed optional documentation references, context-package
     hint behavior, worker final-summary documentation impact, reconciliation,
     and migration from existing `designDocsPath` behavior.

3. `lite:documentation-foundation-design:work:decision-navigation`
   - Add an accepted decision record for the documentation foundation model.
   - Update `docs/design/index.md`, `docs/design/decisions/README.md`, and
     `docs/design/.vitepress/config.ts` so the new record is discoverable.
   - Keep changed design-doc frontmatter current and reference the new decision
     where appropriate.
   - Record whether the accepted model implies brief or graph refinements before
     `documentation-foundation-gate`; if no refinements are needed, state that
     explicitly in the durable design output.

## Proposed positions to validate and encode

- Publish one unified docs site rooted at `docs/` with top-level User Guide,
  Architecture, and Design sections.
- Preserve existing `docs/design/` content as the Design section rather than
  moving or weakening it.
- Use a nested repo `docs` catalog as the target config model while supporting
  `designDocsPath` as a compatibility alias/migration source.
- Keep `designRefs` focused on normative Design authority and add typed `docRefs`
  for optional documentation hints.
- Flow optional docs into worker context as links and purpose hints, not copied
  full documents or hard requirements.
- Report documentation impact explicitly in worker final summaries; missing
  optional docs are reported as impact/follow-up context rather than launch
  blockers.

The decision record should ratify these positions rather than merely repeat
them. Its alternatives section should cover the open options from issue #93:
path-specific docs config fields vs. a nested docs catalog, typed `docRefs` vs.
broadening `designRefs`, and blocking vs. non-blocking treatment for missing
optional docs.

## Important rule to make explicit

Implemented design does not automatically graduate from Design into
Architecture. Design keeps normative intent, invariants, accepted constraints,
and rationale references whether already implemented or not. Architecture, when
present, carries current-codebase orientation: module maps, runtime/data flow,
storage surfaces, extension points, and where-to-look guidance. Obsolete
speculation is removed from living Design docs instead of being preserved as
active guidance.

## Validation

- Run docs build to confirm VitePress navigation and Markdown links remain valid.
- Run repository checks appropriate for doc-only changes if needed by existing
  scripts.
- Re-read the updated design-layer documentation and decision record as a cold
  worker and verify Design, Architecture, User Guide, required/optional status,
  implemented-design handling, and `.streamliner/shaping/` publication behavior
  are answerable without the issue or planning artifacts.
- Confirm the final diff is restricted to design-documentation files and PAW
  workflow artifacts; no production code changes under `src/`, `scripts/`,
  `copilot-plugin/`, or `.streamliner/`.
