# Plan

## Approach Summary

Issue #111 makes launch claims short-lived coordination records while keeping node/session graph bindings durable. The fix keeps the existing cleanup rule for failed or expired claims, but changes startup reconciliation and inspector recovery so successful launches do not lose their node association just because the claim file was pruned.

**Architecture**:
1. **Registry reconciliation** (`src/session-registry/launch-claims.ts`) — startup recovery deletes only launched reserved rows with no real terminal or managed runtime evidence. Rows with a `copilotSessionId` or managed runtime are preserved with their `graphBinding` intact after the claim is gone.
2. **Binding lifecycle tests** — extend launch-claim integration and startup tests to cover bind -> retention prune -> startup reconcile, managed runtime preservation, stale unbound terminal release, and inverted legacy expectations that previously cleared graph bindings.
3. **Node launch record recovery** (`src/server/routes/node-launch-records.ts`, `src/server/node-launch-record-store.ts`) — stale `launched_pending_binding` operations with no blocking claim can be resolved. A blocking latest claim is an active claim state that can still complete normal binding, such as `reserved`, `launching`, or `launched`; terminal released/failed/expired claims and missing claim files are not blocking. If node-launch metadata and a matching launched registry row are available, restore the graph binding; otherwise release the stale operation so it no longer appears stuck. Do not add proactive backfill for already-broken historical rows; the operator prefers to repair those manually if needed.
4. **Inspector recovery affordance** (`src/components/NodeInspector.tsx`) — expose the release/resolve action for stale pending-binding operations when the launch claim no longer blocks.
5. **Design documentation** (`docs/design/session-system.md`) — document that launch claims may be pruned while the registry `graphBinding` remains authoritative for historical session/node association, the stale inspector recovery path, and the no-proactive-backfill scope.

## Work Items

- [x] `registry-reconciliation` — Update `reconcileOrphanReservedRows` so missing launch-claim rows with no `copilotSessionId` and no managed runtime are deleted, while rows with a real terminal session or managed SDK runtime preserve existing `graphBinding`. Keep `applyReservedRowCleanup` unchanged for non-bound terminal failed/expired claims so untrusted attachments do not leak graph bindings.
- [x] `binding-reconciliation-tests` — Add/adjust Vitest coverage in `launch-claim-binding.integration.test.ts`, `launch-claims.test.ts`, `background-worker.launch-claim.test.ts`, and focused route/store tests for bind -> prune -> startup reconcile preserving `graphBinding`, managed SDK preservation, deletion of un-attached reserved rows, and stale unbound terminal release. Explicitly invert existing expectations that orphan real-session/managed rows clear `graphBinding`.
- [x] `stale-operation-recovery` — Update node launch record routing/store behavior so `launched_pending_binding` with no blocking latest claim can be resolved on demand. Treat active latest claims (`reserved`, `launching`, `launched`) as blocking because they can still complete normal binding; missing or terminal latest claims are stale. Attempt graph-binding repair from operation/record metadata plus launched registry row evidence first; if repair evidence is insufficient, mark the operation released/failed. Do not add proactive startup/backfill repair for old already-cleared rows. Add route/store tests.
- [x] `inspector-recovery-ui` — Update `NodeInspector` so stale pending-binding operations with no blocking claim surface the existing recovery control with accurate copy. Required verification is the route/store recovery coverage for the inspector-triggered action; add component-level coverage as well if an existing focused test harness is available.
- [x] `design-doc-update` — Update `docs/design/session-system.md` in the same PR after code behavior stabilizes, covering the launch claim retention contract, durable registry binding behavior, stale pending-binding recovery semantics, the explicit no-proactive-backfill scope, and the operator-facing manual repair boundary for purely historical broken rows that have no stale operation. No decision record is planned because this refines existing launch-claim retention semantics rather than replacing an accepted decision.

## Key Decisions

1. **Bound-session durability lives in the session registry** — claim files are allowed to disappear after retention, but `SessionRegistryRecord.graphBinding` remains the durable node/session association once a real session or managed runtime exists.
2. **Failed/expired cleanup remains stricter** — `applyReservedRowCleanup` still clears `graphBinding` when a non-bound claim attached to a terminal session; this avoids presenting untrusted or nonce-missing sessions as bound.
3. **Repair is on-demand, not proactive** — restore a missing `graphBinding` only when a stale node-launch operation is being resolved and node-launch metadata identifies the workstream/node/claim plus a registry row tied to that launch claim with real terminal or managed runtime evidence. A verified repair also transitions any retained matching terminal claim to `bound` so claim sweeps do not re-clear the restored binding. Do not run startup backfill for old already-cleared rows.
4. **Stale pending-binding resolution is guarded by claim state** — inspector release for `launched_pending_binding` is available only when no latest claim is currently blocking. Active latest claims (`reserved`, `launching`, `launched`) continue to use the existing claim release path; missing or terminal latest claims can be resolved as stale operations.
5. **No schema migration** — use existing `origin.launchClaimId`, operation handoff metadata, terminal/managed launch summaries, and registry `graphBinding` fields.
6. **Historical broken sessions are manual repair scope** — existing rows that were already disconnected by the old startup reconciliation bug and are not represented by a stale launch operation are outside this implementation's automatic repair scope per operator decision.

## Open Questions

None
