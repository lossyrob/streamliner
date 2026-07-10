# Git-backed Artifact Ledger & Sync

## Status

Shaped; ready for formation after review of the Shared Project Operations
campaign.

## Summary

Let a project's Streamliner artifacts live on a dedicated same-repository branch,
normally `streamliner-artifacts`, and keep a separate artifact worktree
synchronized across machines and builders.

GitHub provides the durable shared ledger and repository permission model. A
deterministic local sentry handles routine synchronization and classifies
conflicts. Streamliner shows sync health and artifact attention. Telex carries
operational notifications to the responsible role.

This is the near-term multi-builder artifact solution. It reduces manual
commit/push/pull choreography without requiring a hosted Streamliner service or
putting Streamliner planning files on every source branch.

## Why It Matters

Streamliner artifacts currently tend to live either:

- under `.streamliner` on a source branch, where they add noise for teammates who
  are not participating in Streamliner work; or
- in a separate planning repository, where discovery, permissions, onboarding,
  and laptop/devbox synchronization become extra ceremony.

The artifacts increasingly matter to more than one session:

- campaign and shaping notes;
- workstream briefs and graphs;
- node specs and attached artifacts;
- field reports and reconciliation notes;
- cross-workstream contracts and closeout records.

Git is useful for sharing and auditability, but manually operating a second
checkout is recurring toil. Streamliner should make the dedicated artifact branch
a product-supported path.

## Ownership Boundary

| Concern | Owner |
|---|---|
| Durable Streamliner artifacts and their history | `streamliner-artifacts` Git branch |
| Repository permissions and branch transport | Git/GitHub |
| Local artifact-root configuration and sync projection | Streamliner |
| Deterministic fetch/merge/push classification | Artifact sync sentry |
| Messages, delivery, liveness, acknowledgement, and message history | Telex |
| Semantic conflict resolution and consequential project decisions | Responsible orchestrator or builder |
| Source code and durable product/design documentation | Normal source branches |

The artifact branch is not a message queue or live runtime database. It should not
contain inbox directories, message status files, session heartbeats, or volatile
watch state.

## Branch and Worktree Model

A project repository may designate:

```text
artifactBranch = streamliner-artifacts
```

Each environment checks that branch out separately:

```text
project/
project.streamliner-artifacts/
```

The artifact worktree contains the project's shared Streamliner artifact tree,
for example:

```text
.streamliner/
  shaping/
  workstreams/
  reports/
```

Exact directories remain governed by Streamliner's artifact formats. Local
runtime state stays under `~/.streamliner/state`, not on the artifact branch.

Streamliner needs a durable project mapping similar to:

```text
projectKey
sourceRepoPath
artifactRepoPath
artifactBranch
```

Secrets and Telex credentials do not belong in this configuration. Telex is
referenced separately by backend profile name.

## Artifact-root Contract

This workstream exports `artifact-root-v1`, which should let any Streamliner
surface or plugin role resolve:

- the project key;
- the source repository;
- the artifact repository/worktree;
- the artifact branch;
- whether the artifact root is available and synchronized;
- the current artifact commit;
- any blocking sync/conflict state.

Consumers should not assume `.streamliner` lives under the current source
checkout. The dashboard, workstream loader, role skills, node launch context
assembly, and future Project surface should all use the same resolver.

## Sentry Model

Routine synchronization should be deterministic. The sentry is not an LLM
running `git status` forever.

The deterministic layer should:

- verify the artifact worktree and branch identity;
- fetch remote changes;
- classify clean, ahead, behind, diverged, dirty, and error states;
- apply only explicitly safe mechanical synchronization;
- commit/push product-authored artifact changes according to the chosen policy;
- record local health and event state outside the artifact branch;
- stop and surface semantic or ambiguous conflicts.

Useful initial event classes:

```text
remote_changed
local_changed
sync_clean
push_succeeded
conflict_detected
semantic_attention_needed
script_or_git_error
```

