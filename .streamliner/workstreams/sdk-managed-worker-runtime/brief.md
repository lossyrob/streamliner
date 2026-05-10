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

`managed-worker-runtime-contract` completed in PR #67 and closed issue #61. The
contract accepts SDK-managed graph-node workers as a constrained-go local runtime,
adds the implementation-facing summary under the workstream docs, and updates the
project design layer through `docs/design/session-system.md` and Decision 009,
`docs/design/decisions/009-sdk-managed-worker-runtime.md`.

`foundation-contract-gate` (#62) passes with constraints after a targeted
permission-posture amendment. The builder-selected `managed-sdk` launch is the
consent boundary for autonomous node execution. The first managed PAW worker must
record a `managed-autonomous` profile and run with a Copilot CLI
YOLO/allow-all-equivalent posture, without introducing per-tool approval prompts
during SDK-owned execution. Terminal-first launch remains supported and is still
available and is still the right choice when the builder wants interactive
presence from the start.

`managed-execution-substrate` completed in PR #79 and closed issue #73. The
backend/API substrate now supports explicit `managed-sdk` graph-node execution,
canonical registry runtime metadata, `managed-autonomous` SDK permission
handling, lifecycle/progress/evidence projection, interruption/cancel routes,
conservative PR evidence detection, and graph/session projections without
mutating `graph.json`.

`builder-managed-runtime-ui` completed in PR #78 and closed issue #74. The
builder-facing Background Session UI now supports managed-sdk launch selection,
managed-autonomous consent/profile display, My Sessions and graph/node-inspector
runtime rendering, sanitized progress display, and disabled placeholders for
takeover and cleanup follow-on actions.

The next ready node is `terminal-takeover-cleanup-actions` (#75), which should
finish the operational lifecycle actions. Research-informed review promoted
`managed-runtime-startup-reconciliation` (#89) as a parallel Wave 2 safety node:
the current implementation has launch-claim reserved-row startup recovery, but
active managed SDK runtime rows also need startup reconciliation so stale
`starting`, `running`, or `interrupt_requested` rows do not appear as phantom
live background sessions after API restart.

`managed-session-console` (#85) implements the missing read-only,
terminal-looking monitoring surface. The Wave 2 punch list,
`managed-runtime-wave-2-punch-list` (#87), collects small usability and closeout
tweaks discovered during dogfooding before the usable-runtime gate.
`managed-runtime-usability-gate` (#76) should validate the integrated path only
after lifecycle actions, startup reconciliation, the console experience, and the
punch list are complete.

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
- API startup must reconcile active managed SDK runtime rows that were owned by a
  previous API process. Unless the SDK owner/session is verifiably live, stale
  active rows should move to a safe diagnostic state with a typed reason and
  builder action instead of continuing to look like running workers.
- Progress visibility should be read-only but familiar to Copilot CLI users:
  terminal-like, message/status oriented, and useful for monitoring without
  becoming an interactive terminal emulator.
- Background execution should not feel like an opaque batch job. PAW launch
  preparation and SDK-managed background sessions need a reusable
  terminal-looking console that can stream or replay sanitized activity from
  Streamliner surfaces while preserving terminal takeover as the path to
  interactivity.
- Cleanup after merge is part of the managed worker lifecycle for this
  workstream. Simple SDK-managed node runs should be able to produce a PR, let
  the builder merge it, and then clean up the linked worktree/local branch
  without opening a terminal.
- Cleanup and diff guardrails should capture a base commit/ref anchor for managed
  worktrees where practical. This strengthens cleanup decisions after squash
  merges, rewritten branches, or branch-state drift.
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
  Wave 2 child trackers are #73 (`managed-execution-substrate`), #74
  (`builder-managed-runtime-ui`), #75 (`terminal-takeover-cleanup-actions`), #89
  (`managed-runtime-startup-reconciliation`), #85 (`managed-session-console`),
  #87 (`managed-runtime-wave-2-punch-list`), and #76
  (`managed-runtime-usability-gate`). Local `tasks/*.md` specs remain durable
  support context.
- Use gates at the three consequential wave transitions: foundation contract
  acceptance, usable-runtime acceptance, and final export/closure acceptance.
- Automated PAW Review Loop should wait for this workstream's managed-worker
  runtime contract rather than inventing a separate continuation substrate.

## Open Questions

Wave 1 resolved the gate-level contract questions. Remaining questions are Wave 2
implementation details, not foundation blockers:

- terminal takeover ownership transfer and registry rebinding behavior;
- cleanup-after-merge guardrails for linked worktrees/local branches;
- startup reconciliation semantics and diagnostics for active managed SDK rows
  orphaned by API/process restart;
- base commit/ref anchoring location for managed worktree metadata and cleanup
  guardrails;
- terminal-looking console details for sanitized launch/background progress,
  replay, stale/reconnect state, truncation, and takeover closeout;
- typed `waiting_for_builder` reasons and PR-ready trust markers in the managed
  session console;
- small Wave 2 closeout/punch-list fixes that affect usability gate confidence;
- integrated usability evidence across launch, monitoring, takeover, cleanup, and
  terminal-first fallback behavior;
- first real Streamliner-node dogfood evidence before defaulting any node type to
  SDK-managed execution; and
- later safety profiles or node-type recommendations beyond the initial
  builder-selected `managed-autonomous` profile.

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
- **Managed startup reconciliation contract:** active SDK-managed runtime rows
  must not remain displayed as live workers after API restart unless the SDK
  owner/session is verifiably alive.
- **Managed session console contract:** a read-only, Copilot-CLI-like browser
  transcript for PAW launch preparation and SDK-managed background sessions,
  backed by sanitized bounded events, typed blocker reasons, PR-ready trust
  markers, and explicit takeover boundaries.
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
- **Managed worker runtime contract:** Delivered by PR #67 and issue #61. The
  foundation gate accepted the contract with a targeted `managed-autonomous`
  permission-profile amendment.
- **Managed execution substrate:** Delivered by PR #79 and issue #73. Downstream
  lifecycle actions should consume the canonical registry runtime metadata and
  managed action routes rather than creating a parallel runtime store.
- **Builder-facing managed runtime UI:** Delivered by PR #78 and issue #74.
  Takeover and cleanup UI affordances intentionally remain disabled placeholders
  until #75 wires the backend actions.
- **Terminal takeover and cleanup actions:** Issue #75 is the next ready node.
  The managed session console (#85) should consume its interrupt/takeover/cleanup
  states rather than inventing separate lifecycle semantics. Cleanup work should
  take inspiration from base-commit anchoring patterns and record enough launch
  base context to make cleanup/diff checks deterministic.
- **Managed runtime startup reconciliation:** Issue #89 is a Wave 2 must-have,
  promoted from the research proposal rather than folded into the punch list
  because stale active rows are a trust/safety risk before #76.
- **Managed session console:** Issue #85 should restore the stronger
  read-only terminal-looking monitoring intent before the usability gate,
  including typed waiting reasons and PR-ready trust markers where available.
- **Wave 2 punch list:** Issue #87 collects small usability and closeout tweaks
  discovered during dogfooding before #76.
- **Session Launching and Tracking completion:** implementation nodes may depend
  on final names or shapes from that workstream's Wave 4 graph/session overlay
  exports.

## Closeout Punch List

Tracked by `managed-runtime-wave-2-punch-list` (#87). Add small Wave 2 polish or
confidence-gap items there unless they change core semantics, need their own
gate, or produce downstream exports.

Initial item:

1. **Sessions filtered-open clarity:** when a managed-session card action opens
   My Sessions filtered to a specific session, the Sessions UI should make the
   active filter criteria visible. If the target managed session is ended and
   hidden until "show ended" is enabled, the UI should explain that the
   session-specific filter is active and what criteria currently hide the result.

Research-inspired items deliberately promoted elsewhere:

- **Managed SDK row startup reconciliation** is tracked as #89, not as a small
  punch-list tweak, because stale active runtime rows would undermine launch and
  monitoring trust before the usability gate.
- **Typed waiting reasons and PR-ready trust markers** belong in
  `managed-session-console` (#85), because they are part of the core monitoring
  surface rather than late polish.

## Later Dogfood Targets

When `managed-runtime-dogfood-hardening` is promoted, it should explicitly test:

1. `sdkSessionId` resumability after `pr_ready` for SDK re-entry or
   `copilot --resume <sdkSessionId>` terminal takeover. If resumability is not
   reliable, Automated PAW Review Loop should default to separate review/comment
   addressing workers rather than original-session continuation.
2. Crash/restart reconciliation under a real active managed node, including
   visible diagnostics and safe recovery.
3. Operational/session-registry-level signals such as `managed_session_stalled`,
   `sdk_row_orphaned_on_restart`, `cleanup_blocked_repeated`, and
   `cancellation_timeout`, without building a raw trace backend.
4. Whether Automated PAW Review Loop needs a distinct `managed-review`
   permission profile instead of reusing the implementation-oriented
   `managed-autonomous` profile.
