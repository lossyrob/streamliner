# Launch Context - Managed worker runtime contract

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` if you need project design orientation. Treat the design layer as the authority for product/runtime semantics; this context is only a launch handoff for one selected graph node.

Relevant design navigation for this node:

- `docs/design/session-system.md` - primary living design to extend for session launching, lifecycle, registry contract, tracking, and runtime overlay. It currently describes SDK-assisted PAW launch preparation followed by visible Copilot CLI worker launch; this node should define the accepted contract for SDK-managed workers as a runtime option.
- `docs/design/product.md` and `docs/design/operating-model.md` - product architecture, roles, worker/orchestrator responsibilities, and gate semantics.
- `docs/design/workstream-format.md` - graph/runtime-state separation and conventions for committed graph artifacts versus runtime overlays.
- `docs/design/concepts/context-package.md` - worker context package model.
- `docs/design/concepts/waves.md` - wave promotion, checkpoints, and gate boundaries.
- `docs/design/decisions/004-session-registry-primary-surface.md` - registry is the primary session surface; graph overlays are projections.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - registry rows use Streamliner-owned stable ids and per-record local JSON storage; do not overload Copilot session ids as record ids.
- `docs/design/decisions/006-local-streamliner-api-service.md` - local loopback API owns registry/runtime actions and trusted hook intake.
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW workflow status is derived from explicit PAW artifacts, not model-maintained control state.
- `docs/design/decisions/001-observation-based-session-tracking.md` and `docs/design/decisions/002-file-based-context-delivery.md` - useful background for current Copilot CLI observation and context delivery behavior.

Workstream-level support documents to inspect when drafting the contract:

- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` - current workstream intent, decisions, imports, exports, and open questions.
- `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json` - selected node and downstream dependency structure.
- `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md` - accepted constrained-go findings from upstream issue #60 / PR #63.
- `spikes/sdk-managed-worker-runtime/FINDINGS.md` and `spikes/sdk-managed-worker-runtime/` - reusable local spike evidence if you need to verify a specific SDK behavior.
- `WORKSTREAM-DESIGN.md` - node-boundary philosophy: this node should produce contract confidence for downstream workers, not an implementation checklist.

## Layer 1 - Worker Mission

You own exactly the selected graph node `managed-worker-runtime-contract` for workstream `sdk-managed-worker-runtime`.

Tracker: https://github.com/lossyrob/streamliner/issues/61

Mission: turn the upstream constrained-go SDK capability findings into an accepted product/runtime contract for SDK-managed graph-node execution. The contract should let downstream implementation workers build without re-litigating lifecycle semantics, registry identity, progress visibility, runtime selection, one-way terminal takeover, cleanup-after-merge, PR/completion signals, or the requirements Automated PAW Review Loop will import.

Expected primary output:

- Update the appropriate project design layer, most likely `docs/design/session-system.md`, with the accepted managed-worker runtime contract.
- Add a decision record under `docs/design/decisions/` if the contract establishes durable cross-workstream rationale or constraints beyond a living design update, especially around SDK-managed execution, one-way terminal takeover, or Automated PAW Review Loop consumption.
- Add a workstream-local implementation summary at `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md` if downstream workers need a concise consumable contract in addition to broad design-doc updates.
- Update `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` or `graph.json` only if the accepted contract changes downstream node boundaries, dependencies, gates, or exports.

In scope for this node:

- Define lifecycle states and transitions for SDK-managed node work, including preparing/starting/running/idle, needs-builder or waiting states, interruption/cancel, failed/canceled, PR-ready/review-ready if applicable, completed, cleanup-ready, and cleaned-up.
- Define durable registry identity and runtime-overlay shape for SDK-managed sessions, including how SDK-managed rows are represented alongside terminal-launched and manually tracked sessions.
- Define what belongs in durable session registry records versus SDK runtime state versus derived graph overlays.
- Define the browser-facing read-only terminal-like progress stream: allowed event classes, retention/summarization, redaction, and explicit exclusions.
- Define node-level runtime selection for terminal-first versus SDK-managed launch. Preserve terminal-first launch; first-cut SDK-managed launch remains builder-selected rather than automatic safe/unsafe classification.
- Define permission policy posture for unattended SDK-managed workers. Do not inherit launch-preparation `approveAll` as the autonomous default.
- Define pause/cancel/interruption semantics, including evidence levels and timeout/failure states for SDK abort and process-level cancellation variance.
- Define the first-cut one-way terminal takeover contract using visible Copilot CLI resume of the SDK session id, including ownership transfer, registry rebinding, and failure behavior.
- Define cleanup-after-merge as a deterministic managed lifecycle action with safety checks for linked worktrees/local branches.
- Define PR-ready/completed detection and graph-node linkage.
- Define the importable managed-worker requirements Automated PAW Review Loop should consume for managed implementer/reviewer actors.

Out of scope:

- Implementing production runtime, registry, API, or UI code.
- Designing full review/address/re-review orchestration.
- Removing terminal-first launch.
- Remote, multi-user, cloud execution, worker pools, or broad scheduling.
- SDK -> CLI -> SDK round-tripping after terminal takeover.
- Final UI copy, pixel layout, or terminal theme details.

Success looks like a coherent contract that the `foundation-contract-gate` node can evaluate and downstream nodes can build against. If the contract changes the workstream brief's assumptions about one-way takeover, cleanup, or builder-selected safety posture, call that out explicitly as a gate decision.

## Layer 2 - Relevant State

Workstream state:

- Workstream: `sdk-managed-worker-runtime` / `SDK-Managed Worker Runtime`.
- Current selected node: `managed-worker-runtime-contract`, type `research`, status `ready`, attention `focus`.
- Parent tracker: issue #59.
- Upstream dependency: `sdk-capability-parity-research` / issue #60, completed by merged PR #63.
- Next gate: `foundation-contract-gate` / issue #62, planned and dependent on this contract.

