# Git-backed Artifact Ledger & Sync

## Purpose

Make shared Streamliner project artifacts available to multiple builders and
agent sessions through a dedicated same-repository Git branch and worktree,
without placing planning artifacts on source branches or requiring manual
artifact-path knowledge.

The workstream will establish one authoritative artifact root per project,
describe that local Git provider through `artifact-root-v1`, and put
Streamliner-owned artifact mutations and synchronization behind the local API's
storage-neutral `artifact-operations-v1` contract. Agents retain normal file
editing ergonomics through isolated change workspaces, while the API serializes
promotion into the canonical artifact worktree. The result should preserve an
understandable Git history, remain adaptable to a future remote artifact store,
and keep messages and volatile runtime state out of the artifact branch.

## Approach

The workstream progresses from authority and contract confidence, through safe
mechanical synchronization, to cross-workstream integration and multi-builder
validation. Formation does not count as a wave. Later-wave node boundaries
remain provisional until the preceding contract or safety gate has passed.

### Wave 1 - Artifact provider, operations, and authority cutover

Artifact Sync owns fresh-machine bootstrap. V1 is convention-first: starting
from a source-repository checkout, Streamliner identifies the repository and its
remote, discovers the remote `streamliner-artifacts` branch, creates or adopts a
separate worktree for that branch, and then reads the shared project manifest
from the artifact worktree. Local Streamliner state maps stable repository
identity to the resolved artifact root for subsequent use.

The conventional branch is an artifact-only orphan branch. Streamliner may
create the branch and worktree when they do not exist, but only after showing a
preview of the repository, branch, worktree path, initial artifact contents, and
authority implications and receiving explicit builder confirmation. Adoption of
an existing matching worktree follows the same identity checks without
recreating it.

The V1 bootstrap must not require a custom branch setting, source-branch pointer
file, or personal path instruction. Custom artifact branches and explicit
pointer mechanisms are later overrides. Missing remote branches, incompatible
manifests, repository mismatches, and worktree collisions produce actionable
diagnostics instead of silently falling back to source-branch artifacts.

Implement a single resolver contract rather than allowing dashboard, launch,
plugin, or workstream-loading code to derive paths independently. Migrate one
selected authoritative artifact tree and switch core workstream reads through
the resolver. Product-owned writes go through the local API's artifact mutation
boundary rather than letting each caller mutate the canonical worktree directly.
The migration must explicitly identify the source copy, establish the
artifact-branch copy, cut authority over once, and remove or archive the old copy
so both locations cannot appear current. Routine Git synchronization remains
manual in this wave, but it is invoked and classified through the API rather than
performed independently by agent sessions.

`artifact-root-v1` should resolve at least:

- the stable project key;
- source repository identity and local path;
- artifact repository/worktree path and artifact-tree path;
- artifact branch and current commit;
- shared project manifest identity and compatibility status;
- root availability and branch/worktree identity;
- bootstrap and local repository-to-root mapping status;
- explicit sync or blocking state, including an honest `unchecked` or manual
  state before the sentry owns synchronization;
- diagnostics for missing, stale, mismatched, or incompatible configuration.

`artifact-root-v1` describes the local Git-backed provider. Consumers that
mutate or synchronize artifacts use a separate storage-neutral
`artifact-operations-v1` contract owned by the local Streamliner API. Its first
version should define:

- an opaque artifact `revision`, with optional `gitCommit` provenance for the
  local Git provider;
- coherent snapshot/list/read operations;
- begin-change and validate operations;
- whole-file, structured, or patch-based changes carrying an expected revision;
- atomic application into the canonical artifact root under the accepted local
  writer lock;
- typed stale-revision, dirty-root, validation, trust, and compatibility errors;
- commit/promotion provenance and a manual synchronization operation;
- capability reporting so a later remote provider need not expose a local path
  or pretend every revision is a Git commit.

Simple Streamliner-owned graph/configuration changes should use this API in Wave
1. Direct reads may still use resolved local files when useful. Direct edits to
the canonical artifact worktree remain an explicit escape hatch, but they are
classified as external dirty input: Streamliner must not overwrite or
automatically synchronize them until the builder adopts, commits, reverts, or
reconciles the change.

