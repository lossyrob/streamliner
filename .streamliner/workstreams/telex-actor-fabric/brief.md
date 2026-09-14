# Telex-backed Actor Fabric & Bound Orchestrator

## Purpose

Make a Streamliner workstream operable through durable responsibility addresses
rather than through the continued existence or remembered context of one agent
session. The first user-visible outcome is that the Streamliner UI can launch,
focus, resume, replace, and explicitly fence the sole active orchestrator for a
workstream while the workstream's Telex orchestrator address remains stable and
queued messages survive periods with no occupant.

This workstream adopts released Telex as the complete message fabric.
Streamliner owns the integration between work geometry, explicit role
assignment, session lifecycle, and durable artifacts; it does not implement a
mailbox, queue, heartbeat, acknowledgement store, message database, or
replacement Copilot bridge.

## Approach

Build the integration in three confidence transitions.

### Wave 1 - Integration contract proof

Define the narrow contract before adding product state or UI:

- import the stable role identifiers and contract version from
  `role-context-v1`;
- represent role assignment as explicit launch/attach metadata, never inferred
  from the current session or from an entry skill;
- define the project Telex configuration seam:
  `projectKey`, a portable logical `telexBackendId`, and
  `telexAddressNamespace`;
- define how each environment maps the logical backend ID to a local Telex
  profile and credentials without writing machine-specific profile names or
  secrets into shared project configuration;
- define `telex-addressing-v1`, including canonical derivation, segment
  encoding, role/subrole scope, address descriptions/tags, retirement rules,
  and test vectors;
- define a thin JSON CLI adapter over the released Telex binary, always passing
  backend, address, and session identity explicitly;
- separate control-plane operations from in-session Copilot attachment;
- prove one role-bound terminal session can attach, receive, acknowledge,
  disposition, detach, resume, and reattach without Streamliner owning any
  delivery machinery;
- define the first message envelopes, including field reports, blockers, and
  PR lifecycle wakeups with authoritative evidence pointers.

Wave 1 may begin against provisional Role Skills inputs, but
`telex-addressing-v1` does not freeze until Plugin Role Skills Wave 1 exports the
stable role and subrole identifiers and contract version.

**Checkpoint - `telex-addressing-v1`:** another Streamliner role helper can
derive and attach to the correct durable address from explicit project,
workstream, node, role, and subrole metadata without inventing naming,
transport, or backend behavior. The checkpoint is gated by the Role Skills Wave
1 role/subrole export.

### Wave 2 - Bound orchestrator product slice

Make the contract useful from the workstream UI. Completion of this slice
depends on Plugin Role Skills Wave 2 exporting
`orchestrator-launch-context-v1`, which specifies the role context, inputs, and
effective validated launch policy a newly launched or resumed orchestrator must
receive. Actor Fabric consumes that effective policy through the context
package; it does not own `launch-policy-v1`.

Introduce a local actor-binding record keyed by project, workstream, and
orchestrator role. The record may retain the explicitly assigned role identifier
and contract version, logical Telex backend ID and resolved local profile,
durable address, artifact provider and opaque revision, optional local path/Git
provenance, current and last session registry identifiers, pending Telex thread
references, unresolved actor actions, and the last attachment result. It must not
contain a loaded-role receipt, inferred role state, Telex message bodies, queue
state, or a copied lease.

Every actor mutation - launch, resume, replacement, repair, takeover, detach,
and retirement - receives a stable idempotent `actorOperationId`. Persist the
operation phase and intended actor/address transition before side effects so a
retry cannot create a second session or double-attach the address. Operation
state records the expected prior attachment and lease epoch, any newly observed
lease epoch, and whether the old epoch was confirmed fenced.

Add a workstream-level Orchestrator control with these states and actions:

