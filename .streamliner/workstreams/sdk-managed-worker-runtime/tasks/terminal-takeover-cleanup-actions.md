# Terminal Takeover and Cleanup Actions

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `terminal-takeover-cleanup-actions`
- Type: task
- Wave: 2 / `managed-runtime-usable`
- Tracker: #75
- Status: ready

## Outcome

SDK-managed runs have the operational lifecycle actions needed for practical use:
the builder can interrupt a managed run, open one-way Copilot CLI terminal
takeover for the exact SDK session, and clean up linked worktrees/local branches
after merge without requiring terminal interaction for simple autonomous runs.

## Core Requirements

- Implement managed interrupt/cancel transitions and timeout/failure handling.
- Launch visible Copilot CLI takeover with `copilot --resume <sdkSessionId>` and
  record one-way terminal ownership transfer.
- Stop issuing SDK prompts after takeover and close managed progress with a
  takeover event.
- Bind trusted CLI observation to the existing registry row after takeover.
- Implement cleanup-after-merge checks for registry binding, graph binding,
  repo, worktree, expected branch, PR/head/merge state, clean working tree,
  unpushed commits, and conflicting worktree/process use.

## Research-Informed Cleanup Anchor

Record base commit/ref context when the managed worktree is created or first
bound to the node. Use that anchor as cleanup and diff context alongside
`sdkWorkspacePath`, branch, PR/head state, clean working tree, and
unpushed-commit checks.

The exact field location can follow the implementation's launch/registry
metadata shape, but cleanup diagnostics should include the base commit when
cleanup is blocked or ambiguous. This guards against squash-merge ambiguity,
rewritten branches, and branch-state drift.

## Boundaries

Out of scope:

- SDK -> CLI -> SDK round-tripping after takeover.
- Full terminal live-stream mirroring.
- General cleanup for unrelated branches/worktrees.
- Automated PAW Review Loop orchestration.

## Success Criteria

- A managed SDK session can be interrupted and transitions through clear
  lifecycle states.
- The builder can open visible Copilot CLI takeover for the exact SDK session id.
- After takeover, Streamliner marks ownership as terminal and does not continue
  SDK-owned prompts.
- Cleanup-after-merge safely removes eligible linked worktrees/local branches and
  blocks unsafe cases with clear reasons.
- Cleanup/diff diagnostics include base commit/ref context when relevant.
