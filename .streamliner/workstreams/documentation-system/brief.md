# Documentation System

## Purpose

Establish Streamliner's documentation system as a unified, publishable docs site
with clear authority boundaries between User Guide, Architecture, and Design.
The workstream should preserve Design as the Streamliner-native intended-system
context layer while adding contributor/agent architecture orientation, user-facing
documentation, and product support for optional documentation families.

## Approach

Form this as a three-wave workstream based on confidence transitions rather than
implementation sequence. Each wave starts as one coarse PAW-sized node, followed
by any builder gate needed to validate the new state. Wave 1 makes the
documentation taxonomy, docs-site direction, and product model explicit before
any docs-site or schema implementation begins. Wave 2 creates the first usable
unified docs site with starter content. Wave 3 teaches Streamliner to discover,
represent, and flow optional documentation families into workstream and worker
context.

Wave 1 uses one local task spec under `tasks/`. The orchestrator should create
GitHub issues later when it promotes nodes or chooses to mirror the local spec
into GitHub. This formation session deliberately does not update project design
docs; the Wave 1 worker node owns any design-doc or decision-record changes.
Later-wave nodes are hypotheses: the orchestrator may split, merge, or replace
them at wave promotion time if real complexity warrants it.

Gates mark builder judgment points between confidence transitions. The final
closure gate is not a separate wave: it is a `gate` node that validates the
workstream outputs before the graph is marked completed.

## Design References

- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope, workstream concepts, and
  context-layer framing
- `streamliner:docs/design/operating-model.md` - roles, information flow, and
  artifact-first communication
- `streamliner:docs/design/design-layer.md` - current design-doc system and
  design-layer authority
- `streamliner:docs/design/workstream-format.md` - workstream artifacts,
  tracker references, gates, and runtime-state separation
- `streamliner:docs/design/concepts/context-package.md` - layered context package
  model that optional documentation hints will extend
- `streamliner:docs/design/concepts/waves.md` - wave promotion, checkpoints, and
  gates

## Boundaries

- **In scope:** A unified docs-site structure rooted at `docs/`; preserving
  existing Design docs as the normative intended-system section; initial User
  Guide content; initial Architecture orientation content; VitePress config and
  docs script migration; GitHub Pages publishability; documentation-family
  authority rules; repo documentation catalog/config support; conventional-path
  detection; optional workstream documentation hints; context-package flow for
  optional docs; worker and reconciliation expectations for documentation impact.
- **Out of scope:** Writing a complete user guide, documenting every subsystem,
  publishing `.streamliner/shaping/` notes, replacing Design as the primary
  intended-system context layer, implementing production code during formation,
  and creating GitHub issues from this creator session.
- **Deferred:** Automated stale-doc detection; UI affordances for surfacing docs
  from Streamliner; tooling that automatically updates user-guide or architecture
  navigation when pages are added; project-template generation for optional docs
  families; long-term docs quality scoring.

## Current State

The shaped candidate in `.streamliner/shaping/candidates/documentation-system.md`
has been promoted into this formed workstream. Wave 1 is ready to start from a
single local task spec. Later waves are intentionally sketched as coarse
PAW-sized nodes and should be promoted by the orchestrator only after the
preceding gate has passed and the actual outputs are known.

No GitHub tracker issues have been created. The local task spec is the current
Wave 1 node spec. If the orchestrator wants GitHub-backed execution, it should
create a parent issue and child issue during wave promotion, then replace the
local tracker in `graph.json` with a GitHub tracker reference.

The immediate next node is `documentation-foundation-design`. After it completes,
the builder should pass or fail `documentation-foundation-gate` before
implementation work begins.

## Decisions

- Use `documentation-system` as the workstream ID.
- Use one local task spec for Wave 1 and leave GitHub issue creation to the
  orchestrator.
- Use three waves: design foundation; unified docs site plus initial content;
  Streamliner product support for optional documentation families.
- Represent each substantive wave as one coarse PAW-sized node at formation time
  so the graph models session/accountability units rather than worker plan
  phases.
- Collapse the initial three Wave 1 contract nodes into
  `documentation-foundation-design` because taxonomy, site-transition direction,
  and product-model shape are tightly related design questions best handled in
  one PAW session.
- Treat Wave 2's docs-site migration and starter content as one confidence
  transition because an empty published site is not a useful standalone output.
- Treat Wave 3's catalog/config, workstream hints, context-package flow, and
  documentation-impact reporting as one confidence transition because they are
  one product-support model at formation time.
- Do not update design docs during formation. The Wave 1 worker node owns
  design-doc and decision-record changes.
- Keep `designRefs` focused on normative Design references until the Wave 1
  product-model contract decides how optional `docRefs` or equivalent hints
  should be represented.
- Use a final closure gate as a graph node, not as an additional wave.

## Open Questions

- What exact authority language should distinguish Design, Architecture, and
  User Guide docs?
- Should the repo config evolve from `designDocsPath` to a nested `docs` object,
  or preserve path-specific fields for migration simplicity?
- Should workstream artifacts keep `designRefs` plus add typed `docRefs`, or
  evolve toward one typed documentation-reference model?
- How should missing optional docs be represented to workers and orchestrators:
  as unavailable inputs, documentation impact, both, or neither?
- What minimum starter content makes the User Guide and Architecture sections
  useful without pretending to be complete?
- What standard worker final-summary shape should report Design, Architecture,
  and User Guide impact?

## Imports and Exports

### Imports

- Workstream formation conventions from
  `.streamliner/shaping/candidates/workstream-design-mode.md` and the temporary
  Workstream Creator role note.
- Existing `docs/design/` VitePress usage and `npm run docs:*` behavior.
- Existing workstream format, especially `designRefs`, local trackers, gates,
  checkpoints, and runtime/artifact separation.

### Exports

- Documentation-family authority model: Design, Architecture, and User Guide.
- Unified docs-site structure and navigation conventions for Streamliner.
- Repo documentation catalog/config shape for optional documentation families.
- Workstream documentation-hint model for optional Architecture/User Guide refs.
- Worker and reconciliation documentation-impact reporting guidance.
- Downstream context for the `streamliner-agent-skill-context` candidate.

### External Dependencies

- Builder validation at the Wave 1 taxonomy/product-model gate.
- Builder validation that the unified docs site is useful before product support
  assumes the new docs layout.
- GitHub Pages publish settings for the repository, if the docs site needs a
  repository-level Pages configuration change.

## Additional Context

The candidate's key shaped assumption is that Design and Architecture are peers
with different authority, not a pipeline where implemented design automatically
graduates out of Design. Design answers "what is the intended system and what
constraints should future work obey?" Architecture answers "how is the current
codebase organized and where should a human or agent look?"

Design remains Streamliner-native context. Architecture and User Guide are
optional-but-recommended documentation families that Streamliner can discover,
surface, and help maintain when present without requiring every project to have
them.

Shaping notes under `.streamliner/shaping/` are planning artifacts and should
remain unpublished.
