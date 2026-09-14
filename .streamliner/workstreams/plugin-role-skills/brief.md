# Streamliner Plugin Role Skills

## Purpose

Make Streamliner roles available through the canonical Copilot CLI plugin so a
builder, Streamliner launch surface, or coordinating agent can start a session
with explicit, repeatable operating context instead of reconstructing role
instructions from private prompts or prior conversations.

The workstream owns the stable role-context contract and its plugin delivery:
role identifiers, skill names, authority boundaries, minimum context-selection
rules, launch-context requirements, compatibility metadata, and thin composition
with project policy and reusable lifecycle skills. It also owns the versioned
shared `launch-policy-v1` contract: typed schema, the distinction between
non-overridable policy and defaults, precedence and merge rules, compatibility
semantics, validation, and failure behavior. Project documentation and
workstream artifacts remain authoritative; plugin skills teach sessions how to
operate and where to look.

This is the first workstream in the Shared Project Operations campaign. Its
early `role-context-v1` role identifiers unblock the Telex-backed Actor Fabric.
Its later orchestrator context-package contract is required before Actor Fabric
can complete the bound-orchestrator UI. `launch-policy-v1` is
consumed by Artifact Sync, which stores and resolves policy instances and
provenance without owning their semantics.

## Approach

Form the workstream around three confidence transitions. The first wave produces
stable role identifiers, the installable role contract, and the first useful
plugin experience. The second wave defines typed launch-policy composition and
proves thin, explicit role delivery through worker and orchestrator context
packages. The third wave completes marketplace identity migration,
trust/compatibility remediation, and conditional `artifact-root-v1` plus
`artifact-operations-v1` adoption without moving builder-local prompt profiles
into shared artifacts.

Skills are the primary role mechanism because they remain composable inside a
general Copilot session. Optional custom agents may provide convenient explicit
entry points, but they must be thin wrappers over the same shared role contracts.
No custom agent, launch prompt, or generated context package becomes an
independent source of role truth.

### Wave 1 - Role contract and repository-installable plugin

Reconcile the existing Streamliner role notes, Namra's `streamliner-skills`
implementation, the DBAgent implementer/reviewer launch prompts, the existing
Streamliner plugin, and proven repository marketplace layouts from Telex and
`lossyrob-skills`.

Define and package:

- a small `streamliner` orientation skill that discovers project context,
  describes the available explicit roles, and points to their invocation forms
  without inferring or selecting a role;
- shared Streamliner Core vocabulary and authority guidance;
- explicit skills for Project Workstream Designer, Workstream Formation,
  Workstream Orchestrator, and Workstream Node Worker;
- a Node Worker core with public, versioned Node Implementer and Node Reviewer
  subrole IDs and skills;
- stable contract identifiers, versions, compatibility metadata, and references
  to lifecycle contracts;
- the stable role identifiers Actor Fabric needs for its first execution wave;
- reference-first documentation selection rules;
- standard GitHub repository marketplace metadata and installation guidance.

The first useful slice should be installable by a second builder through the
normal Copilot repository marketplace flow. It must not depend on a private
checkout path, manual copying into `~/.copilot/skills`, or the broader
Distribution/Integration workstream.

**Early export checkpoint - stable role identifiers:** publish the role IDs,
scope vocabulary, and minimum binding metadata needed to unblock Actor Fabric
Wave 1 without waiting for every plugin skill and launch integration to finish.

**Checkpoint - `role-context-v1` available:** another builder can install the
canonical plugin from the repository, explicitly invoke every initial role, and
observe consistent role boundaries and documentation navigation without private
instructions.

### Wave 2 - Explicit launch-context composition

Define thin launch-context contracts that compose:

1. an explicit plugin role contract;
2. effective non-overridable policy;
3. shared project/workstream/node defaults;
4. builder-local launch-profile overrides;
5. per-launch edits;
6. current workstream or node context;
7. optional PAW workflow and PR-lifecycle mechanics.

Plugin Role Skills owns the typed shared `launch-policy-v1` contract used in this
composition. The contract must define:

- the schema and version for policy documents and contract references;
- which fields are non-overridable policy versus overridable defaults;
- precedence and deterministic merge behavior across all layers;
- compatibility rules for plugin role contracts and external lifecycle
  contracts;
- validation diagnostics and provenance requirements;
- automated-launch behavior that blocks when a required role contract or policy
  is missing or invalid;