The exact write/commit policy should be decided during formation. The first slice
may support manual commit/push while proving artifact-root behavior before adding
automatic synchronization.

## Telex Integration

Telex replaces the candidate's earlier file-backed message proposal.

The sentry or Streamliner API may send concise events to durable role addresses,
for example:

```text
project:<projectKey>/role:artifact-sentry
project:<projectKey>/workstream:<workstreamId>/role:orchestrator
```

Examples:

- the artifact branch advanced and a workstream changed;
- a semantic conflict needs an owner;
- local changes could not be pushed;
- an incoming artifact change invalidates a current assumption;
- the sentry is unhealthy or paused.

Messages should carry pointers to the artifact commit and changed paths. They
should not contain a second copy of the artifacts. If a message produces a
durable decision, that result is written back to the appropriate artifact with
the Telex thread/message ID retained as provenance.

Streamliner may also accept local sentry events through an API so the dashboard
can show sync state even when no agent is attached. Local projection and Telex
notification are complementary; neither becomes the artifact source of truth.

## Candidate Scope

### In Scope

- Dedicated same-repository artifact branch policy.
- Separate artifact-worktree setup and discovery.
- Migration/adoption of existing `.streamliner` artifacts from a source branch
  or separate planning repository, with one clearly selected authoritative copy.
- `artifact-root-v1` project configuration and resolver.
- Loading and writing Streamliner artifacts through the resolved artifact root.
- Initial manual-sync workflow and diagnostics.
- Deterministic sentry checks and sync-state classification.
- Safe fetch/update/push automation with explicit conflict stops.
- Local Streamliner sync-health/event projection.
- Telex notification of actionable sync and conflict events.
- Multi-machine and multi-builder dogfood.
- Guidance for promoting durable decisions into source-branch design docs when
  appropriate.

### Out of Scope

- File-backed messages or inbox/status directories.
- Replacing Telex with Git commits.
- Remote Streamliner services or hosted UI.
- Remote active-session or runtime-state storage.
- Automatic semantic conflict resolution.
- Replacing GitHub Issues or source-branch pull requests.
- Moving all Streamliner state into Git.
- Designing repository or Telex authorization beyond consuming their existing
  permission models.

### Deferred

- Cross-repository artifact branches.
- Rich branch administration UI.
- Hosted synchronization services.
- Multi-writer CRDT or database-backed artifact editing.
- Policy-driven semantic merge automation.

## Wave Intent

Actual formation should decide node boundaries. The likely progression is:

### Wave 1: Artifact branch and root contract

- Define the branch policy and worktree setup.
- Move or adopt an existing project's artifact set without leaving two
  authoritative copies.
- Implement/configure external artifact-root resolution.
- Make core workstream loading operate through the resolver.
- Provide setup, status, and diagnostic guidance.
- Prove a manual fetch/commit/push workflow before automating it.

**Checkpoint:** Streamliner can open and update a project whose `.streamliner`
artifacts exist only in a `streamliner-artifacts` worktree.

### Wave 2: Deterministic sync sentry

- Implement branch-state checks and event classification.
- Add local durable health/watch state.
- Define safe automatic operations and explicit stop conditions.
- Surface conflicts without modifying the semantic artifact content.
- Add dry-run and recovery behavior.

**Checkpoint:** two environments remain synchronized during clean operation and
stop clearly when human judgment is required.

### Wave 3: Streamliner and Telex attention

- Project sync health into Streamliner.
- Route actionable events through `telex-addressing-v1`.
- Link notifications to commits, paths, projects, and workstreams.
- Show conflicts, paused sentries, and unavailable artifact roots.
- Preserve Telex provenance when decisions update artifacts.

**Checkpoint:** the responsible role learns about relevant artifact changes
without polling Git or maintaining a message-file convention.

### Wave 4: Multi-builder dogfood

- Use one repository and artifact branch from at least two environments/builders.
- Exercise concurrent clean changes and a semantic conflict.
- Start a role through the canonical plugin skills and resolve the shared artifact
  root without personal instructions.
