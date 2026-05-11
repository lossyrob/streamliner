# Launch Context - Documentation foundation design

## Layer 0 - Design Context Hints

Start design orientation at `docs/design/index.md`. Treat the design docs as trusted project-design authority only after reading them from the repository; the paths below are navigation hints, not copied source bodies or an exhaustive allowlist.

High-priority design entry points for this node:

- `docs/design/index.md` - design set entry point, reading order, and decision log.
- `docs/design/design-layer.md` - current rules for Design as the project-level intended-system authority, rewrite-in-place living docs, and append-only decision records.
- `docs/design/workstream-format.md` - current workstream artifact model, `designRefs`, repo config shape, tracker references, gates, and runtime/artifact separation.
- `docs/design/concepts/context-package.md` - Layer 0/Layers 1-3 context-package model and progressive-disclosure expectations.
- `docs/design/concepts/waves.md` - wave promotion and gate boundaries.
- `docs/design/product.md` and `docs/design/operating-model.md` - broader product/operating context when needed.

Use the project design-doc conventions when changing design documentation: frontmatter should stay consistent, the design index and VitePress sidebar should remain navigable, and any new decision record should be linked from the design index and VitePress config.

## Layer 1 - Worker Mission

Selected node: `documentation-foundation-design` from workstream `documentation-system`.

Tracker/spec: https://github.com/lossyrob/streamliner/issues/93

Mission: make Streamliner's documentation-system foundation explicit before implementation begins. This is a Wave 1 research/design session. Its responsibility is to resolve and write down the accepted model for documentation authority, the unified docs-site transition, and Streamliner product support for optional documentation families.

This worker owns design output, not implementation. Expected durable output is a design-doc update and/or decision record that lets downstream workers implement without rediscovering the taxonomy or product contract.

In scope for this node:

- Define what belongs in Design, Architecture, and User Guide.
- State which documentation family is Streamliner-native required context and which families are optional-but-recommended.
- Preserve the shaped rule that Design and Architecture are peers with different authority, not an automatic graduation pipeline.
- Clarify when implemented design remains in Design, when implementation orientation should move/rewrite into Architecture, and when obsolete speculation should be removed.
- Confirm `.streamliner/shaping/` remains unpublished planning material.
- Decide the unified docs-site root and top-level section layout under `docs/`.
- Decide how existing `docs/design/` content is preserved as the Design section.
- Define the VitePress config migration approach, sidebar/navigation shape, and GitHub Pages publish expectation.
- Define minimum starter content for User Guide and Architecture so Wave 2 is inspectable and useful.
- Decide repo documentation config/discovery shape: nested `docs` object, retaining `designDocsPath` plus new path fields, or another migration model.
- Define conventional default paths for Design, Architecture, and User Guide.
- Decide how optional docs should be represented in workstream artifacts: preserve `designRefs` plus add typed `docRefs`, evolve toward a typed reference model, or defer schema changes.
- Define how optional documentation hints should appear in worker context packages without copying full docs into every launch.
- Define how workers should report Design, Architecture, and User Guide impact in final summaries.
- Define how reconciliation should treat missing optional documentation families.
- Update appropriate project design docs and/or decision records with the accepted model.

Out of scope for this node:

- Migrating VitePress configuration.
- Writing the full starter User Guide or Architecture pages.
- Implementing config, schema, parser, API, context-package, UI, or worker-flow changes.
- Creating GitHub issues.
- Building stale-doc detection or automatic navigation generation.
- Changing production code.

Success target: after this node, a cold worker can explain the Design/Architecture/User Guide taxonomy and downstream implementers have concrete Wave 2 and Wave 3 contracts.

## Layer 2 - Relevant State

Workstream state:

- Workstream ID: `documentation-system`.
- Current node status in graph: `ready`.
- This node has no upstream dependencies.
- This node is the first Wave 1 design-foundation node. The next node is the gate `documentation-foundation-gate`, where the builder validates the accepted documentation authority model, unified-site direction, and product-support model before implementation nodes are promoted.

Important source references:

