# Plan: Terminal takeover and cleanup actions

## Problem and approach

Issue #75 completes the operational lifecycle actions for SDK-managed Streamliner node sessions. The existing substrate already records managed runtime metadata, exposes interrupt/cancel/evidence routes, and renders disabled takeover/cleanup placeholders. This plan wires those placeholders to deterministic backend behavior while preserving the accepted one-way takeover and cleanup-after-merge contract.

The implementation will stay on the canonical session-registry row. Terminal takeover will resume the SDK-created Copilot session in a visible terminal, mark the managed row as terminal-owned, synthesize trusted resume observation onto that same row, and record takeover evidence/progress. Cleanup will be a backend action with guardrails that checks registry and graph binding, repository/worktree/branch identity, PR merge/head state, dirty working tree, unpushed commits, branch sharing, and current process use before removing the linked worktree and local branch.

The schema already contains the lifecycle and evidence states this node needs: `waiting_for_builder`, `interrupt_requested`, `interrupted`, `canceled`, `failed`, `cleanup_ready`, `cleaning_up`, `cleaned_up`, and `terminal_takeover`. No schema or accepted design-doc change is expected.

## Work items

1. Backend managed action helpers and routes
   - Preserve and complete standalone interrupt/cancel behavior: keep the existing routes as builder-visible managed actions where appropriate, ensure they transition through `interrupt_requested` to `interrupted`, `canceled`, `waiting_for_builder`, or `failed` with clear progress/error records, and cover no-runner/abort-failure outcomes without losing the managed row.
   - Add terminal takeover support that validates the managed target, requires `sdkSessionId`, interrupts any active SDK-owned turn, launches `copilot --resume <sdkSessionId>` in a visible terminal, records `terminal_takeover` progress/evidence, flips `runtimeOwner` to `builder-terminal`, and records/synthesizes trusted resume state onto the same registry row.
   - Make the ownership-transfer mechanism explicit: once takeover succeeds, the managed runner marks the active run as ownership-transferred, cancels or disconnects in-flight SDK streaming where possible, and removes the run from the set eligible for future SDK prompts. Late SDK callbacks after ownership transfer must append safe terminal/error progress at most and must not return the row to SDK-owned execution.
   - Pre-bind trusted CLI observation to the existing managed row: before or during terminal launch, ensure `copilotSessionId` on the registry row is the same value as `runtime.sdkSessionId`, so later trusted resume hooks locate the existing managed row by the resumed Copilot session id instead of creating a duplicate observed row.
   - Keep takeover failure modes distinct: spawn failure and inconclusive resume/bind evidence are retryable `waiting_for_builder` outcomes; missing SDK session identity or impossible resume facts are `failed`; if the pre-takeover interrupt does not confirm, proceed with takeover and record the interrupt failure as sanitized progress because terminal ownership transfer is the authoritative stop.
   - Add cleanup support that validates the managed target, evaluates deterministic guardrails, transitions through `cleaning_up`, removes eligible worktrees and local branches, records `cleaned_up`, and moves blocked cases to `waiting_for_builder` with clear evidence.
   - Keep failure behavior explicit: terminal spawn/resume failures preserve the row and move to `waiting_for_builder` or `failed`; cleanup failures do not delete partial state silently.

2. Cleanup guardrail implementation
   - Reuse cleanup-script prior art for worktree parsing and protected branches, but expose testable server-side functions rather than shelling through npm scripts.
   - Verify registry binding and graph binding explicitly: the cleanup target must be the canonical non-archived registry row for the graph node, and the row's graph/session binding must match the selected workstream/node before any filesystem action.
   - Use GitHub PR evidence from runtime evidence/derived refs; verify merged/head status through a deterministic backend verification path. Do not rely on ambient user-shell `gh` configuration for the core cleanup decision; if a local `gh` fallback is retained, detect authentication/repo-access mismatch and return a typed blocked reason rather than a generic failure. If GitHub facts cannot be verified, fail closed to `waiting_for_builder`.
   - Split cleanup eligibility into incorporation and staleness checks. Incorporation is proven by confirmed PR merged state from GitHub facts, regardless of merge strategy. Staleness is proven by verifying that the local feature branch tip is equal to or an ancestor of the recorded PR head SHA, meaning no commits were added after the reviewed PR head. Cover merge commit, squash merge, rebase merge, and post-merge local-commit cases in tests.
   - Verify local git facts with deterministic commands from the repository root: registered worktree, expected branch, clean status, no uncommitted changes, no post-PR unpushed commits, branch not protected, branch not checked out in another worktree, and local branch exists only where safe.
   - Treat live-process use conservatively. Use in-process managed-runner state, registry process state/PID, terminal-owned runtime owner, and trusted end evidence where available; block cleanup when a target row/path/branch appears live. Reconcile stale registry process state with actual PID liveness where possible so crashed or already-ended processes do not permanently block cleanup.