Upstream capability findings to inherit rather than rediscover:

- PR #63 delivered `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md`, `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-smoke-probe.md`, and `spikes/sdk-managed-worker-runtime/`.
- Recommendation is constrained-go for a first SDK-managed graph-node worker runtime.
- SDK-managed workers have strong evidence for repository context, working directory, tools, skills, configured MCP/plugin visibility, custom tools, permission handling, persistent session state, progress events, abort APIs, and local branch/commit/PR-draft production.
- Browser progress must be an allowlisted SDK event projection, not raw prompts, reasoning, tool arguments/results, terminal output, hook payloads, or secret-bearing data.
- Local spikes observed permission approval/denial behavior; denied writes stayed absent and a follow-up turn worked.
- Local cancellation/process-cancellation spikes observed SDK abort, idle-with-aborted, successful follow-up, no completion marker, and stopped PowerShell child process for the tested path. The contract still needs bounded timeout/failure states for other tools/shells/platforms.
- User validation confirmed visible Copilot CLI can take over an SDK-created session via `copilot --resume <sdk-session-id>`; the remaining work is ownership transfer, terminal launch/resume failure behavior, and registry observation/rebinding.
- Streamliner plugin discovery and launch-claim binding can appear in SDK-created sessions after plugin refresh/env setup, but the report recommends SDK-managed runtime write explicit lifecycle/progress records instead of relying solely on existing Copilot CLI plugin hooks as the admission/trust layer.
- Cleanup-after-merge should be deterministic backend lifecycle behavior with PAW-aware metadata and safety checks, not a best-effort model prompt.

Current design constraints to respect:

- `session-system.md` currently frames sessions primarily as Copilot CLI instances and explicitly says the current PAW launch preparation uses SDK internally but launches a visible Copilot CLI worker. This node should update that design if accepting SDK-managed workers as first-class runtime sessions.
- Registry rows are canonical and graph overlays are projections. SDK-managed sessions should not masquerade as ordinary observed CLI rows.
- Registry identity is Streamliner-owned; keep `copilotSessionId` separate and nullable. Define SDK identity fields without making SDK or Copilot ids the registry primary key.
- PAW status is artifact-derived from explicit PAW work directories. Managed runtime lifecycle should not make PAW `WorkflowContext.md` control state authoritative.
- The local API is the owner for runtime actions, registry mutation, trusted signal intake, and SSE updates. Deterministic lifecycle actions such as cleanup should be API/backend actions, not model-only behavior.
- Workstream artifacts separate committed graph/brief/design state from runtime overlays. Do not write ephemeral telemetry into `graph.json`.

Issue #61-specific outputs and criteria:

- The foundation gate needs one coherent accepted contract, not unresolved design choices.
- Runtime workers need lifecycle/status taxonomy and location of state: registry record, runtime state, or derived overlay.
- UI workers need progress-stream shape, meaning, retention, and intentional exclusions.
- Runtime workers need interruption, cancellation, one-way takeover, PR-ready/completed detection, and cleanup-after-merge semantics.
- Automated PAW Review Loop needs explicit importable requirements for managed implementation/review actors.
- Newly discovered risks from capability research should be resolved, constrained, or promoted as open questions before implementation begins.

## Layer 3 - Coordination Context

This node is a contract-confidence node in Wave 1. It should not implement the managed runtime; it should unblock implementation by making the contract reviewable and stable enough for the gate.

Sibling and dependency context:

- `sdk-capability-parity-research` is complete. Use its report and spike harness as evidence; do not spend the node re-proving basic SDK/CLI parity unless a contract detail genuinely depends on a missing check.
- `foundation-contract-gate` follows this node. Write the contract so the builder can review key decisions directly, especially any deviations from the brief's inherited assumptions.
- `managed-execution-substrate` and `builder-managed-runtime-ui` are planned downstream implementation nodes that should be able to proceed in parallel after the gate against this contract.
- `terminal-takeover-cleanup-actions` depends on substrate and UI and will ship operational lifecycle actions; make takeover and cleanup semantics explicit enough for that node.
- Later dogfood/export nodes are provisional. If this contract suggests different boundaries or gate placement, recommend graph/brief amendments rather than silently reshaping the workstream.

PAW/run expectations for this launch:

- Use the PAW Lite process with final-PR-only review gating. Continue autonomously through planning, implementation, documentation, and final PR unless there is a serious blocker, unsafe ambiguity, missing infrastructure/credentials, or material scope mismatch.
- Planning review should use multi-model pre/post-mortem perspectives, non-interactive, with Opus 4.7 for each model slot.
- Final review should be multi-model, non-interactive, with pre/post-mortem perspectives and Opus 4.7.
- The final PR title must include issue `#61`.
- The final PR description must include a collapsible `<details>` section with `<summary>Docs.md</summary>` whose contents are a completed Docs.md following the `paw-docs-guidance` template.
- If issue #61 or parent/child tracker amendments are needed, pause and propose the amendments for discussion rather than editing issue text unilaterally.

Launch/worktree context:

- Launch cwd: `C:/Users/robemanuele/proj/streamliner/streamliner` on branch `main`; treat it as the base/coordination checkout.
- Worktree policy: do not check out the target node branch in the launch cwd. PAW init should create or reuse a sibling worktree for the target branch and place `.paw/work/<workId>` there.
- Selected graph path: `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json`.
- Tracker URL: https://github.com/lossyrob/streamliner/issues/61.
- Launch nonce: `a940196e-32c3-4f0c-8b56-307ef4e47f2d`.
- Existing Streamliner launch record: none.
