# Define artifact-root-v1 and project manifest contract

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `artifact-root-v1-contract`
- Type: research
- Status: ready

## Outcome

Streamliner has an accepted `artifact-root-v1` contract for resolving one
authoritative artifact root from source-repository identity. The contract
defines the shared project manifest, local repository-to-root mapping, resolver
responses, diagnostics, authority state, and the boundaries consumed by
bootstrap, migration, launch preparation, the dashboard, and plugin roles.

## Scope

### In scope

- Define stable repository identity and `projectKey` relationships.
- Define the conventional `streamliner-artifacts` artifact-only orphan branch.
- Define the minimum shared project manifest fields and version marker.
- Define local mapping fields under `~/.streamliner/state`.
- Define resolver availability, commit/snapshot, trust, sync, and blocking
  states, including honest unchecked/manual states.
- Define typed diagnostics for missing branches, worktree collisions, repository
  mismatch, stale mappings, missing manifests, and unsupported versions.
- Define how existing workstream source discovery consumes the resolver.
- Identify every current graph-path, workstream-directory, repo-root, launch,
  context, dashboard, and plugin consumer that must stop deriving paths.
- Update project design authority where the accepted contract changes intended
  system behavior.

### Out of scope

- Implement bootstrap, migration, sentry, UI, or Telex behavior.
- Define `launch-policy-v1`; Plugin Role Skills owns that contract.
- Add custom artifact branch or pointer-file support.

## Success criteria

- Another Wave 1 node can implement bootstrap without inventing path or
  authority semantics.
- Consumers can distinguish unavailable, incompatible, untrusted, unsynchronized,
  and ready roots.
- The contract supports a single artifact commit snapshot.
- Runtime state remains local and the artifact branch contains no message or
  watch-state files.
- The authority gate has concrete contract evidence to review.
