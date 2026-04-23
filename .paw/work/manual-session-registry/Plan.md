# Plan

## Approach Summary

Implement the manual session registry in three layers so downstream Wave 2 work can consume one stable runtime surface without contract churn: a file-backed `SessionRegistryStore` under `src/session-registry/`, an in-process dashboard runtime host that exposes registry endpoints from the local Node server, and a sibling "My Sessions" UI surface that uses those endpoints with autosaved edits. The app shell must render navigation independently of successful graph loading so the sessions surface remains reachable when no graph is configured or graph load fails. Browser/store synchronization for this node will stay deliberately simple: after each mutation the browser refetches the affected registry data, and it also performs light periodic polling for external/store-driven changes rather than adding SSE or websocket infrastructure now. The store must preserve unknown extra entry fields on rewrite so Streamliner honors the accepted storage contract while still updating known fields safely. Carry over the useful persistence hardening from `donna` — serialized overlapping saves, temp-file write-then-rename, and Windows-aware rename retries — while keeping the existing workstream canvas intact, preserving the `src/session-registry-schema.ts` and `src/session-registry-contract.ts` contracts as-is, and only updating design docs if the implemented host/runtime behavior adds durable detail beyond the current issue spec and design docs.

## Work Items

- [x] Implement the persistent registry core under `src/session-registry/` using Decision 005's `entries/`, derived `index.json`, `quarantine/`, advisory lock, rebuild, CRUD, attach, archive, delete, and subscription semantics, including serialized overlapping writes, Windows-safe temp-file rename retries, and preservation of unknown extra entry fields on rewrite.
- [x] Host a singleton registry store in the dashboard's local Node runtime by extending the existing Vite-backed server surface with session list/get/create/patch/archive/delete endpoints while preserving the current graph endpoints, and use post-mutation refetch plus light polling as the browser-facing synchronization mechanism for this node.
- [x] Add a sibling "My Sessions" dashboard surface with top-level navigation, URL-addressable view selection, list/create/edit/archive/delete flows, and 500 ms autosave/flush behavior backed by the runtime API; refactor the top-level app shell so the sessions route remains usable even when no graph is configured or the graph fails to load.
- [x] Add targeted regression coverage and harness updates for store persistence, runtime API behavior, and the sessions view reload path, including restart-simulation, overlapping-save, corrupted-state recovery, direct sessions-route/no-graph reachability, open-view polling detection of external/store-driven changes, and `SessionRegistryStore` contract behavior (`listSessions` sort/filter rules, `attachObservedSession` merge/preservation semantics, source-sensitive lifecycle restrictions, rebuild/delete behavior, unknown-field preservation, and emitted change events); update `docs/design/session-system.md` only if the landed runtime-host or routing behavior needs to be promoted into durable design guidance.

## Key Decisions

- Use the dashboard's in-process Node runtime as the only writer in Wave 2 by growing the existing Vite plugin/server surface instead of introducing a separate daemon.
- Keep the current session-registry schema and contract files unchanged; treat any required contract change as a stop-and-escalate event instead of an implementation detail.
- Make the sessions experience a sibling to the graph, not a replacement, so the current canvas/inspector flow stays intact.
- Use a lightweight URL-addressable view toggle for the sibling sessions surface in this node rather than introducing a broader pathname-router abstraction now.
- Use browser-side post-mutation refetch plus light periodic polling for cross-boundary session updates in this node instead of introducing SSE or websocket infrastructure.
- Keep the store implementation observation-ready by isolating file-backed mutation logic from future watcher code; `donna`'s parent-watch plus bounded `events.jsonl` reads are useful follow-on patterns, but they should land as a later observer concern rather than being entangled into this node.

## Open Questions

None.
