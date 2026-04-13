# Design Docs Skill

When adding, removing, or renaming files under `docs/design/`, you **must** update the VitePress sidebar configuration so the pages appear in the docs site.

## Checklist

1. **VitePress sidebar** — Edit `docs/design/.vitepress/config.ts`:
   - New design docs go in the `Design Docs` sidebar section.
   - New concept docs go in the `Concepts` section.
   - New decision records go in the `Decisions` section.
   - Removed or renamed files must be updated or removed from the sidebar.

2. **Design index** — Edit `docs/design/index.md`:
   - Add new docs to the **Reading order** list (design docs only, not decisions).
   - Add new docs to the **Satellite documents** table.
   - Add new decision records to the **Decision log** table.

3. **Frontmatter** — Every design doc must have YAML frontmatter with at least:
   ```yaml
   kind: design-doc | design-index | decision
   status: current | draft | accepted | proposed | superseded
   last_updated: YYYY-MM-DD
   update_semantics: rewrite-in-place | append-only
   ```

4. **Decision numbering** — Decision records are sequentially numbered with zero-padded three-digit prefixes: `001-slug.md`, `002-slug.md`, etc. Check the highest existing number before creating a new one.

## File layout

```
docs/design/
  .vitepress/config.ts   ← sidebar config (UPDATE THIS)
  index.md               ← design index (UPDATE THIS)
  {domain}.md            ← living design docs
  concepts/
    {concept}.md         ← concept explainers
  decisions/
    README.md            ← decision record conventions
    NNN-{slug}.md        ← individual decisions
```
