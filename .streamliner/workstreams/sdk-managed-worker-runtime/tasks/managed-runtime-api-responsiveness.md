# Managed Runtime API Responsiveness Hardening

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-runtime-api-responsiveness`
- Type: task
- Wave: 2 / `managed-runtime-usable`
- Tracker: #94
- Status: ready

## Problem Statement

Running multiple Streamliner-managed SDK sessions can make the local API visibly
unresponsive. The Copilot SDK work is not browser work, but Streamliner still
handles SDK events inside the API process. Today routine SDK events can produce
registry runtime patches, synchronous file/index writes, and session SSE
broadcasts. The Sessions API can also return multi-megabyte payloads while graph
and session UI polling continues.

This load must be bounded before the managed-session console adds more live
monitoring traffic.

## Core Functionality

- Coalesce and throttle routine managed SDK progress writes per registry row.
- Flush lifecycle terminal states, evidence, failures, interrupts, takeover, and
  cleanup transitions promptly even when routine progress is throttled.
- Avoid duplicate write amplification when one SDK event produces both progress
  and lifecycle updates.
- Reduce session-event broadcast payload/chatter for managed runtime progress,
  using query-aware SSE delivery or compact runtime update events where
  practical.
- Reduce redundant UI polling while live SSE is connected, especially
  session-list polling used by graph overlays.
- Add diagnostics or tests that show registry writes and API response latency
  stay bounded with multiple active managed sessions.

## Scope

In scope:

- Same-process hardening.
- Managed progress batching/coalescing.
- API-safe compact projections for graph/session/console surfaces.
- UI/SSE chatter reduction.
- Repeatable local validation evidence for two active managed sessions.

Out of scope:

- Full child-process supervisor ownership; tracked separately by
  `managed-runtime-supervisor-isolation` (#95).
- Remote/cloud worker pools.
- Raw trace/event backend.
- Exposing raw prompts, tool arguments/results, stdout/stderr, reasoning,
  provider telemetry, hook payload bodies, secrets, or tokens.

## Success Criteria

- Two concurrent managed SDK sessions no longer make `/api/health`, graph
  polling, or Sessions API calls visibly stall under normal dashboard use.
- Routine SDK event bursts produce bounded registry writes rather than one
  file/index write per raw SDK event.
- Important state transitions and PR/completion evidence still appear promptly.
- The managed-session console can rely on bounded, sanitized progress projection
  without turning the registry into a raw event stream.
- Tests or repeatable local diagnostics cover event coalescing and API
  responsiveness assumptions.

