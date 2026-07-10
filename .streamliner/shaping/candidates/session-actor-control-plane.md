# Telex-backed Session Actor Control Plane

## Status

Shaped; ready for formation after review of the Shared Project Operations
campaign.

## Summary

Attach selected Streamliner sessions to durable Telex responsibility addresses so
orchestrators, workers, and supporting roles can coordinate without the builder
copying messages between sessions.

Telex owns the message fabric: addresses, stations, delivery, liveness,
acknowledgement, history, and local or networked backends. Streamliner owns how
project/workstream/node roles map onto those addresses, which session is serving a
role, what coordination events mean, and how messages update the operational
picture.

Actors remain ephemeral sessions serving durable responsibilities. A workstream
orchestrator can stop and be replaced; its Telex address and queued messages
remain.

## Why It Matters

Real Streamliner work now involves:

- long-running terminal and SDK-managed sessions;
- a workstream orchestrator coordinating several workers;
- sessions waiting on PRs, reviews, CI, or another workstream;
- workers discovering blockers, scope pressure, or missing work;
- laptop, devbox, and teammate environments participating in the same project;
- lifecycle events that should wake an orchestrator immediately instead of on
  its next polling turn.

The missing product layer is no longer a message transport. Telex is released and
provides that transport. The missing layer is the Streamliner integration that
binds work geometry and session lifecycle to the fabric.

## Ownership Boundary

| Concern | Owner |
|---|---|
| Address registration, station attachment, store-and-forward delivery, liveness, acknowledgements, and message history | Telex |
| Local SQLite and shared Postgres backend behavior | Telex |
| Streamliner project/workstream/node role identifiers | Plugin Role Skills (`role-context-v1`) |
| Mapping those roles and scopes to Telex addresses | This workstream (`telex-addressing-v1`) |
| Session registry, launch claims, runtime projection, and managed/terminal session identity | Streamliner |
| Meaning and routing of workstream events, field reports, blockers, and escalation | Streamliner |
| Durable briefs, graphs, reports, and decisions | Streamliner artifacts, not Telex history |

Streamliner should consume Telex as a released dependency. It should not fork,
vendor, or recreate Telex's mailbox, daemon, persistence, backend, or Copilot
bridge.

## Address and Actor Model

A Telex address names a durable responsibility. A station is the current session
serving it.

Illustrative addresses:

```text
project:<projectKey>/role:designer
project:<projectKey>/workstream:<workstreamId>/role:orchestrator
project:<projectKey>/workstream:<workstreamId>/node:<nodeId>/role:worker
project:<projectKey>/role:artifact-sentry
```

Formation may refine the exact syntax, but `telex-addressing-v1` should guarantee:

- stable derivation from Streamliner project/workstream/node identity;
- role identifiers imported from `role-context-v1`;
- no dependence on a Copilot session ID or process ID;
- enough scope to route a message to the responsible actor;
- compatibility with local and shared Telex backend profiles.

Not every observed session becomes an actor. A session becomes an actor when it
accepts a role, mission boundary, address attachment, and reporting obligation.

## Project Configuration

Streamliner should reference a Telex backend by configured profile name, never by
copying credentials into project artifacts.

The first configuration seam is expected to include:

```text
projectKey
telexBackendProfile
telexAddressNamespace
```

Local SQLite is sufficient for same-machine dogfood. Multi-builder operation uses
a shared Telex backend. Backend installation, authentication, schema management,
and transport behavior remain Telex concerns.

## Candidate Scope

### In Scope

- Define `telex-addressing-v1`.
- Import stable role identifiers from `role-context-v1`.
- Add project-level Telex backend/profile references.
- Attach and detach eligible terminal or managed sessions to role addresses.
- Represent address, station, liveness, and message-attention state in the
  Streamliner session/actor projection.
- Route worker lifecycle events such as #121 to the bound orchestrator address.
- Define a small set of Streamliner coordination message profiles: handoff,
  blocker, field report, map correction, review ready, merge ready, and
  escalation.
- Bind a workstream orchestrator to its durable address and support replacement
  or resumption by another session.
- Preserve Telex message/thread identifiers when an event is promoted into a
  durable artifact, issue, or reconciliation record.
- Dogfood the integration against a real multi-session workstream.

### Out of Scope

- Implementing a mailbox, queue, daemon, lease, heartbeat protocol, delivery
  buffer, acknowledgement store, or message-history database.
- Reimplementing Telex's Copilot bridge or backend authentication.
- Storing workstream artifacts in Telex.
- Making every observed session messageable.
- General-purpose chat UI.
- Full autonomous wave progression.
- Hosted Streamliner services or a new remote relay.
- Designing multi-user authorization beyond consuming the configured Telex and
  repository access models.

### Deferred