**Checkpoint:** From a fresh source checkout, Streamliner can discover the
conventional remote artifact branch, create or adopt its worktree, read the
shared manifest, and open and update a project whose shared `.streamliner`
artifacts exist only in that worktree. Streamliner-owned updates use
`artifact-operations-v1` with expected-revision checks rather than direct
canonical-worktree mutation.

**Authority gate:** The builder confirms that the resolver has one unambiguous
authoritative root, the source-branch artifact copy is no longer authoritative,
fresh-machine bootstrap does not depend on private setup knowledge, recovery is
documented, downstream consumers can rely on `artifact-root-v1`, and all
Streamliner-owned canonical writes pass through `artifact-operations-v1`.

### Wave 2 - API-owned synchronization and change workspaces

Add deterministic Git inspection and event classification behind the local API.
The sentry verifies repository, worktree, branch, and remote identity; classifies
clean, ahead, behind, diverged, dirty, unavailable, and error states; and applies
only operations admitted by an explicit safety policy. Sessions do not each run
fetch/commit/push against the canonical artifact worktree; they ask the API to
perform or schedule those operations.

The sentry records health, watch state, deduplication state, and recovery
details under local Streamliner state. It never writes inboxes, acknowledgements,
heartbeats, or other runtime state to the artifact branch. Ambiguous changes and
semantic conflicts stop without modifying artifact content.

Local artifact writers and the sentry coordinate through an explicit lock or
single-writer boundary so a local write, commit, fetch, or update cannot race
another Streamliner-owned operation against the same artifact root. This local
coordination does not pretend to serialize other machines: concurrent remote
writers are handled through Git state, push rejection, divergence
classification, and conflict stops.

For complex Markdown or multi-file changes, add isolated artifact change
workspaces. A session begins a change against an expected revision, edits normal
files in the isolated workspace with ordinary tools, then asks the API to
validate and promote the resulting change set. The API rechecks the base
revision, applies the accepted patch under the canonical writer lock, records
provenance, and synchronizes according to policy. This centralizes promotion,
not keystrokes. Direct canonical edits remain detectable external edits rather
than an unsupported failure mode.

Dry-run behavior, actionable diagnostics, and recovery procedures are part of
the capability rather than follow-on documentation. Product-authored commits
must remain attributable and inspectable; automatic batching and push behavior
cannot be enabled until their ownership and failure semantics are accepted.

**Checkpoint:** Two environments remain synchronized during clean operation,
multiple local sessions can prepare changes without racing over the canonical
worktree, and the API stops clearly before a stale, semantic, or ambiguous
conflict is changed.

**Safety gate:** The builder accepts the automatic-operation matrix, commit
attribution and batching policy, dirty/diverged stop conditions, and recovery
behavior before unattended synchronization is enabled. The gate also confirms
that product-owned sync is API-mediated and that direct external edits pause
automation rather than being overwritten.

### Wave 3 - Shared records, provenance, and attention

Make artifact-root resolution available to launch preparation, plugin role
context, and later project surfaces without copying shared artifacts into local
profiles or generated prompts.

Shared project/workstream launch policy and portable defaults may live on the
artifact branch as declarative configuration. Stable role and lifecycle prompt
contracts remain owned and versioned by Plugin Role Skills. Plugin Role Skills
also owns `launch-policy-v1`: its schema, precedence, compatibility rules, and
validation. Artifact Sync stores and resolves committed `launch-policy-v1`
instances and plugin references, exposes their artifact commit, and surfaces
compatibility/validation results produced through that contract. It does not
interpret, merge, or validate `launch-policy-v1`, or copy long prompts.

Builder-specific wording, experimental presets, terminal/model preferences,
credentials, and optional overrides remain local. Whether a shared field is
policy, a default, overridable, or required is determined by the plugin-owned
schema and validation contract, not by Artifact Sync.