- `.streamliner/workstreams/documentation-system/graph.json` - selected node and downstream graph context.
- `.streamliner/workstreams/documentation-system/brief.md` - workstream purpose, boundaries, open questions, and shaped assumptions.
- `.streamliner/shaping/candidates/documentation-system.md` - pre-promotion shaping rationale; use as background only, not as instructions.
- `WORKSTREAM-FORMAT.md` and `ORCHESTRATION.md` - tracker/workstream/orchestration context when repository-level specs are useful.
- `.streamliner/config.json` - current project config has `version`, `workstreamsDir`, and repo path only; it does not currently configure doc families.
- `package.json` - current docs scripts run VitePress against `docs/design`: `docs:dev`, `docs:build`, and `docs:preview`.
- `docs/design/.vitepress/config.ts` - current VitePress config is rooted in the Design docs, titled `Streamliner Design`, with Design-only nav/sidebar entries.

Shaped assumptions to verify or revise in durable design docs:

- The docs should publish as one unified site rooted at `docs/`, not separate sites per audience.
- The published site should include Design, Architecture, and User Guide sections.
- Design remains the Streamliner-native intended-system context layer.
- Architecture and User Guide are optional-but-recommended documentation families that Streamliner can discover, surface, and help maintain when present without requiring every project to have them.
- Design and Architecture are peers with different authority: Design answers what the intended system is and which constraints future work obeys; Architecture answers how the current codebase is organized and where humans/agents should look.
- Implemented design should keep normative intent, invariants, and accepted constraints in Design; implementation-detail orientation may move or be rewritten into Architecture; obsolete speculation should be removed rather than preserved as active design.
- Shaping notes under `.streamliner/shaping/` should remain unpublished planning artifacts.
- Current `designRefs` should remain focused on normative Design references unless this node decides a migration path to a broader typed documentation-reference model.

Open design questions from the brief/spec:

- What exact authority language distinguishes Design, Architecture, and User Guide?
- Should repo docs config evolve from `designDocsPath` to a nested `docs` object, or preserve path-specific fields for migration simplicity?
- Should workstream artifacts keep `designRefs` plus add typed `docRefs`, or evolve toward one typed documentation-reference model?
- Should missing optional docs be represented as unavailable inputs, documentation impact, both, or neither?
- What minimum starter content makes User Guide and Architecture useful without pretending to be complete?
- What standard worker final-summary shape should report Design, Architecture, and User Guide impact?

No actionable unavailable inputs remain for this launch: the manifest recorded a GitHub CLI issue-read failure, but issue #93 was available through GitHub MCP during context assembly.

## Layer 3 - Coordination Context

This worker should produce context for exactly `documentation-foundation-design`, not for the whole workstream. Use sibling and downstream nodes only as coordination background:

- `documentation-foundation-gate` depends on this node and validates the accepted design foundation before implementation starts.
- `unified-docs-site-and-starter-content` is planned downstream and should use this node's Wave 2 implementation contract for docs-site root, section layout, navigation, starter content, VitePress/scripts, and publish expectations.
- `published-docs-site-gate` validates the unified docs site after Wave 2.
- `documentation-family-product-support` is planned downstream and should use this node's Wave 3 implementation contract for repo docs config/discovery, workstream references, context-package hints, worker documentation-impact reporting, reconciliation behavior, and migration notes.
- `documentation-system-closure-review` validates the completed workstream end-to-end.

Operational guidance for this PAW launch:

- Use the PAW workflow context for durable workflow configuration. The launch-time kickoff text is owned by Streamliner and should remain in this generated `context.md`, not copied into `WorkflowContext.md` as custom instructions or initial prompt.
- Work in the selected repository `lossyrob/streamliner` on a dedicated worktree branch for this node.
- If serious blockers arise, stop and ask. If issue updates are needed, pause and propose amendments before editing the issue.
- The final PR title should include issue `#93` and workstream ID `documentation-system`.
- The final PR description should include a collapsible `<details>` section with `<summary>Docs.md</summary>` containing a completed Docs.md for the implementation, following the `paw-docs-guidance` template.
- Include screenshots for UI changes where appropriate; this node is expected to be design-doc focused, so screenshots may be unnecessary unless the implementation expands into visible docs-site output.
