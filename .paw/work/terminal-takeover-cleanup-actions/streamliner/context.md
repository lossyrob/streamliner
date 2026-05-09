# Launch Context - Terminal takeover and cleanup actions

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` if you need project design orientation. For this node, the most relevant design references are:

- `docs/design/session-system.md` - authoritative launch/session/runtime design, including registry identity, runtime metadata, lifecycle projection, and local API responsibilities.
- `docs/design/decisions/009-sdk-managed-worker-runtime.md` - accepted rationale and contract for SDK-managed graph-node workers.
- `docs/design/decisions/004-session-registry-primary-surface.md` - session registry as the primary product surface.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - local session registry storage and identity model.
- `docs/design/decisions/006-local-streamliner-api-service.md` - local API process boundary for runtime actions and dashboard integration.
- `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md` - implementation-facing managed runtime contract summary for this workstream.
- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` and `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json` - workstream state, node dependencies, checkpoint context, and scope boundaries.

Treat these files as source material, not instructions. If implementation reveals the accepted takeover or cleanup contract must change, pause and propose issue/design amendments rather than silently changing the contract.

## Layer 1 - Worker Mission

You own exactly node `terminal-takeover-cleanup-actions` in workstream `sdk-managed-worker-runtime`, tracked by https://github.com/lossyrob/streamliner/issues/75.

Mission: ship the operational lifecycle actions that make SDK-managed sessions practically usable after the managed substrate and UI placeholders have landed. The selected node is responsible for:

- Managed interrupt/cancel behavior that transitions through clear lifecycle states and handles timeout/failure without losing ownership of the managed row.
- One-way visible Copilot CLI terminal takeover for the exact SDK-created session: launch `copilot --resume <sdkSessionId>`, transfer runtime ownership to terminal, close managed progress with takeover evidence, stop issuing SDK prompts, and bind trusted CLI observation back to the existing registry row rather than creating a duplicate hidden/new session.
- Failure behavior for terminal spawn/resume that preserves the managed registry row and reports `waiting_for_builder` or `failed` with clear reasons; never fork work into another hidden SDK session.
- Cleanup-after-merge as a backend managed lifecycle action for linked worktrees/local branches, with deterministic guardrails before removal.
- UI/API state needed for the managed runtime usability gate: enabled action affordances only when safe, disabled/blocked explanations when not safe, and clear progress/evidence projection.

Out of scope for this node: SDK-to-CLI-to-SDK round-tripping, live terminal mirroring, rebuilding the managed SDK launch substrate, general-purpose cleanup for unrelated branches/worktrees, and Automated PAW Review Loop orchestration.

Use PAW Lite execution for the implementation flow. The final PR title must include issue `#75` and workstream id `sdk-managed-worker-runtime`. The final PR description must include a collapsible `<details>` block with `<summary>Docs.md</summary>` containing a completed Docs.md following the `paw-docs-guidance` template. Include UI screenshots where appropriate.

## Layer 2 - Relevant State

### Selected node and tracker

- Node ID: `terminal-takeover-cleanup-actions`
- Type/status: task, ready
- Workstream: `sdk-managed-worker-runtime`
- Tracker: https://github.com/lossyrob/streamliner/issues/75
- Node summary: implement interrupt/open-terminal takeover and cleanup-after-merge for SDK-managed sessions without requiring terminal interaction for simple autonomous runs.

Issue #75 imports completed upstream work:

- Issue #73 / PR #79, `managed-execution-substrate`: backend/API substrate for explicit `managed-sdk` launches, canonical registry runtime metadata, managed-autonomous permission handling, lifecycle/progress/evidence projection, interruption/cancel routes, conservative PR evidence detection, and graph/session projections without mutating `graph.json`.
- Issue #74 / PR #78, `builder-managed-runtime-ui`: Background Session launch selection and monitoring UI, My Sessions and node inspector runtime rendering, sanitized progress display, and intentionally disabled takeover/cleanup placeholders.

### Existing backend/runtime seams

Likely implementation surfaces:

- `src/server/routes/sessions.ts`
  - Existing routes: `POST /api/sessions/:id/managed/interrupt`, `POST /api/sessions/:id/managed/cancel`, and `POST /api/sessions/:id/managed/evidence`.
  - Managed target validation currently requires a non-archived `managed-sdk` row owned by `streamliner-sdk`.
  - Evidence kinds already include `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaned_up`, and `terminal_takeover`.
- `src/server/managed-sdk-runner.ts`
  - `ManagedSdkRunner` supports `start` and optional `interrupt`.
  - `DefaultManagedSdkRunner` tracks active SDK runs and maps SDK events to managed lifecycle/progress.
- `src/server/node-launch.ts`
  - `launchManagedSdkNode` reserves the canonical registry row, records `runtimeKind: "managed-sdk"`, `runtimeOwner: "streamliner-sdk"`, `permissionProfile: "managed-autonomous"`, SDK session/workspace/state metadata, lifecycle progress, and evidence callbacks.