Agent-effective shared policy requires an explicit trust chain. Launch
preparation records the artifact commit and shared-policy references it used,
and must not silently activate an untrusted policy change merely because the
artifact branch advanced. The accepted trust model must account for repository
permissions, branch protection or required approval, and a legible pending or
blocked state when a newer commit has not satisfied the configured trust rule.

Launch and context preparation consume one coherent artifact snapshot. A launch
is bound to a single artifact commit before reading its graph, brief, manifest,
shared policy, and related references; it either completes from that snapshot or
detects movement and retries/fails explicitly. This provenance allows a builder
to determine which durable project state and plugin contract governed a launch
without turning runtime launch records into another artifact store.

The public launch and role surfaces should consume logical revisions and
operations, not treat a worktree path as the permanent storage API. The local
provider may expose a path capability for trusted local tools, while a future
remote provider can implement the same read/change/validate/promote contract
without a local checkout.

Streamliner projects sync health through its local API and dashboard whether or
not an agent is attached. After `telex-addressing-v1` is available, actionable
events are routed to the responsible durable role address with pointers to the
project, commit, changed paths, and affected workstream. Routine clean status
remains dashboard-only.

**Checkpoint:** Role and launch consumers resolve one trusted single-commit
artifact snapshot, plugin-owned validation and compatibility failures are
legible, and responsible actors receive actionable artifact attention without
polling Git.

### Wave 4 - Campaign integration validation loop

Wave 4 hosts the single Shared Project Operations campaign integration gate. It
consumes accepted checkpoints and evidence from Plugin Role Skills and
Telex-backed Actor Fabric rather than recreating their contracts inside this
workstream.

One end-to-end scenario, exercised with Namra or another cold second builder,
must include:

1. installing the canonical Streamliner plugin in a fresh environment;
2. opening the source repository and bootstrapping the conventional
   `streamliner-artifacts` worktree without personal path instructions;
3. loading the shared project manifest and a trusted single-commit policy
   snapshot;
4. launching the workstream orchestrator from the Streamliner UI using the
   plugin-owned role and launch-policy contracts;
5. coordinating through a shared Telex backend;
6. rebooting an environment or replacing the orchestrator station while the
   durable responsibility remains addressable;
7. observing at least one implementer or reviewer lifecycle event routed through
   Actor Fabric;
8. preparing concurrent artifact changes through separate API change
   workspaces, plus one direct external edit to the canonical worktree;
9. stopping deterministic synchronization and routing the conflict to the
   responsible role through Telex;
10. recording the disposition as a durable artifact or source-design promotion
    with artifact commit and Telex message/thread provenance.

The validation loop measures remaining setup steps, manual Git choreography,
false-positive attention, replacement/recovery clarity, conflict ownership, and
whether a cold second builder can understand the project from the artifact
history.

**Campaign integration gate:** Two builders can install the role context,
bootstrap the shared artifact root, launch and replace a role-bound orchestrator,
observe implementer/reviewer lifecycle traffic, and disposition an artifact
conflict through Telex with durable promotion. The project retains one clear
artifact authority, understandable Git history, trusted policy provenance,
explicit compatibility diagnostics, and no manual message relay.

## Design References

- `streamliner:docs/design/index.md` - entry point for current project design
  authority.
- `streamliner:docs/design/workstream-format.md` - artifact placement,
  project configuration, graph identity, and runtime-state separation.
- `streamliner:docs/design/session-system.md` - launch context, local prompt
  profiles, provenance inputs, and local runtime ownership.
- `streamliner:docs/design/decisions/006-local-streamliner-api-service.md` -
  local API ownership of backend registry and filesystem behavior.
- `streamliner:docs/design/decisions/007-tracked-workstream-registry.md` -
  existing workstream identity, source discovery, path precedence, and local
  registry behavior.

## Boundaries

