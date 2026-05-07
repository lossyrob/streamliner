# Concurrent Resumable Node Launches

## Overview

Streamliner graph node launches now use per-node runtime operation state for PAW initialization and visible terminal launch. A builder can start PAW init for one ready node, close the launch dialog, select and launch another ready node, and later reopen each node's launch state without progress, errors, prepared handoffs, terminal results, or launch claims bleeding between nodes.

The implementation keeps launch telemetry out of committed workstream artifacts. `graph.json` remains the authored planning graph; launch operation state is local API runtime state stored with node launch records. Existing prepared launch records and launch claims remain authoritative for handoff paths and terminal binding, while the new operation snapshot describes the fast-moving lifecycle around those contracts.

## Architecture and Design

### High-Level Architecture

Launch state is split across three cooperating runtime concepts:

1. `NodeLaunchRecord` stores the latest prepared handoff paths for a graph path and node id.
2. `NodeLaunchOperation` stores the current launch lifecycle for the same graph path and node id, including preparation run id, bounded progress, prepared handoff, terminal launch result, and last error.
3. Launch claims remain the source of truth for pending, bound, failed, blocking, and retryable terminal-session state.

The local API returns records and operations together from `GET /api/node-launch-records`. The dashboard keys operation state by graph path and node id, so each node has an independent dialog state. Background PAW init progress continues after the dialog is closed. Reopening a preparing operation reattaches to the run SSE endpoint when that in-memory run still exists; otherwise the UI falls back to the stored operation snapshot.

### Design Decisions

Terminal launch stays synchronous on `POST /api/node-launches`. The route writes `launching` before claim creation and terminal spawn, then writes either `launched_pending_binding` with the terminal result or `terminal_failed` with diagnostics before returning. The in-flight spawn window remains bounded by the request lifetime, while post-return binding state is projected from launch claims.

Preparation uses the existing background run manager and SSE stream. The API now creates the operation before starting the run, appends bounded progress events, persists `prepared` on completion, and persists `preparation_failed` on failure. The same lifecycle is applied to the legacy synchronous preparation endpoint so all callers share duplicate gating and failure state.

The record store serializes read-modify-write updates through an internal write chain. This lets separate node launches update the same JSON runtime file without dropping each other's operation rows or progress buffers.

### Integration Points

- `src/node-launch-record-contract.ts` defines the shared operation contract.
- `src/server/node-launch-record-store.ts` persists launch records and operations.
- `src/server/routes/launch-preparations.ts` owns PAW init operation creation, progress, success, failure, and SSE replay.
- `src/server/routes/node-launches.ts` owns terminal launch operation transitions.
- `src/server/routes/node-launch-records.ts` returns the latest record plus operation projection and overlays launch-claim status.
- `src/App.tsx`, `NodeInspector`, and `PawLaunchDialog` render and update per-node operation state.

## User Guide

### Prerequisites

The selected graph source must be backend-readable, the node must be ready, and the normal launch prerequisites still apply: tracker-required policy, PAW launch configuration, and local terminal launch support. Browser-only graph sources and non-ready nodes remain disabled.

### Basic Usage

Select a ready graph node and choose **Initialize PAW launch**. While PAW init is running, the dialog can be closed with **Close**; the backend preparation run continues. Select another ready node to initialize that node independently. Reopen a node with an active operation by selecting it and choosing **Open PAW launch**.

When preparation succeeds, the dialog shows the prepared handoff, kickoff prompt, and `WorkflowContext.md` review surface. Launching the terminal records the claim and shows the terminal launch result. If launch observation binds the claim to a session, later reads project the operation as `bound`.

### Advanced Usage

If a preparing dialog is reopened while the API process still has the run buffer, the dashboard reconnects to `/api/launch-preparations/runs/:runId/events` and continues receiving progress, completion, or failure events. If the run id is stale, the API restarted, or SSE replay is unavailable, the stored operation snapshot remains visible and the UI offers the appropriate retry or review action.

Failed preparation attempts are retryable. Failed terminal spawn attempts are retryable when launch-claim state is non-blocking. Pending or bound claims still block same-node duplicate launches until the claim resolves or is released through the existing release affordance.

## API Reference

### Key Components

`NodeLaunchOperation.status` can be `launchable`, `preparing`, `prepared`, `preparation_failed`, `launching`, `launched_pending_binding`, `bound`, or `terminal_failed`. `preparing` and `launching` are same-node duplicate blockers. `launched_pending_binding` and `bound` are projected from launch-claim state when a claim exists.

`POST /api/launch-preparations/runs` returns a run id and the initial operation snapshot. `GET /api/launch-preparations/runs/:runId/events` streams progress, completed, and failed events and replays buffered events after `Last-Event-Id` or `lastEventId`.

`GET /api/node-launch-records?graphPath=...&nodeId=...` returns `{ record, operation }`. Callers should treat `record` as the latest prepared handoff paths and `operation` as the current runtime lifecycle.

`POST /api/node-launches` remains synchronous. It accepts a prepared handoff, writes terminal launch operation state around claim creation and terminal spawn, and returns the existing terminal launch response.

### Configuration Options

No new user configuration is required. Progress history is bounded to 50 events per operation. Runtime launch state is stored in Streamliner's local state root with node launch records.

## Testing

### How to Test

As a human user, open a backend-readable workstream with at least two ready nodes. Start PAW init for node A, close the dialog while progress is running, start PAW init for node B, and verify each node reopens with only its own progress and state. Complete node A preparation, review the generated handoff, launch the terminal, and verify the inspector shows terminal and claim state.

### Edge Cases

Same-node duplicate preparation and terminal launch attempts return a typed conflict with the current operation snapshot. Distinct nodes can launch concurrently. Preparation failures persist `preparation_failed` with error details and can be retried. Terminal failures persist `terminal_failed` without clobbering a successful launch operation that may have won a concurrent race. Reopened preparing operations gracefully fall back to stored snapshots when SSE replay is unavailable.

## Limitations and Future Work

Operation progress is stored by rewriting the bounded local JSON document. This is acceptable for current launch volume but could later move to per-run files or batched writes if PAW init progress becomes much chattier.

The operation row does not independently store workstream id before a handoff exists, so claim projection for a purely pre-handoff operation depends on an existing record or later handoff. Future runtime overlay and gate work can extend the operation snapshot if it needs claim projection before preparation has produced metadata.
