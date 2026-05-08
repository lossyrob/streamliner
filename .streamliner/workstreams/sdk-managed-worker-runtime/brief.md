# SDK-Managed Worker Runtime

## Purpose

Build Streamliner's foundation for running graph-node worker sessions through a
managed Copilot SDK runtime rather than a visible terminal-first Copilot CLI
session. The workstream should make SDK-managed execution a node-level launch
option, give the builder terminal-like read-only visibility, and preserve the
ability to interrupt the autonomous path and continue in Copilot CLI when human
takeover is needed.

This is the runtime substrate that Automated PAW Review Loop should consume when
it needs controllable implementation and review actors.

## Approach

The workstream starts with a design-foundation wave because the risky question is
not only implementation mechanics; it is whether the SDK worker can be made close
enough to a Copilot CLI worker to become a durable Streamliner runtime. Wave 1
therefore verifies capability parity, then turns the accepted findings into a
managed-worker runtime contract covering lifecycle states, registry identity,
progress streams, node launch selection, one-way terminal takeover, and cleanup
after merge. A foundation contract gate blocks implementation until the builder
accepts that contract.

After the gate, implementation proceeds through one usable-runtime wave with
PAW-sized nodes rather than small checklist tasks. The substrate node owns the
managed execution path and runtime state. The builder-facing UI node can proceed
in parallel against the accepted contract and exposes per-node runtime selection
plus a read-only terminal-like progress surface. Terminal takeover and
cleanup-after-merge then complete the wave as operational lifecycle actions,
because the builder should not promote the next wave until SDK-managed sessions
can finish common node work without requiring the builder to crack open a
terminal. A managed-runtime usability gate ends this wave because the result is
both experiential and safety-relevant.

Later-wave nodes are hypotheses. The orchestrator should split, merge, or
replace them at promotion time based on the accepted contract and the real
complexity of the shipped substrate. Node boundaries should follow
`WORKSTREAM-DESIGN.md`: split for independent confidence, safe parallelism,
stable exports, or validation boundaries rather than for every implementation
area.

## Design References

- `streamliner:INDEX.md` - top-level project document index for future sessions
- `streamliner:WORKSTREAM-DESIGN.md` - workstream and node-boundary philosophy
  for PAW-sized work
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope and architecture
- `streamliner:docs/design/operating-model.md` - roles, context package, gates,
  and worker/orchestrator responsibilities
- `streamliner:docs/design/workstream-format.md` - graph, node, tracker, and
  runtime-state artifact conventions
- `streamliner:docs/design/session-system.md` - current session launch,
  registry, lifecycle, and graph-overlay design
- `streamliner:docs/design/concepts/context-package.md` - layered worker context
  model
