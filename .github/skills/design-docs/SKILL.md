---
name: design-docs
description: >
  Guides modifications to Streamliner's design documentation under docs/design/.
  Ensures VitePress sidebar config, design index, and frontmatter stay consistent
  when design docs or decision records are added, removed, or renamed. Activate
  whenever work touches docs/design/ files.
---

# Design Docs Skill

When adding, removing, or renaming files under `docs/design/`, you **must** keep
three coordination points in sync.

## 1. VitePress sidebar — `docs/design/.vitepress/config.ts`

The sidebar controls what appears in the docs site. Update the correct section:

- **Design Docs** section → living design docs (`{domain}.md`)
- **Concepts** section → concept explainers (`concepts/{concept}.md`)
- **Decisions** section → decision records (`decisions/NNN-{slug}.md`)

Removed or renamed files must also be updated in the sidebar.

## 2. Design index — `docs/design/index.md`

- Add new design docs to the **Reading order** list and **Satellite documents** table.
- Add new decision records to the **Decision log** table with number, title, status, and date.
- Concept docs are already listed in the reading order under "Concepts" — add new ones there.
- Remove entries for deleted docs.

## 3. Frontmatter

Every file under `docs/design/` must have YAML frontmatter:

```yaml
# Living design docs
kind: design-doc
status: current | draft | superseded
last_updated: YYYY-MM-DD
update_semantics: rewrite-in-place
authoritative_for: "Short description of what this doc owns"
scope_tags: [tag1, tag2]
code_paths: [src/relevant/**]
references_decisions: [1, 2]

# Decision records
kind: decision
number: NNN
status: proposed | accepted | superseded
date: YYYY-MM-DD
update_semantics: append-only
superseded_by: null
supersedes: null
```

## Decision numbering

Decision records use zero-padded three-digit prefixes: `001-slug.md`, `002-slug.md`.
Check the highest existing number in `docs/design/decisions/` before creating a new one.

## File layout reference

```
docs/design/
  .vitepress/config.ts   ← sidebar config
  index.md               ← design index
  {domain}.md            ← living design docs
  concepts/
    {concept}.md
  decisions/
    README.md            ← conventions
    NNN-{slug}.md        ← individual decisions
```
