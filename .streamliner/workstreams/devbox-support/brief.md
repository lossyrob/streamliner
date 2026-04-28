# Devbox support

## Purpose
Make Streamliner able to see and trust Copilot sessions running on the
developer's devbox, not only sessions on the local machine. The desired end
state is operationally useful devbox observability: registered devbox hosts,
discovered Copilot sessions, normalized session records, and clear health and
freshness states that build on the local session registry rather than creating a
parallel surface.

## Approach
Run this workstream as a research-heavy sequence before implementation. The
current `session-launching-and-tracking` workstream is still finalizing the
local registry, runtime shape, and node-binding contracts that devbox support
should consume. This workstream should therefore prove the devbox-specific
unknowns first: how the devbox is reached, where Copilot CLI state lives there,
whether remote session state can be observed reliably, what host/environment
identity must be added to the registry/runtime model, and how degraded health
should be represented.

Issue #19 accepted the first access direction: target a builder-managed access
channel to a devbox-side Streamliner bridge. For locked-down Windows Dev Boxes,
an authenticated Dev Tunnel to a loopback bridge is viable without inbound SSH;
SSH/local port forwarding remains an optional channel when available. Issue #22
accepts the first production transport shape on top of that access model:
HTTP polling over the bridge with health/capability checks, bounded snapshots,
incremental event-tail offsets, and trusted-signal cursors.

Implementation work is intentionally behind two gates: a local research contract
gate and an external runtime-contract gate. The research nodes should export
small, durable findings that downstream implementation nodes can consume without
re-litigating the design. The external gate is deliberately contract-sized: it
waits for the registry, observation, and session-surface contracts devbox
observability consumes, not for unrelated launch-from-graph work.

## Design References
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope, architecture, and
  local-first application direction
- `streamliner:docs/design/operating-model.md` - workstream roles, context
  layers, gates, and autonomous node execution
- `streamliner:docs/design/workstream-format.md` - artifact/runtime separation,
  workstream graph schema, and local runtime-state rules