- interactive-launch behavior that may continue only through an explicit,
  prominently warned builder override when the contract permits it.

Artifact Sync later stores and resolves shared policy documents, defaults,
contract pins, and provenance through `artifact-root-v1`, and exposes
storage-neutral reads and canonical mutations through `artifact-operations-v1`.
It does not define the policy schema, merge semantics, compatibility rules, or
failure behavior.

Role assignment is always explicit. A builder prompt, UI action, launch helper,
or custom-agent entry point states the role. The system does not infer role from
ambient repository state, skill invocation history, or session behavior, and it
does not persist a loaded-role receipt.

For graph-launched workers:

- terminal launches explicitly instruct the session to invoke the appropriate
  Node Worker role skill before reading the installed
  `streamliner/context.md`;
- managed SDK launches preload the role skill through the SDK skill mechanism;
- generated `context.md` remains the Layer 0-3 node mission and coordination
  package rather than duplicating the role handbook;
- implementation launches can explicitly compose Node Worker Core with the Node
  Implementer overlay;
- reviewer launches can explicitly compose Node Worker Core with the Node
  Reviewer overlay and the configured review/lifecycle profile.

For workstream orchestrators, export
`orchestrator-launch-context-v1`, the requirements for a replacement
launch/relaunch context package. The package must carry:

- the explicit Workstream Orchestrator role contract ID and version;
- project key and workstream identity;
- resolved artifact provider and opaque artifact revision, with local path and
  Git commit included only as optional provider provenance;
- current graph and brief state or bounded current-state summaries with
  authoritative references;
- documentation entry points;
- effective validated launch policy and defaults;
- pending Telex thread references that require orchestrator attention, without
  copying Telex into a second message store;
- the Actor Fabric binding identity and role/scope metadata;
- unresolved actions, gates, blockers, and reconciliation obligations needed to
  resume responsibility.

The contract cannot freeze its artifact identity fields until Artifact Sync's
authority gate accepts `artifact-operations-v1` revision semantics. This is an
explicit cross-workstream dependency, not an assumption that a local path and Git
commit are permanent.

Actor Fabric assembles this package at launch and relaunch from the role contract,
resolved artifacts, Telex state, and actor lifecycle state. Plugin Role Skills
owns the package requirements and role content, not package assembly or actor
lifecycle. Launch and relaunch resolve current artifacts and provenance rather
than embedding stale brief or graph bodies. The builder should be able to launch
or relaunch an orchestrator from the UI without briefing a generic session about
its role or workstream location.

**Checkpoint - `orchestrator-launch-context-v1` available:** launch consumers
can construct short instructions from versioned role contracts and
validated policy, and Actor Fabric can assemble the required orchestrator
context package. This checkpoint is required before Actor Fabric can complete
its bound-orchestrator UI.

### Wave 3 - Marketplace migration, compatibility, and hardening

Complete the distribution and remediation behavior needed for trustworthy shared
project operations:

- migrate from the development-oriented
  `streamliner@streamliner-local` marketplace/plugin identity to canonical
  `streamliner@streamliner`, with temporary compatibility for the old identity
  so enabled-plugin settings, installed caches, and Streamliner's launch
  preflight continue to work during migration;
- define compatibility and trust remediation for missing, stale, untrusted, or
  incompatible role/lifecycle contracts and policy provenance;
- implement the typed policy validation and failure behavior defined in Wave 2;
- keep personal wording, model selection, terminal preferences, experimental
  settings, and long-form prompt profiles in local builder state;
- support portable shared references or pins to plugin role and lifecycle
  contracts without copying contract bodies into shared artifacts;
- continue to resolve today's source-root layout, then consume
  `artifact-root-v1` and `artifact-operations-v1` when Artifact Sync exports
  them;
- document installation, upgrade, compatibility, and degraded-context behavior;
- add only those optional custom-agent wrappers that remain visibly thin over
  the shared skills.

The full product-wide install/update/uninstall and `doctor` experience remains
owned by the future Distribution/Integration workstream. This workstream should
still provide enough version and compatibility information for launch surfaces
to fail clearly or explain degradation.

**Workstream gate - trustworthy explicit role delivery:** install the canonical
plugin through the repository marketplace; start explicit Designer, Formation,
and Orchestrator sessions; launch an explicitly oriented Node Implementer and
Node Reviewer from thin instructions; validate policy precedence and
non-overridable enforcement; verify authoritative docs and current
workstream/node artifacts are discovered; exercise marketplace identity
migration; and verify missing, stale, untrusted, or incompatible contracts
produce the specified remediation or failure behavior rather than silent role
degradation.

