# 012. Durable shared-branch launch classification

## Context

Some Azure DevOps workstream nodes contribute to an existing branch and pull
request instead of owning a new branch and PR. Prompt-only routing cannot safely
distinguish that mode, serialize writers across nodes, or prove that a worker
starts from the reviewed branch head.

## Decision

Graph nodes durably classify launches as `standard-github`,
`standard-azure-devops`, or `existing-shared-azure-devops`. Absence preserves
the historical `standard-github` behavior.

Existing-shared nodes commit the target branch, required start SHA, existing
Azure DevOps PR identity, `branch-contribution` completion mode, and logical
branch lease key. Launch preparation must receive the same values and fails
closed on missing or mismatched data.

The node launch record store owns a cross-node exclusive branch lease keyed by
the logical lease key. Fresh launch requires local and remote branch heads to
equal the required start SHA. The lease binds to the launch claim and reserved
registry row, supports exact same-session reclaim, and changes ownership only
through explicit reviewed transfer. Accepted contributions explicitly release
the lease with their end SHA.

When terminal spawn or managed SDK start fails after lease binding, the backend
returns the same lease to active-unbound only after the claim is terminal failed,
the reserved registry row is gone, and no worker ownership evidence was seen.
The failed claim remains in lease audit history. Any surviving session evidence
or incomplete registry cleanup leaves the lease bound for reviewed recovery.

Shared mode never creates or switches branches or worktrees, merges, rebases,
force-pushes, or creates a PR. The handoff, launch record, claim lineage, and
session PAW launch metadata retain the launch mode, PR, start SHA, completion
mode, and lease identity.

## Alternatives considered

**Keep mode in orchestrator prompts.** Rejected because backend callers could
silently take the standard new-branch path.

**Use per-node or preparation-run locks.** Rejected because different nodes can
target the same shared branch and preparation run IDs do not represent branch
ownership.

**Automatically merge or rebase stale branches.** Rejected because it changes
the reviewed starting point and obscures which session owns the write slot.

## Consequences

- Existing graphs remain valid and behave as standard GitHub launches.
- Shared launches require an explicit existing checkout and online remote-head
  verification.
- Clearing node launch state cannot discard an active branch lease.
- Recovery that cannot prove the same launch claim and registry row requires a
  reviewed lease transfer before replacement work begins.
