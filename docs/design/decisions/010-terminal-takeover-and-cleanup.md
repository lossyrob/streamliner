---
kind: decision
number: 10
status: accepted
date: 2026-05-09
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 010. Terminal takeover and managed cleanup actions

## Context

Decision 009 accepted SDK-managed graph-node workers and established one-way
terminal takeover plus deterministic cleanup-after-merge as part of the runtime
contract. Implementation of issue #75 exposed the places where that contract must
be more precise:

1. builder actions mutate the same registry row that SDK callbacks update;
2. `managedRuntimeTarget` validates which process currently owns the row;
3. cleanup removes local worktrees and branches, so failures must be explicit and
   retryable;
4. Copilot CLI hook evidence arrives from the installed plugin cache, not from the
   worktree source tree.

Without a narrower decision, the implementation could accidentally fabricate
trusted hook evidence, let late SDK callbacks overwrite takeover state, or delete
local Git state without a fresh proof that cleanup is still safe.

## Decision

Terminal takeover and cleanup are first-class managed runtime actions with the
following semantics.

1. **Owner and lifecycle patches must be asserted.** Mutating managed-runtime
   routes patch the registry and then verify that the expected owner/lifecycle
   landed before returning success. Sticky terminal-owned states may reject normal
   SDK callbacks, so action routes must surface a failure instead of assuming a
   patch succeeded.
2. **Terminal takeover is a one-way ownership transfer.** Streamliner opens
   visible Copilot CLI with `copilot --resume <sdkSessionId>`. Once the terminal
   launches, SDK runner ownership is transferred and late SDK callbacks are
   suppressed. The registry row moves to `runtimeOwner: builder-terminal` and
   `lifecycleState: terminal_takeover`; SDK control does not resume for that row.
3. **Takeover pre-binding is provisional, not trusted hook evidence.** The route
   may pre-bind `copilotSessionId == sdkSessionId` before launching the terminal
   so the resumed CLI can attach to the existing row. It must not write
   `trustedSignalSource: copilot-cli-hook`, `trustedStartedAt`, or
   `copilotProcessState: live` until actual Copilot CLI hook signals arrive.
4. **Cleanup target validation allows both owners but preserves terminal sticky
   ownership.** Cleanup can run for Streamliner-owned SDK rows or terminal-owned
   takeover rows. Cleanup lifecycle transitions from `terminal_takeover` to
   `cleaning_up`, `waiting_for_builder`, or `cleaned_up` are explicit escape
   hatches; cleanup routes do not need to reassert `runtimeOwner` on every patch.
5. **Cleanup is serialized and revalidated before destructive Git operations.**
   Cleanup runs under a per-session in-process lock. It validates the linked
   worktree, branch, PR evidence, GitHub merge state, branch ancestry, protected
   branch names, dirty state, and shared branch checkouts before cleanup. Before
   deleting a branch, it re-lists worktrees and revalidates the branch tip against
   the merged PR proof.
6. **Cleanup commands are bounded and argument-safe.** Git and GitHub CLI calls
   are asynchronous, have timeouts, use argument arrays, include `--` separators
   for path/ref operands, and classify auth, network, repo-not-found, merge-state,
   and Git failures with typed blockers. After merge safety is proven, local
   branch deletion may use `git branch -D -- <branch>` so squash/rebase merge
   workflows are retryable.
7. **`GH_CONFIG_DIR` is part of the cleanup contract.** Local cleanup uses the
   API process environment and configured managed-cleanup dependencies. When
   GitHub verification depends on a public GitHub account, callers must thread the
   correct `GH_CONFIG_DIR` into the process/dependency environment rather than
   relying on whatever account the default `gh` command happens to use.
8. **Plugin cache skew is expected operationally.** Copilot CLI runs the installed
   plugin cache, not necessarily the worktree copy. Hook-driven proof must be
   accepted only after real hook signals arrive, and agents that edit hook scripts
   must refresh the installed plugin cache before expecting behavior changes.

## Alternatives considered

**Treat interrupt plus terminal launch as sufficient for takeover.** Rejected.
Abort can be inconclusive, and late SDK callbacks can otherwise win races against
terminal takeover state. Transfer semantics must be explicit.

**Write trusted live hook fields when launching the terminal.** Rejected. A
successful terminal process launch is not the same evidence as the Copilot CLI
plugin hook observing the resumed session.

**Allow cleanup to reuse the initial validation result after worktree removal.**
Rejected. Cleanup is destructive and can race local developer activity. The
branch deletion step requires a fresh worktree-list and branch-tip proof.

**Delegate cleanup to an agent prompt or manual terminal command.** Rejected.
The operation is bounded and safety-critical enough to be a deterministic backend
action with typed blockers and retryable partial-failure state.

## Consequences

- `session-system.md` remains the living design authority for the broader session
  registry and runtime overlay; this decision narrows the action semantics.
- Managed action UI and API routes share route/action constants so enum literals
  cannot silently diverge from route suffixes.
- Cleanup can be retried after partial failures: removed worktree plus failed
  branch deletion is visible in the outcome, and a later request can continue from
  the remaining branch state.
- Hook evidence is trusted only when it comes from hook intake. Route-side
  takeover evidence is operational evidence, not trusted process evidence.
- Operational docs must continue to mention plugin cache refresh whenever hook
  scripts change.
