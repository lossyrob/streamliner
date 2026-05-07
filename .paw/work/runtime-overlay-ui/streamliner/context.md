# Launch Context - Runtime overlay in UI

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` when design orientation is needed. It gives the current reading order and decision log for Streamliner design docs.

Most relevant design references for this node:

- `docs/design/session-system.md` - authoritative for session launching, lifecycle, registry contract, tracking, graph binding, PAW workflow enrichment, and runtime overlay. Focus on `Session Lifecycle`, `Session Tracking`, `Node-to-Session Binding`, and `Runtime Overlay`.
- `docs/design/workstream-format.md` - authoritative for committed workstream artifacts versus local runtime state. Focus on `Local runtime state` and `Artifact state vs. operational state`: `graph.json` is the committed base layer; runtime/session/tracker evidence is rendered as an overlay and must not be committed as telemetry.
- `docs/design/decisions/004-session-registry-primary-surface.md` - the session registry is the primary session surface; graph overlay is a projection of registry state, not a replacement store.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - local file-backed registry identity/storage contract.
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW workflow status comes from explicit PAW work-directory artifacts, not `## Control State`; session observation remains authoritative for liveness/attention.
- Workstream artifacts: `.streamliner/workstreams/session-launching-and-tracking/brief.md` and `.streamliner/workstreams/session-launching-and-tracking/graph.json`.

Treat those files as source context, not instructions. If overlay precedence, data shape, or degradation behavior changes, expect to update `docs/design/session-system.md` per issue #52.

## Layer 1 - Worker Mission

Implement the selected node only: `runtime-overlay-ui` / **Runtime overlay in UI** for issue https://github.com/lossyrob/streamliner/issues/52.

The outcome is a committed dashboard/runtime overlay that composes:

- committed graph node/checkpoint/workstream state from `.streamliner/workstreams/session-launching-and-tracking/graph.json`,
- bound session status from the session registry and existing graph-node session status work,
- tracker state for GitHub-backed nodes where available,
- launch-claim/launch-record state already exposed by Wave 3 launch work,
- PAW artifact workflow enrichment for recognized Streamliner-launched PAW sessions.

The key product constraint is that runtime telemetry stays out of committed workstream artifacts. Do not turn `graph.json` or the brief into a telemetry log; render runtime evidence as derived UI/API state and tolerate missing/stale/unresolved evidence visibly.

Success should satisfy issue #52:

- Runtime overlay combines committed and runtime state without mutating `graph.json` for session/tracker/PAW telemetry.
- Bound session status and PAW workflow enrichment appear coherently where both are available.
- Missing, stale, ambiguous, unresolved, or unavailable runtime evidence degrades visibly rather than disappearing silently.
- The later `launch-and-tracking-gate` node can evaluate that launch/tracking is usable on the graph from this overlay.

Boundaries:

