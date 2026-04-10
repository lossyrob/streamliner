# Bootstrap design docs

## Outcome
Create Streamliner's initial repo-scoped `docs/design/` set from the current
root docs, then switch the workstream to reference that design layer instead of
the transitional root-doc paths.

## Success criteria
- `docs/design/index.md` exists as the cold-reader entry point.
- A minimal set of repo-scoped design docs exists, derived from the current root
  docs and aligned with their current intent.
- Any needed decision-record scaffolding exists under `docs/design/decisions/`.
- `.streamliner/workstreams/session-launching-and-tracking/brief.md` and
  `graph.json` reference the new `docs/design/*` paths rather than the root
  docs.
- The resulting design set is small, coherent, and sufficient for the next Wave
  1 node to work against.

## Relevant context
- The current root docs are transitional design authority:
  `DESIGN-DOCS.md`, `DOCTRINE.md`, `PRODUCT-SPEC.md`, and
  `WORKSTREAM-FORMAT.md`.
- The goal is not to mirror every root doc one-to-one. The goal is to create a
  usable repo-scoped design layer for Streamliner itself.
- Keep design docs project-level and durable. Do not turn them into a workstream
  changelog.

## Notes
- If any part of the root-doc model is still too unstable to codify in
  `docs/design/`, capture that uncertainty explicitly in the design index or an
  open design section instead of pretending it is settled.