Artifact Sync Wave 4 hosts the final Shared Project Operations campaign gate,
where two builders exercise the integrated plugin roles, bound Actor Fabric,
shared Telex coordination, shared policy provenance, and Git-backed artifact
root.

After `artifact-root-v1` adoption, a final Plugin Role Skills closure gate
validates this workstream's role delivery, launch-policy ownership, marketplace
and trust behavior, orchestrator context export, and artifact-root integration.
It confirms that the required evidence is available to Artifact Sync's campaign
gate without repeating the integrated two-builder campaign exercise.

## Design References

- `streamliner:docs/design/index.md` - entry point for the project design set.
- `streamliner:docs/design/operating-model.md` - builder, orchestrator, and
  worker authority; artifact-first information flow.
- `streamliner:docs/design/design-layer.md` - Design, Architecture, and User
  Guide authority boundaries.
- `streamliner:docs/design/workstream-format.md` - committed workstream
  artifacts, project configuration, and runtime-state separation.
- `streamliner:docs/design/concepts/context-package.md` - Layer 0-3 node context
  and progressive documentation disclosure.
- `streamliner:docs/design/concepts/waves.md` - confidence transitions,
  checkpoints, gates, and later-wave promotion.
- `streamliner:docs/design/session-system.md` - API-first launch pipeline,
  generated worker context, plugin preflight, and terminal/managed SDK launch
  paths.

## Boundaries

- **In scope:** `role-context-v1`; `orchestrator-launch-context-v1`;
  `launch-policy-v1`; typed policy schema; policy/default
  distinction; precedence and merge rules; compatibility/version semantics;
  validation and failure behavior; contract identifiers and versions; plugin
  skills and shared role references; Streamliner Core; explicit Designer,
  Formation, Orchestrator, Node Worker, Node Implementer, and Node Reviewer
  contracts; orientation-only `streamliner` entry skill; repository marketplace
  packaging; documentation selection rules; worker and orchestrator
  context-package requirements; thin prompt/profile composition; marketplace
  identity migration; trust/compatibility remediation; source-root discovery
  followed by later `artifact-root-v1` adoption; optional thin custom-agent
  wrappers.
- **Out of scope:** Inferring a session's role; loaded-role receipts; Telex
  transport, address derivation, station attachment, singleton occupancy, or
  actor lifecycle; assembling the orchestrator context package; Git
  branch/worktree artifact synchronization; storing or resolving shared policy
  documents and provenance; moving local long-form prompt profiles into
  `streamliner-artifacts`; implementing PAW workflow stages; implementing or
  copying `paw-pr-lifecycle` loops, scripts, markers, and polling mechanics;
  building reviewer orchestration; implementing the UI launch/relaunch surface;
  product-wide CLI/daemon installation, update/uninstall, or `doctor`; replacing
  the node context package; rewriting project design authority into plugin
  prompts.
- **Deferred:** Automated role/skill generation from docs; portfolio-level
  manager roles; broad custom-agent marketplace/versioning strategy; UI role
  selection; automatic role inference; full product-wide helper health
  management; artifact-root-only operation before `artifact-root-v1` is
  available.

## Current State

The shaped candidate
`.streamliner/shaping/candidates/streamliner-agent-skill-context.md` is ready for
promotion into this workstream. Formation has established the workstream
boundary and reviewed the current plugin, project role notes, design/operating
model, marketplace examples, launch pipeline, Namra's external implementation,
DBAgent implementer/reviewer prompts, and the installed `paw-pr-lifecycle`
skill.

The canonical Streamliner plugin currently contains trusted session-lifecycle
hooks but no packaged role skills. Its repository marketplace is currently
named `streamliner-local`, points at `copilot-plugin/streamliner`, and is
documented primarily around an absolute local checkout. Telex and
`lossyrob-skills` demonstrate the standard plugin manifest shape with
`"skills": "skills/"` and repository-backed marketplace metadata.

Namra's repository is now available locally at
`C:\Users\robemanuele\proj\others\namra\streamliner-skills`. It independently
validates separate entry, shaping, graph-formation, orchestration, and node-worker
skills, while also carrying project-specific rules that must be reconciled
rather than copied wholesale. Namra has explicitly granted permission to share,
copy, and adapt useful content from this private EMU repository; provenance
should be recorded, but permission is not a formation or implementation blocker.

