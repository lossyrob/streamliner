# Plan

## Approach Summary

Issue #38 promotes workstream tracking from browser-local directory handles to a server-owned source registry. The implementation should keep existing sticky workstream URLs and path-backed legacy registry behavior working, but make configured source directories the primary workflow on `/workstreams`.

The core backend change is a source registry persisted under `~\.streamliner\state\workstream-registry\sources.json`. Sources are shallow-scanned using explicit patterns:

1. `project-root` scans `<root>\.streamliner\workstreams\*\graph.json`.
2. `workstreams-root` scans `<root>\*\graph.json`.

Scan results are merged with existing path-backed registrations into the existing `/api/workstreams` list response. Discovered workstreams get their identity from `graph.json` content and route through the existing `/workstreams/{projectKey}/{workstreamId}` URL shape.

The shared contracts should distinguish **source configuration** from **workstream entry origin**:

- `WorkstreamSourceConfig` / `WorkstreamSourceListEntry` describe registered roots (`project-root` or `workstreams-root`), path, health, last scan time, and scan messages.
- `WorkstreamRegistryListEntry.source` remains the entry-origin discriminator. Existing `"path"` and `"browser-directory"` values remain valid; source-discovered entries use a new origin such as `"source"`, plus `sourceId`, `sourceType`, and `sourcePath`.
- `WorkstreamRegistryListResponse` gains explicit `sources`, `conflicts`, and archive metadata so the UI does not infer health from flattened workstream cards.

Conflict semantics apply to **all** candidates with the same `{projectKey}/{workstreamId}`: legacy path-backed entries, browser-directory legacy entries, and source-discovered entries. Path-backed entries win route precedence over source-discovered entries to avoid surprising existing users; source-discovered candidates are still reported in `conflicts`. Among multiple source candidates, deterministic order is source creation time, then graph path. Conflict DTOs must include candidate origin, source id when available, graph path, and whether the candidate is currently used for route loading.

Archive/restore is local Streamliner state keyed by identity. Archived workstreams are hidden from the default active list, but conflict diagnostics and source health remain visible in source/conflict sections so archiving does not hide configuration problems. Restoring the identity makes the current winning candidate visible again. Archive state does not mutate graph files and can harmlessly outlive deleted sources.

Source deletion is in scope and is config-only: deleting a source removes that source configuration and its discovered entries from the active list on the next scan/list, clears source health for that source, and does not delete files or archive state. A sticky route that was only resolvable through a deleted source soft-fails as `workstream_not_found` unless another candidate remains.

Source scanning uses lazy startup semantics: the first `GET /api/workstreams` after API startup reads persisted sources and scans them before responding. Adding a source and manual refresh also scan. There is no eager boot hook and no watcher in this iteration.

Graph freshness and source-list freshness are separate. Existing graph route polling/live reads cover content changes for already resolved graphs. Source scans cover new workstreams, deleted graph files, invalid graph files, identity changes, and conflicts. If a previously discovered graph disappears or becomes invalid, the list reports a scan message and the graph route soft-fails with the existing graph error shape. If graph identity changes, the old identity disappears from source-discovered results and the new identity appears on the next scan; archived state remains keyed to the old identity until explicitly restored/cleaned later.

The frontend should replace the browser-native directory picker as the primary add flow with a lightweight source configuration form: choose source type, enter a local path, add source, refresh sources, archive/restore workstreams, and inspect source health/errors. Browser-directory code can remain as legacy support if removing it would create risk, but the visible primary UX should be server-side sources.

## Work Items

