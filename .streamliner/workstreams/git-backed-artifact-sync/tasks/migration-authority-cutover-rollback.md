# Implement migration authority cutover and rollback

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `migration-authority-cutover-rollback`
- Type: task
- Status: planned

## Outcome

An existing source-branch or planning-repository artifact tree can move to the
artifact branch through a previewed, attributable, reversible cutover that leaves
one authoritative copy. A failed or rejected migration restores the prior
authority without losing artifact history.

## Scope

### In scope

- Inventory candidate artifact trees and select one authoritative source.
- Detect duplicate, dirty, stale, or conflicting candidate copies.
- Preview copied paths, excluded runtime/personal data, target commit, and
  source-branch cleanup or archival.
- Require explicit confirmation before the authority-changing operation.
- Write the artifact branch through the accepted local lock.
- Verify manifest, graph, brief, local specs, source links, and resolver state.
- Remove or archive the former artifact copy so it cannot continue to look
  current.
- Define rollback points before and after push and branch-protection failures.
- Preserve an understandable, attributable Git history.

### Out of scope

- Indefinite bidirectional mirroring.
- Automatic semantic conflict resolution.
- Moving source code or durable source design docs onto the artifact branch.

## Success criteria

- Exactly one artifact root is authoritative after success.
- Failure can restore the prior authority and local mapping.
- Runtime state, local prompt profiles, credentials, and Telex data are excluded.
- A cold reader can understand the cutover and rollback from Git history and
  diagnostics.
- The authority gate can verify both successful migration and a forced rollback.