This brief is an uncommitted formation draft. No `graph.json`, tracker issue,
node spec, implementation change, or commit has been created.

## Decisions

- Use `plugin-role-skills` as the workstream ID.
- Export a versioned `role-context-v1` contract.
- Export `orchestrator-launch-context-v1` as the required replacement
  orchestrator context-package contract.
- Export and own `launch-policy-v1`, including typed schema,
  policy/default distinction, precedence and merge rules, compatibility/version
  semantics, validation, provenance requirements, and failure behavior.
- Treat Artifact Sync as the storage, resolution, and provenance provider for
  shared policy instances, not the owner of policy semantics.
- Use skills as the primary role-context mechanism.
- Keep custom agents optional and thin over shared skill content.
- Assign roles explicitly through builder prompts, launch prompts, UI actions,
  helpers, or custom-agent entry points.
- Do not implement role inference, role-selection logic, or a loaded-role
  receipt.
- Keep `streamliner` as an orientation/discovery skill, not an automatic role
  router.
- Ship minimal useful contracts for all four initial top-level roles rather than
  making the first checkpoint incomplete.
- Treat Workstream Node Worker as a role family; use a shared worker core and
  explicit role overlays where authority and obligations materially differ.
- Publish versioned Node Implementer and Node Reviewer role IDs and skills over
  the shared Node Worker core.
- Keep role contracts stable and reference-first. Project docs and workstream
  artifacts remain authoritative.
- Keep generated `context.md` as node-specific Layer 0-3 context rather than a
  copy of role guidance.
- Compose thin launch instructions from stable role contracts, current
  artifacts, policy/default layers, local profiles, and reusable workflow or
  lifecycle skills.
- Keep outcome anchors, authority boundaries, one-node scope, durable review
  obligations, and reconciliation/field-report semantics in stable role
  contracts.
- Keep PAW configuration, models, review emphasis, merge/hot-work posture,
  terminal preferences, personal wording, and experimental overrides in
  editable profiles or launch inputs.
- Keep PAW workflow mechanics in PAW skills and PR sentry/marker/polling
  mechanics in `paw-pr-lifecycle`.
- Use standard repository marketplace distribution patterned after Telex rather
  than manual skill copying.
- Use `streamliner@streamliner` as the canonical marketplace/plugin identity,
  with temporary compatibility for `streamliner@streamliner-local` during
  migration.
- Support the current source-root layout first and adopt `artifact-root-v1` plus
  `artifact-operations-v1` later without changing role identifiers.
- Export orchestrator launch/relaunch context requirements; Actor Fabric owns
  package assembly, singleton binding, addressing, attachment, and lifecycle.
- Require the orchestrator context package to carry explicit role/version,
  project/workstream identity, artifact provider and revision (with optional
  local path/Git provenance), current graph/brief state, pending Telex thread
  references, actor binding, and unresolved actions.
- Export stable role identifiers early enough to unblock Actor Fabric Wave 1.
- Require `orchestrator-launch-context-v1` before Actor Fabric completes the
  bound-orchestrator UI.
- Share declarative policy, portable defaults, and versioned contract
  references through shared artifacts; do not share the local prompt-profile
  store wholesale.
- Keep non-overridable policy separate from overridable default precedence.
- Block automated launches when a required role contract or launch policy is
  missing or invalid. Interactive launches may proceed only through an explicit,
  prominently warned builder override when allowed by the policy contract.
- Keep reviewer watch-through-merge behavior in `paw-pr-lifecycle` launch policy
  rather than making it a stable Node Reviewer obligation.
- Keep the workstream gate focused on trustworthy role delivery; Artifact Sync
  Wave 4 owns the final integrated campaign gate.
- Add a final workstream closure gate after `artifact-root-v1` adoption to
  validate local obligations and campaign-evidence availability without
  duplicating Artifact Sync's integrated campaign gate.
- Treat marketplace identity migration and trust/compatibility remediation as
  required graph work, not optional closeout polish.
- Do not wait for issue #40 before shipping the first repository-installable
  role-skills slice.

## Open Questions

- What exact identifier and version syntax should role and lifecycle contracts
  use, and what compatibility range semantics should launch consumers enforce?
- Which role contracts, if any, should receive optional custom-agent wrappers in
  the first release?
