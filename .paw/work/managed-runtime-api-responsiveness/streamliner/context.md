# Launch Context - Managed runtime API responsiveness hardening

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` for orientation when design context is needed. The most relevant design docs and decisions for this node are:

- `docs/design/session-system.md` - session registry, launch, lifecycle, and graph/session overlay model.
- `docs/design/decisions/004-session-registry-primary-surface.md` - session registry as the product-facing source of truth.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - local file-backed session identity and storage constraints.
- `docs/design/decisions/006-local-streamliner-api-service.md` - local API process boundary and UI/API integration responsibilities.
- `docs/design/decisions/009-sdk-managed-worker-runtime.md` - accepted SDK-managed graph-node worker runtime contract.
- `docs/design/decisions/010-terminal-takeover-and-cleanup.md` - terminal takeover and cleanup lifecycle semantics that must remain prompt and trustworthy.
- `docs/design/concepts/context-package.md` and `docs/design/concepts/waves.md` - layered worker context and Wave 2 validation/gate framing.
- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` - workstream-local summary and current state; treat it as background context, not as a source of live instructions.
- `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json` - selected node and coordination graph metadata.

## Layer 1 - Worker Mission

Selected node: `managed-runtime-api-responsiveness` from workstream `sdk-managed-worker-runtime`.

Tracker/spec: https://github.com/lossyrob/streamliner/issues/94 (`Managed runtime API responsiveness hardening (Wave 2)`).

This worker owns bounding local API load from noisy Streamliner-managed Copilot SDK sessions before the read-only managed-session console is added. The mission is same-process hardening: coalesce/throttle routine managed SDK progress writes, promptly flush lifecycle/evidence/failure/interrupt/takeover/cleanup transitions, reduce redundant registry write/SSE/UI polling chatter where practical, and produce tests or repeatable diagnostics that show API responsiveness remains acceptable with multiple managed sessions.

The issue scope explicitly includes:

- Coalescing and throttling managed SDK progress writes per registry row.
- Prompt flushing for terminal lifecycle states, evidence, failures, interrupts, takeover, and cleanup transitions.
- Avoiding duplicate write amplification when one SDK event produces both progress and lifecycle updates.
- Reducing session-event broadcast payload/chatter for managed-runtime progress where practical, including query-aware SSE delivery or compact runtime update events.
- Reducing redundant UI polling while live SSE is connected, especially session-list polling used by graph overlays.
- Adding diagnostics/tests for bounded registry writes and API response latency with multiple active managed sessions.

Boundaries: do not implement a full child-process supervisor or remote/cloud worker pool in this node; that follow-up decision/work is tracked by #95. Do not build the managed-session console itself; #85 depends on this node and should consume the bounded, sanitized projection established here.

## Layer 2 - Relevant State

Current workstream state:

