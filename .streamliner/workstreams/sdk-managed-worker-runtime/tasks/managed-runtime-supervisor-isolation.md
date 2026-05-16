# Managed Runtime Supervisor Isolation Boundary

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-runtime-supervisor-isolation`
- Type: task
- Wave: 2 / `managed-runtime-usable`
- Tracker: #95
- Status: planned
- Depends on: #94

## Problem Statement

Even after API-side load shedding, the current architecture keeps active Copilot
SDK session ownership inside the local API process. That makes the API both the
builder-facing control plane and the noisy managed-worker supervisor. If active
managed work can still starve API responsiveness, Wave 2 should establish a local
process boundary before the usability gate passes.

## Core Functionality

- Use evidence from `managed-runtime-api-responsiveness` (#94) to decide whether
  same-process coalescing is sufficient for Wave 2.
- If required, introduce a local managed-runtime supervisor child process that
  owns Copilot SDK clients/sessions.
- Communicate compact lifecycle/progress/evidence updates from the supervisor to
  the API instead of sending raw SDK event streams.
- Keep the API as the builder-facing control plane for launch status,
  graph/session projections, and HTTP routes.
- Preserve interrupt, cancel, one-way terminal takeover, cleanup, and startup
  reconciliation semantics across the process boundary.
- Project supervisor crash/exit into safe managed runtime states rather than
  leaving phantom running rows.

## Scope

In scope:

- Local process-isolation decision and, if needed, implementation.
- IPC/control protocol for managed session lifecycle operations.
- Coalesced progress delivery from supervisor to API.
- Startup/crash recovery behavior needed for Wave 2 confidence.

Out of scope:

- Remote/cloud execution pools.
- Multi-agent scheduling.
- Durable raw trace backend.
- SDK -> CLI -> SDK round-tripping after terminal takeover.

## Success Criteria

- The workstream records an explicit keep-same-process vs split-supervisor
  decision based on measured API responsiveness after #94.
- If a supervisor is implemented, the API remains responsive while multiple
  managed sessions are active and noisy SDK events are flowing.
- Managed actions still work across the boundary: interrupt, cancel, terminal
  takeover, cleanup, and evidence recording.
- API restart or supervisor crash leaves rows in safe diagnostic states with
  clear builder-facing recovery actions.
- The usability gate can cite either measured same-process sufficiency or shipped
  supervisor isolation before passing.

