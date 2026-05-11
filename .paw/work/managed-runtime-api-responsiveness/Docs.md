# Managed Runtime API Responsiveness

## Overview

This implementation hardens Streamliner's same-process SDK-managed worker runtime so routine SDK activity does not amplify into one registry write, one full SSE broadcast, and one UI refresh cycle per callback. Managed sessions still use the session registry as the canonical bounded projection, but routine runtime progress now flows through a row-local coalescer, runtime-only SSE changes can be delivered as compact events, and browser session views pause list polling while the live event stream is healthy.

The goal is responsiveness under multiple active managed sessions without introducing a separate supervisor process or changing the durable workstream graph. Prompt-driving lifecycle transitions, evidence, failure, interrupt, terminal takeover, cancellation, and cleanup states remain prompt and durable.

## Architecture and Design

### High-Level Architecture

The responsiveness path has four cooperating pieces:

1. `ManagedRuntimePatchCoalescer` batches routine runtime metadata patches per registry row. It merges progress, evidence, forced lifecycle, and lifecycle fields into a single patch and writes through the existing `patchRuntimeMetadata` store method.
2. Managed launch/resume callbacks in `node-launch.ts` enqueue routine SDK progress and lifecycle callbacks while continuing to flush startup, started metadata, failure, and terminal states promptly.
3. The session event stream marks `patchRuntimeMetadata` changes with `changeScope: "runtime"` and converts managed runtime-only upserts to compact `session.runtime.updated` SSE events.
4. Session clients apply live events directly and suppress interval/focus polling while SSE is live and fresh. They refetch on stream error, stale stream, malformed event, or unknown compact runtime row.

The file-backed registry remains the authoritative session source. The compact SSE event is only a transport optimization; full `session.upserted` remains the canonical shape for snapshots and non-runtime changes.

### Design Decisions

Routine repeated active lifecycle states such as `running` can wait for the throttle window because they do not change builder actionability. First entry into a lifecycle state, lifecycle classification changes, evidence-bearing patches, `forceLifecycleState`, and prompt-driving lifecycle states bypass the throttle by scheduling an urgent microtask flush.

Route-owned managed actions quiesce the coalescer before writing directly to the registry. This prevents pending throttled SDK callbacks from overwriting route-owned states such as `cleaning_up`, `canceled`, `terminal_takeover`, or `cleaned_up`. Closed rows retain a bounded late-callback suppression window and are explicitly reopened by a later managed launch or resume.

SSE query filtering happens on snapshots, live events, and replay. Compact runtime events that do not match a client's query are dropped. Non-runtime full upserts that no longer match a filtered client can still be translated to `session.deleted` so existing clients remove rows that moved out of scope.

### Integration Points

- `src/server/node-launch.ts` wires managed SDK callbacks through the coalescer.
- `src/server/routes/sessions.ts` quiesces pending runtime patches around interrupt, cancel, takeover, cleanup, and explicit evidence writes.
- `src/session-registry/file-store.ts` tags runtime metadata patch events with `changeScope: "runtime"`.
- `src/server/session-events.ts` filters event delivery by session list query and emits `session.runtime.updated` for managed runtime-only changes.
- `src/session-registry-client.ts` and `src/components/SessionsPage.tsx` apply live events directly, handle compact runtime updates, and resume polling on stale/error states.
- `docs/design/session-system.md` documents the coalescing and compact live-sync contract.

## User Guide

### Prerequisites

No new setup is required. The behavior applies to Streamliner-managed SDK sessions launched through the existing `managed-sdk` graph-node runtime.

### Basic Usage

Use Streamliner as before:

1. Open a workstream graph.
2. Launch a ready node with the `managed-sdk` runtime.
3. Monitor the session list, graph runtime overlay, and node/session details.

Routine SDK activity should update the UI without making the API or dashboard feel stuck. Important lifecycle transitions, PR/completion evidence, interrupt/cancel results, terminal takeover, and cleanup states should still appear promptly.

### Advanced Usage

Filtered session views, including workstream- or node-scoped session lists and graph overlays, now receive query-aware SSE snapshots and live changes. A compact runtime update for a known row updates that row in memory. If a compact update references a row the client does not have, the client falls back to a full `/api/sessions` fetch.

When the SSE stream is connected and fresh, clients pause periodic and focus/visibility list polling. If the stream errors or stops delivering heartbeat/live events beyond the stale threshold, normal polling resumes automatically.

## API Reference

### Key Components

- `ManagedRuntimePatchCoalescer` batches and flushes row-local `SessionRegistryRuntimeMetadataPatch` values.
- `SessionRegistryUpsertChangeEvent.changeScope` identifies runtime-only upserts from `patchRuntimeMetadata`.
- `session.runtime.updated` SSE events carry `{ registryId, runtime, updatedAt, version }` for managed runtime-only changes.
- `sessionRegistryEventsUrl`, event payload parsers, and `sessionMatchesQuery` are shared client helpers for filtered live session sync.

### Configuration Options

The coalescer defaults to a short 250 ms routine throttle window. It also has a bounded closed-row retention window for late-callback suppression after terminal/drop paths. These are constructor options for tests and future tuning; production uses the defaults.

## Testing

### How to Test

Run:

- `npm run lint`
- `npm run build`
- `npx vitest run --pool=forks --maxWorkers=4`

Manual smoke testing can launch a managed SDK node and watch the Sessions page or graph overlay. Routine tool/progress bursts should not trigger visible API stalls, while important lifecycle/evidence transitions should appear without waiting for the routine throttle.

### Edge Cases

- A single SDK `tool.execution_start` event produces both progress and `running` lifecycle callbacks; these merge into one runtime patch.
- Evidence and forced lifecycle patches flush promptly even when routine progress is already queued.
- Terminal, canceled, completed, cleaned-up, and takeover states close the row-local queue and suppress late SDK callbacks.
- Unknown compact runtime SSE events trigger a full session fetch instead of creating partial rows.
- Malformed SSE payloads and EventSource errors fall back to list fetching.

## Limitations and Future Work

This work does not implement a managed child-process supervisor or remote worker pool. It also does not implement the read-only managed-session console. Future work may reduce non-runtime synthetic delete chatter with per-client membership tracking, share heartbeat/stale constants across server and client modules, and consolidate the Sessions page with the shared session-list hook.
