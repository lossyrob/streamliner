# Implement convention-first artifact bootstrap

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `convention-first-bootstrap`
- Type: task
- Status: planned

## Outcome

From a normal source checkout, a builder can discover an existing remote
`streamliner-artifacts` branch or preview creation of the conventional
artifact-only orphan branch, create or adopt its separate worktree, read the
shared project manifest, and persist the local repository-to-root mapping
without personal path instructions.

## Scope

### In scope

- Identify the source repository and configured remote deterministically.
- Discover the conventional remote branch and existing matching worktrees.
- Preview repository, branch, worktree path, initial artifact contents, and
  authority implications before any branch/worktree creation.
- Require explicit builder confirmation before creation.
- Create the artifact-only orphan branch and separate worktree when confirmed.
- Adopt an existing worktree only after repository and branch identity checks.
- Read and validate the shared manifest before registering the root.
- Persist and repair the local repository-to-root mapping.
- Provide dry-run, status, and actionable recovery diagnostics.

### Out of scope

- Custom branch names or source-branch pointer files.
- Automatic artifact migration; owned by the cutover node.
- Automatic fetch/commit/push sentry behavior.

## Success criteria

- A fresh environment needs only the source checkout and repository access.
- No filesystem mutation occurs before preview and confirmation.
- Re-running bootstrap is idempotent for a healthy adopted worktree.
- Missing branches, path collisions, repository mismatch, and invalid manifests
  fail explicitly.
- The resolved root is immediately consumable through `artifact-root-v1`.
