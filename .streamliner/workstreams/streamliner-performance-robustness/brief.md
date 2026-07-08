# Streamliner Performance and Robustness

## Purpose

Make Streamliner feel fast and stable when it is used as an always-on
coordination surface with many open tabs, several workstream graph views, and
multiple My Sessions views. This workstream should identify the actual local
bottlenecks in the API, client refresh behavior, background observation/indexing,
and file-backed stores, then apply targeted improvements without changing
Streamliner product semantics.

Performance is product quality for Streamliner: if the coordination surface slows
down under normal multi-workstream usage, the builder loses the leverage that
parallel agent work is supposed to create.

## Approach

Start with measurement, not assumptions. Wave 1 produces a reproducible
multi-tab baseline, a request/latency/background-work bottleneck map, and the
minimum durable diagnostics needed for future workers to see what is slow. A
builder gate then validates the findings and priority order before optimization
nodes proceed.

After the baseline gate, optimization work is split by independently consumable
confidence: client/API fanout reduction and background/store efficiency can
proceed against the accepted bottleneck map, then a gate checks whether perceived
responsiveness improved without semantic regression. A final hardening wave turns
the accepted behavior into regression coverage, manual load recipes, and
operator-facing diagnostics so downstream workstreams can add surfaces without
reintroducing request storms.

Later-wave node boundaries are hypotheses. The orchestrator should split, merge,
or reorder them at promotion time based on the Wave 1 findings; the graph encodes
the likely confidence transitions, not a claim that the root cause is already
known.

## Design References

- `streamliner:INDEX.md` - top-level project document index for future sessions
- `streamliner:WORKSTREAM-DESIGN.md` - workstream and node-boundary philosophy
  for PAW-sized work
- `streamliner:WORKSTREAM-FORMAT.md` - reference workstream artifact schema
- `streamliner:NODE-SPEC-FORMAT.md` - node spec format for Wave 1 local specs
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope, local-first architecture,
  and workstream model
- `streamliner:docs/design/operating-model.md` - roles, gates, and information
  flow through artifacts
- `streamliner:docs/design/workstream-format.md` - artifact/runtime-state
  separation and graph conventions
- `streamliner:docs/design/session-system.md` - launch, registry, local API,
  background observation, PAW enrichment, and graph overlay design
