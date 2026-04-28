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

Implementation work is intentionally behind two gates: a local research contract
gate and an external runtime-contract gate. The research nodes should export
small, durable findings that downstream implementation nodes can consume without
re-litigating the design. The implementation nodes remain sketches until the
current workstream exports the required local-session checkpoints.

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

## Current State
The workstream is newly shaped. Wave 1 should execute the research spikes in the
graph before any implementation begins. The implementation tail is blocked on
external checkpoints from `session-launching-and-tracking`, especially the
stable local session/runtime shape, single-box tracking behavior, and node
binding story. Research can proceed now because it is meant to define the
devbox-specific contracts those later implementation nodes will consume.

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

## Open Questions
- Which concrete devbox access path should the first implementation support:
  SSH, a mounted filesystem, a local bridge service, an editor remote channel,
  or something else discovered by the access spike?
- Does reliable remote observation require an agent/service on the devbox, or
  can the local Streamliner process read remote Copilot state directly with
  acceptable latency and failure behavior?
- What host/environment fields belong in the registry record versus derived
  runtime overlay state?
- Should the devbox contract update `session-system.md` only, or does it require
  a new accepted decision record once the spikes establish the approach?
