# Runtime Overlay UI

## Overview

Runtime Overlay UI adds a dashboard-level projection that combines committed workstream graph state with local runtime evidence without mutating `graph.json`. It lets builders see whether a node has active session work, unresolved launch state, PAW workflow enrichment, or degraded tracker/session evidence while preserving the graph artifact as the durable planning source.

The implementation covers issue #52 by adding a typed overlay model, graph-wide launch-record loading, compact graph-card runtime chips, a sidebar runtime overlay panel, and design documentation for precedence and degradation behavior.

## Architecture and Design

### High-Level Architecture

The overlay is built in `src/workstream-runtime-overlay.ts` from these inputs:

- The committed `WorkstreamViewModel`, which provides derived node status and any tracker snapshots already loaded.
- Graph-bound non-manual session summaries from `buildGraphNodeSessionStatusMap`.
- Graph-wide node launch records from `GET /api/node-launch-records?graphPath=...`.
- Source loading/error state for both the session registry and graph-wide launch records.

The builder returns a `WorkstreamRuntimeOverlay` with per-node overlays, graph-wide summary counts/issues, and `gateReadiness`. The React dashboard wires this into `WorkstreamCanvas`, compact node rendering, and a new `RuntimeOverlayPanel` in the sidebar.

### Design Decisions

The committed graph remains the base layer. Runtime status never writes session, launch, PAW, or tracker telemetry into `graph.json`, and the launch-record API tests assert graph immutability for graph-wide reads.

`graphBinding` remains the only session-to-node linkage contract. The overlay reuses existing session registry summaries instead of adding a second linkage store.

`activityStatus` and `activityEvidence` remain the liveness and attention sources. PAW workflow evidence is enrichment only: recognized Streamliner-launched PAW sessions show workflow stage context, while unavailable, unknown, or non-Streamliner PAW evidence appears as degradation rather than inferred progress.

Launch-record source health participates in gate readiness. If graph-wide launch records are loading or fail to load, the overlay is still usable for session/tracker projection but reports degraded readiness because launch-claim evidence may be incomplete.

### Integration Points

- `src/node-launch-record-client.ts` provides frontend helpers for selected-node and graph-wide launch-record reads.
- `src/server/node-launch-record-store.ts` and `src/server/routes/node-launch-records.ts` support graph-wide listing while preserving the selected-node response shape.
- `src/App.tsx` loads graph-wide launch records for backend-readable workstreams, clears stale records on graph changes, builds the overlay, and passes it into graph/sidebar rendering.
- `src/components/WorkstreamGraphNode.tsx` keeps node cards compact by showing only runtime chips when runtime evidence or actionable degradation exists.
- `src/components/RuntimeOverlayPanel.tsx` shows graph-wide readiness, aggregate degradation, selected-node runtime slices, and selected-node degradation reasons.

## User Guide

### Prerequisites

Use a backend-readable tracked workstream graph so the dashboard can query the local API for graph-wide launch records. Browser-only or missing graph sources still render committed graph state, but launch preparation and launch-record projection are unavailable.

### Basic Usage

Open a workstream dashboard. The graph still shows committed status badges and existing session indicators. When runtime evidence exists, task cards add compact chips such as runtime activity, PAW stage enrichment, launch state, or ambiguity/degradation counts.

Select a node to inspect runtime details. The sidebar shows:

- Graph-wide overlay readiness: usable, degraded, or not usable.
- Runtime evidence, degraded nodes, unresolved launches, and PAW-enriched counts.
- Aggregated tracker degradation when many GitHub-backed nodes have no loaded tracker snapshot.
- Selected-node session, launch, PAW, tracker, and degradation details.

### Advanced Usage

Launch-record degradation is surfaced separately from session registry degradation. A session registry error marks the overlay not usable because the session projection cannot be trusted. A launch-record error marks the overlay degraded because session and tracker evidence can still be used, but launch-claim state may be incomplete.

Gate consumers can use `gateReadiness.status` and `gateReadiness.reasons` from the overlay model to determine whether launch/tracking is usable enough for downstream validation.

## API Reference

### Key Components

- `buildWorkstreamRuntimeOverlay(input)` composes the overlay from committed nodes, session summaries, launch records, and source states.
- `selectWorkstreamRuntimeGateReadiness(issues)` derives gate readiness from machine-readable issue impacts.
- `loadGraphNodeLaunchRecords(graphPath)` loads all node launch records for one graph.
- `loadNodeLaunchRecord(graphPath, nodeId)` preserves the selected-node compatibility helper.
- `RuntimeOverlayPanel` renders graph-wide and selected-node runtime overlay state in the dashboard sidebar.

### Configuration Options

The overlay has no feature flag. It uses existing workstream tracking, session registry, launch-record, and tracker snapshot data. Source state is passed explicitly through the overlay input so consumers can distinguish complete, loading, and failed evidence.

## Testing

### How to Test

Run the dashboard against `.streamliner/workstreams/session-launching-and-tracking/graph.json`, select `runtime-overlay-ui`, and compare before/after screenshots with:

```powershell
node scripts\screenshot.mjs --graph .streamliner\workstreams\session-launching-and-tracking\graph.json --out .screenshots\after-runtime-overlay.png --select-node runtime-overlay-ui --delay-ms 1000
```

The sidebar should include the Runtime overlay card above the inspector, and selected-node details should show session, launch, PAW, tracker, and degradation state.

### Edge Cases

The overlay explicitly handles loading/error source states, missing launch records, pending and bound launch claims without visible sessions, ambiguous bound sessions, interrupted/stale sessions, ended sessions awaiting graph promotion, PAW evidence degradation, non-Streamliner PAW evidence, and tracker references without snapshots.

## Limitations and Future Work

Tracker snapshots are consumed only when already present on the derived node; this work does not add GitHub fetching. The issue summary aggregates tracker-snapshot-missing reasons to avoid sidebar noise, but it does not provide an expand/deep-link UI for all hidden graph-wide issues. Future gate work can consume the typed readiness contract directly.