3. Runtime projection and UI actions
   - Replace default disabled managed actions with state-aware action availability and reasons for interrupt/cancel, terminal takeover, and cleanup.
   - Use managed action availability plus blocked reasons as the usability-gate surface; the downstream gate should be able to tell whether takeover/cleanup is ready, blocked, in progress, or completed from API projection alone.
   - Wire My Sessions managed runtime buttons to the new backend endpoints and refresh session state after success/failure.
   - Wire Node Inspector managed action buttons where a primary session is available, with disabled reasons when not safe.
   - Preserve existing sanitized projection boundaries; do not expose raw SDK prompts, command output, or secret-bearing telemetry while adding action state.

4. Tests and verification
   - Extend managed runtime route tests for takeover success, takeover failures, cleanup success, cleanup guardrail blocks, loopback/content-type guards, and runtime target validation.
   - Add unit coverage for action availability in `managed-runtime-contract`.
   - Add managed SDK runner coverage so takeover/interrupt stops SDK prompt ownership and late callbacks do not overwrite terminal-owned state.
   - Add launch-gating coverage for both halves of the owner-aware matrix: a terminal-owned `terminal_takeover` row does not block fresh SDK work, while SDK-owned active states still block duplicates.
   - Add trusted-resume binding regression coverage proving takeover sets/binds `copilotSessionId == sdkSessionId` on the existing managed row and a later trusted resume signal does not create a duplicate observed row.
   - Add UI/API projection tests for usability-gate action state and blocked reasons.
   - Run the existing Vitest suite plus lint/build after implementation, and capture UI screenshots for the managed action surface per the active iterative UI workflow. Screenshots are local validation artifacts; if they are included in the PR, use the repository's dedicated `pr-screenshots` branch convention rather than committing PNGs to this feature branch.

## Success criteria to verification

| Success criterion | Verification mapping |
| --- | --- |
| A managed SDK session can be interrupted and transitions through clear lifecycle states. | Managed runtime route tests for interrupt/cancel success, no-runner behavior, abort failure, and lifecycle/progress records. |
| The builder can open a visible Copilot CLI takeover for the exact SDK session id. | Takeover route test asserting the launched command uses `copilot --resume <sdkSessionId>` and returns terminal launch evidence. |
| After takeover, Streamliner marks ownership as terminal and does not continue SDK-owned prompts. | Takeover route and runner tests asserting `runtimeOwner: builder-terminal`, `terminal_takeover`, active-run ownership transfer, and no late SDK callback reverts. |
| Trusted CLI observation after takeover is bound to the existing registry row. | Trusted-resume binding regression test asserting `copilotSessionId == sdkSessionId` on the same row and no duplicate observed session is created. |
| Cleanup-after-merge safely removes eligible linked worktrees/local branches and blocks unsafe cases with clear reasons. | Cleanup guardrail unit tests plus route tests for merged PR success, unverified GitHub facts, dirty/shared/protected/live/post-PR-commit blockers, and partial cleanup failures. |
| The combined launch, monitoring, takeover, and cleanup path is ready for the managed-runtime usability gate. | Runtime projection/action availability tests, UI button endpoint tests, launch-gating matrix tests, full repository verification, and iterative UI screenshot capture. |

## Key decisions and constraints

- No accepted design contract change is expected; design docs should not be updated unless implementation proves the contract impossible.
- Terminal takeover is one-way. After success, SDK ownership ends and Streamliner must not issue further SDK prompts for that row.
- Cleanup is intentionally conservative. Missing PR merge/head facts, unclean worktree state, unpushed commits, protected/shared branches, graph/registry binding mismatches, or live process signals block cleanup rather than attempting deletion.
- `terminal_takeover` remains a managed lifecycle literal. Duplicate-launch blocking should become owner-aware (`runtimeOwner === "streamliner-sdk"`), so a terminal-owned takeover row does not behave like an SDK-owned active run without redefining the lifecycle contract.
- Guardrail vocabulary maps directly to the issue: branch-sharing and live-process checks are the implementation details behind "conflicting worktree/process use."
- Workflow note: PAW artifacts use the configured `commit-and-clean` lifecycle; final PR creation is owned by the `paw-pr` skill and must include the requested Docs.md details section.
