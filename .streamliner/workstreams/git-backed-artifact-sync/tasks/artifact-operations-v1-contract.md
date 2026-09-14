# Define artifact-operations-v1 API contract

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `artifact-operations-v1-contract`
- Type: research
- Status: planned

## Outcome

Streamliner has an accepted storage-neutral local API contract for reading,
changing, validating, promoting, and synchronizing project artifacts. The local
Git worktree is one provider behind the contract, not the permanent public API.

## Inputs

- `.streamliner/workstreams/git-backed-artifact-sync/brief.md`
- Output of `artifact-root-v1-contract`
- `DISTRIBUTED-CONTROL-PLANE.md`
- `ORCHESTRATION.md`
- `docs/design/decisions/006-local-streamliner-api-service.md`
- Existing graph reads and workstream configuration PATCH behavior
- Existing atomic file-write and process-lock patterns

## Scope

### In scope

- Define `artifact-operations-v1` identities and capability reporting.
- Use an opaque artifact `revision`; expose `gitCommit` only as optional local
  provider provenance.
- Define coherent snapshot, list, and read operations.
- Define begin-change, validate, expected-revision mutation, and promote/apply
  operations.
- Decide the minimum V1 mutation shapes:
  - whole-file replacement for Markdown and generic artifacts;
  - typed/structured operations where Streamliner already owns the schema;
  - optional patch input when it can be validated safely.
- Define typed stale-revision, dirty-root, validation, compatibility, trust,
  unavailable-provider, and conflict errors.
- Define operation provenance: actor/session, source revision, changed paths,
  validation result, resulting revision/commit, and correlation ID.
- Define manual synchronization and status operations that Wave 2 automation
  will implement behind the same API.
- Define which read-only callers may consume an optional local path capability
  without making it required of remote providers.
- Define the boundary between canonical mutations, isolated change workspaces,
  and direct external edits.
- Produce a compatibility path for a future API-backed active-state provider.
- Update project design authority or add a decision record for the accepted
  contract.

### Out of scope

- Implementing the operations API.
- Building a hosted or remote artifact service.
- Cross-machine distributed locking.
- CRDTs, semantic merge, or collaborative live editing.
- Requiring every local read to pass through HTTP.
- Defining project launch-policy semantics.

## Expected output

- The accepted `artifact-operations-v1` contract.
- Request/response and typed-error examples.
- Capability model for local Git and future remote providers.
- Minimal V1 mutation-shape decision.
- Provenance and expected-revision rules.
- Implementation and validation matrix for downstream nodes.
- Any required Design or decision-record update.

## Success criteria

- Product callers can mutate artifacts without knowing the canonical worktree
  path or issuing Git commands.
- Two writers starting from the same revision cannot silently overwrite one
  another.
- A local Git provider and a future remote provider can satisfy the same logical
  contract.
- Direct file reads remain possible where useful without bypassing canonical
  write/sync ownership.
- Direct external edits are represented as a visible dirty/conflict state, not
  silently overwritten.
- The contract centralizes promotion and synchronization without centralizing
  every editor keystroke.

## Documentation impact

Design impact is expected because this node defines the long-lived artifact
mutation boundary between local Git storage and a future remote state provider.