| State | Meaning | Primary action |
|---|---|---|
| unconfigured | Project Telex or role inputs are unavailable | Configure |
| unbound | Durable address is derivable but no orchestrator has been launched | Launch orchestrator |
| launching | Registry/session launch is in progress | Show progress |
| attaching | Session exists but Telex attachment is not confirmed | Wait or diagnose |
| active | The expected session is live and occupies the address | Focus |
| attachment-degraded | Session is live but bridge/address attachment is unhealthy | Repair binding |
| unoccupied-resumable | Address is unoccupied and the retained session can resume | Resume orchestrator |
| unoccupied-replacement | Address is unoccupied but the retained session cannot resume | Launch replacement |
| occupied-conflict | Another live station occupies the address | Inspect, request handoff, or explicitly take over when supported |
| stale-or-unknown | Registry and Telex evidence are incomplete or disagree | Refresh and reconcile |
| failed | A launch, resume, attach, or takeover action failed | Retry or open diagnostics |

Same-session resume is preferred when the Copilot session state still exists,
the working directory is valid, the explicit role contract is compatible, the
artifact provider/revision resolves, and no trusted live process already owns
the session.
Resume reuses the same Streamliner registry row and Copilot session identity, but
must still reapply the explicit orchestrator role and artifact location and run
the released Telex Copilot resume/bridge-provisioning path. Conversation history
is useful continuity, not the source of role or artifact truth.

If resume is impossible or fails, the UI offers an explicit replacement action.
Replacement creates a new session and updates the actor binding while preserving
the same Telex address. It is never a silent fallback: the operator must be able
to see that session identity changed and that any prior station was fenced or
confirmed absent.

Actor Fabric assembles every replacement orchestrator context package according
to `orchestrator-launch-context-v1`. The package is rebuilt from the
artifact provider and recorded revision through `artifact-operations-v1`, the
current workstream brief/graph/state, pending Telex thread references, the
actor-binding record, unresolved actions, and the effective validated policy
supplied through that contract. A local path and Git commit are optional provider
provenance, not required context identities. A replacement must become
productive without access to the prior orchestrator transcript.

Sole-active behavior has two enforcement layers:

1. Streamliner serializes mutations of the workstream orchestrator actor slot.
2. Telex enforces exclusive address occupancy through its lease/epoch model.

For a retained local prior session, explicit takeover may stop that known
station through released Telex station lifecycle behavior, confirm release, and
then attach the replacement. Unknown or remote live occupancy remains blocked or
request-handoff unless released Telex exposes a safe handoff/takeover
capability. Streamliner must not implement its own cross-host fencing.

The existing generic session relaunch and terminal adapter are reused as lower
level primitives, but the actor action is workstream-specific. It must restore
role and artifact context, re-provision Telex, update actor-binding state, and
retain enough terminal reference information for a Focus action. A successful
terminal spawn is not success until the expected session and Telex attachment
are reconciled.

Partial failure is an explicit product state rather than an exception hidden by
retry. Recovery must cover at least: registry/session launch succeeded but Telex
attach failed; the old station was stopped but replacement launch failed;
Telex attachment succeeded but the actor-binding write was interrupted; and the
UI/API restarted with an operation still marked active. On API startup,
reconcile non-terminal actor operations against the session registry, current
Telex station/address status, attachment lease epochs, and actor-binding files
before enabling another mutation.

**Checkpoint - bound orchestrator:** after a machine reboot, the builder can
open a workstream and use one UI action to resume the prior orchestrator or
explicitly launch its replacement. The session receives the correct role,
artifact location, and Telex address without the builder restating them, and
queued Telex messages are delivered after attachment. The checkpoint is gated
by the Role Skills Wave 2 `orchestrator-launch-context-v1` export.

### Wave 3 - Actor projection, lifecycle routing, and actor dogfood

Extend the proven orchestrator slot to selected node actors and operational
events:

- project Telex configuration and backend health diagnostics;
- session/actor projection joining local actor bindings, registry identity, and
  Telex-derived occupancy/liveness without copying Telex history;
- Workstream Node Worker subrole addressing for explicitly assigned
  `node-implementer` and `node-reviewer` actors;
- terminal and managed-session attachment against the same address model where
  released runtime support is verified;
- lifecycle routing for worker completion, blockers, review readiness,
  review-posted, review-addressed, re-review, merge readiness, merged, and
  escalation events;
- bound-orchestrator replacement while messages are queued;
- address retirement when a responsibility is durably closed;
- promotion of at least one Telex-carried outcome into a workstream artifact
  while retaining message/thread provenance.

