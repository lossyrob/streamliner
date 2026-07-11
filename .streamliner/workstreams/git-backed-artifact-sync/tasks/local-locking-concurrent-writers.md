# Define local locking and concurrent-writer behavior

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `local-locking-concurrent-writers`
- Type: task
- Status: planned

## Outcome

Streamliner-owned local artifact writers, bootstrap/migration operations, and
the sentry cannot race one another against the same artifact root. The product
also behaves honestly when a builder edits files outside Streamliner or another
machine advances the artifact branch.

## Scope

### In scope

- Define lock identity, ownership, timeout, stale-lock, and recovery behavior.
- Serialize Streamliner-owned write, commit, fetch/update, and migration
  operations against one local artifact root.
- Decide whether locking is process-local, file-backed, API-owned, or layered.
- Detect non-Streamliner local edits and classify them as dirty input rather
  than overwriting them.
- Define concurrent remote writer behavior through fetch state, push rejection,
  divergence, and semantic-conflict stops.
- Cover multiple local source worktrees mapped to the same artifact worktree.
- Add deterministic concurrency and crash-recovery tests.

### Out of scope

- A distributed lock across builders.
- Automatic semantic merging.
- Preventing direct Git or editor use.

## Success criteria

- Two Streamliner-owned local operations cannot mutate the same root
  concurrently.
- Stale locks recover without silently discarding work.
- External local edits and remote writers remain visible and attributable.
- Cross-machine concurrency is handled by Git state, not misrepresented as
  locally serialized.
