# Validate off-branch, cloud-agent, and source-link compatibility

## Node

- Workstream: `git-backed-artifact-sync`
- Node ID: `off-branch-cloud-source-link-compatibility`
- Type: task
- Status: planned

## Outcome

Streamliner can operate when artifacts and source/design files are on different
branches and worktree roots, including cloud-agent environments that begin from
a source checkout. Graph repo references, design references, local specs,
tracker links, and launch context continue to resolve correctly.

## Scope

### In scope

- Exercise source checkout plus artifact-only worktree layouts on supported
  local environments.
- Exercise a cloud-agent or equivalent fresh environment with no private path
  configuration.
- Verify `repoId` and source-repository design links from artifact-branch graphs.
- Verify local tracker/spec paths resolve relative to the artifact workstream.
- Verify launch cwd and target source repo remain separate from artifact paths.
- Verify UI navigation and diagnostics do not assume one shared root.
- Document unsupported environments or unavoidable bootstrap prerequisites.

### Out of scope

- Hosted synchronization services.
- Cross-repository artifact roots.
- Copying source design docs onto the artifact branch.

## Success criteria

- A cloud/fresh agent can bootstrap artifacts from repository conventions.
- Source links and design references open the source repository, not the
  artifact-only worktree.
- Local specs and briefs resolve from the artifact snapshot.
- Context assembly reports missing source or artifact inputs distinctly.
