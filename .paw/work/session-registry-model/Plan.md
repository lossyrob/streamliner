# Plan: Session Registry Model

## Approach Summary

Issue #11 is already framed as a design-session node, so the main job is to turn the existing high-level registry direction in `docs/design/session-system.md` into an implementation-ready contract. The plan is to tighten the registry section into a concrete spec, reconcile that spec with `docs/design/workstream-format.md`, capture the most durable identity/storage choice in a decision record, add a TypeScript schema skeleton that downstream runtime/UI work can import, and keep every design-doc coordination point in sync.

## Requirements Traceability

| Issue requirement | Planned artifact(s) |
|---|---|
| Record shape, field names, optionality, lifecycle semantics, graph binding | `docs/design/session-system.md` |
| Exact storage path, file layout, versioning, hand-edit tolerance, concurrency stance | `docs/design/session-system.md`, `docs/design/workstream-format.md`, `docs/design/decisions/005-session-registry-storage-and-identity.md` |
| Autosave debounce, atomic write strategy, conflict behavior | `docs/design/session-system.md` |
| Observation/import hook source files, discovery trigger model, merge rules, ended/archived policy | `docs/design/session-system.md` |
| Public API for UI + relaunch consumers | `docs/design/session-system.md`, `src/session-registry-contract.ts` |
| TypeScript record/index schema skeleton with runtime module note | `src/session-registry-schema.ts`, `src/session-registry-contract.ts` |
| Design-doc navigation and decision-log consistency | `docs/design/index.md`, `docs/design/.vitepress/config.ts`, `docs/design/decisions/README.md` |
| Leave brief/graph unchanged unless a real scope shift appears | Verified explicitly before final review |

## Work Items

- [x] **define-registry-contract** — Expand `docs/design/session-system.md` with the concrete session-registry contract: field inventory and optionality, Streamliner-vs-Copilot id relationship, origin/source metadata, graph binding, lifecycle and rediscovery semantics, autosave semantics, observation/import merge rules, ended-vs-archived policy, public surface, compatibility-probe inheritance from Decision 001, and the future runtime-module location note.
- [x] **reconcile-runtime-state-docs** — Update `docs/design/workstream-format.md` anywhere the new global session-registry subtree needs to be described alongside the existing project/workstream-scoped runtime files, and resolve any now-obsolete open questions between the two docs.
- [x] **capture-identity-storage-decision** — Add a single decision record for the durable choice that the registry uses Streamliner-owned record IDs and a global local-first storage layout under the runtime-state root, plus the matching archive/end policy constraints and the authoritative on-disk tree.
- [x] **pin-storage-failure-semantics** — In the updated docs/decision, explicitly define the canonical directory tree, authoritative-file rules, index/record skew repair, malformed-file and unknown-field tolerance, schema-mismatch/quarantine behavior, and whether concurrent writers are prevented, detected, or merely tolerated.
- [x] **add-schema-skeleton** — Add `src/session-registry-schema.ts` exporting the registry schema version constant, lifecycle/origin unions, graph-binding shape, record type, index-entry type, and index type.
- [x] **add-public-contract-types** — Add `src/session-registry-contract.ts` exporting the typed consumer-facing contract for list/detail views and safe mutation inputs (for example patch/update payloads) so downstream UI and relaunch work do not have to reverse-engineer the design prose from persisted shapes alone.
- [x] **sync-design-doc-nav** — Update touched-doc frontmatter plus `docs/design/index.md`, `docs/design/.vitepress/config.ts`, and `docs/design/decisions/README.md` so the design set, decision log, and sidebar stay consistent. While touching the decisions list, fix any related drift that would otherwise leave the docs inconsistent.
- [x] **verify-docs-and-code** — Add a lightweight Vitest surface test for the schema/contract exports, then run `npm test`, `npm run build`, `npm run lint`, and `npm run docs:build`; confirm the new decision number appears everywhere it should; verify the schema + contract modules export the planned surface; and confirm no brief/graph changes are required for issue #11.

## Key Decisions

- Keep `id` as a Streamliner-owned stable identifier and store the linked Copilot CLI session id separately as nullable observation metadata. This preserves a stable record for manual entries and for sessions whose Copilot state has been cleaned up.
- Treat the registry as a global local-runtime concern rather than a per-workstream artifact. The concrete storage path should live directly under `~/.streamliner/state/` in a registry-specific subtree so the same entry can outlive and outscope any single workstream.
- Use per-record JSON plus an index file with `schemaVersion`, atomic write-then-rename updates, and a single logical writer expectation. If a concurrent edit slips through, resolve it with last-writer-wins over the latest on-disk snapshot instead of introducing a database now.
- Make bad-state handling explicit: tolerate unknown extra fields from hand edits, quarantine malformed or incompatible files instead of partially merging them, and specify how index/record drift is repaired.
- Keep archiving builder-driven. Observation may mark linked sessions `ended`, but it should not silently auto-archive records the builder may still want for relaunch or context recovery.

## Scope Boundaries

- No persistence implementation yet — this issue stops at design and schema/types.
- No registry UI, relaunch workflow, terminal color bridge, event-observation expansion, or PAW control-state observation work.
- No workstream brief/graph edits unless the design work reveals a genuine scope shift that cannot be represented cleanly in the docs alone.

## Open Questions

None.
