# Streamliner Performance and Robustness

## Stage

Seeded

## Seed Idea

Improve Streamliner's responsiveness and robustness under real builder usage:
many open Streamliner tabs, several workstream graph views, and multiple My
Sessions views across desktops. The current local API and backing stores may be
getting swamped by request fanout, polling/event streams, graph loads, session
registry refreshes, background observation/indexing, or file-store reads/writes.

The workstream should take a systems view: observe what is actually happening,
identify the biggest local bottlenecks, and make Streamliner feel fast and
stable when it is used as an always-on coordination surface.

## Why It Matters

Streamliner is becoming a real working environment rather than a single-tab demo.
The builder may keep one tab per workstream open, plus My Sessions views on
multiple desktops. If every tab independently polls, opens event streams, reloads
graphs, refreshes session state, or triggers expensive backing-store work, the
local API can become slow exactly when Streamliner is supposed to make parallel
agent work easier.

Performance is now product quality:

- session and workstream views need to stay responsive;
- graph tabs should not overload the API just by staying open;
- My Sessions should scale to multiple visible copies;
- background observation/indexing should not starve interactive requests;
- the backing store should handle growing workstream/session data safely;
- operators need enough diagnostics to see what is slow.

## Candidate Scope

### In Scope

- Profile local API request volume under realistic multi-tab usage.
- Identify expensive client refresh patterns: polling, focus refresh, event-stream
  refetches, graph/workstream reloads, and duplicate requests across tabs.
- Identify expensive server/background paths: session registry refresh, launch
  claim scans, PAW artifact indexing, context/activity indexing, graph loading,
  and workstream-source scanning.
- Evaluate backing-store behavior for session registry, launch claims, node
  launch records, workstream sources, and graph/runtime overlays.
- Add or improve diagnostics so slow endpoints, background scans, and request
  fanout are visible in logs.
- Implement targeted optimizations that improve perceived responsiveness without
  changing product semantics.
- Define robustness expectations for many tabs viewing the same local API.

### Out of Scope

- Remote/cloud execution scaling.
- Multi-user server deployment.
- Replacing Streamliner's local-first architecture.
- Optimizing speculative future features before profiling current bottlenecks.
- Large product redesigns unrelated to responsiveness.

### Deferred

- Full database migration unless profiling shows the file-backed store cannot
  support expected local usage.
- Cross-machine sync.
- Distributed cache or background job queue.
- Browser push architecture redesign beyond what is needed for local multi-tab
  use.

## Current Symptom Model

The builder is seeing slow responses or request saturation while running:

- many Streamliner tabs;
- multiple workstream graph pages;
- My Sessions views in more than one desktop;
- ongoing session/workstream automation and background observation.

Likely investigation areas based on current code surfaces:

- React app and Sessions page refresh loops, focus refresh, and EventSource
  handling.
- `/api/sessions`, `/api/sessions/events`, `/api/workstreams`,
  `/api/workstream-sources`, graph APIs, launch-preparation events, and node
  launch/record APIs.
- Session registry background worker and session/activity/context/PAW indexers.
- File-store refresh-from-disk and per-entry JSON/index behavior.
- Workstream source scanning and graph loading when multiple workstream tabs are
  open.

This candidate should not assume the root cause. The first wave should measure
before optimizing.

## Workstream Shape

Likely wave shape:

1. **Performance baseline and instrumentation** — measure request rates,
   endpoint latency, background worker time, file-store IO, and multi-tab fanout.
   Produce a clear bottleneck report and quick-win list.
2. **Client/API request reduction** — coalesce duplicate refreshes, gate polling
   by visibility/focus where safe, avoid full refetches after narrow events, cache
   stable graph/source data, and prevent many tabs from stampeding the same API.
3. **Background/store efficiency** — tune observation/indexing cadence, avoid
   unnecessary refresh-from-disk work, add incremental/cached reads where safe,
   and separate interactive request priority from background scans.
4. **Robustness and diagnostics** — add guardrails, logs, status indicators, and
   tests so future features do not reintroduce request storms.

## Dependencies

### Depends On

- Session Launching and Tracking workstream, because current load comes from the
  local API, session registry, launch records, graph binding, and runtime overlay
  surfaces it introduced.

### Enables

- [Work Geometry Canvas](work-geometry-canvas.md), because a multi-workstream
  canvas will increase graph/workstream data loading pressure.
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md),
  because checkpoint panels and punch-list UI should not add more uncontrolled
  refresh loops.
- [Automated PAW Review Loop](automated-paw-review-loop.md), because review-loop
  automation will add more session/event/PR state.
- [SDK-Managed Worker Runtime](sdk-managed-worker-runtime.md), because managed
  workers need responsive progress/status streaming and robust background work.

### Related Candidates

- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because
  project-scoped graph/dependency scanning must stay efficient as workstreams
  accumulate.
- [External Dependency Tracking](external-dependency-tracking.md), because more
  dashboard state should not compound refresh pressure.

## Exported Interfaces and Dependencies

Potential exports:

- Performance baseline and profiling report.
- Endpoint/background-job latency and request-volume diagnostics.
- Multi-tab refresh/fanout policy.
- Client cache/refetch strategy for sessions, workstreams, graphs, and runtime
  overlays.
- Backing-store improvement plan or constraints.
- Regression tests or manual load-test recipe for many tabs.

Potential imports:

- Current local API logging and access logs.
- Session registry file-store and background worker behavior.
- Existing graph/workstream source APIs.
- Vite/React client refresh and EventSource usage.

## Open Questions

- What is the concrete symptom: slow endpoint responses, high CPU, excessive disk
  IO, stale UI, browser overload, or API request backlog?
- How many tabs/views should Streamliner comfortably support locally?
- Which endpoints dominate request volume and latency under current usage?
- Should multiple tabs coordinate through browser storage/broadcast channels to
  reduce duplicate requests?
- Which state should be event-driven, polled, focus-refreshed, or cached?
- When should background observation/indexing yield to interactive requests?
- Is the file-backed store sufficient with better caching/incremental reads, or
  is a SQLite-style backing store becoming necessary?

## Handoff Brief

Create a Streamliner Performance and Robustness workstream.

Start with measurement, not assumptions. Reproduce realistic builder usage with
many Streamliner tabs, several workstream graph views, and multiple My Sessions
views. Instrument or inspect local API logs, request volume, endpoint latency,
background worker cadence, graph/source loading, and file-store IO. Identify the
highest-impact bottlenecks and then implement targeted optimizations that improve
responsiveness without changing Streamliner semantics.

The first useful output should be a baseline report plus a prioritized set of
quick wins. Later waves should reduce client/API fanout, tune background/store
work, and add diagnostics/regression coverage so Streamliner remains fast as more
workstreams, sessions, and automation surfaces are added.
