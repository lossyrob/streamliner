# Managed Worker Runtime Contract

## Overview

This work turns the SDK capability findings from issue #60 / PR #63 into an
accepted product/runtime contract for SDK-managed graph-node workers. Streamliner
now has a documented contract for when a node can run through a managed Copilot
SDK session instead of a visible terminal-first Copilot CLI session.

The work is documentation and design only. It does not implement the production
runtime, registry schema, API routes, or UI. It gives downstream workers a stable
target for implementation.

## Architecture and Design

### High-Level Architecture

The contract preserves the existing session architecture:

- The session registry remains the canonical session surface.
- Graph overlays remain projections of registry/runtime state.
- PAW workflow status remains artifact-derived from explicit PAW work
  directories.
- The local Streamliner API owns runtime actions, trusted lifecycle writes,
  progress fanout, terminal takeover, and cleanup.

SDK-managed workers add a second worker runtime mode:

| Runtime | Role |
|---------|------|
| `terminal-cli` | Existing visible Copilot CLI worker path. |
| `managed-sdk` | Streamliner-owned Copilot SDK worker with browser-safe progress and managed lifecycle actions. |

### Design Decisions

The durable decision is recorded in
`docs/design/decisions/009-sdk-managed-worker-runtime.md`. The main choices are:

- SDK-managed workers are accepted as a first-class local runtime option.
- Runtime choice is builder-selected for the first cut; Streamliner does not
  automatically classify nodes as safe or unsafe for managed execution.
- Terminal-first launch remains supported.
- Managed workers use the existing registry row identity; SDK ids and Copilot
  session ids are metadata, not primary keys.
- Managed lifecycle is separate from PAW artifact status.
- Browser progress is an allowlisted, redacted, bounded projection.
- Unattended permission policy is explicit and does not inherit launch
  preparation `approveAll`.
- Terminal takeover is one way from SDK-managed to visible Copilot CLI.
- Cleanup-after-merge is a deterministic backend lifecycle action with safety
  checks.

### Integration Points

The primary design update is in `docs/design/session-system.md`, which now
documents:

- runtime selection;
- managed registry identity and runtime state;
- managed lifecycle states;
- trust and binding;
- progress projection and retention;
- permission policy;
- interruption/cancellation;
- one-way terminal takeover;
- PR, review, completion, and cleanup signals;
- My Sessions and graph overlay behavior; and
- Automated PAW Review Loop requirements.

The downstream consumable summary is
`.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md`.

## User Guide

### Prerequisites

This is a design contract for future implementation. Users do not have a new
runtime UI yet. Downstream implementers should read:

1. `docs/design/session-system.md`
2. `docs/design/decisions/009-sdk-managed-worker-runtime.md`
3. `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md`
4. `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md`

### Basic Usage

For downstream implementation work, treat the contract as the source of truth:

1. Keep terminal-first launch intact.
2. Add SDK-managed runtime behavior behind explicit node launch selection.
3. Store managed identity and lifecycle against the existing registry row.
4. Project sanitized progress to the browser.
5. Use one-way terminal takeover for human recovery.
6. Run cleanup-after-merge as deterministic backend behavior.

### Advanced Usage

Automated PAW Review Loop should consume managed workers only through the
contracted signals: registry identity, managed lifecycle, bounded progress,
PR/review-ready state, permission posture, takeover finality, and cleanup state.

## API Reference

### Key Components

No production APIs were added in this node. The contract defines future API and
schema expectations for:

- registry metadata: runtime kind/owner, SDK identity, managed lifecycle,
  progress pointer, completion metadata;
- local runtime state: sanitized progress, summaries, lifecycle evidence;
- lifecycle actions: interrupt, terminal takeover, cleanup-after-merge; and
- UI projections: My Sessions and graph overlays.

### Configuration Options

No runtime configuration was implemented. The contract requires future managed
launches to record:

- selected runtime (`terminal-cli` or `managed-sdk`);
- explicit permission profile;
- workstream/node/repo/worktree/branch identity;
- PAW work directory and context metadata; and
- SDK session identity needed for resume/takeover.

## Testing

### How to Test

For this design node, testing means validating documentation integrity and
reviewing the contract against issue #61:

- Confirm the design docs build.
- `npm run docs:build` and `npm run lint` were run for this branch.
- Confirm Decision 009 appears in the design index and VitePress sidebar.
- Confirm the workstream-local summary gives downstream substrate, UI,
  takeover/cleanup, gate, and review-loop workers enough direction without
  re-reading the entire design doc.

### Edge Cases

The contract explicitly covers these future implementation edge cases:

- SDK cancellation evidence is inconclusive or times out.
- Permission denial blocks unattended progress.
- SDK session is discovered by filesystem observation and must not create a
  duplicate visible row.
- Terminal takeover fails before trusted CLI binding.
- PR is ready but graph promotion has not happened.
- Cleanup guardrails find dirty worktree, branch mismatch, unmerged state, or
  another worktree/process depending on the branch/path.

## Limitations and Future Work

This node does not implement SDK-managed execution. Future workstream nodes own:

- the managed execution substrate;
- builder-facing runtime UI;
- terminal takeover and cleanup actions;
- dogfood hardening; and
- final export readiness for Automated PAW Review Loop.

Remote execution, multi-user/cloud workers, worker pools, automatic safe/unsafe
node classification, full review/address/re-review orchestration, and
SDK-to-CLI-to-SDK round-tripping remain out of scope for the accepted first-cut
contract.

Resolves #61.
