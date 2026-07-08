# Performance baseline and bottleneck map

## Node

- Workstream: `streamliner-performance-robustness`
- Node ID: `performance-baseline-and-bottleneck-map`
- Type: research
- Status: ready

## Outcome

Streamliner has an evidence-backed baseline for realistic builder usage with
many open Streamliner tabs, several workstream graph views, and multiple My
Sessions views. The output identifies request volume, endpoint latency,
EventSource and focus-refresh behavior, background worker cadence, graph/source
loading, file-store IO hotspots, and the highest-impact bottlenecks or quick
wins to address next.

## Design References

- `INDEX.md` - top-level navigation for project docs
- `WORKSTREAM-DESIGN.md` - node and wave boundary philosophy
- `.streamliner/shaping/candidates/streamliner-performance-robustness.md` -
  shaped candidate and original symptom model
- `.streamliner/workstreams/streamliner-performance-robustness/brief.md` -
  current workstream intent, boundaries, imports, and exports
- `.streamliner/workstreams/streamliner-performance-robustness/graph.json` -
  node, dependency, and gate structure
- `.streamliner/workstreams/session-launching-and-tracking/brief.md` - upstream
  session/local API substrate this workstream imports
- `.streamliner/workstreams/session-launching-and-tracking/graph.json` -
  upstream node/checkpoint state and exported surfaces
- `docs/design/index.md` - project design entry point
- `docs/design/product.md` - local-first web application and workstream model
- `docs/design/operating-model.md` - artifact-based information flow and gates
- `docs/design/workstream-format.md` - artifact/runtime-state separation
- `docs/design/session-system.md` - launch, registry, background observation,
  PAW enrichment, and runtime overlay design
- `docs/design/decisions/001-observation-based-session-tracking.md` -
  observation-first session tracking model
- `docs/design/decisions/004-session-registry-primary-surface.md` - registry as
  the primary session surface
- `docs/design/decisions/005-session-registry-storage-and-identity.md` -
  file-backed registry storage contract
- `docs/design/decisions/006-local-streamliner-api-service.md` - API process,
  SSE, and background worker ownership
- `docs/design/decisions/007-tracked-workstream-registry.md` - workstream-source
  registry and graph-source model
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW
  artifact-derived status and indexing model
- `docs/operations/logging.md` - current API log scopes and slow-request recipes

## Inputs

- Current local API logs under `~/.streamliner/state/logs/`.
- Current Streamliner dashboard behavior under realistic multi-tab usage.
- Existing session registry, launch-claim, node-launch, workstream-source,
  graph/runtime overlay, context/activity, and PAW artifact runtime stores.
- Any builder-provided description of the exact tab/session/workstream mix that
  currently feels slow.
- Anecdotal symptom evidence captured in the workstream brief's "Observed
  symptoms" section: a 2026-05-14 prototype-development session in
  `_proto/canvas` saw the same API process serve a static file
  (`/_proto/canvas/`) in 6ms early and 13,197ms during a degraded window, with
  `/api/health` ranging from 1ms to 226,815ms in the same lifetime, and
  `/api/workstreams` returning 304 in 116,111ms during the slow window.
  Slow windows correlated with `signals` scope events from an active Copilot
  CLI session. Use as a starting hypothesis (event-loop blocking), not as
  a substitute for measurement.

## Exports

- A baseline report at
  `.streamliner/workstreams/streamliner-performance-robustness/docs/performance-baseline.md`
  unless the findings are promoted directly into project design or operations
  docs.
- A reproducible manual or scripted load-shape recipe that later nodes and gates
  can rerun.
- A ranked bottleneck map covering client/API fanout, endpoint latency,
  background cadence, graph/source loading, and store IO.
- A quick-win list that distinguishes measurement-backed optimizations from
  speculation.
- A diagnostics gap list for `diagnostics-instrumentation-foundation`.

## Boundaries

### In scope

- Reproduce or approximate the builder's many-tab usage shape with several graph
  views and multiple My Sessions views.
- Measure request rates and endpoint latency for local API routes that dominate
  the current symptom model.
- Inspect EventSource connection/reconnect behavior, focus/visibility refreshes,
  polling, and full-refetch patterns.
- Measure or infer background worker cadence and cost, including session
  registry observation, context/activity indexing, PAW artifact indexing,
  launch-claim scans, workstream-source scans, and graph/source loading.
- Inspect file-backed store behavior enough to distinguish repeated disk refresh,
  write contention, large reads, and derived-index rebuilds.
- Measure **Node event-loop lag** during normal usage with a cheap
  `setInterval`-based drift sampler. The brief's observed-symptoms evidence
  suggests this is the dominant symptom shape (same process, static-file
  fetches ranging from 6ms to 13s within one lifetime). Confirm or refute
  the hypothesis. If event-loop lag spikes correlate with specific scopes
  (signals, indexing, scans), surface the correlation in the report.
- Inspect what runs **after** signal-handler responses return.
  `POST /api/sessions/signals` itself returns fast, but downstream
  synchronous work (indexing, registry rescans, graph reloads triggered by
  the signal) can starve the next request batch and produce the
  "fast-then-slow" pattern observed in the brief. Identify whether such
  trailing work exists and what triggers it.
- Use temporary profiling scripts, browser/devtools traces, log filters, or
  one-off diagnostics when useful, provided the final report explains what was
  measured and what remains unknown.

### Out of scope

- Implementing client/API fanout reductions; owned by
  `client-api-fanout-reduction`.
- Implementing background/store tuning; owned by `background-store-efficiency`.
- Adding permanent diagnostics beyond small measurement aids; owned by
  `diagnostics-instrumentation-foundation`.
- Migrating stores to a database.
- Redesigning Streamliner's local-first architecture.
- Optimizing speculative future features before current bottlenecks are
  observed.

## Inherited decisions

- The first useful output is a baseline report and prioritized quick-win list,
  not an optimization PR.
- Current semantics are the baseline contract: measuring slowness must not
  silently change polling, EventSource, registry, graph, or background behavior.
- File-backed stores remain the default until evidence shows they cannot support
  the expected local usage envelope.
- Later-wave node boundaries are provisional and may be reshaped after the
  baseline findings gate.

## Design-impact expectation

No project design update is required unless the research shows current design
assumptions in `docs/design/session-system.md`, `docs/design/workstream-format.md`,
or an accepted decision record are no longer viable. Operational findings may be
captured in `docs/operations/logging.md` or a workstream-local support doc.

## Success criteria

- The report states the exact load shape measured and how closely it matches the
  builder's real usage.
- The report identifies the highest-volume and slowest local API routes under
  that load shape.
- The report distinguishes browser/client duplication from server/background
  cost and file-store IO cost.
- The report states what EventSource, polling, focus refresh, and graph/source
  reload behavior was observed.
- The report identifies diagnostics that are missing or too noisy for future
  performance work.
- The report produces a priority-ordered quick-win list with rationale and
  confidence.
- Downstream nodes can proceed without rediscovering the baseline.

## Engagement

The builder should review the load shape and bottleneck ranking before
`baseline-findings-gate` passes. If the measured load shape does not reproduce
the real symptom, pause optimization promotion and revise the reproduction.