- **In scope:** Dedicated same-repository artifact branch policy; separate
  artifact worktree fresh-machine discovery, setup, or adoption; shared project
  manifest resolution; local repository-to-root mapping; migration with explicit
  authority cutover; `artifact-root-v1`; storage-neutral
  `artifact-operations-v1`; API-mediated canonical mutations and synchronization;
  expected-revision validation; isolated multi-file change workspaces; explicit
  external/direct-edit detection and reconciliation; deterministic sync
  classification and admitted safe operations; local health and recovery state;
  local writer/sentry locking; shared launch policy/default record storage and
  resolution; trusted single-commit launch provenance; Streamliner health
  projection; Telex notification of actionable artifact events; hosting the
  campaign integration gate.
- **Out of scope:** File-backed inboxes or message status files; copying Telex
  history into Git; volatile session/watch state on the artifact branch;
  automatic semantic conflict resolution; hosted Streamliner synchronization;
  replacing GitHub Issues or source pull requests; storing credentials or
  personal prompt presets in shared artifacts; defining plugin role/lifecycle
  prompts or interpreting, merging, or validating `launch-policy-v1`; full
  Project surface design.
- **Deferred:** Cross-repository artifact roots; rich branch administration UI;
  hosted sentries; CRDT or database-backed collaborative editing; semantic merge
  automation; general policy authoring UI; portfolio-wide artifact roots; custom
  artifact branch names and source-branch pointer mechanisms; remote active-state
  storage and hosted artifact mutation APIs.

## Current State

Streamliner artifacts currently live under this repository's source-branch
`.streamliner` tree, including shaping material and tracked workstreams. The
existing `.streamliner/config.json` describes a workstreams directory and repo
path, but the running API does not yet provide a first-class project mapping
with artifact branch, worktree, commit, or sync identity.

The local tracked-workstream registry supports direct graph paths and two source
types: a `project-root`, which scans
`.streamliner/workstreams/*/graph.json`, and a `workstreams-root`. It stores
absolute discovered graph paths under
`~/.streamliner/state/workstream-registry/`, gives direct path registrations
precedence, and reports duplicate identities as conflicts. This is a useful
discovery seam but is not sufficient as an artifact-root or Git synchronization
contract.

Launch preparation and context assembly currently consume backend-readable graph
paths, workstream directories, and repo roots. Those consumers must be audited
for current-checkout and path-derived assumptions so they do not bypass the new
resolver.

The local API already owns graph reads and a narrow atomic PATCH path for durable
workstream configuration. It does not yet expose a general artifact snapshot,
change-set, validation, or synchronization contract. Sessions and tools can
therefore still write artifact files independently, with no single place to
apply expected-revision checks or coordinate promotion into Git.

Editable PAW launch prompt profiles are currently local runtime data in
`~/.streamliner/state/paw-launch-prompt-profiles.json`. A committed
`launchDefaults.promptProfileId` is deliberately only a best-effort local hint.
Migration must not copy this local profile store wholesale into the artifact
branch. Evolved profiles need classification into stable plugin contracts,
shared declarative policy/defaults, and builder-local overlays.

Formation produced the committed brief, graph, and initial Wave 1 local specs.
No execution issues, implementation, artifact migration, or synchronization
service has been created.

## Decisions

- Git is the durable artifact ledger and repository permission/transport
  boundary. The default branch name is `streamliner-artifacts`, checked out as a
  separate artifact-only orphan worktree.
- Artifact Sync owns convention-first fresh-machine bootstrap: discover the
  remote `streamliner-artifacts` branch from source-repository identity, create
  or adopt its worktree, read the shared project manifest, and persist a local
  repository-to-root mapping.
- Streamliner may create the conventional branch/worktree only after presenting
  a concrete preview and receiving explicit builder confirmation.
- A project has one authoritative artifact root. Migration is an explicit
  authority cutover, not a period of indefinite two-way copying.
- `artifact-root-v1` is the first useful export and the only supported path
  resolver for dashboard, workstream, launch, plugin-role, and future Project
  consumers.
- `artifact-operations-v1` is the storage-neutral mutation and synchronization
  contract. `artifact-root-v1` supplies the local Git provider; callers should
  not treat its filesystem path as the permanent artifact API.