- Which concrete fields are non-overridable policy, portable shared defaults, or
  local-only settings within the owned launch-policy schema?
- What is the minimum first version of the shared policy schema and contract-pin
  shape before `artifact-root-v1` exists?
- What stable field-report semantics belong in Node Worker Core, Implementer,
  and Reviewer contracts before the later field-report transport and
  reconciliation workstream defines delivery?
- Which existing context-assembly service should Actor Fabric reuse when
  assembling `orchestrator-launch-context-v1` so it does not duplicate the
  existing node-launch pipeline?

## Imports and Exports

### Imports

- Documentation-family authority and context-flow conventions from the
  completed Documentation System workstream.
- Project Workstream Designer and Workstream Formation semantics from the
  shaping candidate and temporary role notes.
- Existing API-first node launch, context generation, plugin preflight, terminal
  launch, and managed SDK launch seams from Session Launching and Tracking.
- Existing Streamliner project key and source-root project configuration.
- Existing repository marketplace and plugin structure.
- Namra's `streamliner-skills` repository as implementation evidence and a
  migration source.
- DBAgent implementer and reviewer launch prompts as evidence for stable
  outcome, authority, review, field-report, and policy concerns.
- Installed `paw-pr-lifecycle` role guides and script contract as the reusable
  lifecycle-mechanics boundary.
- Later `artifact-root-v1` and `artifact-operations-v1` from Git-backed Artifact
  Ledger and Sync.

### Exports

- `role-context-v1`: stable role IDs, skill names, role contract versions,
  authority boundaries, minimum context-selection rules, explicit activation
  requirements, worker launch requirements, and compatibility metadata.
- `launch-policy-v1`: typed schema,
  non-overridable-policy/default classification, precedence and merge rules,
  compatibility/version semantics, provenance requirements, validation, and
  failure/remediation behavior.
- `orchestrator-launch-context-v1`: required explicit role/version,
  project/workstream identity, artifact provider and opaque revision, optional
  local path/Git provenance, current graph/brief state, pending Telex thread
  references, actor binding, unresolved actions, and documentation/policy
  context.
- Versioned Node Worker Core, Node Implementer, and Node Reviewer contract
  layering.
- Repository-installable canonical plugin skills and marketplace metadata.
- A role/lifecycle helper manifest for the future Distribution/Integration
  workstream: helper names, source locations, contract versions, compatibility
  expectations, required product APIs, and health checks.
- Explicit Workstream Orchestrator launch/relaunch context requirements.
- Explicit Node Worker/Implementer/Reviewer launch-context requirements.
- Telex role-binding input requirements: explicit role ID, project key, and
  optional workstream/node scope. Actor Fabric owns address derivation and
  station behavior.
- Shared project/workstream policy semantics and local-profile separation for
  Artifact Sync to store, resolve, and report with provenance.
- Artifact discovery and mutation requirements that work against source-root
  layout first and later consume `artifact-root-v1` and
  `artifact-operations-v1`.
- Stable worker outcome-anchor, authority, durable-review, and field-report
  expectations for later hot-work, reconciliation, and execution-integrity
  workstreams.
- Orchestrator helper requirements for invoking a future product-owned
  `streamliner launch-node` or equivalent API without reconstructing the launch
  pipeline.

### External Dependencies

- Builder confirmation of the public Implementer/Reviewer role split and final
  contract naming.
- Copilot repository marketplace behavior and versioning conventions remaining
  compatible with the patterns proven by Telex and `lossyrob-skills`.
- Actor Fabric consuming the explicit orchestrator role/scope contract without
  moving package assembly, singleton, or lifecycle ownership back into this
  workstream.
- Artifact Sync providing `artifact-root-v1`, `artifact-operations-v1`, policy
  storage/resolution, and provenance without redefining policy semantics or
  relocating personal prompt profiles.
- Distribution/Integration issue #40 eventually consuming the helper manifest
  for product-wide installation, update, launch, and diagnostics.

## Formation Notes

### Evidence reviewed

