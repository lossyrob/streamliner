---
kind: decision
number: 9
status: accepted
date: 2026-05-07
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 009. SDK-managed graph-node worker runtime

## Context

Streamliner's launch design originally used Copilot SDK for launch preparation
and then started a visible Copilot CLI worker terminal. That terminal-first path
preserved builder presence and reused observation-based tracking, but it left
Streamliner without programmatic control over long-running worker actors that
Automated PAW Review Loop and similar orchestration features need.

The SDK capability research for issue #60 / PR #63, captured in
`.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md`,
concluded that a constrained first SDK-managed graph-node worker runtime is
viable. The evidence covers repository context, working directory, tools, skills,
MCP/plugin visibility, permissions, persistent SDK sessions, progress events,
abort APIs, one-way terminal takeover through
`copilot --resume <sdkSessionId>`, Streamliner plugin claim-binding evidence,
and local branch/commit/PR-draft production. The research also identified
constraints that need to become product contract rather than implementation
guesswork: browser progress must be allowlisted and redacted, cancellation must
use bounded evidence and failure states, plugin hooks can corroborate but should
not be the sole SDK admission path, and cleanup-after-merge must be deterministic
backend behavior.

## Decision

Accept **SDK-managed graph-node workers** as a first-class local runtime option
for Streamliner node execution.

The first cut is constrained:

1. **Runtime selection is explicit and builder-selected.** `terminal-cli` remains
   the supported terminal-first path. `managed-sdk` is available when the builder
   selects it for a node, but Streamliner does not automatically classify nodes
   as safe or unsafe for managed execution.
2. **The session registry remains canonical.** SDK-managed workers use the same
   Streamliner-owned registry row identity as terminal-launched and manual
   sessions. SDK ids and Copilot session ids are nullable metadata, never primary
   keys.
3. **Managed lifecycle is separate from PAW artifact status.** Managed runtime
   states describe Streamliner's execution ownership and evidence; PAW workflow
   status remains derived from durable PAW artifacts under Decision 008.
4. **Progress is a browser-safe projection.** The UI may show terminal-like
   progress, but only through an allowlisted, redacted, bounded stream. Raw
   prompts, reasoning, tool arguments/results, hook payloads, terminal output,
   and secret-bearing content are excluded by default.
5. **Unattended permission policy is explicit.** Managed workers do not inherit
   launch-preparation `approveAll`. A managed launch records and enforces a
   scoped permission profile.
6. **Terminal takeover is one way.** Streamliner may interrupt a managed SDK
   session and launch visible Copilot CLI with
   `copilot --resume <sdkSessionId>`. After takeover binds, ownership transfers
   to the terminal path and SDK control does not resume for that row.
7. **Cleanup-after-merge is a backend lifecycle action.** Worktree/local-branch
   cleanup uses deterministic safety checks and records runtime state; it is not
   delegated to a model prompt.
8. **Automated PAW Review Loop consumes this contract.** Managed implementer and
   reviewer actors rely on the registry identity, managed lifecycle events,
   redacted progress, PR/review-ready signals, permission posture, takeover
   finality, and cleanup states defined in the session-system design.

## Alternatives considered

**Keep all graph-node workers terminal-first.** Rejected. Terminal-first remains
essential for builder presence, but it does not give Streamliner enough
programmatic lifecycle control for managed implementer/reviewer actors,
deterministic cleanup, or browser-native progress without relying on terminal
transcripts.

**Replace terminal-first launch globally with SDK-managed workers.** Rejected.
The SDK path is viable but still constrained. Builders need explicit choice, and
terminal presence remains the right default for many nodes, debugging sessions,
and recovery paths.

**Rely on existing Copilot CLI plugin hooks as the SDK admission layer.**
Rejected as the sole mechanism. Local spikes show plugin signals can appear in
SDK-created sessions, but SDK-managed workers should write explicit lifecycle and
progress records through Streamliner's local runtime. Plugin signals become
corroborating evidence while SDK-owned, and they become primary again after
terminal takeover.

**Treat SDK abort as equivalent to interactive terminal cancel everywhere.**
Rejected. Local evidence supports useful abort/interruption semantics, including
observed process-level stop for a PowerShell path, but the contract must include
bounded timeout, inconclusive evidence, and failure/needs-builder states for tool
and platform variance.

**Ask the model to clean up after merge.** Rejected. Cleanup touches local
worktrees, branches, and repository state. It must be a deterministic backend
action with guardrails and clear failure states.

## Consequences

- `session-system.md` is now authoritative for two worker runtime modes:
  terminal-owned Copilot CLI and Streamliner-owned SDK-managed workers.
- Registry schema and API work can add managed runtime metadata without changing
  the stable-row-id invariant from Decision 005.
- The graph overlay remains a projection. Managed lifecycle/progress telemetry
  lives in local runtime state and must not be persisted into `graph.json`.
- Browser UI work can build a read-only terminal-like progress surface without
  exposing raw SDK event content.
- Terminal takeover work has a clear terminal state: after a successful
  `copilot --resume <sdkSessionId>` bind, the row is terminal-owned and SDK
  control is finished.
- Automated PAW Review Loop should consume the managed runtime contract rather
  than inventing a separate actor/session substrate.

## Open questions

- Exact numeric retention caps for sanitized managed progress events should be
  chosen during substrate implementation, but the contract requires bounded count
  and byte retention plus latest-summary persistence.
- The first managed runtime should be dogfooded on a real Streamliner node PR
  before Streamliner defaults any node type to managed execution.

## 2026-05-08 gate amendment: autonomous permission posture

The foundation-contract gate resolves the permission-profile ambiguity in item 5.
For the first managed PAW worker, builder selection of `managed-sdk` at node
launch is the consent boundary for autonomous tool execution. The runtime records
a `managed-autonomous` permission profile and configures SDK-managed worker tool
execution with a Copilot CLI YOLO/allow-all-equivalent posture, so the worker
does not pause for per-tool approval prompts while Streamliner owns the SDK
session.

This amends "Managed workers do not inherit launch-preparation `approveAll`" to
mean the autonomous profile must be explicit, durable, and tied to the selected
node launch rather than accidentally inherited from the internal PAW
initialization helper. Streamliner still scopes the launch to the selected node,
worktree, repo, branch, and PAW context; projects only redacted progress; and
keeps deterministic backend guardrails for Streamliner-owned lifecycle actions
such as terminal takeover, cleanup-after-merge, graph promotion, registry
deletion, and worktree/branch removal.

If the runtime cannot record or honor the autonomous profile, the managed launch
fails or moves to `waiting_for_builder` with typed evidence. It must not silently
degrade into hidden per-tool prompts, silently choose a different runtime, or
pretend the worker is autonomous when SDK/provider policy blocked tool execution.