- Streamliner-owned writes to the canonical artifact worktree go through the
  local API with an expected revision, validation, local serialization, and
  provenance. Direct reads may continue to use resolved files where useful.
- Complex agent edits use isolated change workspaces and normal file tools, then
  submit a change set for API validation and promotion.
- Direct canonical-worktree edits remain an escape hatch. They are external
  dirty input that pauses automatic mutation/sync until explicitly reconciled.
- Manual fetch, commit, and push behavior is proven through the API before
  synchronization is automated. Sessions do not independently synchronize the
  canonical artifact worktree.
- The sentry is deterministic. It may perform accepted mechanical operations
  but stops for semantic, ambiguous, dirty, or incompatible conditions according
  to policy.
- Volatile runtime and sentry state remains under local Streamliner state and is
  never committed to the artifact branch.
- Telex owns messages, delivery, liveness, acknowledgement, and message history.
  Artifact notifications contain pointers and provenance, not copied artifacts.
- Durable decisions reached through Telex are promoted into the appropriate
  artifact or source design record with message/thread provenance retained.
- Shared artifacts may carry declarative project/workstream launch policy,
  portable defaults, and versioned references to plugin-owned role/lifecycle
  contracts. They do not contain copied long-form plugin prompts.
- Plugin Role Skills owns `launch-policy-v1`, including its schema, precedence,
  compatibility, and validation. Artifact Sync owns storage and resolution of
  instances, commit provenance, and transport diagnostics, but does not
  interpret, merge, or validate the contract.
- Personal presets and optional builder overlays remain local. Credentials,
  tokens, and backend secrets are never artifact content.
- Agent-effective shared policy carries commit provenance and is not silently
  activated when its commit has not satisfied the accepted repository
  protection or approval rule.
- Launch preparation reads graph, brief, manifest, shared policy, and related
  references from one artifact revision/commit snapshot.
- Streamliner-owned local writers and the sentry serialize operations against
  the same artifact root; Git divergence and push rejection remain the
  cross-machine concurrency boundary.
- Missing roots, branch mismatches, unresolved shared records, and plugin-owned
  compatibility failures surface as explicit diagnostics rather than
  success-shaped fallback behavior.
- Wave 4 hosts the campaign's single integration gate and consumes evidence from
  Plugin Role Skills and Actor Fabric.
- The standalone local Streamliner API is the natural owner of resolver,
  registry integration, sentry health, and dashboard projection.

## Open Questions

- What is the minimal shared project manifest schema, and how is it versioned for application and artifact compatibility?
- Which `artifact-operations-v1` mutation shapes belong in V1: whole-file
  replacement, typed graph operations, generic patches, or a deliberately small
  combination?
- What API/change-workspace lifecycle best preserves ordinary agent file editing
  while preventing abandoned workspaces, stale promotions, or unbounded local
  storage?
- What exact operations are admitted in each clean/ahead/behind/dirty/diverged state, and how are product-authored commits attributed, scoped, and batched?
- How does the local API determine that an agent-effective artifact commit has satisfied the project's protection or approval rule, especially when branch protection is unavailable or a repository is offline?
- Which root, compatibility, or sync failures block node launch versus allowing
  a degraded read-only experience? Which conditions deserve Telex attention
  rather than dashboard-only status?
- Which shared records live at project, workstream, or node scope, and what
  storage lookup does Artifact Sync expose without duplicating the
  `launch-policy-v1` precedence rules?
- What process and lock scope coordinate multiple local API processes,
  worktrees, and non-Streamliner editors without turning local locking into a
  false cross-machine guarantee?

## Imports

- Existing `projectKey`, `workstreamId`, repo IDs, workstream format, and tracked
  source discovery behavior.
- Existing local API, graph loading/writing, launch preparation, and context
  assembly seams.
- Git repository, remote, branch, and worktree capabilities.
- `role-context-v1`, `launch-policy-v1`, and campaign-gate evidence from Plugin
  Role Skills.
- `telex-addressing-v1` from Telex-backed Actor Fabric for Wave 3 role-addressed
  artifact attention, plus lifecycle/replacement evidence for the campaign gate.

