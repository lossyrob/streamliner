# Plan: Bootstrap Design Docs

## Problem
Issue #4 asks to create Streamliner's initial `docs/design/` set from the current root docs, then update the workstream to reference the new paths.

## Approach
Derive a minimal, coherent set of repo-scoped design docs from the four root docs (DESIGN-DOCS.md, DOCTRINE.md, PRODUCT-SPEC.md, WORKSTREAM-FORMAT.md). The goal is not 1:1 mirroring — it's a usable design layer for Streamliner itself.

### Design doc mapping
| Root doc | Design doc | Domain |
|----------|-----------|--------|
| PRODUCT-SPEC.md | product.md | Product scope, architecture, V1 goals |
| DOCTRINE.md | operating-model.md | Roles, context package, operating rhythm |
| DESIGN-DOCS.md | design-layer.md | How design docs work in Streamliner |
| WORKSTREAM-FORMAT.md | workstream-format.md | Artifact format, layout options, runtime state |

Plus: `index.md` (entry point), `decisions/` (empty scaffolding with a README).

### Work items
1. **create-dirs** — Create `docs/design/` and `docs/design/decisions/`
2. **create-product-doc** — Derive `product.md` from PRODUCT-SPEC.md
3. **create-operating-model-doc** — Derive `operating-model.md` from DOCTRINE.md
4. **create-design-layer-doc** — Derive `design-layer.md` from DESIGN-DOCS.md
5. **create-workstream-format-doc** — Derive `workstream-format.md` from WORKSTREAM-FORMAT.md
6. **create-decisions-scaffold** — Add decisions/ README
7. **create-index** — Create `index.md` referencing all docs (depends on 2-6)
8. **update-workstream-refs** — Update brief.md and graph.json designRefs (depends on 7)
9. **verify** — Validate all files, frontmatter, and references

### Key decisions
- Design docs describe *intended state* in declarative present tense per DESIGN-DOCS.md
- Each doc gets proper YAML frontmatter per the format spec (kind, status, last_updated, update_semantics, plus domain-specific fields)
- Root docs remain in place (they're transitional, not deleted by this issue)
- PORTFOLIO-LAYER.md and PRODUCT-THESIS.md are not migrated (PORTFOLIO-LAYER is a working draft, PRODUCT-THESIS is foundational context, not design authority)

### Status/uncertainty classification (from plan review)
- product.md → `current` (PRODUCT-SPEC is well-established)
- operating-model.md → `current` (DOCTRINE is stable)
- workstream-format.md → `current` (WORKSTREAM-FORMAT is the reference spec)
- design-layer.md → `current` (DESIGN-DOCS is the meta-spec; this doc describes how Streamliner's design-doc system works — it is a legitimate design concern even though DESIGN-DOCS.md didn't list itself as a "natural mapping." The design-doc system is part of Streamliner's intended architecture.)
- Open questions and unstable areas captured in the index's Open Questions section

### Scope exclusions
- Root docs stay in place (transitional, removed by a future issue)
- PORTFOLIO-LAYER.md not migrated (working draft, not design authority)
- PRODUCT-THESIS.md not migrated (foundational thesis, not design authority)
- No ADR corpus invented — just scaffolding with format guidance

### Review-driven refinements
- Index follows the full template: overview, reading order, satellite doc table, decision log, open questions
- Decision scaffolding includes numbering convention, status expectations, and template shape
- Verification is a concrete checklist: frontmatter fields, path consistency, brief/graph sync, no stale root-doc refs
