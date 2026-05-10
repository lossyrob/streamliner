# Managed Runtime Dogfood and Hardening

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-runtime-dogfood-hardening`
- Type: task
- Wave: 3 / `review-loop-export-ready`
- Status: planned

## Purpose

Dogfood SDK-managed execution on real node work, harden failure/status/cleanup
paths, reconcile docs and graph assumptions, and prepare the managed-worker
runtime export for Automated PAW Review Loop.

## Research-Informed Dogfood Targets

1. **Verify `sdkSessionId` resumability after `pr_ready`.** Run a managed node to
   `pr_ready`, confirm the SDK session id remains stored and addressable, then
   verify either SDK re-entry or `copilot --resume <sdkSessionId>` can access the
   session state. If this fails, document that review-loop comment addressing
   must use separate workers rather than original-session continuation.
2. **Exercise crash/restart reconciliation on a real active managed node.** Kill
   and restart the API while the worker is active, then confirm diagnostics and
   recovery paths match the Wave 2 startup reconciliation contract.
3. **Prototype operational signals without building a trace backend.** Candidate
   session-registry-level signals include `managed_session_stalled`,
   `sdk_row_orphaned_on_restart`, `cleanup_blocked_repeated`, and
   `cancellation_timeout`.
4. **Evaluate `managed-review` profile need.** Automated PAW Review Loop may need
   reviewer actors with a narrower or different permission posture than
   implementation-oriented `managed-autonomous` workers.

## Boundaries

In scope:

- Real Streamliner-node dogfood runs.
- Failure, timeout, restart, takeover, cleanup, and PR-ready hardening.
- Evidence needed by downstream Automated PAW Review Loop.

Out of scope:

- Per-tool approval UX for implementation workers.
- Full AgentOps/Laminar-style trace backend.
- Remote/cloud execution pools.
- SDK -> CLI -> SDK round-tripping after takeover unless a later design changes
  the accepted one-way contract.