## Exports

- `artifact-root-v1`, including project/repository identity, paths, branch,
  commit/snapshot identity, shared manifest, availability, sync/blocking state,
  and diagnostics.
- `artifact-operations-v1`, including opaque revisions, snapshots, reads,
  begin-change, validation, expected-revision mutation, promotion, provenance,
  synchronization, capability reporting, and typed conflict/error states.
- API-mediated canonical write and synchronization behavior plus isolated
  artifact change workspaces for complex agent edits.
- Direct/external edit detection and explicit adopt/commit/revert/reconcile
  behavior.
- Convention-first fresh-machine artifact bootstrap and local
  repository-to-root mapping.
- Artifact branch/worktree policy, migration authority cutover, rollback, and
  recovery guidance.
- Deterministic sync-state and event schema plus the safe-operation matrix.
- Sentry health, deduplication, pause, recovery, and local-state behavior.
- Storage and resolution of shared `launch-policy-v1` instances, defaults, and
  plugin references, without interpreting, merging, validating, or owning the
  contract or prompt content.
- Trusted single-commit artifact and shared-policy provenance for launch/context
  preparation.
- Local writer/sentry locking and explicit cross-machine concurrency behavior.
- Local API and dashboard sync-health projection.
- Telex artifact-attention message profile with project, commit, path,
  workstream, and provenance pointers.
- Multi-builder operating guidance and the Shared Project Operations campaign
  integration gate.

## Formation Notes

Cross-workstream blind-spot review should focus on:

- whether Plugin Role Skills can resolve an artifact root and shared policy
  without user-specific filesystem instructions;
- whether Plugin Role Skills exports `launch-policy-v1` and stable
  role/lifecycle references in a form Artifact Sync can store, resolve, and
  provenance without interpreting or reimplementing;
- whether Telex Actor Fabric can route sentry attention without Artifact Sync
  defining its own address syntax, transport, acknowledgement, or history;
- whether workstream registry, launch preparation, context assembly, dashboard
  routes, and future Project surfaces all consume the same resolver;
- whether all Streamliner-owned artifact mutations and synchronization use
  `artifact-operations-v1` while direct edits remain a safe, visible escape hatch;
- whether isolated change workspaces preserve agent ergonomics without becoming
  a second authoritative artifact store;
- whether artifact commit provenance remains available through launch and Telex
  promotion without leaking runtime state into Git;
- whether launch preparation can hold a coherent single-commit artifact snapshot
  while the sentry and local editors continue operating;
- whether setup and migration remain understandable on Windows and other
  supported environments with multiple worktrees for the same repository;
- whether automatic Git operations preserve attribution and stop safely under
  branch protection, rejected pushes, unavailable remotes, and concurrent
  writers;
- whether shared policy and builder-local overrides have deterministic
  `launch-policy-v1` precedence without Artifact Sync becoming a second policy
  engine;
- whether artifact formats with frequently rewritten indexes or graphs need
  narrower write ownership or formatting rules to reduce conflict pressure.

When the graph is formed, the following must be explicit nodes or named gate
cases rather than being buried in generic implementation or test work:

- convention-first fresh-machine bootstrap and off-branch discovery, including
  cloud-agent environments and source-link compatibility;
- application and artifact/manifest schema compatibility, including downgrade
  and unsupported-version diagnostics;
- branch protection or approval enforcement plus artifact-history recovery from
  accidental rewrite, deletion, or corruption;
- local writer/sentry locking, concurrent remote writers, rejected pushes, and
  deterministic divergence/conflict stops;
- expected-revision API mutation, stale change-set handling, isolated workspace
  cleanup, and external direct-edit reconciliation;
- the Wave 4 campaign scenario spanning plugin installation, UI launch, shared
  Telex, reboot/replacement, implementer/reviewer lifecycle traffic, conflict
  disposition, and durable promotion.

The formed graph and Wave 1 specs now carry these requirements. Execution issues
and implementation remain intentionally uncreated until the campaign formation
PR is accepted and this amended geometry is reviewed.
