# Managed Execution Substrate

## Overview

The managed execution substrate adds an explicit `managed-sdk` runtime path for Streamliner graph-node launches while keeping the existing terminal launch path as the default. When a builder selects the managed runtime, Streamliner reserves the same canonical launched session row and launch claim used by terminal launches, then starts a Streamliner-owned Copilot SDK worker without opening a visible terminal.

The implementation gives managed workers first-class registry/runtime metadata: runtime ownership, managed-autonomous permission posture, SDK session/workspace facts, lifecycle state, bounded progress events, and safe evidence such as PR URLs. This makes managed execution visible to existing session and graph consumers without writing runtime state back into `graph.json`.

## Architecture and Design

### High-Level Architecture

Managed launches flow through the existing node launch API. `terminal-cli` remains the implicit runtime; `managed-sdk` is opt-in from prepared handoff/API input. Both paths share launch policy checks, duplicate launch protection, launch-claim reservation, nonce/claim prompt binding, and canonical registry row creation.

For managed launches, `launchManagedSdkNode` patches runtime metadata onto the reserved row, then delegates SDK work to `DefaultManagedSdkRunner`. The runner starts a Copilot SDK client in the node worktree, uses an allow-all-equivalent SDK permission handler for the recorded `managed-autonomous` posture, and streams lifecycle/progress/evidence callbacks back through the session registry runtime writer.

Session registry runtime metadata is additive and optional. Existing rows without `runtime` metadata remain valid, and terminal-first behavior is unchanged. Graph-node projection reads runtime metadata from bound session rows and ranks managed lifecycle freshness alongside existing terminal/session evidence.

### Design Decisions

- **Registry ID remains canonical**: SDK session IDs, workspace paths, launch claims, and Copilot session IDs are metadata, not replacement identities.
- **Runtime is explicit**: `managed-sdk` must be selected intentionally; absent runtime input preserves `terminal-cli`.
- **Node launch is the consent boundary**: managed workers record `managed-autonomous` and auto-approve SDK tool permission requests rather than introducing per-tool builder approval.
- **Progress is durable but bounded**: runtime progress is stored on the registry row with fixed retention and string limits so browser consumers can refresh/reconnect safely.
- **Evidence is conservative**: automatic assistant evidence is limited to strong signals such as PR URLs. Review/completion/cleanup/terminal-takeover states can still be recorded through explicit managed evidence routes.
- **Follow-on states block duplicates**: `pr_ready`, `review_ready`, `cleanup_ready`, and related active managed states continue blocking duplicate launches until the managed work is resolved.

### Integration Points

- `POST /api/node-launches` accepts explicit runtime selection and records managed launch operations for polling.
- Session registry records expose optional `runtime` metadata through list/get surfaces and file-store persistence.
- Graph-node status projection uses bound runtime metadata to show managed lifecycle and launch progress.
- Managed action routes under `/api/sessions/:id/managed/*` support interruption, cancellation, and evidence ingestion for Streamliner-owned managed SDK rows.
- Design documentation in `docs/design/session-system.md` describes the managed runtime status model and metadata fields.

## User Guide

### Prerequisites

Use a prepared Streamliner node launch handoff for a graph node. The target worktree must be valid for the selected node, and the API process must have access to the Copilot SDK runtime and the normal Streamliner session registry state.

### Basic Usage

Launches continue to use terminal runtime by default. To use managed execution, provide `runtimeKind: "managed-sdk"` in the prepared handoff/API request. Streamliner will reserve the launch claim and registry row, start the SDK worker, and return a managed launch response containing the registry ID, SDK session ID when available, SDK workspace path when available, and permission profile.

Existing operation polling can distinguish terminal and managed launches through `runtimeKind` and managed operation states such as `managed_starting`, `managed_running`, `managed_waiting_for_builder`, `managed_pr_ready`, `managed_completed`, and `managed_failed`.

### Advanced Usage

Builders or follow-on automation can use the managed session routes to influence the runtime:

- `POST /api/sessions/:id/managed/interrupt` requests SDK abort and records `interrupt_requested` followed by `interrupted`, `waiting_for_builder`, or `failed`.
- `POST /api/sessions/:id/managed/cancel` records builder-requested cancellation and persists `canceled` when abort succeeds.
- `POST /api/sessions/:id/managed/evidence` records safe lifecycle evidence such as `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaned_up`, or `terminal_takeover`.

These routes only operate on Streamliner-owned `managed-sdk` rows. Missing rows return 404, archived rows return 409, and terminal/manual rows are rejected rather than synthesized into managed runtimes.

## API Reference

### Key Components

- `launchManagedSdkNode` starts a managed SDK launch from a prepared handoff and shared launch-claim reservation.
- `DefaultManagedSdkRunner` owns SDK client/session startup, managed-autonomous permission approval, lifecycle/progress/evidence callbacks, and interruption.
- `mergeSessionRegistryRuntimeMetadata` normalizes runtime metadata, redacts progress data, bounds retained progress, and deduplicates evidence.
- `isManagedRuntimeActive` determines whether a managed lifecycle state should block duplicate launches for the node.

### Configuration Options

- `runtimeKind`: `terminal-cli` or `managed-sdk`; omitted values behave as `terminal-cli`.
- `runtimeOwner`: `streamliner-sdk` for managed workers, `builder-terminal` for terminal-owned runtime metadata.
- `permissionProfile`: `managed-autonomous` for SDK-managed workers and `manual` for terminal/builder-owned runs.

## Testing

### How to Test

Prepare a node launch and submit it without `runtimeKind`; the existing terminal launch response and operation state should remain unchanged. Submit the same kind of handoff with `runtimeKind: "managed-sdk"` and confirm the response has `runtimeKind: "managed-sdk"`, a managed SDK payload, a reserved registry row with runtime metadata, and no terminal payload.

After a managed launch, inspect the bound session in the dashboard or registry API. The row should expose managed lifecycle/progress metadata and graph-node status should reflect the managed runtime state. Use the managed evidence route to record `review_ready` or `completed`, and use interrupt/cancel routes to verify state transitions.

### Edge Cases

- Duplicate launches are blocked while a launch claim or active managed lifecycle state exists for the node.
- Legacy registry rows without `runtime` remain valid.
- Managed action routes reject terminal/manual rows instead of creating managed metadata on the wrong session.
- SDK interruption errors are recorded as `failed`; missing attached runner evidence leaves the session waiting for builder attention.
- Raw prompts, reasoning, tool args/results, command payloads, tokens, secrets, and similar sensitive fields are not persisted in runtime progress data.

## Limitations and Future Work

This work is backend/API substrate only. It does not add pixel-level UI runtime selection, terminal takeover UX, or cleanup-after-merge automation. Explicit API evidence is the supported seam for review/completion/cleanup states beyond PR URL detection. Future hardening could replace the current conservative progress sanitizer with per-event allow-lists and add stronger IDs for repeated unstructured evidence events.