- `streamliner:docs/design/concepts/waves.md` - wave promotion, checkpoints, and
  gate boundaries
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md`
  - current rationale for observing Copilot CLI session state
- `streamliner:docs/design/decisions/002-file-based-context-delivery.md` -
  context delivery model that managed SDK workers should preserve or update
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md` -
  session registry product role
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md`
  - local session registry storage and identity contract
- `streamliner:docs/design/decisions/006-local-streamliner-api-service.md` -
  local API process boundary for runtime actions and UI integration
- `streamliner:docs/design/decisions/007-tracked-workstream-registry.md` -
  workstream routing and graph-source model
- `streamliner:docs/design/decisions/008-paw-artifacts-for-workflow-status.md` -
  PAW artifact-derived workflow status
- `streamliner:docs/design/decisions/009-sdk-managed-worker-runtime.md` -
  accepted SDK-managed graph-node worker runtime contract

## Boundaries

- **In scope:** SDK-managed graph-node worker launch as a node-level runtime
  option; research into SDK/CLI capability parity; managed worker lifecycle and
  status semantics; read-only terminal-like progress visibility; pause/cancel or
  interruption semantics; one-way terminal takeover for the first cut; session
  registry metadata for managed sessions; My Sessions and graph overlay behavior;
  PR-ready/completed surfacing; cleanup-after-merge for autonomous node sessions;
  runtime-selection affordances in the existing launch flow; export of the
  managed-worker contract for Automated PAW Review Loop.
- **Out of scope:** Replacing every terminal launch immediately; removing visible
  Copilot CLI launch support; automated PAW review/address/re-review loop
  orchestration itself; remote or multi-user execution; cloud worker pools;
  multi-agent scheduling; a general-purpose workflow engine outside Streamliner
  node/review execution; assuming SDK-managed workers are always safe without a
  builder-selected launch choice.
- **Deferred:** SDK -> CLI -> SDK round-tripping after terminal takeover; full
  terminal live-stream mirroring; automatic multi-node autonomous scheduling;
  rich safety classification by node type; remote execution pools; broad
  distribution wrappers around the runtime.

## Current State

The workstream is formed from
`.streamliner/shaping/candidates/sdk-managed-worker-runtime.md` and the
builder's follow-up shaping notes. GitHub parent issue #59 tracks the workstream,
and Wave 1 uses GitHub-backed tracking through issues #60, #61, and #62. The
local task specs under `tasks/` remain durable node context for workers.

`sdk-capability-parity-research` completed in PR #63 and closed issue #60. The
accepted recommendation is constrained-go for a first SDK-managed graph-node
worker runtime. The research report and reusable spike harness captured evidence
for SDK startup/session persistence, repository instructions, explicit skills,
MCP/plugin visibility, browser-safe progress projection, permission approval and
denial behavior, SDK abort plus process-level cancellation on the tested
PowerShell path, one-way `copilot --resume <sdk-session-id>` terminal takeover,
Streamliner plugin launch-claim spooling, and local branch/commit/PR-draft
production.

`managed-worker-runtime-contract` completed in PR #67 and closed issue #61. It
accepted SDK-managed graph-node workers as a constrained-go local runtime and
updated `docs/design/session-system.md`, Decision 009, and the workstream-local
implementation contract summary.

`foundation-contract-gate` (#62) passes with constraints after a targeted
permission-posture amendment. The builder-selected `managed-sdk` launch is the
consent boundary for autonomous node execution. The first managed PAW worker must
record a `managed-autonomous` profile and run with a Copilot CLI
YOLO/allow-all-equivalent posture, without introducing per-tool approval prompts
during SDK-owned execution. Terminal-first launch remains supported and is still
the right choice when the builder wants interactive presence from the start.

Wave 1 nodes may add workstream-local support documents under `docs/` when the
findings are useful to downstream workers but do not yet belong directly in the
project design layer.

Session Launching and Tracking is the primary upstream workstream import. It is
close enough to completion that Wave 1 can begin now against the current
substrate and its remaining planned exports.

## Decisions

- Shape this as a foundational SDK-managed worker runtime workstream, not a
  narrow review-loop continuation slice.
- Runtime mode is selected at node launch time. The first product surface may be
  two launch actions, a runtime option, or a checkbox in the existing launch
  flow, but the decision lives at the node-launch boundary.
- The first cut uses one-way takeover: a managed SDK session may be interrupted
  and opened in Copilot CLI, but once the builder takes over in a terminal the
  session becomes terminal-managed and does not return to SDK management.
- Progress visibility should be read-only but familiar to Copilot CLI users:
  terminal-like, message/status oriented, and useful for monitoring without
  becoming an interactive terminal emulator.
- Cleanup after merge is part of the managed worker lifecycle for this
  workstream. Simple SDK-managed node runs should be able to produce a PR, let
  the builder merge it, and then clean up the linked worktree/local branch
  without opening a terminal.
- Initial safety posture is builder choice. The SDK-managed launch option should
  be available for nodes, and Streamliner can learn later which node types should
  default to or warn against it.
- SDK-managed autonomous execution uses node launch as the consent boundary. The
  first managed PAW worker records a `managed-autonomous` profile and runs with a
  YOLO/allow-all-equivalent tool posture while Streamliner owns the SDK session;
  it must not pause for per-tool approval prompts or silently fall back to another
  runtime.
- GitHub issue #59 is the parent tracker for this workstream. Wave 1 child
  trackers are #60 (`sdk-capability-parity-research`), #61
  (`managed-worker-runtime-contract`), and #62 (`foundation-contract-gate`);
  local `tasks/*.md` specs remain durable support context.
- Use gates at the three consequential wave transitions: foundation contract
  acceptance, usable-runtime acceptance, and final export/closure acceptance.
- Automated PAW Review Loop should wait for this workstream's managed-worker
  runtime contract rather than inventing a separate continuation substrate.

## Open Questions

Wave 1 resolved the gate-level contract questions. Remaining questions are Wave 2
implementation details, not foundation blockers:

- exact persisted field/API names for managed lifecycle, progress, completion,
  permission profile, takeover, and cleanup state;
- numeric retention caps for sanitized progress event count and byte size;
- first real Streamliner-node dogfood evidence before defaulting any node type to
  SDK-managed execution; and
- later safety profiles or node-type recommendations beyond the initial
  builder-selected `managed-autonomous` path.

## Imports and Exports

### Imports

- **Session Launching and Tracking substrate:** launch context, PAW
  initialization behavior, launch claims, registry `graphBinding`, node launch
  records, session/workstream routes, PR/artifact observation seams, and graph
  runtime overlay primitives.
- **Copilot SDK and Copilot CLI behavior:** SDK worker capabilities, CLI session
  state, plugin/hook behavior, and resume/takeover mechanics.
- **PAW workflow behavior:** PAW Lite implementation flow, PR creation, artifact
  status, review policies, and cleanup expectations.

### Exports

- **Managed worker runtime contract:** lifecycle states, status transitions,
  progress-stream shape, autonomous permission posture, pause/cancel semantics,
  PR/completion signals, and cleanup semantics.
- **Terminal takeover contract:** first-cut one-way ownership transfer from
  SDK-managed runtime to visible Copilot CLI.
- **Session registry metadata for SDK-managed sessions:** fields and overlay
  behavior that let My Sessions and graph nodes distinguish managed SDK sessions
  from terminal-launched sessions while preserving a unified session surface.
- **Node launch runtime-selection contract:** the shape future launch callers use
  to request terminal-first or SDK-managed execution.
- **Review-loop dependency contract:** requirements Automated PAW Review Loop can
  consume when it coordinates implementation and review actors.

### External Dependencies

- **SDK/CLI interoperability evidence:** Delivered by PR #63 and issue #60. The
  downstream implementation nodes should consume the constrained-go findings
  rather than rediscover SDK capability basics.
- **Session Launching and Tracking completion:** implementation nodes may depend
  on final names or shapes from that workstream's Wave 4 graph/session overlay
  exports.

## Closeout Punch List

No closeout items yet. During dogfooding, small polish or confidence-gap items
should be parked here and batched near the closure gate unless they change core
semantics, need their own gate, or produce downstream exports. The foundation
gate's only promoted constraint is the explicit `managed-autonomous`
permission-profile requirement for Wave 2.