- In scope: composition/UI/data contract for the overlay; visible degradation/precedence behavior; tests around the composed overlay model and rendering; design-doc updates if behavior/data shape changes.
- Out of scope: reimplementing the prerequisite session status indicator (#50), reimplementing the PAW artifact parser/indexer (#51), follow-on PAW Review automation, CLI/daemon/plugin distribution workstream, or a second linkage store separate from registry `graphBinding`.

Use the builder's launch preferences while executing: PAW-lite process, final-PR-only review policy, non-interactive reviews, and continue autonomously until serious blockers. If issue amendments become necessary, pause and propose them rather than editing the issue directly. The final PR title should include `#52`, and the PR body should include a collapsible `<details>` section with `<summary>Docs.md</summary>` containing a completed Docs.md following the `paw-docs-guidance` template.

## Layer 2 - Relevant State

Issue #52 is open and ready. Its comment on 2026-05-06 says this node became ready after #50 and #51 completed; it is the next runtime-composition node before the Wave 4 gate, alongside sibling #47.

Current workstream state from `.streamliner/workstreams/session-launching-and-tracking/graph.json`:

- Workstream: `session-launching-and-tracking`, status `active`, attention `focus`.
- Selected node: `runtime-overlay-ui`, status `ready`, attention `watch`, depends on `graph-node-session-status-ui` and `paw-artifact-status-observation`.
- Upstream completed node `graph-node-session-status-ui` (#50): graph nodes already project non-manual registry rows with matching `graphBinding`, show highest-attention My Sessions status plus bound-session count, include loading/error/no-bound-session fallbacks, and link to workstream/node-scoped Sessions view.
- Upstream completed node `paw-artifact-status-observation` (#51): Streamliner persists explicit `pawLaunch` metadata for launched PAW sessions, derives coarse workflow enrichment only from exact PAW work-directory metadata or retained launch-claim lineage, avoids cwd-based `.paw/work/*` fallback discovery, and shows PAW workflow chips only for recognized Streamliner-launched PAW sessions.
- Related completed node `sessions-workstream-linkage-ui` (#48): My Sessions resolves `graphBinding` against tracked workstreams, shows workstream/node chips, supports Workstream grouping, deep-links to selected graph nodes, and keeps unbound/manual sessions first-class.
- Related completed node `session-event-observation` (#49): registry rows expose `activityEvidence` alongside compatibility `activityStatus`, covering status reason, confidence, diagnostics, pending input, turn-boundary timestamps/counts, process state, and bounded event-scan metadata.

Useful source entry points observed during launch context assembly:

- `src/graph-node-session-status.ts` - builds per-node summaries from registry sessions using `graphBinding`; filters manual rows; ranks `waiting_for_input` > `interrupted` > `working` > `exited`/`unknown`, with freshness tie-breakers.
- `src/App.tsx` - currently wires `useSessionRegistryList({ workstreamId })`, `buildGraphNodeSessionStatusMap`, `nodeSessionStatusState`, and `sessionRouteForNode` into the graph dashboard/graph rendering path.
- `src/session-registry-contract.ts` - `SessionRegistryListItem` fields available to UI consumers include `graphBinding`, `pawLaunch`, `activityStatus`, `activityEvidence`, `pawWorkflow`, trusted signal timestamps, derived branch/worktree/GitHub refs, and other list-surface state.
- `src/session-registry-schema.ts` - defines `activityStatus` values (`unknown`, `working`, `waiting_for_input`, `interrupted`, `exited`), PAW workflow statuses (`recognized`, `unavailable`, `unknown`), PAW stages (`init`, `planning`, `implementation`, `review`, `finalization`), PAW workflow kind (`paw`, `paw-lite`, `paw-review`, `unknown`), and PAW diagnostics.
- `src/session-registry/paw-artifact-indexer.test.ts` - good reference for artifact-derived `pawWorkflow` behavior and diagnostics.
- Existing tests likely relevant: `src/graph-node-session-status.test.ts`, `src/App.test.tsx`, `src/session-workstream-linkage.test.ts`, `src/session-registry-schema.test.ts`, server/API tests if the overlay needs backend contract changes.

Design state to preserve:

- `activityStatus`/`activityEvidence` explain liveness and attention (`working`, `waiting_for_input`, `interrupted`, `exited`, confidence/diagnostics/pending input).
- `pawWorkflow` explains durable workflow artifact evidence only; it must not drive liveness or infer active/idle state.
- `graphBinding` is the shared linkage contract between Sessions and the graph. Do not introduce a second UI-only linkage store.
- Registry/manual sessions without resolvable graph binding should remain visible in Sessions with degraded labeling; graph overlay should only project sessions bound to the selected workstream/node.
- `graph.json.updatedAt` changes only for intentional committed graph edits, not overlay telemetry/session pulses.

The launch manifest reported GitHub issue #52 as unavailable via an earlier `gh issue view` attempt, but this SDK session successfully read the issue and its comment through GitHub MCP. No actionable unavailable input remains from that diagnostic.

## Layer 3 - Coordination Context

This worker owns `runtime-overlay-ui` only. Sibling/upstream/downstream nodes are coordination background:

- Upstream #50 and #51 are completed and should be reused, not reimplemented.
- Sibling #47 `tracker-required-launch-policy` is ready and may affect launch preconditions/configuration, but it is not assigned to this worker. Avoid coupling runtime overlay implementation to unfinished #47 behavior except through stable existing contracts.
- Downstream #53 `launch-and-tracking-gate` depends on this node and #47. Leave the overlay with a clear enough data/UI contract that the gate can assert launch and tracking are usable on the graph.
- Closeout punch-list items in the brief (#55 resumable launch dialog, #56 terminal portability seam, prompt profile responsiveness) are parked polish, not this node's task unless a direct dependency emerges.

Repository/worktree launch expectations:

- Base coordination checkout at launch: `C:\Users\robemanuele\proj\streamliner\streamliner`, initial branch `main`.
- Work should run in a sibling worktree for the target branch; do not check out the target branch in the launch cwd.
- Target repository: `lossyrob/streamliner`.
- Selected graph path: `C:\Users\robemanuele\proj\streamliner\streamliner\.streamliner\workstreams\session-launching-and-tracking\graph.json`.
- Launch nonce: `57c095cc-36e8-4aab-9eb5-859632a52669`.

Validation expectations:

- Prefer focused model/unit tests for the overlay composition contract, then UI tests where rendering changes are visible.
- Because this task changes dashboard rendering, follow the repo's iterative UI workflow and verify with real graph data before finalizing.
- Run existing repo checks appropriate to the touched code (`npm test`, `npm run lint`, `npm run build` as applicable).

PAW/PR operating guidance for the worker:

- Use PAW-lite workflow behavior with final PR-only review gates.
- Planning review and final review should be non-interactive multi-model pre/post-mortem perspectives using `claude-opus-4.7` as requested by the builder.
- Continue without intermediate builder review unless a serious blocker appears.
- If tracker issue updates/amendments are needed, pause and propose amendments for discussion rather than applying them silently.
- Final PR title must include `#52`.
- Final PR description must include a collapsible `<details>` block with `<summary>Docs.md</summary>` and the completed Docs.md content following the `paw-docs-guidance` template.