- `streamliner:docs/design/concepts/waves.md` - wave promotion, checkpoints, and
  gate boundaries
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md`
  - current observation model that background work must preserve
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md` -
  registry as the primary session surface
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md`
  - file-backed session registry storage and identity contract
- `streamliner:docs/design/decisions/006-local-streamliner-api-service.md` -
  loopback API ownership, SSE session events, and background worker ownership
- `streamliner:docs/design/decisions/007-tracked-workstream-registry.md` -
  workstream-source registry and graph-source model
- `streamliner:docs/design/decisions/008-paw-artifacts-for-workflow-status.md` -
  PAW artifact-derived workflow status and indexing implications
- `streamliner:docs/operations/logging.md` - current API log locations, scopes,
  and slow-request inspection recipes

## Boundaries

- **In scope:** Profiling local API request volume and latency under realistic
  multi-tab usage; identifying expensive client refresh patterns; identifying
  expensive server/background paths; evaluating file-backed store behavior for
  session registry, launch claims, node launch records, workstream sources,
  graph/runtime overlays, context/activity indexing, and PAW artifacts; adding
  low-overhead diagnostics for slow endpoints, background scans, store work, and
  request fanout; implementing targeted optimizations that preserve current
  semantics; defining regression expectations for many local tabs.
- **Out of scope:** Remote/cloud execution scaling; multi-user server deployment;
  replacing Streamliner's local-first architecture; broad UI/product redesigns
  unrelated to responsiveness; speculative optimization before profiling current
  bottlenecks.
- **Deferred:** Full database migration unless profiling shows the file-backed
  store cannot support expected local usage; cross-machine sync; distributed cache
  or background job queue; browser push architecture redesign beyond what local
  multi-tab robustness requires.

## Current State

The workstream is formed from
`.streamliner/shaping/candidates/streamliner-performance-robustness.md`. Wave 1
uses local specs under `tasks/` rather than GitHub issue trackers so the
measurement plan can be reviewed and launched from committed artifacts first.
The first ready node is `performance-baseline-and-bottleneck-map`; it should
produce a reproducible baseline report and prioritized quick-win list before any
optimization node changes behavior.

`diagnostics-instrumentation-foundation` is detailed but depends on the baseline
node. It should add only the durable visibility the baseline proves is missing,
not tune or redesign the system yet. The `baseline-findings-gate` blocks
downstream optimization until the builder accepts the observed bottlenecks and
priority order.

### Observed symptoms (anecdotal, pre-baseline)

An interactive session on 2026-05-14 (prototype work in `_proto/canvas`)
observed the local API process serving requests with widely variable latency
within a single process lifetime, no restart between observations:

- `GET /api/health` (a one-line handler) returned in 1ms early, then in
  226,815ms (~4 minutes) during a degraded window.
- `GET /_proto/canvas/` (a static file via `express.static`, no business
  logic) returned in 6ms early, then in 13,197ms during a separate degraded
  window.
- `GET /api/workstreams` returned 304 in 116,111ms in the same degraded
  window as the slow `/api/health`.
- Slow windows correlated with `signals` scope events received from an
  active Copilot CLI session driving `prompt.submitted` traffic.
- The signal handler itself (`POST /api/sessions/signals`) returned in
  ~487ms — fast — but subsequent requests stalled, suggesting downstream
  work scheduled by the signal continued to occupy the event loop after the
  response.

Static-file slowness within the same process rules out per-endpoint
business logic, store IO, and individual background jobs as the dominant
cause. The shape points at **Node event-loop blocking** — synchronous
compute or blocking IO somewhere in the request or signal pipeline that
starves later requests. The baseline node should treat event-loop lag as a
primary measurement target alongside per-endpoint timing.

These are observations, not measurements. Wave 1 should reproduce them
under controlled load, confirm or refute the event-loop-blocking hypothesis,
and identify which scope/handler is the actual blocker.

## Decisions

- Use local Wave 1 specs first. GitHub issue promotion can happen after formation
  or at Wave 1 launch without changing the graph shape.
- Keep Wave 1 measurement-first. Permanent diagnostics may be added before the
  first gate, but client/server behavior optimizations wait until the baseline
  findings are accepted.
- Treat local API logs and low-overhead diagnostics as product surfaces for this
  workstream. They should help operators understand slowness without requiring a
  debugger or live terminal scrollback.
- Preserve the existing local-first architecture and file-backed stores unless
  measured evidence shows they cannot meet the expected local multi-tab usage
  envelope.
- Use gates where builder judgment matters: accepting the bottleneck map,
  validating responsiveness after optimizations, and accepting the final
  robustness/export package.

## Open Questions

- What concrete symptom dominates current pain: slow endpoint responses, high
  CPU, excessive disk IO, stale UI, browser overload, EventSource churn, or API
  request backlog?
- Is **event-loop lag** the dominant symptom shape (the same process serves
  requests fast then catastrophically slow without restart), and which scope or
  handler is the actual blocker?
- Does the Copilot CLI `signals` handler trigger downstream synchronous work
  (PAW indexing, graph reload, activity update, registry rescan) that runs
  after the response and starves later requests?
- Is there a way to surface "the server is currently busy with X" as a live
  operator signal, not just slow request log lines after the fact?
- How many concurrent tabs/views should Streamliner comfortably support on the
  builder's local machine?
- Which endpoints and background jobs dominate request volume and latency under
  realistic usage?
- Should multiple browser tabs coordinate through browser storage or
  `BroadcastChannel` to reduce duplicate requests, or is server/client caching
  enough?
- Which state should be event-driven, polled, focus-refreshed, cached, or
  explicitly stale-tolerant?
- When should background observation/indexing yield to interactive requests?
- Is the file-backed store sufficient with better caching/incremental reads, or
  is a SQLite-style backing store becoming necessary?

## Imports and Exports

### Imports

- **Session Launching and Tracking substrate:** local API routes, session
  registry records, launch claims, graph binding, node launch records, session
  events, PAW artifact enrichment, and graph runtime overlay surfaces.
- **Tracked workstream registry and graph loading:** server-side workstream
  sources, source scans, discovered graph metadata, browser fallback paths, and
  graph/runtime overlay loading behavior.
- **API logging and runtime stores:** current structured JSON-lines logs,
  request logging, background worker logs, registry entry/index files, launch
  claim stores, node launch records, and PAW/context/activity indexes.
- **Real builder usage shape:** the local multi-tab, multi-workstream operating
  pattern that produces the performance symptoms.

### Exports

- **Performance baseline report:** reproducible multi-tab load shape, request
  inventory, endpoint latency, background worker cadence, store IO observations,
  and bottleneck ranking.
- **Diagnostics foundation:** low-overhead endpoint/background/store visibility
  sufficient to diagnose future slowness.
- **Multi-tab request/fanout policy:** accepted guidance for polling, focus
  refresh, EventSource reconnects, cross-tab duplication, caching, and stale data.
- **Client/API cache and refetch strategy:** behavior future UI surfaces can
  inherit for sessions, workstreams, graphs, and runtime overlays.
- **Backing-store constraints or improvement plan:** evidence-backed statement of
  whether file-backed storage remains sufficient and what constraints downstream
  workstreams must respect.
- **Regression/load-test recipe:** automated or manual checks that keep many-tab
  local responsiveness from regressing.

### External Dependencies

- **Builder load-shape validation:** Wave 1 needs the builder to validate that the
  measured tab/session/workstream mix reflects real usage.
- **Local machine evidence:** Findings are scoped to the current local-first
  Streamliner environment. Remote, multi-user, or cloud scaling evidence belongs
  to a separate future workstream.

## Related Candidates and Workstreams

- **Depends on:** Session Launching and Tracking, because current load comes from
  the local API, session registry, launch records, graph binding, and runtime
  overlay surfaces it introduced.
- **Enables:** Work Geometry Canvas, Checkpoint and Closeout Experience,
  Automated PAW Review Loop, and SDK-Managed Worker Runtime, because each will add
  more graph, session, review, or runtime surfaces that should inherit a robust
  request/diagnostics model.
- **Related candidates:** Multi-Workstream Dependencies and External Dependency
  Tracking, because project-scoped graph/dependency state must stay efficient as
  workstreams accumulate.

## Closeout Punch List

No closeout items yet. During dogfooding, small polish or confidence-gap items
should be parked here and batched near the closure gate unless they change core
semantics, need their own gate, or produce downstream exports.
