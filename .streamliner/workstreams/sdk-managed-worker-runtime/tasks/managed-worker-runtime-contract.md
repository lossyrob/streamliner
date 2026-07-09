# Managed worker runtime contract

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-worker-runtime-contract`
- Type: research
- Status: completed

## Outcome

Streamliner has an accepted product and runtime contract for SDK-managed
graph-node execution. Implementation workers can build against the contract
without re-litigating lifecycle semantics, registry identity, progress
visibility, node launch selection, one-way terminal takeover, cleanup after
merge, or the exports Automated PAW Review Loop will consume.

## Design References

- `INDEX.md` - top-level navigation for project docs
- `WORKSTREAM-DESIGN.md` - workstream and node-boundary philosophy for this
  workstream
- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` - current
  workstream intent, decisions, imports, and exports
- `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json` - node and
  checkpoint structure
- `docs/design/index.md` - project design entry point
- `docs/design/product.md` - product architecture and workstream model
- `docs/design/operating-model.md` - developer/orchestrator/worker roles and
  gate semantics
- `docs/design/session-system.md` - session launch, registry, lifecycle, and
  runtime overlay design to extend
- `docs/design/workstream-format.md` - artifact/runtime separation and graph
  conventions
- `docs/design/concepts/context-package.md` - worker context package model
- `docs/design/concepts/waves.md` - wave/gate promotion model
- `docs/design/decisions/004-session-registry-primary-surface.md` - session
  registry as the primary session surface
- `docs/design/decisions/005-session-registry-storage-and-identity.md` -
  registry storage and identity constraints
- `docs/design/decisions/006-local-streamliner-api-service.md` - local API
  ownership of runtime actions
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW
  artifact-derived workflow status

## Inputs

- The capability report exported by `sdk-capability-parity-research`, completed
  by PR #63 / issue #60 with a constrained-go recommendation.
- Current Session Launching and Tracking artifacts, especially launch claims,
  graph binding, registry rows, node launch records, and graph runtime overlays.
- Builder decisions captured in the workstream brief: foundational scope,
  node-level runtime selection, read-only terminal-like monitoring, one-way
  terminal takeover, builder-selected safety, and cleanup-after-merge.

## Exports

- An accepted managed-worker runtime contract in the appropriate project design
  document and/or decision record.
- A workstream-local implementation contract summary at
  `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md`
  if the design update is too broad for implementation workers to consume
  directly.
- Updated brief and graph recommendations if the accepted contract changes
  downstream node boundaries, dependencies, or gate placement.
- Explicit requirements Automated PAW Review Loop can import for managed
  implementer/reviewer actors.

## Completion

Completed by PR #67, which closed GitHub issue #61. The node produced the
managed-worker runtime contract for SDK-managed graph-node execution, including
project design updates and a workstream-local implementation summary.

## Boundaries

### In scope

- Define managed worker lifecycle states and state transitions, including
  starting, running, interrupted or paused, waiting for builder, failed,
  canceled, PR-ready, review-ready if applicable, completed, and cleaned up.
- Define what belongs in durable session registry records versus runtime overlays
  for SDK-managed sessions.
- Define how managed SDK sessions appear in My Sessions and graph-node overlays,
  including the metadata that distinguishes them from terminal-launched sessions.
- Define the browser-facing progress stream: what the read-only terminal-like UI
  can show, how recent messages/status are retained, and what must not be
  exposed.
- Define the node-level runtime selection contract for terminal-first versus
  SDK-managed launch.
- Define pause/cancel/interruption semantics and the first-cut one-way terminal
  takeover contract.
- Define cleanup-after-merge semantics for linked worktrees and local branches,
  including safety checks and what marks a node cleaned up.
- Define how PR-ready/completed states are detected and linked back to the graph
  node.
- Define the safety posture for the first cut: builder-selected availability
  rather than automatic safe/unsafe node classification.
- Define the contract Automated PAW Review Loop will consume when it coordinates
  managed implementation and review actors.

### Out of scope

- Implementing production runtime, registry, API, or UI code.
- Designing full review/address/re-review orchestration.
- Removing the terminal-first launch path.
- Designing remote, multi-user, or cloud execution.
- Solving SDK -> CLI -> SDK round-tripping after terminal takeover.
- Finalizing exact UI copy, pixel layout, or terminal theme details.

## Inherited decisions

- SDK-managed execution is a launch option for node work, not an immediate global
  replacement for all terminal launches.
- Terminal takeover is one-way for the first cut.
- Cleanup after merge is included because autonomous SDK runs should not require
  opening a terminal only to remove a linked worktree/local branch.
- The progress UI should feel familiar to Copilot CLI users while remaining
  read-only and privacy-conscious.
- Node boundaries should remain PAW-sized and split for independent confidence,
  not for every implementation component.

## Design-impact expectation

Expect an update to `docs/design/session-system.md`. Create a decision record if
the accepted contract constrains future workstreams in a way that needs durable
rationale beyond the living design doc.

## Success criteria

- The foundation contract gate can evaluate one coherent contract rather than a
  pile of unresolved design choices.
- Implementation nodes know the lifecycle/status taxonomy and which state lives
  in registry records, runtime state, or derived overlays.
- UI workers know what progress stream is available, what it means, and what is
  intentionally excluded.
- Runtime workers know how interruption, cancellation, one-way takeover,
  PR-ready/completed detection, and cleanup-after-merge should behave.
- The contract states how SDK-managed sessions are represented alongside
  terminal-launched and manually tracked sessions.
- The contract states how node launch callers request SDK-managed versus
  terminal-first execution.
- Automated PAW Review Loop has explicit importable requirements for managed
  implementation/review actors.
- Any newly discovered risks from capability research are either resolved,
  constrained, or promoted as open questions before implementation proceeds.

## Engagement

The builder should review the proposed contract before
`foundation-contract-gate` passes. If the contract changes the one-way takeover,
cleanup, or safety posture assumptions from the brief, call that out explicitly
as a gate decision.
