# Runtime Overlay UI Plan

## Problem

Issue #52 needs the graph dashboard to present a single runtime overlay that composes committed workstream graph state with local runtime evidence: graph-bound session activity, PAW workflow enrichment, launch-claim/launch-record state, and tracker context where it is already available. Runtime telemetry must remain derived UI/API state and must not be written into `graph.json`.

## Approach

Build a small overlay view model that joins the existing workstream view model, graph-node session summaries, PAW workflow fields on bound launched sessions, and node launch records. The graph remains the committed base layer; runtime evidence appears as compact node details plus a sidebar summary/selected-node detail with explicit degradation messages for unavailable registry, stale observation, ambiguous bound sessions, missing PAW/tracker evidence, and unresolved launch claims.

Extend the node-launch-record API/client path to support graph-wide record loading so the overlay can show launch state for every node, not only the selected inspector node. Reuse the existing `graphBinding` and registry fields; do not add a new linkage store. Keep PAW workflow display limited to recognized Streamliner-launched PAW sessions while surfacing unavailable/unknown PAW artifact evidence as degradation instead of silently dropping it.

Update `docs/design/session-system.md` to document the composed overlay contract and its visible degradation behavior.

## Overlay contract and precedence

Add an exported `workstream-runtime-overlay` contract with a typed per-node model plus a graph summary that downstream gates can consume. The contract should include a gate-oriented readiness selector such as `gateReadiness.status: "usable" | "degraded" | "not-usable"` plus machine-readable reasons. "Usable" means the overlay composition ran successfully and can distinguish committed graph state from runtime evidence; "degraded" means the overlay is usable but one or more runtime sources are missing/stale/ambiguous/unresolved; "not-usable" means required graph/registry composition failed.

Precedence and coherence rules:

| Evidence | Overlay behavior |
|---|---|
| Committed graph status | Always remains visible as the base state; runtime evidence never mutates or overwrites `graph.json` or `updatedAt`. |
| Blocking pending launch claim with no bound session | Render as `launching` / unresolved runtime evidence for that node. |
| Bound session `activityStatus: working` | Render active work while retaining committed node status. |
| Bound session `activityStatus: waiting_for_input` or `activityEvidence.pendingInputRequest` | Render needs-input / blocked-for-builder attention. |
| Bound session `activityStatus: interrupted` or stale process evidence | Render interrupted/stale/resumable degradation. |
| Bound session `activityStatus: exited` | Render ended runtime evidence pending explicit artifact promotion if the committed node is not completed. |
| Multiple non-ended bound sessions on one node | Render the highest-attention session as primary and mark the node as ambiguous/multi-session instead of hiding the conflict. |
| `pawWorkflow.status: recognized` on a Streamliner-launched bound session | Render PAW stage enrichment alongside, never instead of, activity status. |
| PAW expected but unavailable/unknown | Render PAW degradation; bound sessions not recognized as Streamliner-launched PAW sessions are treated as PAW enrichment unavailable rather than silently inferred from cwd. |
| Tracker snapshot present in `WorkstreamDerivedNode` | Include tracker-derived issue/PR state already available from the view model. |
| Tracker reference present but no snapshot | Render tracker linkage as visible degraded tracker evidence; do not add new GitHub fetching in this node. |

## Out of scope

- Reimplementing graph-node session status indicators, activity observation, PAW artifact parsing/indexing, or launch-claim binding.
- Adding a new linkage store or changing the shape of `graphBinding`, `activityStatus`, `activityEvidence`, `pawLaunch`, or `pawWorkflow`.
- Follow-on PAW Review automation, CLI/daemon/plugin distribution, or non-GitHub tracker fetching.
- Promoting runtime evidence into committed graph status.

## Work items

1. **Overlay composition model:** Add a tested `workstream-runtime-overlay` module that derives per-node and summary overlay state from committed nodes, bound session summaries, PAW workflow enrichment, node launch records, and available tracker snapshot fields. Success means the exported model covers planned/ready, launching, active, needs-input, interrupted/stale, ended, PAW-enriched, tracker-degraded, unresolved, and ambiguous cases and exposes gate readiness.
2. **Graph-wide launch records:** Extend the existing node launch record store/route/client path so `GET /api/node-launch-records?graphPath=...` can return all records for that graph, including latest launch-claim summaries, while preserving `GET /api/node-launch-records?graphPath=...&nodeId=...` as the selected-node response. Success means the overlay can load launch records once per graph refresh without changing graph artifacts.
3. **Dashboard rendering:** Wire the overlay into `GraphDashboard`, graph node cards, and selected-node/sidebar detail; include loading/error/unavailable/stale/ambiguous/unresolved degradation states without mutating graph artifacts. Success means node cards stay compact while the sidebar exposes the richer contract and degradation reasons.
4. **Design documentation:** Update the runtime-overlay section of `docs/design/session-system.md` for the overlay model, exported gate contract, precedence, tracker narrowing, and degradation behavior.
5. **Validation and PR readiness:** Add/update focused tests, run repository checks, capture before/after dashboard screenshots with `node scripts/screenshot.mjs --graph .streamliner/workstreams/session-launching-and-tracking/graph.json`, then complete configured final review and PR creation. Success means tests cover the overlay composition matrix, gate readiness, coherent activity+PAW rendering, graph-wide launch record listing, tracker-degraded behavior, and graph artifact immutability/no-write behavior.

## Key decisions and notes

- `graphBinding` remains the only session-to-node linkage contract.
- `activityStatus` and `activityEvidence` remain the liveness/attention source; `pawWorkflow` remains workflow enrichment only.
- Committed graph status remains visible even when runtime overlay state is active or degraded.
- Tracker runtime state is included only when a `WorkstreamGithubSnapshot` has already populated the workstream view model; otherwise the overlay reports tracker linkage as degraded tracker evidence rather than inventing GitHub state.
- Node cards stay compact; the sidebar overlay summary and selected-node detail carry richer degradation text so missing/stale/unavailable evidence is visible without overcrowding the graph.

## Validation matrix

- Composition unit tests: one node each for planned/ready, launching, active, needs-input, interrupted/stale, ended, PAW-enriched, tracker-degraded, unresolved, ambiguous, and unavailable-source cases.
- API tests: graph-wide launch record listing, latest claim summary joining, existing selected-node query compatibility, and no graph file write.
- UI tests: graph card compact overlay, selected-node sidebar overlay details, activity+PAW coherence, registry error/loading degradation, and Sessions link preservation.
- Visual verification: before/after screenshots from `scripts/screenshot.mjs` against `.streamliner/workstreams/session-launching-and-tracking/graph.json`.
- Repository checks: focused tests during iteration, then lint/build/test appropriate to touched code before final review.