- `.streamliner/roles/README.md`
- `.streamliner/roles/project-workstream-designer.md`
- `.streamliner/roles/workstream-creator.md`
- `.streamliner/shaping/candidates/streamliner-agent-skill-context.md`
- `.streamliner/shaping/candidates/workstream-design-mode.md`
- `.streamliner/shaping/roadmap.md`
- `copilot-plugin/streamliner/**`
- `.github/plugin/marketplace.json`
- Streamliner design docs listed above
- Session Launching and Tracking and Documentation System workstream briefs
- `C:\Users\robemanuele\proj\others\namra\streamliner-skills`
- `C:\Users\robemanuele\proj\small\skills`
- installed Telex plugin marketplace/manifest/skill structure
- DBAgent `paw-lite_loop_v7.md` and `paw-review-loop-v3.md`
- installed `paw-pr-lifecycle` skill and its Implementer/Reviewer guides

### Prompt and lifecycle layering

The DBAgent prompt drafts currently combine stable role obligations, editable
project/profile policy, PAW workflow configuration, GitHub account details,
worktree preferences, review strategy, hot-work posture, PR formatting,
field-report requirements, and lifecycle mechanics. The canonical plugin should
not copy those long prompts.

The intended decomposition is:

| Layer | Examples | Owner |
|---|---|---|
| Stable role contract | outcome anchor, authority, one-node scope, real review, reconciliation report | Plugin Role Skills |
| Shared policy contract | typed schema, enforcement/default classification, precedence, compatibility, validation/failure | Plugin Role Skills |
| Shared policy values | required review, authority limits, evidence thresholds, portable defaults, contract pins, provenance | Project/workstream artifacts; Artifact Sync stores/resolves |
| Builder-local profile | models, personal wording, terminal/account preferences, experiments | Local Streamliner state |
| Per-launch edit | temporary builder direction for this session | Launch input |
| Node/workstream context | current mission, graph/brief state, design references | Generated context package |
| PAW workflow mechanics | planning/review/implementation phases and PAW artifacts | PAW skills |
| PR lifecycle mechanics | loop commands, markers, sentries, polling, event transitions | `paw-pr-lifecycle` |
| Telex actor mechanics | address derivation, attachment, singleton occupancy, lifecycle | Actor Fabric |

### Required graph coverage

Formation has not created `graph.json`, but the eventual graph must include
explicit work for:

- publishing stable role identifiers as an early checkpoint that unblocks Actor
  Fabric Wave 1;
- producing `role-context-v1` and the repository-installable role skills;
- defining and validating the typed shared launch-policy contract;
- integrating explicit worker/implementer/reviewer launch context;
- producing `orchestrator-launch-context-v1` before Actor Fabric's
  bound-orchestrator UI completion;
- migrating marketplace/plugin identity from
  `streamliner@streamliner-local` to `streamliner@streamliner`, including
  enabled settings, installed cache, launch-preflight, rollback, temporary
  compatibility, and coexistence behavior;
- remediating missing, stale, untrusted, or incompatible role/lifecycle
  contracts and policy provenance;
- adopting `artifact-root-v1` without changing logical role or policy
  semantics;
- running the role-focused workstream gate.
- running a final Plugin Role Skills closure gate after artifact-root adoption,
  with the integrated campaign exercise remaining in Artifact Sync Wave 4.

### Cross-workstream blind spots for review

- Migrating to `streamliner@streamliner` may break the current
  `streamliner@streamliner-local` launch-preflight requirement unless temporary
  compatibility and settings/cache migration are coordinated.
- Terminal launches currently rely on kickoff-prompt activation, while managed
  SDK launches can preload a skill explicitly; both paths need equivalent
  failure and compatibility behavior.
- Contract pins must not force the shared artifact branch to mirror plugin
  source bodies or builder-local profiles.
- Launch-policy schema and merge/validation behavior must be available to
  Artifact Sync before it stores shared policy, or storage will accidentally
  define semantics through implementation.
- A role contract version must not accidentally pin implementation details of
  `paw-pr-lifecycle`; compatibility should attach to named behavior contracts,
  not script paths or polling internals.
- The reviewer role needs a clear terminal responsibility that does not make
  every reviewer session an indefinite lifecycle actor unless policy requests
  that behavior.
- Field-report semantics should be stable enough for reconciliation but should
  not preempt Campaign 2's ownership of field-report transport and
  execution-integrity workflows.
- Actor Fabric must reuse a context-assembly seam for
  `orchestrator-launch-context-v1`; implementing a separate
  orchestrator-only pipeline would duplicate the existing node-launch
  architecture.
- Source-root and future artifact-root resolution must produce the same logical
  role context so `artifact-root-v1` adoption does not require new role IDs.
- Optional custom agents can create drift if they contain role prose instead of
  loading shared contract content.