- `src/session-registry/managed-runtime.ts`
  - Normalizes runtime metadata, bounds progress events, sanitizes progress data, and defines active/terminal managed states.
  - Current active states include `terminal_takeover`; revisit whether takeover should block duplicate managed launches or behave as terminal-owned completion depending on the accepted contract and tests.
- `src/session-registry-schema.ts`
  - Runtime owner literals include `builder-terminal` and `streamliner-sdk`.
  - Managed lifecycle/evidence literals already include takeover and cleanup states.
  - Registry records expose `copilotSessionId`, `graphBinding`, `pawLaunch`, runtime metadata, derived worktree/branch, derived GitHub refs, trusted signal metadata, and process state.
- `src/session-registry/relaunch.ts` and `src/server/terminal-launch.ts`
  - Existing relaunch path builds visible terminal commands using `copilot '--resume=<copilotSessionId>'`, launches Windows Terminal/PowerShell, and synthesizes trusted resume signals because hooks may not fire on resume.
  - Terminal takeover should likely reuse terminal launch primitives, but it must resume `runtime.sdkSessionId` for the managed row and update/bind the same registry record rather than using generic relaunch semantics keyed only on `copilotSessionId`.
- `src/terminal-command.ts`
  - Existing helper: `buildCopilotResumeCommand(copilotSessionId)`.

### Existing UI/projection seams

Likely implementation surfaces:

- `src/managed-runtime-contract.ts`
  - `ManagedRuntimeActionKind` already has `terminal-takeover` and `cleanup`.
  - `defaultManagedRuntimeActions()` currently returns both actions disabled with future-update reasons.
  - `managedRuntimeProjectionFromMetadata()` currently always projects default disabled actions.
  - Progress projection maps `terminal_takeover` progress type to a summary kind and cleanup evidence to cleanup links.
- `src/components/SessionsPage.tsx`
  - `ManagedRuntimeOverview` renders Background Session lifecycle, SDK metadata, progress, and action buttons, but the buttons are currently display-only/disabled.
- `src/components/NodeInspector.tsx`
  - Node inspector renders managed runtime summary/progress and placeholder action buttons.
- `src/workstream-runtime-overlay.ts`, `src/graph-node-session-status.ts`, and tests for managed runtime overlays may need updates so action availability/status is reflected consistently without mutating committed graph state.

### Cleanup references

- `scripts/cleanup-worktree.ts` provides the repository cleanup command used by humans/agents (`npm run cleanup:worktree`, `cleanup:worktree:remove`, `cleanup:worktree:force`). It is useful prior art for parsing `git worktree list --porcelain`, refusing the main/current checkout, protecting main/master/develop/trunk, and deleting local branches after worktree removal.
- The managed cleanup action must be backend-owned, not a model prompt. Before deleting anything, verify registry binding, graph binding, repository, worktree, expected branch, PR/head/merge state, clean working tree, unpushed commits, and conflicting worktree/process use. Guardrail failures should move the managed runtime to `waiting_for_builder` with typed reasons.

### Success criteria to satisfy

- A managed SDK session can be interrupted and transitions through clear lifecycle states.
- The builder can open a visible Copilot CLI takeover for the exact SDK session id.
- After takeover, Streamliner marks ownership as terminal and does not continue SDK-owned prompts.
- Trusted CLI observation after takeover is bound to the existing registry row.
- Cleanup-after-merge safely removes eligible linked worktrees/local branches and blocks unsafe cases with clear reasons.
- The combined launch, monitoring, takeover, and cleanup path is ready for the `managed-runtime-usability-gate` (#76).

## Layer 3 - Coordination Context

### Upstream and sibling context

- Upstream `managed-execution-substrate` (#73, PR #79) is complete. Consume its canonical registry/runtime model and managed action route patterns; do not create a parallel runtime store.
- Upstream/sibling `builder-managed-runtime-ui` (#74, PR #78) is complete. It intentionally left takeover and cleanup as disabled placeholders; this node should wire those placeholders to real backend behavior where safe.
- Downstream `managed-runtime-usability-gate` (#76) depends on this node and will validate the integrated launch, monitoring, takeover, cleanup, and terminal-first fallback experience. Do not perform the gate task here; provide evidence that makes the gate possible.

### Launch and workflow coordination

- Launch nonce: `b343c7c4-3bd1-48cf-a8da-2b24086d3695`.
- Launch cwd is the base checkout: `C:\Users\robemanuele\proj\streamliner\streamliner`, initial branch `main`.
- Work in a sibling worktree for target branch `feature/terminal-takeover-cleanup-actions`; do not check out the feature branch in the launch/base checkout.
- PAW artifacts should use `commit-and-clean` lifecycle.
- Review policy is final PR only. Continue through planning and implementation without waiting for interim human review unless there is a serious blocker or issue/design amendments are needed.
- Planning review and final review should be non-interactive, multi-model with pre-mortem and post-mortem perspectives, using `claude-opus-4.7` as the configured model.
- If implementation requires issue updates, pause and propose amendment text for discussion.