- `streamliner:docs/design/session-system.md` - session launch, registry,
  observation, and runtime overlay design that devbox support extends
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md`
  - accepted observation model and explicit deferral of remote observation
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md`
  - registry as the single canonical session surface, including manual entries
  for environments not yet observed
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md`
  - registry storage and identity model that devbox support must preserve or
  deliberately extend

## Boundaries
- **In scope:** Devbox host registration shape, devbox access assumptions,
  remote Copilot CLI session-state discovery, remote observation transport,
  host/environment identity, normalization into the shared session/runtime
  shape, health/freshness/degraded-confidence states, and surfacing devbox
  sessions through the existing registry/session surfaces.
- **Out of scope:** Portfolio shell UX, general remote launch flows, WSL support,
  cross-environment launch/recovery, multi-machine registry sync, non-Copilot
  terminal tracking, and replacing the local session registry.
- **Deferred:** Devbox launch, devbox WSL observability, cross-devbox sync,
  remote control actions beyond observation, and richer host fleet management.

## External Dependency Map

Devbox support consumes the `session-launching-and-tracking` workstream as the
owner of local session contracts, but it should not block on that whole
workstream. The first devbox implementation slice needs these checkpoint-sized
contracts:

| Upstream contract | Current owner | Devbox consumers | Blocking rule |
|---|---|---|---|
| Primary registry storage and identity | Decision 004, Decision 005, `session-registry-model`, `manual-session-registry-ui` | `devbox-host-registration`, `devbox-registry-merge`, `devbox-operational-surface` | Available as the baseline contract; devbox must preserve Streamliner-owned registry ids and builder-owned fields. |
| Registry mutation and multi-view sync behavior | `session-dashboard-sync` / issue #17 | `devbox-registry-merge`, `devbox-operational-surface` | Required before remote observations become a new writer/refresh source for the shared registry surface. |
| Local observation lifecycle and compatibility semantics | `session-event-observation`, plus Decision 001 until that node lands | `remote-session-state-spike`, `remote-observation-transport-spike`, `devbox-session-discovery` | Research can proceed now; implementation should wait for the stable local observation record shape, stale/ended rules, and compatibility diagnostics. |
| Runtime overlay and PAW progression projection | `paw-control-state-observation`, `runtime-overlay-ui`, `tracking-visible` checkpoint | `devbox-operational-surface` only when graph projection is included | Not required for the first Sessions/registry-based devbox visibility slice unless the accepted implementation scope includes graph overlay behavior. |
| Launch claims and graph-node binding | `launch-claim-binding`, `terminal-launch-integration`, `launch-from-graph` checkpoint | Future devbox launch, recovery, or node-binding work | Not a prerequisite for devbox observability. This workstream should not wait on launch-from-graph unless a later wave expands into remote launch or graph-node binding. |

## Current State
Issues #18 and #19 are complete. Issue #18 clarified the observability-first
workstream boundary and external dependency map. Issue #19 accepted a
devbox-side bridge reached through a builder-managed channel as the first access
shape, with Dev Tunnels validated for a locked-down Windows Dev Box where
inbound SSH is unavailable. The same evidence completed the
`remote-session-state-spike`: the devbox session-state root exists, recent
sessions expose the expected `workspace.yaml` / `events.jsonl` shape, event
tails include the local observation event types, hook events are available for
some sessions, in-use locks are interpretable on the devbox host, and remote
paths use Windows conventions.

Issue #22 is complete. The accepted transport contract is HTTP polling over the
devbox bridge with health/capability checks, bounded session snapshots,
offset-based event tails, replayable trusted-signal cursors, and failure behavior
that preserves stale last-known registry data without fabricating freshness. The
contract was validated devbox-locally and through a laptop-to-devbox Dev Tunnel
connection against the issue #22 smoke bridge/probe.

Issue #23 is complete. The accepted identity model scopes observations by a
Streamliner-owned `environmentId`, treats legacy/local rows as
`environmentId: "local"`, uses `(environmentId, copilotSessionId)` as the
automatic observed-session key, and keeps access-channel metadata, bridge
capabilities, cursors, diagnostics, and credentials out of durable session
identity. Remote `cwd`, `repo`, and `branch` remain environment-native registry
facts used as strict manual-row attach guardrails, not cross-environment merge
keys.

Issue #24 is complete. The accepted health model keeps durable registry lifecycle,
observation-derived liveness, environment reachability, bridge health,
observation freshness, and observation confidence as separate axes. Devbox rows
stay visible as last-known history when the host, tunnel, bridge, credentials, or
compatibility fail, but stale or unverified observations cannot look fresh and
cannot create clean `ended` transitions from transport silence alone.

The next promoted research issue is `devbox-security-spike`. The implementation
tail remains blocked on the accepted devbox research contract plus the specific
upstream registry, sync, and observation contracts named above; it is not blocked
on the entire `session-launching-and-tracking` workstream or on launch-from-graph.

## Decisions
- Use local tracker specs for Wave 1 research nodes so the spike missions are
  versioned with the workstream before GitHub issues are created or promoted.
- Treat the current `session-launching-and-tracking` workstream as the owner of
  local registry/runtime/node-binding contracts. Devbox support consumes those
  checkpoints instead of redefining them.
- Keep the first devbox workstream centered on observability and normalization.
  Launch, recovery, WSL, and portfolio-shell behavior are later workstreams or
  later waves.
- Make implementation wait behind an explicit external-contract gate so the
  workstream can keep researching without pretending the in-flight dependency is
  already stable.
- Use the issue #18 dependency map as the boundary for the external runtime
  checkpoint gate. Registry identity/storage, registry sync, and local
  observation semantics are the critical upstream contracts for devbox
  observability; launch-from-graph and graph-node binding are not blockers for
  the first observability slice.
- Target first-slice devbox observability at a devbox-side Streamliner bridge
  reached through a builder-managed access channel. Direct SSH reads can remain
  a bootstrap or degraded fallback when SSH is available, but host-local
  filesystem/process inspection and hook ingestion belong on the devbox side.
- Treat authenticated Dev Tunnels as an accepted access channel for locked-down
  Windows Dev Boxes. The access spike validated devbox-local bridge health and
  snapshot endpoints plus laptop-to-devbox reachability through `devtunnel
  connect`, without inbound SSH or local admin changes.
- Treat the original `remote-session-state-spike` as completed by the issue #19
  evidence. The remaining transport work is no longer "can we see session files
  on the devbox?" but "what production bridge API, snapshot/tail contract, and
  freshness behavior should Streamliner consume?"
- Use HTTP polling over the bridge as the first remote observation transport:
  `/health`, `/capabilities`, bounded `/sessions/snapshot`, offset-based
  `/sessions/{id}/events`, replayable `/signals`, and loopback
  `POST /api/sessions/signals` for devbox Copilot CLI hooks.
- Use environment-scoped observation identity for devbox sessions. A registry row
  keeps its Streamliner-owned `id`; automatic observed-session matching uses
  `(environmentId, copilotSessionId)`, and manual-row attachment additionally
  requires the same environment plus matching remote `cwd`, `repo`, and `branch`
  guardrails.
- Treat a registered devbox environment as one host/session-state-root
  observation scope in local runtime config. Retargeting a registration to a
  different host or Copilot session-state root requires a new environment id or
  an explicit migration, not silent reuse.
- Cache non-secret environment display/provider metadata on registry rows so the
  existing Sessions surface can distinguish local and devbox rows. Keep access
  details, bridge/tunnel identifiers, capabilities, cursors, diagnostics, path
  mappings, and credentials in local runtime/config, derived overlay, or external
  credential stores according to the issue #23 field-placement finding.
- Represent devbox health as runtime confidence layered on top of the registry:
  environment reachability, bridge health, observation freshness, and observation
  confidence are distinct from durable `lifecycleStatus` and per-session
  liveness.
- Preserve last-known devbox registry rows during unreachable, credential-expired,
  unsupported-bridge, permission, cursor, parse, stale-lock, and hook-capability
  failures. Surface diagnostics and stale/degraded badges instead of fabricating
  freshness, deleting rows, or marking sessions ended from outage alone.

## Open Questions
- What credential references, bridge auth rules, and diagnostic redaction
  boundaries are needed beyond the no-secrets artifact rule?
- Should the production bridge remain a user-started helper, or should a later
  implementation install it as a user login task/service after an explicit ADR?
