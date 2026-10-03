# Define application and artifact schema compatibility

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `app-artifact-schema-compatibility`
- Type: research
- Status: planned

## Outcome

Streamliner can decide whether the local application version may safely read or
write a shared project manifest and artifact set. Unsupported, newer, older, or
malformed formats produce explicit read-only, blocked, upgrade, or recovery
diagnostics instead of partial parsing or success-shaped fallback behavior.

## Scope

### In scope

- Define manifest schema version negotiation and compatibility ranges.
- Define application-version and artifact-format diagnostics.
- Define read-only versus write-blocked behavior for newer and older formats.
- Define upgrade, downgrade, backup, and rollback expectations.
- Cover graph, brief, local task specs, shared record references, and future
  manifest evolution without making the manifest a duplicate workstream index.
- Separate Artifact Sync format compatibility from `launch-policy-v1`
  compatibility and validation, which remain Plugin Role Skills responsibilities.
- Define test cases for unsupported app versions and mixed-version builders.

### Out of scope

- Define or validate `launch-policy-v1`.
- Implement a general artifact migration framework.
- Silently rewrite incompatible artifacts during discovery.

## Success criteria

- Bootstrap and launch callers receive typed compatibility state.
- Incompatible writers cannot corrupt an artifact set.
- A cold builder knows whether to upgrade Streamliner, recover history, or use a
  supported read-only path.
- The authority gate includes mixed-version and unsupported-version evidence.