The `telex-pr-lifecycle-events-v1` contract is a transport-specific event
envelope, not a lifecycle state machine. GitHub and deterministic sentries
remain authoritative for PRs, reviews, checks, head commits, mergeability, and
merge. `paw-pr-lifecycle` remains authoritative for sentry behavior, marker
contracts, approval-note triage, re-review rules, and lifecycle transitions.
Future autonomous execution decides when to launch or continue actors and
whether a merge crosses the human floor.

Each event class has one configured canonical emitter. Deterministic
sentry/runtime emitters take precedence for GitHub-derived events. Actor
emission is allowed only for event classes assigned to the actor and only after
the referenced action is verified. If emitter ownership transitions from actor
to sentry, both use the same stable `sourceEventKey`, derived from the
authoritative repository/PR/event/head/review-or-comment identity, so retries or
handoffs cannot double-author the event.

The `actor-fabric-dogfood-hardening` node is a bounded validation loop, not a
single walkthrough. Each attempt records the actor bindings, Telex lease epochs,
artifact revision, lifecycle evidence, injected failure, and observed result.
Findings route by ownership:

- an actor/runtime defect reopens the affected Wave 3 implementation node;
- an address, event-envelope, or binding-contract defect returns to the
  appropriate contract or substrate node;
- a role, artifact, or lifecycle-policy mismatch routes to the owning
  workstream rather than being patched locally;
- a scope or authority change pauses for builder disposition.

After repairs land, rerun the affected probe and then the complete actor scenario.
The loop stops when an independent final run finds no new blocking defect, when a
configured run budget is exhausted, when the same blocker repeats without new
evidence, or when scope/external dependencies require builder action. The final
gate consumes the attempt log, repair links, lease/fencing evidence, lifecycle
events, provenance promotion, and the independent confirming run.

**Final gate - durable actor operation:** one real workstream uses the UI to
launch and operate its bound orchestrator, survives an API restart and machine
reboot, resumes or explicitly replaces the prior session without transcript
dependency, recovers at least one injected partial failure idempotently, and
proves the previous Telex lease epoch is fenced before a replacement is active.
Explicit implementer/reviewer events reach the responsible subrole, GitHub
remains the PR authority, and at least one message result is promoted with
provenance. Artifact Sync Wave 4 owns the campaign-wide two-builder gate.

## Design References

- `streamliner:INDEX.md` - product, operating-model, artifact, and design entry
  points.
- `streamliner:.streamliner/shaping/roadmap.md` - Shared Project Operations
  campaign intent, ownership boundaries, sequencing, and cross-campaign seams.
- `streamliner:.streamliner/shaping/candidates/session-actor-control-plane.md` -
  shaped actor-fabric boundary, address model, candidate scope, and expected
  exports.
- `streamliner:.streamliner/shaping/candidates/streamliner-agent-skill-context.md`
  - `role-context-v1`, explicit role families, launch-context requirements, and
  the edge with Telex role binding.
- `streamliner:ORCHESTRATION.md` - orchestration as a function, launch broker,
  reconciliation, authority boundaries, and UI-launched worker behavior.
- `streamliner:.streamliner/shaping/node-gate-flow.md` - shaping reference for
  Telex-carried gate transitions and GitHub authority.
- `streamliner:docs/design/index.md` - project design reading order and decision
  log.
- `streamliner:docs/design/operating-model.md` - builder, orchestrator, and
  worker authority plus artifact-first information flow.
