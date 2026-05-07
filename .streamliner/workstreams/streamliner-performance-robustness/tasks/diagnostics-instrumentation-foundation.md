# Diagnostics instrumentation foundation

## Node

- Workstream: `streamliner-performance-robustness`
- Node ID: `diagnostics-instrumentation-foundation`
- Type: task
- Status: planned

## Outcome

Streamliner has low-overhead, durable diagnostics for the slow or opaque paths
identified by the baseline node. Future workers and operators can see endpoint
latency, request fanout, background scan cadence/cost, graph/source loading, and
file-store work well enough to validate optimizations and diagnose regressions
without relying on live terminal scrollback.

## Design References

- `.streamliner/workstreams/streamliner-performance-robustness/brief.md` -
  workstream measurement-first approach and boundaries
- `.streamliner/workstreams/streamliner-performance-robustness/graph.json` -
  dependencies and gate expectations
- `.streamliner/workstreams/streamliner-performance-robustness/tasks/performance-baseline-and-bottleneck-map.md`
  - upstream baseline node spec
- `docs/design/index.md` - project design entry point
- `docs/design/workstream-format.md` - runtime-state and artifact boundaries
- `docs/design/session-system.md` - local API, registry, observation, indexing,
  launch, and overlay design
- `docs/design/decisions/005-session-registry-storage-and-identity.md` -
  file-backed registry storage rules
- `docs/design/decisions/006-local-streamliner-api-service.md` - API process,
  request logging, SSE, and background worker ownership
- `docs/design/decisions/007-tracked-workstream-registry.md` - workstream-source
  scanning and graph-source registry model
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW
  artifact status source and indexing constraints
- `docs/operations/logging.md` - current durable API log contract

## Inputs

- The baseline report and diagnostics gap list exported by
  `performance-baseline-and-bottleneck-map`.
- Existing API structured logging behavior and log retention/configuration.
- Existing request, background worker, registry/store, workstream-source, graph,
  launch-claim, node-launch, context/activity, and PAW indexing code paths.

## Exports

- Durable diagnostics that cover the baseline-approved opaque paths with
  low-overhead structured events, counters, timings, summaries, or equivalent
  visibility.
- Updated operator documentation or workstream-local diagnostic notes that explain
  how to read the new diagnostics.
- A before/after diagnostic sample or recipe that later optimization nodes can
  reuse during gate validation.
- Any design impact or decision-needed flag if instrumentation reveals that
  current runtime-state or logging assumptions need revision.

## Boundaries

### In scope

- Add or refine structured diagnostics for slow local API endpoints and request
  volume.
- Add or refine diagnostics for EventSource churn, reconnects, or snapshot/replay
  behavior if the baseline shows it matters.
- Add or refine diagnostics for background worker passes, scans, indexing, and
  sweep loops that compete with interactive requests.
- Add or refine diagnostics for workstream-source scans, graph loads, registry
  refreshes, launch-claim stores, node launch records, PAW/context/activity
  indexing, and other file-backed store hot paths identified by the baseline.
- Keep diagnostics low overhead and useful under many-tab load.
- Update existing documentation when operators need new commands, log scopes, or
  interpretation guidance.

### Out of scope

- Reducing request fanout or changing cache/refetch semantics; owned by
  `client-api-fanout-reduction`.
- Tuning background cadence or store algorithms; owned by
  `background-store-efficiency`.
- Building a full metrics database, tracing stack, or observability dashboard.
- Changing runtime-state artifact authority or migrating to SQLite.
- Remote, multi-user, or cloud diagnostics.

## Inherited decisions

- Diagnostics should support measurement and regression prevention without
  becoming a new product surface that requires its own broad UX design.
- Existing structured JSON-lines API logs are the starting point; extend or
  complement them rather than creating a disconnected logging path unless the
  baseline proves that necessary.
- Instrumentation should be driven by observed opacity from the baseline, not by
  a desire to log every subsystem.
- Runtime state remains separate from committed workstream artifacts.

## Design-impact expectation

Expect an update to `docs/operations/logging.md` if new durable log scopes,
fields, recipes, or retention expectations are added. Update
`docs/design/session-system.md` only if instrumentation changes the intended
runtime model, API contract, or background ownership semantics.

## Success criteria

- The diagnostics cover the specific gaps identified by the baseline report.
- Operators can find slow endpoints, request storms, background scans, and hot
  store paths from durable logs or documented diagnostic outputs.
- The added diagnostics do not create meaningful overhead under the accepted
  multi-tab load shape.
- Later optimization nodes can use the diagnostics to compare before/after
  behavior.
- Any new log scope, field, or recipe is documented where future sessions will
  find it.
- The baseline findings gate can evaluate the bottleneck map with enough
  visibility to approve or revise the optimization priority order.

## Engagement

The builder should review the resulting diagnostic sample or recipe before
`baseline-findings-gate` passes. If the instrumentation introduces noisy logs or
unclear operator guidance, tighten the signal before promoting optimization work.
