# Provide single-commit launch snapshots

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `single-commit-launch-snapshots`
- Type: task
- Status: planned

## Outcome

Launch and context preparation bind to one artifact commit and read the manifest,
graph, brief, shared records, local specs, and provenance from that coherent
snapshot. Artifact movement during preparation is detected and handled
explicitly rather than producing a mixed-context worker launch.

## Scope

### In scope

- Define and implement the snapshot token/commit returned by
  `artifact-root-v1`.
- Make launch preparation and context assembly use the bound snapshot for every
  artifact input.
- Record the artifact commit and resolved shared-record references in launch
  provenance.
- Define retry, restart, and fail behavior when the artifact branch advances.
- Preserve source-repository design and tracker links while artifact files come
  from the artifact branch.
- Cover missing files and compatibility changes discovered after binding.

### Out of scope

- Persisting generated launch runtime state on the artifact branch.
- Evaluating or merging `launch-policy-v1`.
- Preventing other machines from advancing the remote branch.

## Success criteria

- A launch cannot combine graph content from one commit with policy or brief
  content from another.
- Movement produces a typed retry or failure state.
- Provenance identifies the exact artifact commit and shared references used.
- Snapshot reads remain compatible with local writers and sentry locking.
