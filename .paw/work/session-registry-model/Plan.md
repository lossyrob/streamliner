# Plan: Session Registry Model

## Approach Summary

Issue #11 is already framed as a design-session node, so the main job is to turn the existing high-level registry direction in `docs/design/session-system.md` into an implementation-ready contract. The plan is to tighten the registry section into a concrete spec, capture the most durable identity/storage choice in a decision record, add a TypeScript schema skeleton that downstream runtime/UI work can import, and keep the design-doc coordination points in sync.

## Work Items

- [ ] **define-registry-contract** — Expand `docs/design/session-system.md` with the concrete session-registry contract: record shape, storage layout and versioning, autosave semantics, observation/import merge rules, lifecycle transitions, and the public surface for UI + relaunch work.
- [ ] **capture-identity-storage-decision** — Add a single decision record for the durable choice that the registry uses Streamliner-owned record IDs and a global local-first storage layout under the runtime-state root, plus the matching end/archive policy constraints.
- [ ] **add-schema-skeleton** — Add TypeScript schema/types for the registry record and index, with a short note in code/doc text about the future runtime module location. Do not add persistence logic yet.
- [ ] **sync-design-doc-nav** — Update `docs/design/index.md` and `docs/design/.vitepress/config.ts` for any new decision record so the docs set remains navigable.
- [ ] **verify-docs-and-code** — Run the existing repo checks, confirm no brief/graph changes are required for issue #11, and prepare the branch for final review.

## Key Decisions

- Keep `id` as a Streamliner-owned stable identifier and store the linked Copilot CLI session id separately as nullable observation metadata. This preserves a stable record for manual entries and for sessions whose Copilot state has been cleaned up.
- Treat the registry as a global local-runtime concern rather than a per-workstream artifact. The concrete storage path should live directly under `~/.streamliner/state/` in a registry-specific subtree so the same entry can outlive and outscope any single workstream.
- Use per-record JSON plus an index file with `schemaVersion`, atomic write-then-rename updates, and a single logical writer expectation. If a concurrent edit slips through, resolve it with last-writer-wins over the latest on-disk snapshot instead of introducing a database now.
- Keep archiving builder-driven. Observation may mark linked sessions `ended`, but it should not silently auto-archive records the builder may still want for relaunch or context recovery.

## Open Questions

None.
