# Work Shaping

## Problem Statement

Streamliner currently has sticky workstream routes, but the primary add/relink flow is still tied to browser-local directory handles. That solved the brittle server-launched Windows file picker, but it does not provide durable path-based tracking across browser profiles, cleared storage, origin changes, or devbox/browser restarts.

The user needs a Streamliner-owned way to register source directories once, discover workstreams from disk, keep graph views sticky by `{projectKey}/{workstreamId}`, and reflect updates to `graph.json` without re-registering or re-permitting browser access.

## Core Functionality

1. Add a server-side workstream source registry persisted under Streamliner's local runtime state.
2. Support source directories that can be scanned for workstreams:
   - project roots containing `.streamliner\workstreams\*\graph.json`
   - workstreams roots containing `*\graph.json`
3. Discover workstream entries from graph identity and serve their graph content from disk.
4. Surface source health, scan errors, missing graphs, invalid graphs, and duplicate identity conflicts.
5. Allow discovered workstreams to be archived/hidden without mutating files on disk.
6. Update `/workstreams` UI to manage sources, refresh scans, delete source configuration without mutating disk, show archive/restore controls, and continue linking to sticky graph routes.

## Supporting Features

- Preserve compatibility with existing path-backed registered workstreams where practical.
- De-emphasize browser directory handles so the primary workflow is server path based.
- Keep scan-on-demand and scan-on-start behavior simple; file watchers can come later.
- Soft-fail graph loading when files disappear or become invalid.

## Key Design Choices

- **Server-owned paths are canonical.** Source configuration and hidden/archive state belong under `~\.streamliner\state\...`, not browser storage.
- **Directory sources beat individual file registration.** The user should register stable roots, not repeatedly pick `graph.json`.
- **Discovered identity comes from graph content.** URLs continue using `/workstreams/{projectKey}/{workstreamId}`.
- **Archive is local UI state.** It hides entries but does not delete or change graph artifacts.
- **Conflicts are visible.** Duplicate `{projectKey}/{workstreamId}` candidates should be reported rather than silently masking unexpected sources, including overlaps between legacy path-backed entries and source-discovered entries.
- **Archive is identity-scoped but diagnostics remain visible.** Hiding a workstream removes it from the default active list without hiding source health or conflict information.
- **Manual path entry is acceptable here.** Browser-native pickers cannot provide absolute paths; a simple local path configuration flow is more robust for this iteration.

## Edge Cases

- Source path missing: keep source registered, mark it unhealthy, and show the scan error.
- Source path is not a directory: reject when adding or mark unhealthy if it becomes invalid.
- Invalid `graph.json`: show scan warning/error for that source without crashing the workstreams page.
- Duplicate identity across sources: expose a conflict and choose deterministic primary resolution for route loading.
- Archived workstream still exists on disk: hide by default; show in archived mode with restore action.
- Archived workstream disappears: keep archive state harmless and allow cleanup later.
- Existing path registry entries: continue showing/serving them or migrate them into the new model without breaking existing sticky URLs.
- Source deletion: remove only Streamliner source configuration and discovered entries; never delete graph files or archive state.

## Rough Architecture

- `src/server/workstream-sources.ts` owns source persistence, scanning, discovery, conflict detection, hidden/archive state, and graph path resolution.
- `src/server/routes/workstreams.ts` gains source-management endpoints and routes graph reads through discovered source resolution.
- `src/workstream-registry-contract.ts` defines shared source, discovery, health, archive, and conflict DTOs.
- `src/App.tsx` uses server APIs for add source, refresh sources, archive/restore, and graph loading. Browser directory persistence becomes fallback/legacy-only or is removed from the primary flow.
- `docs/design/decisions/007-tracked-workstream-registry.md` is updated to record the transition from browser handles to server source directories.

## Critical Analysis

This is more robust than browser handles because the API process owns filesystem paths and can rediscover workstreams independently of browser profile state. The tradeoff is that path entry is less polished than a native picker, but it is predictable, works on devboxes, and preserves live disk reads. A future native desktop helper or source autodiscovery flow can improve ergonomics without changing the source registry model.

## Risks

- Scanning too broadly could be slow or accidentally traverse unrelated directories; keep the patterns shallow and explicit.
- Duplicate identity handling can confuse users if the UI hides details; expose enough source/path context to diagnose.
- Keeping old path registry and browser-directory code alongside sources can create split-brain behavior; make the new source model primary and keep compatibility narrow.
- Tests must avoid touching the user's real `~\.streamliner` state.

## Open Questions

None for this iteration. The implementation should choose simple, reversible defaults and avoid watchers until a later optimization.