- Coordinate the conflict/disposition through Telex.
- Measure the remaining manual Git and setup steps.

**Gate:** the shared artifact workflow materially reduces setup and synchronization
toil while leaving an understandable Git history and clear conflict ownership.

## Expected Exports

- `artifact-root-v1`.
- Artifact branch policy and worktree setup flow.
- Artifact-root resolver and diagnostics.
- Deterministic sync-state/event schema.
- Sentry health and recovery behavior.
- Local Streamliner sync-event API/projection.
- Telex artifact-attention message profile.
- Multi-builder operating guidance.

## Dependencies

### Imports

- Existing project key and tracked-workstream loading behavior.
- Git worktree and GitHub repository capabilities.
- `telex-addressing-v1` for role-addressed notifications (Wave 3).

### Enables

- Plugin skills loading shared project/workstream context on any machine.
- Project Surface and Orientation using one artifact-root model.
- Multi-builder workstream design and orchestration.
- Future remote-control-plane work without requiring it for the first useful
  solution.

## Review Criteria

This workstream succeeds when:

- source branches no longer need to carry Streamliner planning artifacts;
- migration leaves one clear authoritative artifact root rather than two copies
  that can drift;
- a fresh environment can discover and set up the artifact worktree predictably;
- Streamliner loads the same project/workstream state on multiple machines;
- clean synchronization needs little or no manual choreography;
- semantic conflicts stop and reach an accountable role;
- Telex, not Git files, carries operational messages;
- volatile runtime/watch state stays out of the artifact branch;
- a teammate can understand the project state from the artifact history.

## Risks

- Git conflict noise if shared files are rewritten frequently.
- Automatic commit/push behavior obscures who changed an artifact.
- The branch becomes an unstructured junk drawer.
- A migration leaves source-branch and artifact-branch copies that both appear
  authoritative.
- Sync events become noisy.
- The dedicated branch is treated like a remote service without service
  semantics.
- Skills or UI code continue assuming `.streamliner` is under the source root.

Mitigations:

- preserve clear artifact formats and ownership;
- prefer small, attributable commits;
- keep volatile state local;
- make migration switch authority explicitly and remove or archive the old copy;
- deduplicate/rate-limit Telex attention events;
- stop on semantic conflicts;
- make all consumers use `artifact-root-v1`;
- retain promotion paths for decisions that belong in source-branch design docs.

## Open Questions

- Where should the durable project-to-artifact-root mapping live?
- What is the safest initial write/commit policy?
- Which clean sync operations may run automatically?
- How should two builders avoid repeatedly rewriting the same graph or index?
- Should Streamliner create the branch/worktree or only adopt an existing one in
  the first slice?
- How should artifact-root availability affect node launch and role-skill
  activation?
- What sync events deserve Telex messages versus dashboard-only status?

## Relationship to Other Work

- **Telex-backed Session Actor Control Plane** owns addresses and message
  delivery; this workstream emits artifact-attention events through that contract.
- **Streamliner Plugin Role Skills** consumes artifact-root discovery and should
  never require a user-specific instruction listing artifact paths.
- **Project Surface and Orientation** later presents projects and sync state but
  should consume, not redefine, `artifact-root-v1`.
- **Distributed Control Plane** remains the longer-term remote-service direction;
  it is not required for this Git-backed solution.

## Handoff Brief

Form the Git-backed Artifact Ledger & Sync workstream inside the Shared Project
Operations campaign.

The workstream should make `streamliner-artifacts` a supported same-repository
branch checked out as a separate worktree, export one `artifact-root-v1` resolver
used by all Streamliner consumers, prove manual operation before adding a
deterministic sync sentry, and route actionable sync/conflict events through
Telex. It must not create file-backed messages or put volatile runtime state on
the artifact branch.

Wave 1 should deliver the artifact branch/root contract and a usable manual
workflow. Wave 2 should automate deterministic synchronization. Wave 3 should add
Streamliner and Telex attention. Wave 4 should prove the complete workflow with
two builders/environments.
