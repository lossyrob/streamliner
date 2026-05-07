# Plan: Managed Worker Runtime Contract

## Problem and approach

Issue #61 is a contract-confidence node for the `sdk-managed-worker-runtime`
workstream. The upstream capability report already recommends a constrained-go
path for SDK-managed graph-node workers, but downstream implementation nodes need
one coherent product/runtime contract rather than another round of capability
research.

The implementation will update the project design layer and add a concise
workstream-local contract summary. The contract will keep terminal-first launch
as the default/supported path while making SDK-managed workers a first-class
builder-selected node runtime option with explicit lifecycle, registry identity,
progress, permission, takeover, PR/completion, cleanup, and review-loop
semantics.

## Work items

1. **Design contract**
   - Update `docs/design/session-system.md` so SDK-managed workers are covered by
     the session system rather than listed as out of scope.
   - Define runtime selection at node launch, registry/runtime-state ownership,
     managed lifecycle states and transitions, browser-safe progress projection,
     unattended-worker permission posture, builder-selected runtime availability,
     interruption/cancellation, one-way terminal takeover, PR/completion
     detection, cleanup-after-merge, My Sessions presentation, graph overlay
     behavior, and Automated PAW Review Loop import requirements.
   - Enumerate the managed lifecycle states from the issue and define entry/exit
     transitions for each: preparing/starting, running, idle, waiting for builder
     or needs input, interrupt requested, interrupted/paused, canceled, failed,
     PR-ready, review-ready when applicable, completed, cleanup-ready, cleaned
     up, and terminal-takeover/ownership-transferred.
   - Keep managed runtime lifecycle separate from PAW artifact-derived workflow
     status. The contract must not turn PAW `WorkflowContext.md` control state or
     model-maintained progress into authoritative runtime state.
   - Define the SDK trust and binding model: how the managed runtime creates or
     reserves the registry row, authenticates local API writes, records lifecycle
     evidence, binds graph/node identity without relying solely on Copilot CLI
     plugin hooks, and treats plugin signals as corroboration until terminal
     takeover.
   - Define progress-stream retention as well as exclusions: bounded event
     history, replay-on-reconnect posture, summarization/persistence rules, and
     what survives API/runtime restart.
   - Define bounded cancellation semantics, including timeout/failure states and
     the distinction between clean builder cancellation and runtime failure.
   - Define one-way terminal takeover mechanics: registry ownership transfer,
     row preservation, SDK teardown, progress-stream closeout, CLI resume failure
     behavior, and how subsequent trusted CLI/plugin signals rebind to the
     existing Streamliner row.
   - Define PR-ready/completed/review-ready graph linkage, including what signal
     marks a node PR-ready, where the PR URL lives, and how runtime state remains
     distinct from committed graph promotion.
   - Define cleanup targets and safety checks for linked worktrees/local
     branches: clean worktree, expected branch, verified PR merge/head state,
     registry binding match, and deterministic transition to cleaned up or
     waiting for builder.
   - Include a structured "Automated PAW Review Loop requirements" section with
     importable semantics: lifecycle events the loop can consume, stable identity
     fields, PR/review-ready signals, permission/takeover preconditions, and
     cleanup/completion signals.
   - Add a decision record under `docs/design/decisions/` if the contract creates
     durable cross-workstream rationale or constraints beyond the living design
     update. Keep `docs/design/index.md` and
     `docs/design/.vitepress/config.ts` synchronized if a decision is added.

2. **Downstream summary**
   - Add
     `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md`
     as a concise implementation-facing summary. Although the issue phrases this
     output as conditional, this plan treats it as required because the design
     contract is broad and downstream substrate, UI, takeover/cleanup, gate, and
     review-loop workers need a short importable reference.
   - Organize it around the needs of downstream workers: substrate, UI,
     takeover/cleanup, foundation gate, and Automated PAW Review Loop.

3. **Validation, review, and PR**
   - Run the configured PAW Lite planning-docs review before implementation
     because `WorkflowContext.md` has `Planning Docs Review: enabled`.
   - Treat issue #60 / PR #63 as the inherited input for this node. The contract
     consumes its constrained-go recommendation, parity evidence, progress
     redaction findings, cancellation caveats, terminal takeover verification, and
     cleanup guidance rather than re-proving them.
   - After drafting the contract, evaluate whether the accepted semantics require
     brief, graph, tracker, dependency, gate, or export amendments. If they do,
     recommend those amendments separately rather than silently changing issue
     text.
   - Run `npm run docs:build` for design-doc navigation/link validation and
     `npm run lint` if TypeScript/config files such as the VitePress sidebar are
     touched.
   - Commit selectively according to `Artifact Lifecycle: commit-and-clean`.
   - Run the configured final multi-model review before PR creation.
   - Create the final PR with a title that includes `#61` and a description that
     includes the required collapsible `Docs.md` section.

## Key decisions and constraints

- Do not implement production runtime, registry, API, or UI code in this node.
- Do not re-prove SDK/CLI parity unless a contract detail depends on a missing
  fact; inherit PR #63 and the local spike findings.
- Preserve the registry as the canonical session surface with Streamliner-owned
  stable row ids. SDK ids and Copilot session ids remain separate nullable
  identity facts.
- Honor Decisions 001 and 002 as compatibility constraints: terminal-owned
  sessions still use observation-based session tracking, and SDK-managed workers
  still receive file-based context through PAW/Streamliner launch artifacts.
- Keep browser progress as an allowlisted projection. Do not expose raw prompts,
  reasoning, tool arguments/results, hook payloads, terminal output, or
  secret-bearing content. The contract must also choose bounded retention and
  replay semantics.
- Treat permission policy as an explicit unattended-worker runtime posture; do
  not inherit launch-preparation `approveAll` as the default.
- Treat managed-runtime availability as builder-selected for the first cut. Do
  not require or invent automatic node safe/unsafe classification.
- Treat terminal takeover as one-way for the first cut. After successful
  `copilot --resume <sdk-session-id>` takeover, ownership transfers to the
  terminal path, the existing registry row is preserved/rebound, and SDK
  management does not resume.
- Treat cleanup-after-merge as a deterministic backend lifecycle action with
  safety checks, not a model prompt.
- Keep managed-runtime lifecycle/progress data in local runtime state. Graph
  overlays are projections; runtime telemetry must not be persisted into
  `graph.json`.
- Recommend tracker/graph amendments only if the accepted contract changes node
  boundaries, dependencies, gates, or workstream assumptions.
- Carry the issue's non-goals into the contract: no production runtime/API/UI
  implementation in this node, no full review/address/re-review orchestration,
  no remote/multi-user/cloud execution, no SDK-to-CLI-to-SDK round-tripping, and
  no final UI copy/theme work.
