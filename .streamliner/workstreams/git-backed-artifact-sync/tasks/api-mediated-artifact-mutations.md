# Implement API-mediated artifact mutations

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `api-mediated-artifact-mutations`
- Type: task
- Status: planned

## Outcome

All Streamliner-owned canonical artifact writes use
`artifact-operations-v1` with expected revisions, validation, local writer
serialization, atomic application, and provenance. Direct edits remain usable as
an explicit external-edit path that pauses automation instead of being
overwritten.

## Inputs

- `.streamliner/workstreams/git-backed-artifact-sync/brief.md`
- Accepted `artifact-operations-v1-contract`
- Accepted application/artifact compatibility contract
- Output of `local-locking-concurrent-writers`
- Existing graph reads and workstream configuration PATCH route
- Existing atomic file replacement and API process-lock patterns

## Scope

### In scope

- Implement the local Git-backed `artifact-operations-v1` provider.
- Add coherent snapshot/list/read behavior with opaque revisions and Git commit
  provenance.
- Add expected-revision whole-file and structured mutation support for the first
  accepted artifact types.
- Validate changed artifacts before canonical application.
- Acquire the canonical local writer lock inside the API mutation path.
- Apply accepted changes atomically and record operation provenance.
- Expose explicit manual status/fetch/update/commit/push operations through the
  API with preview, confirmation where consequential, and typed Git failures.
- Route existing Streamliner-owned graph/configuration mutations through the
  new boundary.
- Detect a dirty canonical worktree before mutation.
- Treat direct/non-Streamliner file changes as external dirty input and expose
  explicit adopt, commit, revert, or reconcile actions.
- Add typed conflict and recovery responses for stale revisions, validation
  failure, concurrent local operations, and unavailable providers.
- Add focused tests for concurrent expected-revision writes, direct edits,
  failed validation, crash recovery, and atomic application.

### Out of scope

- Automatic or unattended fetch/push synchronization; Wave 2 owns it.
- Isolated multi-file change workspaces; Wave 2 owns the richer authoring flow.
- Hosted or cross-machine mutation APIs.
- Automatic semantic merge.
- Preventing builders from editing files directly.
- Moving runtime state or message history into the artifact branch.

## Expected output

- Local Git provider for `artifact-operations-v1`.
- API routes/service methods for accepted snapshot and mutation operations.
- Existing product-owned graph/configuration writes routed through the gateway.
- External-edit detection and builder disposition behavior.
- Provenance and typed conflict records.
- Tests covering serialization, validation, stale revisions, and recovery.

## Success criteria

- Concurrent Streamliner-owned writes cannot silently overwrite each other.
- Product-owned code no longer writes canonical artifact files outside the API
  mutation boundary.
- Invalid or stale changes fail before canonical files are replaced.
- Direct editor/agent changes remain visible and recoverable.
- The canonical worktree never auto-syncs while unresolved external edits are
  present.
- Callers operate on logical revisions rather than depending on worktree paths.

## Documentation impact

Architecture and user guidance should explain the canonical API mutation path,
the direct-edit escape hatch, and how external dirty changes are reconciled.