- [x] `contracts-and-source-store` — Extend shared contracts with source config/list DTOs, entry-origin metadata, scan messages, conflict DTOs, and archive metadata. Add `src/server/workstream-sources.ts` to persist source configuration, hidden/archive state, last scan health, and discovered workstream metadata under an injectable source registry path. Include shallow scanning for `project-root` and `workstreams-root`, graph parsing via existing workstream identity helpers, lazy first-list scan behavior, deterministic duplicate handling across all candidate origins, missing/deleted/invalid/identity-changing graph behavior, and tests that read/write only temporary directories.
- [x] `routes-and-registry-merge` — Extend `src/server/routes/workstreams.ts` and existing registry functions so `GET /api/workstreams` lazily scans persisted sources and returns path-backed entries plus discovered source entries, `GET /api/workstreams/:projectKey/:workstreamId/graph` resolves path-backed entries first and source-discovered entries second, and source management endpoints support list/add/delete/refresh/archive/restore. Preserve existing `POST`, `PATCH`, and `DELETE /api/workstreams` behavior for path-backed compatibility. Reject non-directory source paths on add; keep existing sources registered but unhealthy if their directory later disappears. Add API tests for source add/refresh/discovery, scan after restart/first list, missing/invalid sources, deleted/invalid/identity-changing graph files, duplicate conflicts across path/source and source/source candidates, archive/restore under conflict, source deletion, graph updates from disk, and legacy path compatibility.
- [x] `workstreams-ui` — Update `src/App.tsx` and `src/streamliner-theme.css` so `/workstreams` shows source management: add-source form, source health/scan status, manual refresh, conflict/error indicators with diagnostic paths/source ids, active vs archived workstream sections, archive/restore actions, source deletion, and path/source labels on cards. Keep sticky route loading and polling unchanged from the user's perspective. Hide browser directory picking from the primary UI but leave legacy browser-directory loading/deletion support intact for existing local browser entries if low-risk.
- [x] `frontend-tests-and-screenshot` — Update `src/App.test.tsx` for the new source workflow: add a source from path input, refresh sources, open a discovered workstream, archive/restore an entry, and soft-fail missing graphs. Capture at least one representative `/workstreams` screenshot with `scripts\screenshot.mjs` after UI changes.
- [x] `design-docs` — Update `docs/design/decisions/007-tracked-workstream-registry.md` append-only to record the shift from browser directory handles to server-side source directories as the primary model. Only add coordination entries if a new design doc or decision file is created; this plan updates the existing decision only.
- [x] `validation-and-pr` — Run targeted server/UI tests, full lint/build, final review, commit with selective staging, push the feature branch, and create a PR whose title includes `#38`.

## Key Decisions

1. **Source directories are server-owned local state** — persisted under `~\.streamliner\state\workstream-registry\`, injectable in tests.
2. **No file watchers in this iteration** — scan on the first list request after API startup, source add, and manual refresh is enough for correctness; polling graph content remains per graph route.
3. **Shallow explicit scanning only** — avoid broad recursive traversal and surprising performance issues.
4. **Existing URL identity remains canonical** — `/workstreams/{projectKey}/{workstreamId}` continues to route by graph identity, not source id or filesystem path.
5. **Archive does not mutate disk** — archive/restore changes local UI state only.
6. **Conflicts are visible and deterministic** — path-backed precedence is applied first; among source-discovered candidates, source creation time then graph path picks the route-loading candidate. All candidates are reported in source/conflict metadata.
7. **Legacy path registry stays compatible** — existing registered graph entries continue to work while sources become the primary visible add flow.
8. **Manual path entry is acceptable** — browser APIs cannot provide durable absolute paths, so this iteration uses local path input rather than browser pickers.
9. **Lazy startup scan** — first `GET /api/workstreams` after API startup scans persisted sources before responding; no eager boot scan is required.
10. **Path-backed precedence** — legacy/path entries win over source-discovered entries for route loading when identities overlap; overlaps are still reported as conflicts.
11. **Browser-directory legacy support stays hidden** — keep existing browser-directory entries working when practical, but remove the picker from the primary add/relink UI.
12. **Source deletion is config-only** — delete source configuration and discovered entries only; never delete graph files or archive state.

## Done When

- A user can add a `project-root` or `workstreams-root` source path and see discovered workstreams on `/workstreams`.
- Persisted sources are scanned on the first workstreams list request after API restart.
- Existing path-backed registered workstreams still list, route, relink, and delete as before.
- Sticky `/workstreams/{projectKey}/{workstreamId}` routes load source-discovered graphs and reflect graph content changes from disk.
- Missing source directories, invalid paths, deleted graphs, invalid graphs, identity changes, and duplicate identities are surfaced clearly without crashing the UI.
- Archive/restore hides and restores workstreams without mutating disk and without hiding conflict diagnostics.
- Browser-specific file/directory handles are not required for the primary add-source workflow.
- Tests use temporary directories or mocked fetches only and do not read/write the user's real `~\.streamliner` state.

## Open Questions

None.