- `streamliner:docs/design/session-system.md` - session launch, registry,
  lifecycle, terminal relaunch, managed runtime, and graph projection.
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md`
  - observed liveness rather than session-authored heartbeats.
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md` -
  registry as the canonical local session surface.
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md`
  - Streamliner-owned stable session identity and local storage.
- `streamliner:docs/design/decisions/006-local-streamliner-api-service.md` -
  loopback API ownership and trust boundary.
- `streamliner:docs/design/decisions/009-sdk-managed-worker-runtime.md` -
  terminal and managed workers sharing registry identity.
- `streamliner:docs/design/decisions/010-terminal-takeover-and-cleanup.md` -
  explicit ownership transfer, trusted evidence, and deterministic lifecycle
  actions.
- `telex:README.md` and the released `telex copilot skill` / command help -
  installed product contract for addresses, stations, delivery, disposition,
  backends, and the Copilot push bridge.
- `telex:docs/design/DESIGN.md` and `telex:docs/design/DECISIONS.md` at the
  installed release tag - released address, lease, station, push-delivery, and
  answerback semantics.
- `paw-pr-lifecycle:SKILL.md`,
  `paw-pr-lifecycle:references/implementer.md`, and
  `paw-pr-lifecycle:references/reviewer.md` - current deterministic PR lifecycle
  policy, markers, sentries, and role transitions.

## Boundaries

- **In scope:** `telex-addressing-v1`; explicit project/workstream/node
  role-address derivation; Workstream Node Worker implementer/reviewer subrole
  routing; portable logical Telex backend IDs and local profile mappings; thin
  released-CLI adapter; in-session attach/resume helpers; local actor-binding
  and actor-operation state; idempotent operation IDs; lease-epoch fencing;
  startup and partial-failure reconciliation; replacement orchestrator context
  assembly; sole workstream orchestrator launch/focus/resume/replacement UI;
  local takeover of a retained known station; actor/session/Telex health
  projection; field-report transport envelope and provenance; blocker and
  transport-specific PR lifecycle event envelopes; lifecycle wakeup routing;
  message provenance when outcomes are promoted; address retirement; actor-
  specific dogfood.
- **Out of scope:** A Streamliner mailbox, queue, daemon, lease, heartbeat,
  delivery buffer, acknowledgement store, message-history database, or
  replacement Copilot bridge; copying Telex credentials into project artifacts;
  storing workstream artifacts in Telex; making every observed session an actor;
  inferring roles from session behavior or from the `streamliner` entry skill;
  treating Telex messages as authority for GitHub PR/review/merge state; general
  chat UI; full autonomous wave progression; automatic review-loop policy;
  hosted Streamliner services; new remote relay infrastructure; multi-user
  authorization design; defining the field-report payload schema, disposition
  policy, or reconciliation behavior owned by Campaign 2; the campaign-wide
  two-builder gate owned by Artifact Sync Wave 4.
- **Deferred:** Rich conversation surfaces; broadcast markets and capability-card
  dispatch; portfolio-level actors; policy-driven automatic reassignment;
  cross-project addresses; automatic remote takeover if released Telex does not
  provide it; automatic implementer/reviewer launching, continuation, iteration
  limits, posting policy, merge policy, and human-floor decisions owned by
  future autonomous execution.

## Current State

Formation has produced the first draft brief from the Shared Project Operations
campaign, the shaped Session Actor Control Plane candidate, released Telex
contracts, Streamliner session/orchestration design, the Role Skills boundary,
and the current PAW PR lifecycle policy.

The builder has accepted the bound-orchestrator UI as the first usable product
slice after the contract proof. Role assignment is explicitly supplied by the
builder, launch prompt, helper, or custom-agent entrypoint; there is no
loaded-role receipt and no role-selection algorithm to import. The four
top-level role families remain stable, with `node-implementer` and
`node-reviewer` as explicit Workstream Node Worker subroles.

The cross-workstream blind-spot review is complete. It established two explicit
Role Skills gates: Actor Wave 1 freezes only after Role Skills Wave 1 exports
stable role/subrole IDs, and the bound-orchestrator checkpoint completes only
after Role Skills Wave 2 exports `orchestrator-launch-context-v1`. It
also moved the campaign-wide two-builder gate to Artifact Sync Wave 4 and kept
this workstream's final gate focused on actor durability, fencing, recovery, and
routing.

No graph, task specs, GitHub issues, code changes, or commits have been created
for this workstream. The brief is ready for builder review and later graph
formation; no graph or execution node should be created until the builder
explicitly advances formation.

## Decisions

- Use `telex-actor-fabric` as the workstream ID.
- Treat released Telex as the complete message fabric. Streamliner integrates
  with it and never recreates its transport or persistence.
- Model an actor as an explicitly assigned session serving a durable
  responsibility. Observation alone does not make a session an actor.
- Keep a workstream's Telex orchestrator address stable while terminal or
  managed sessions are replaceable occupants.
- Import stable role identifiers and contract version from `role-context-v1`,
  but do not import or create a loaded-role receipt, inference algorithm, or
  role-selection behavior.
- Freeze Actor Wave 1 only after Role Skills Wave 1 exports stable role and
  subrole identifiers.
- Complete the bound-orchestrator checkpoint only after Role Skills Wave 2
  exports `orchestrator-launch-context-v1`.
- Preserve four top-level role families. Encode `node-implementer` and
  `node-reviewer` as explicit Workstream Node Worker subroles assigned by launch
  metadata.
- Give each V1 actor session exactly one primary Telex responsibility address.
  Use CC/observer delivery for additional visibility rather than attaching the
  same session as the primary occupant of multiple role addresses.
- Keep the `streamliner` entry skill limited to orientation and discovery. It
  neither selects a role nor attaches a Telex address.
- Persist explicit role assignment, artifact provider/revision, and optional
  local path/Git provenance in the local actor-binding record so reboot recovery
  does not depend on remembered chat.
- Assemble replacement orchestrator context from the Role Skills contract,
  artifact revision and current workstream state through
  `artifact-operations-v1`, pending Telex thread references, actor-binding state,
  and unresolved actions. Never require the prior chat transcript.
- Consume effective validated launch policy through
  `orchestrator-launch-context-v1`; do not claim ownership of
  `launch-policy-v1`.
- Keep actor-binding state separate from Telex occupancy and delivery state.
  Streamliner may cache attachment evidence for projection but must query Telex
  for current station/address health.
- Give every actor mutation a stable idempotent `actorOperationId`, persist its
  phase before side effects, and reconcile non-terminal operations on startup.
- Record expected and observed Telex lease epochs for replacement/takeover
  operations and do not mark a replacement active until the prior epoch is
  confirmed fenced.
- Treat partial failures as recoverable actor-operation states, including
  launched-without-attachment, stopped-old-station-without-replacement,
  attached-without-binding-write, and API restart during mutation.
- Make the bound-orchestrator control the first usable product slice after the
  address/adapter contract proof. Do not split it into an unrelated issue or
  later campaign.
- Enforce sole-active orchestrator behavior through a serialized Streamliner
  actor slot plus Telex's exclusive lease/epoch fencing.
- Prefer same-session resume when safe. Reapply explicit role and artifact
  context and re-provision Telex on every resume.
- Require an explicit replacement action when same-session resume is unavailable
  or fails. Never silently replace an orchestrator.
- Permit explicit takeover of a retained known local station only through
  released Telex station lifecycle behavior and confirmed release.
- Treat unknown remote occupancy as blocked/request-handoff until released Telex
  provides a safe remote handoff/takeover capability. Do not build a Streamliner
  fencing workaround.
- Reuse the existing terminal relaunch infrastructure as a low-level primitive,
  not as the actor lifecycle contract.
- Require the first usable UI slice to expose launch, focus, resume, replacement,
  stale/unoccupied, degraded attachment, conflict, and takeover states.
- Use the released Telex CLI with JSON output behind a thin adapter. Always pass
  backend, address, and session identity explicitly and surface typed failures.
- Store a portable logical Telex backend ID in project configuration and map it
  locally to a Telex profile and credentials on each environment.
- Keep Copilot bridge provisioning inside the target session or an explicitly
  supported target-session helper path; the Streamliner API must not pretend to
  be that session.
- Define `telex-pr-lifecycle-events-v1` as a transport-specific envelope for
  derived wakeups carrying GitHub evidence. One Telex thread should represent
  one PR lifecycle, with head SHA and a stable source-event key for stale-event
  detection and deduplication.
- Include `review-ready`, `review-posted`, `review-addressed`,
  `rereview-requested`, `merge-ready`, `merged`, and `blocker` events in the
  versioned transport envelope.
- Assign one canonical emitter per lifecycle event class. Deterministic
  sentry/runtime emission takes precedence for GitHub-derived events; actor and
  sentry retries share the same authoritative `sourceEventKey` and cannot
  double-author an event.
- Keep GitHub and deterministic sentries authoritative. `paw-pr-lifecycle` owns
  markers, sentries, transitions, approval triage, and the rule that
  merge-readiness remains monitored until merge.
- Split field-report ownership explicitly: Role Skills owns the reporting
  obligation, Actor Fabric owns the Telex transport envelope and provenance,
  and Campaign 2 owns the payload schema, disposition, and reconciliation
  semantics.
- Keep launch-profile policy separate from role and transport contracts. Launch
  profiles own PAW mode, model, hot-work, account, and project emphasis.
- Promote durable decisions and map changes from Telex into Streamliner
  artifacts while retaining Telex message/thread provenance.

## Open Questions

- What exact serialized grammar and escaping rules should
  `telex-addressing-v1` use for namespace, project, workstream, node, role, and
  subrole segments?
- What is the supported mechanism for automatically reapplying the orchestrator
  role and attachment during `copilot --resume`: an initial resume prompt, a
  launch helper, a custom-agent entrypoint, plugin hook behavior, or a verified
  combination?
- What terminal reference can the platform adapters retain so Focus reliably
  raises the correct terminal after launch? What is the explicit degraded
  behavior on platforms where focusing an existing tab is unsupported?
- Does released Telex expose a safe remote handoff/takeover operation suitable
  for Streamliner, and what evidence proves the prior epoch is fenced before a
  replacement is declared active?
- What exact actor-binding storage shape and retention policy should preserve the
  current and last session without turning the binding store into a second
  session registry?
- Which attachment and address-health fields belong in the session list/workstream
  projection, and which must be fetched on demand from Telex?
- What canonical emitter table should `telex-pr-lifecycle-events-v1` use for
  each event class, and which dedicated project/workstream service address
  should identify deterministic sentry/runtime emission?
- Which PR lifecycle events require a Telex terminal disposition, and what are
  the default attention levels for routine review transitions versus blockers?
- How should managed SDK actors receive Telex turns using only released,
  supported integration surfaces?
- When should node and workstream addresses retire, and how should queued
  messages be dispositioned before retirement?
- Where should logical Telex backend ID to local profile mapping live, and what
  diagnostics distinguish a missing mapping from an unhealthy mapped backend?
- What bounded pending-thread and unresolved-action set must be included in a
  replacement orchestrator context package?

## Imports and Exports

### Imports

- `role-context-v1` from Streamliner Plugin Role Skills:
  - Wave 1 stable top-level role/subrole identifiers and contract version,
    which gate the freeze of `telex-addressing-v1`;
  - explicit Workstream Node Worker subroles `node-implementer` and
    `node-reviewer`;
  - orchestrator, implementer, and reviewer outcome/authority/scope obligations;
  - field-report and current-head review obligations;
  - no loaded-role receipt, role inference, or selection algorithm.
- Role Skills Wave 2 `orchestrator-launch-context-v1`, which specifies the
  context package and effective validated policy Actor Fabric consumes for
  initial launch, resume, and replacement and gates completion of the
  bound-orchestrator UI checkpoint.
- Existing Streamliner project key, workstream ID, node ID, and tracked
  workstream registry.
- Existing session registry stable identity, observation evidence, graph
  binding, launch claims, terminal relaunch, managed runtime identity, and local
  API trust boundary.
- Released Telex v0.1.0 CLI, Copilot plugin/bridge, local exchange, address and
  station lifecycle, named local/shared backend profiles, lease epochs,
  acknowledgement, disposition, history, and directory/status contracts.
- `artifact-root-v1` and `artifact-operations-v1` from Git-backed Artifact Ledger
  & Sync when available. Before that checkpoint, the first slice uses the
  current source-root artifact layout while recording explicit local
  path/commit provenance.
- `paw-pr-lifecycle` marker, sentry, transition, and GitHub-verification policy.
- GitHub and deterministic sentries as PR lifecycle authority.
- Current workstream state, artifact revision/provenance, pending Telex thread
  references, actor-binding state, and unresolved actions as replacement
  orchestrator context inputs.

### Exports

- `telex-addressing-v1`:
  - canonical address derivation and encoding;
  - project/workstream/node role and subrole categories;
  - address descriptions, scope, tags, lifecycle, and retirement policy;
  - explicit attachment inputs and test vectors.
- Project Telex configuration contract using a portable logical backend ID
  rather than a machine-local profile name or embedded credentials, with each
  environment supplying the local profile/credential mapping.
- Thin Telex CLI adapter contract with explicit backend/session/address inputs,
  JSON parsing, timeouts, compatibility checks, and typed failures.
- Workstream actor-binding contract for explicit role assignment, artifact
  provenance, stable address, current/last session linkage, pending thread
  references, and unresolved actions.
- Idempotent actor-operation contract covering operation IDs, persisted phases,
  expected/observed lease epochs, fencing proof, partial-failure states, and
  startup reconciliation.
- Replacement orchestrator context-assembly contract implementing the Role
  Skills Wave 2 `orchestrator-launch-context-v1` requirements without prior
  transcript access or ownership of `launch-policy-v1`.
- Bound-orchestrator UI and API contract for launch, focus, resume, replacement,
  repair, stale reconciliation, and explicit takeover.
- Session/actor projection contract that composes registry state with
  Telex-derived address/station health without storing messages or leases.
- Streamliner field-report transport/provenance envelope and blocker transport
  profile. Campaign 2 later supplies field-report payload and reconciliation
  semantics.
- `telex-pr-lifecycle-events-v1` transport envelope, canonical-emitter
  precedence, stable source-event dedupe, and routing convention for explicit
  implementer, reviewer, and orchestrator addresses.
- Message/thread provenance convention for durable artifact promotion.
- Bound-orchestrator singleton, reboot recovery, same-session resume, replacement,
  and local fencing behavior.
- Lifecycle-event routing consumed by worker lifecycle notifications, Artifact
  Ledger attention, Campaign 2 reconciliation, and future autonomous execution.

### External Dependencies

- Plugin Role Skills Wave 1 must publish stable role and subrole identifiers
  before `telex-addressing-v1` can be frozen.
- Plugin Role Skills Wave 2 must publish `orchestrator-launch-context-v1`
  before the bound-orchestrator checkpoint can complete.
- Artifact Ledger & Sync must publish `artifact-root-v1` and
  `artifact-operations-v1` before multi-builder actor launch can resolve the same
  logical artifact snapshot on every machine.
- Released Telex must continue to expose the Copilot attach/resume bridge and
  may need a safe remote handoff/takeover capability for later cross-environment
  operation.
- The terminal adapter must provide, or explicitly degrade, a focus-existing-
  orchestrator operation.
- Artifact Sync Wave 4 owns the campaign-wide two-builder gate that combines
  portable artifact-root resolution with logical Telex backend mapping.

## Formation Notes

- This brief was formed on branch `formation/telex-actor-fabric` from Campaign 1,
  Shared Project Operations.
- The candidate source remains
  `.streamliner/shaping/candidates/session-actor-control-plane.md`; this brief
  incorporates later builder decisions from the campaign formation dialogue.
- Formation treated Telex as a released dependency and used the installed
  binary's `telex copilot skill` and command help as the exact runtime contract.
- The most important shift from the original candidate is that the
  bound-orchestrator UI is now the first usable product slice immediately after
  the contract proof.
- The most important Role Skills clarification is that role assignment is
  explicit metadata. There is no loaded-role receipt and no inferred selection
  from the orientation skill.
- The most important lifecycle clarification is that Telex carries wakeups and
  evidence pointers while GitHub and deterministic sentries remain authoritative.
- The approved blind-spot review added:
  - explicit Role Skills Wave 1 and Wave 2 checkpoint dependencies;
  - replacement context assembly from durable artifacts, actor state, pending
    threads, and unresolved actions;
  - field-report ownership split across Role Skills, Actor Fabric, and Campaign
    2;
  - idempotent actor operations, lease-epoch fencing, partial-failure recovery,
    and startup reconciliation;
  - portable logical backend IDs with environment-local profile mappings;
  - transport-specific PR lifecycle event naming plus canonical-emitter
    precedence and source-event dedupe;
  - an actor-specific final gate, leaving the campaign-wide two-builder gate to
    Artifact Sync Wave 4.
- Remaining blind spots for graph formation include terminal focus support,
  released remote handoff capability, managed SDK delivery, address retirement,
  and the bounded content of replacement context packages.
- Formation intentionally created no `graph.json`, task specs, GitHub issues,
  implementation changes, or commits.
