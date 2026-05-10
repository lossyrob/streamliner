# Managed Runtime Startup Reconciliation Plan

## Problem and approach

Streamliner currently reconciles orphan launch-claim reserved rows when the session-registry background worker starts, but it does not reconcile active SDK-managed runtime rows that were left behind by a previous API process. This can make My Sessions and graph overlays present stale background workers as live.

Implement startup reconciliation as a registry-level helper that scans non-archived Streamliner-owned managed SDK rows in active lifecycle states. If a row does not have a verifiably live owner in the current API process, patch its runtime metadata through `SessionRegistryFileStore.patchRuntimeMetadata` to a safe diagnostic state with typed progress data. Wire that helper into `SessionRegistryBackgroundWorker.start()` so it runs synchronously before timers and before ordinary polling/indexing work. Preserve terminal managed outcomes and terminal-owned takeover rows.

## Work items

1. Add a managed runtime startup reconciliation helper under `src/session-registry/` with explicit result counts, typed diagnostic reason/action data, optional live-owner verification, canonical active-state scoping, and safe patching through runtime metadata merge semantics.
2. Wire the helper into `SessionRegistryBackgroundWorker.start()` so managed-runtime reconciliation runs once per worker startup before launch-claim reconciliation, timers, discovery, indexing, and summarization. Managed reconciliation failures should be logged and isolated so the background worker and launch-claim recovery still start.
3. Add unit coverage for parameterized stale active-state reconciliation, verifiably-live skip behavior, terminal-state preservation, `terminal_takeover` skip behavior, archived-row preservation, and one-shot startup execution.
4. Add projection/overlay coverage proving reconciled rows no longer render as active managed workers and expose diagnostic progress for builder-visible recovery.
5. Validate with targeted tests, then repository lint/build/test as appropriate before commit and PR.
6. Capture crash/restart-shaped evidence by seeding a persistent registry directory with active managed rows, starting a new `SessionRegistryBackgroundWorker`, and asserting the reconciled registry/overlay result. Include this evidence in final PR notes for the usability gate.

## Key decisions and considerations

- Reconciled stale rows should use `interrupted` for Streamliner-owned SDK states that represent SDK execution or paused SDK work (`preparing`, `starting`, `running`, `idle`, `waiting_for_builder`, `interrupt_requested`, `pr_ready`, `review_ready`, `cleanup_ready`, `cleaning_up`). `interrupted` is non-active for duplicate managed-runtime checks and already enables the existing managed resume path in the launch dialog. The diagnostic payload must preserve the previous lifecycle so the builder can see whether the stale row came from startup, execution, review, PR, or cleanup.
- `terminal_takeover` rows are scanned but skipped when `runtimeOwner` is `builder-terminal`, because terminal takeover is one-way and SDK -> CLI -> SDK round-tripping is out of scope. A Streamliner-owned SDK row should not normally be in `terminal_takeover`; if encountered, preserve it rather than forcing an SDK resume path, and log/return a skipped count so the anomaly is visible without clobbering the handoff state.
- Terminal managed outcomes (`completed`, `failed`, `canceled`, `interrupted`, `cleaned_up`) and terminal-owned takeover rows must not be clobbered.
- Production startup currently has no durable cross-process SDK liveness proof. Any active Streamliner-owned managed row present at API startup is therefore treated as a previous-process row and unverifiable by default. The helper will support an optional `isOwnerLive(session)` verifier for tests and future liveness mechanisms; without that verifier it intentionally reconciles active Streamliner-owned rows rather than presenting phantom live workers.
- Diagnostic details should be stored in a sanitized `lifecycle` progress event. Planned data shape:
  - `reason: "startup-reconciliation-sdk-owner-unverified"`
  - `action: "marked-interrupted-for-builder-recovery"` or `"preserved-terminal-takeover"`
  - `previousLifecycleState`, `runtimeOwner`, `launchClaimId`, `launchNonce`, `sdkSessionIdPresent`, and `workstreamId`/`nodeId` when graph-bound
  These fields are identifiers or booleans only; raw prompts, tool data, and SDK output remain excluded by existing runtime progress sanitization.
- Use canonical runtime predicates/fields rather than duplicating UI heuristics: `runtime.runtimeKind === "managed-sdk"`, `runtime.runtimeOwner`, `runtime.lifecycleState`, `isManagedRuntimeActive(runtime)`, `session.lifecycleStatus !== "archived"`, and `SessionRegistryFileStore.patchRuntimeMetadata`.
- If a malformed registry row cannot be normalized/listed by the store, reconciliation should not invent recovery data outside the existing store error path. If a runtime patch for one row fails, log it and continue with remaining rows so one bad row does not block startup recovery for all others.

## Out of scope

This plan does not add remote/cloud worker recovery, a process supervision backend, automatic SDK resume, PID/heartbeat ownership proof, or SDK -> CLI -> SDK round-tripping after terminal takeover.

## Code anchors

- `src/session-registry/background-worker.ts` - `start()` already has a synchronous pre-poll startup recovery slot for launch-claim reconciliation.
- `src/session-registry/managed-runtime.ts` - defines active/terminal managed lifecycle sets and `isManagedRuntimeActive`.
- `src/session-registry/file-store.ts` - `patchRuntimeMetadata` merges runtime patches and emits registry change events.
- `src/managed-runtime-contract.ts` and `src/workstream-runtime-overlay.ts` - project runtime metadata/progress into My Sessions and graph overlays.
- `src/server/managed-sdk-runner.ts` - `DefaultManagedSdkRunner.activeRuns` is in-process only, which is why previous-process rows are unverifiable after API restart.