- Broadcast/dispatch markets and capability-card routing.
- Portfolio-level actors spanning several projects.
- Rich conversation UI beyond operational message/attention surfaces.
- Policy-driven automatic reassignment when a station disappears.

## Field Reports and Durable Promotion

Telex carries concise operational messages. It does not replace the workstream
record.

A worker field report should identify:

- the project, workstream, and node;
- outcome and evidence;
- blockers and downstream impacts;
- map corrections or scope pressure;
- requested disposition;
- links or pointers to commits, PRs, issues, and artifacts.

When a report changes the durable plan, Streamliner or the orchestrator promotes
the result into `brief.md`, `graph.json`, a reconciliation note, an issue, or a
design record. The promoted artifact should retain the Telex message/thread ID as
provenance.

## Wave Intent

Actual formation should decide node boundaries. The likely progression is:

### Wave 1: Telex integration contract

- Verify the supported released Telex CLI/plugin integration surface.
- Define project configuration and `telex-addressing-v1`.
- Map `role-context-v1` roles onto project/workstream/node addresses.
- Define the first Streamliner coordination message profiles.
- Decide the thin adapter boundary between the Streamliner API/plugin and Telex.

**Checkpoint:** another workstream can bind a known Streamliner role to a stable
Telex address without inventing its own naming or transport behavior.

### Wave 2: Session attachment and operational projection

- Attach/detach terminal and managed sessions.
- Project address/station/liveness/message-attention state into Streamliner.
- Route lifecycle events and acknowledgements.
- Support bound-orchestrator replacement and resumption.
- Add minimal API/UI operations needed to inspect or act on coordination state.

**Checkpoint:** an orchestrator and worker can exchange and disposition messages
through Telex while Streamliner shows who is serving each responsibility.

### Wave 3: Orchestrator and multi-builder dogfood

- Run a real workstream using the plugin role skills and Telex addresses.
- Route worker completion, blockers, field reports, and review/merge readiness.
- Exercise station replacement and an offline recipient.
- Exercise a shared Telex backend from two environments/builders.
- Promote at least one message outcome into a durable artifact with provenance.

**Gate:** coordination no longer requires the builder to carry messages between
sessions, and the durable project record remains understandable without reading
Telex history.

## Expected Exports

- `telex-addressing-v1`.
- Project Telex profile-reference contract.
- Streamliner actor/session projection fields.
- Streamliner coordination message profiles.
- Field-report transport and provenance convention.
- Bound-orchestrator attach/resume behavior.
- Lifecycle-event routing consumed by #121 and later autonomous execution.

## Dependencies

### Imports

- Released Telex and its supported plugin/CLI/backend contracts.
- `role-context-v1` from Streamliner Plugin Role Skills.
- Existing Streamliner session registry, launch pipeline, lifecycle plugin hooks,
  and managed-runtime session identity.
- Existing project/workstream/node identifiers.

### Enables

- Campaign 2 Node Handoff, Boundary Pressure & Reconciliation.
- Campaign 4 Automated PAW Review and Autonomous Wave Progression.
- Artifact-sync attention routing in the Shared Project Operations campaign.
- Session attention/desktop notification surfaces.

## Review Criteria

This workstream succeeds when:

- Streamliner does not contain a second message transport;
- a role address survives session replacement;
- terminal and managed sessions can serve the same address model;
- lifecycle and field-report events reach the responsible orchestrator;
- offline/store-and-forward behavior works through Telex;
- shared-backend operation works across two environments;
- durable decisions are promoted into artifacts instead of being stranded in
  message history;
- the builder no longer performs routine session-to-session relay.

## Open Questions

- Should the first Streamliner adapter invoke the Telex CLI, use a future library
  interface, or support both behind one boundary?
- Which roles attach automatically at Streamliner launch, and which require
  explicit builder/session confirmation?
- Which message profiles belong in the first useful slice?
- How should Streamliner display an unoccupied but queued address?
- When a terminal takeover occurs, does the new session inherit the managed
  session's station attachment or explicitly reattach?
- How should Telex backend/profile health appear in project diagnostics?

## Handoff Brief

Form the Telex-backed Actor Fabric & Bound Orchestrator workstream inside the
Shared Project Operations campaign.

The workstream must adopt released Telex as the complete message fabric and keep
Streamliner focused on integration: project/profile configuration, durable
role-address derivation, session attachment, actor/liveness projection,
Streamliner-specific coordination message profiles, lifecycle routing, bound
orchestrator behavior, and promotion of message outcomes into durable artifacts.

Wave 1 should produce `telex-addressing-v1` and a thin integration contract.
Wave 2 should make terminal and managed sessions attachable and visible. Wave 3
should dogfood a real orchestrator/worker flow across multiple sessions and a
shared backend. Do not implement a Streamliner mailbox or persist message files
under `.streamliner`.