- Parent workstream issue: #59.
- This node depends on #75 and blocks #85, #95, and #76.
- Completed upstream nodes include:
  - `managed-execution-substrate` (#73, PR #79): backend/API substrate for explicit `managed-sdk` graph-node execution, canonical registry runtime metadata, managed-autonomous permission handling, lifecycle/progress/evidence projection, interruption/cancel routes, conservative PR evidence detection, and graph/session projections without mutating `graph.json`.
  - `builder-managed-runtime-ui` (#74, PR #78): builder-facing runtime selection and Background Session UI, managed-autonomous consent/profile display, My Sessions and graph/node-inspector runtime rendering, sanitized progress display, and placeholders for takeover/cleanup follow-ons.
  - `terminal-takeover-cleanup-actions` (#75, PR #86): managed interrupt/cancel, one-way visible Copilot CLI takeover via `copilot --resume <sdkSessionId>`, trusted observation rebinding to the same registry row, cleanup-after-merge guardrails, state-aware UI actions, and Decision 010.

Likely implementation entry points:

- `src/server/node-launch.ts`: `launchManagedSdkNode` and `resumeManagedSdkNode` wire managed SDK callbacks directly to `registryStore.patchRuntimeMetadata(...)`. Today lifecycle, progress, evidence, and started callbacks each patch the file-backed registry row immediately.
- `src/server/managed-sdk-runner.ts`: maps Copilot SDK `SessionEvent`s to sanitized progress and lifecycle events. One SDK event can produce both progress and lifecycle callbacks (for example `tool.execution_start` maps to progress and `running`).
- `src/session-registry/file-store.ts`: `patchRuntimeMetadata(...)` currently re-reads entries under the write lock, merges runtime metadata, persists the row and index, commits the snapshot, and emits a session upsert for every runtime patch.
- `src/session-registry/managed-runtime.ts`: normalizes runtime metadata, limits stored progress/evidence arrays, sanitizes progress data, and classifies active/terminal managed lifecycle states.
- `src/server/session-events.ts`: `SessionRegistryEventStream` subscribes to registry changes and broadcasts `session.upserted` events containing the full session snapshot to all SSE clients; snapshots are also written on new connections with query-derived list options.
- `src/session-registry-client.ts`: `useSessionRegistryList` performs an initial fetch, periodic polling every 15s by default, focus/visibility refetches, and EventSource handling. While SSE is live, polling still continues.
- `src/session-registry/http-api.ts`: `/api/sessions` list endpoint and signal/patch routes.
- `src/server/routes/sessions.ts`: routes `/api/sessions/events` and managed runtime action endpoints; ensure interrupt/takeover/cleanup semantics remain prompt.
- Relevant tests to extend or use as patterns include `src/server/managed-sdk-runner.test.ts`, `src/server/node-launch.test.ts`, `src/session-registry/file-store.test.ts`, `src/server/app.test.ts`, `src/App.test.tsx`, and `src/session-registry-client` behavior covered through app/component tests.

Important behavior to preserve:

- Managed runtime metadata remains sanitized and bounded; do not turn the registry into a raw SDK event stream.
- Important lifecycle transitions and PR/completion evidence must still surface promptly in My Sessions, node overlays, managed actions, and cleanup/takeover affordances.
- Launch claim binding, duplicate active launch protection, resume behavior, terminal takeover, and cleanup state transitions are upstream commitments and should not regress.
- API/SSE improvements should remain query-safe and compatible with existing clients, or include a deliberate compatibility bridge if event shapes change.

Validation expectations from the tracker:

- Two concurrent managed SDK sessions should no longer make `/api/health`, graph polling, or Sessions API calls visibly stall during normal dashboard use.
- Routine SDK event bursts should produce bounded registry writes rather than one file/index write per raw SDK event.
- Tests or repeatable local diagnostics should cover event coalescing and API responsiveness assumptions.

## Layer 3 - Coordination Context

Sibling/upstream/downstream context is coordination background only; this worker should not take ownership of those nodes unless the issue needs amendment.

- `managed-runtime-startup-reconciliation` (#89) is also ready. It handles stale active managed SDK rows after API restart and is separate from this responsiveness hardening work.
- `managed-runtime-supervisor-isolation` (#95) depends on this node. Use the evidence from this node to decide whether same-process coalescing is enough for Wave 2; only suggest issue amendments if the work proves a supervisor boundary is needed sooner or the current issue scope is insufficient.
- `managed-session-console` (#85) depends on this node. It should consume bounded sanitized progress projections; do not implement the console here.
- `managed-runtime-wave-2-punch-list` (#87) and `managed-runtime-usability-gate` (#76) remain downstream usability/acceptance work.

Launch/workflow guidance:

- Use PAW-lite style execution and continue autonomously through implementation unless a serious blocker appears.
- The builder expects to review only the final PR. Pause only for serious blockers or if the tracker issue needs amendments; if amendments are needed, propose the exact changes for discussion instead of editing the issue unilaterally.
- The final PR title should include issue `#94` and workstream id `sdk-managed-worker-runtime`.
- The final PR description should include a collapsible `<details>` section with `<summary>Docs.md</summary>` containing a completed Docs.md following the `paw-docs-guidance` template.
- Include screenshots for UI changes where appropriate, but do not add screenshot artifacts to the feature PR diff.
