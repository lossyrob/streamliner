# Launch Context - PAW artifact status observation

## Layer 0 - Design Context Hints

Use the repo's design layer directly when you need design authority. Start from `docs/design/index.md` if the intended system or current decision set is unclear.

Possible starting points for this node:

- `docs/design/session-system.md` - session registry, activity evidence, launch metadata, and runtime overlay model. Relevant areas include derived UI fields, activity detection, orthogonal session/workflow state sources, watcher diagnostics, and PAW artifact status rendering.
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - accepted decision that PAW workflow status comes from durable PAW artifacts, not PAW `## Control State`.
- `docs/design/decisions/001-observation-based-session-tracking.md` - liveness and attention are derived from Copilot CLI session observation.
- `docs/design/decisions/004-session-registry-primary-surface.md` and `docs/design/decisions/005-session-registry-storage-and-identity.md` - the registry is the primary session surface and owns persisted session identity/storage.
- `docs/design/workstream-format.md` - committed workstream artifacts and local runtime state must remain separate.

The selected node spec is GitHub issue https://github.com/lossyrob/streamliner/issues/51.

## Layer 1 - Worker Mission

Implement **PAW artifact status observation** for Streamliner sessions. For PAW-backed sessions launched through Streamliner, and for manually tracked sessions that can be linked to PAW artifacts, Streamliner should inspect the PAW work directory and expose a coarse workflow-enrichment status derived from durable artifacts.

This worker owns the artifact-observation slice only. Keep these boundaries clear:

- PAW artifact status is workflow enrichment: what durable PAW artifacts exist and what coarse stage they imply.
- Copilot session observation remains authoritative for liveness and attention: launching, active work, idle/waiting, needs input, interrupted, clean exits, ended state, confidence, and related diagnostics.
- `WorkflowContext.md` and `ReviewContext.md` may be useful artifacts for identity, workflow kind, headings, or timestamps, but their `## Control State` sections are not authoritative and must not drive status.
- Runtime overlay composition and final graph rendering are downstream work owned by `runtime-overlay-ui`; this node should provide the data surface and semantics those consumers need.

Issue #51 success criteria:

- PAW-backed sessions can expose coarse workflow progress from artifacts when artifacts are available.
- Sessions without PAW artifacts degrade visibly rather than pretending to have workflow status.
- Liveness and attention still come from Copilot session observation.
- Runtime overlay consumers can distinguish PAW workflow enrichment from general session state.

Expected exports:

- A coarse PAW workflow status suitable for My Sessions and graph runtime overlay enrichment.
- Clear degraded/unknown states for sessions without PAW artifacts, with unreadable work directories, or with incomplete/ambiguous artifact sets.
- Documentation of the artifact signals used for status derivation.

Expect to update `docs/design/session-system.md` if you define artifact categories, derived statuses, diagnostics, or degraded-state semantics beyond what is already documented.

## Layer 2 - Relevant State

Wave 4 is adding runtime visibility on top of the completed launch/session substrate. The relevant completed foundation is:

- Wave 2 shipped the local-first session registry and Sessions surface. Registry rows are graph-independent, persisted under local runtime state, and can be created manually, observed from Copilot CLI sessions, or launched from graph nodes.
- Wave 3 shipped PAW graph launch: Streamliner assembles `streamliner/context.md`, runs PAW init in an SDK preparation session, creates launch claims, starts a visible Copilot CLI worker, and binds the resulting session back to the graph through `graphBinding` on the registry row.
- `session-event-observation` is complete via PR #54 / issue #49. Registry rows expose compatibility `activityStatus` plus detailed `activityEvidence` from bounded Copilot `events.jsonl` observation and trusted hook/process evidence.
- `sessions-workstream-linkage-ui` is complete via PR #46 / issue #48. `graphBinding` connects Sessions rows to workstreams/nodes and is the shared linkage contract for graph projections.

Current implementation seams to inspect first:

- `src/session-registry-schema.ts` defines registry enum/type contracts. `SessionRegistryActivityEvidence` currently covers liveness/attention diagnostics; a PAW workflow enrichment field should remain separate from those fields.
- `src/session-registry-contract.ts` defines `SessionRegistryListItem`, the registry API/UI list shape. Thread any PAW workflow enrichment through this contract deliberately so UI and overlay consumers can distinguish it from `activityStatus` and `activityEvidence`.
- `src/session-registry/background-worker.ts` runs each observation cycle. It discovers Copilot sessions, reconciles launch claims, indexes session activity, indexes session context, and refreshes summaries. A PAW artifact scan likely belongs here or in a sibling indexer invoked from here.
- `src/session-registry/session-activity-indexer.ts` is the existing bounded `events.jsonl` liveness/attention indexer. Reuse its diagnostics style where helpful, but do not mix PAW workflow inference into liveness fields.
- `src/session-registry/file-store.ts` owns persisted registry rows, validation, patch/upsert behavior, and derived-state patches. Adding a persisted or derived PAW workflow field likely requires schema validation, defaulting, migration/backward compatibility, and tests here.
- `src/server/routes/sessions.ts` and `src/session-registry/http-api.ts` expose registry data to the UI. Preserve loopback/trust and existing compatibility behavior.
- `src/server/launch-preparation.ts`, `src/server/node-launch.ts`, `src/server/node-launch-record-store.ts`, and launch-claim code are useful for finding PAW work directory metadata already produced by Streamliner launches.
- UI consumers may live in `src/components/SessionsPage.tsx`, `src/components/session/*`, `src/components/NodeInspector.tsx`, and graph overlay/view-model code. Final graph overlay composition is downstream; add only the UI/API affordances needed to make the data visible or testable for this node.

Design target from `docs/design/session-system.md` and Decision 008:

- `pawWorkflow` should be an artifact-derived workflow summary when a PAW work directory is present. It should include discoverable work id/title, likely workflow kind, latest/coarsest stage implied by artifacts, artifact freshness, and ambiguity/unavailable diagnostics as appropriate.
- PAW diagnostics should cover cases like unavailable work directory, ambiguous artifact set, and unknown artifact layout. Do not invent workflow progress for unavailable or unsupported artifact sets.
- Overlay consumers need to distinguish recognized artifact sets, ambiguous artifact sets, and unavailable artifact paths.
- Mutation-affecting affordances must not depend only on artifact-derived status until artifact patterns and confidence thresholds are explicitly defined.

A reasonable implementation shape is to add a dedicated PAW artifact indexer/scanner with tests, then thread its output through the registry record/list/API surfaces. Keep artifact inspection bounded and transparent: prefer filenames, known artifact paths, frontmatter/headings when necessary, mtime/freshness, and diagnostics over deep semantic parsing.

Likely artifact categories to evaluate against actual PAW conventions before coding include:

- Initialization/context: `.paw/work/<work-id>/WorkflowContext.md`, `streamliner/context.md`.
- Specification/research/planning: `Spec.md`, `CodeResearch.md`, `ImplementationPlan.md`, `PlanReview.md`, planning-docs review artifacts, and related PAW stage files if present.
- Implementation progress: phase artifacts or phase-marked files/directories produced by PAW implementation.
- Review/finalization: implementation review, final review, PR/final PR artifacts, and any durable PR link/status artifact.

Do not treat that list as exhaustive or authoritative until verified in the repo/PAW artifacts; it is a starting hypothesis from the node spec and design decision.

## Layer 3 - Coordination Context

Direct upstream dependency:

- `session-event-observation` is completed. It provides graph-independent `activityEvidence` and `activityStatus` for session liveness/attention. Preserve these semantics and avoid conflating workflow progress with active/idle/needs-input state.

Parallel or adjacent Wave 4 work:

- `graph-node-session-status-ui` is ready and depends on session event observation plus sessions/workstream linkage. It renders bound session status on graph nodes using the My Sessions pulse/pill language. If this node changes session list shapes, keep the contract clear so graph node status can continue to consume liveness separately from PAW workflow enrichment.
- `runtime-overlay-ui` depends on this node and `graph-node-session-status-ui`. It will compose committed graph status, bound Copilot session status, tracker state, and PAW artifact status without writing telemetry into `graph.json`. Provide a clean data model and degraded-state semantics for it.
- `launch-and-tracking-gate` depends on the runtime overlay. This node contributes the PAW workflow-status substrate needed for that gate.

Workstream constraints that directly affect this node:

- Keep session runtime data, tracker snapshots, launch claims, and artifact scan projections in local runtime/session registry state; do not commit telemetry back into `.streamliner/workstreams/session-launching-and-tracking/graph.json`.
- The session registry remains the primary surface. A graph overlay is a projection of registry rows with `graphBinding`, not a separate status store.
- The MVP is PAW-backed graph launch, but manual/legacy sessions may exist without PAW artifacts. They should show unknown/unavailable workflow enrichment rather than false progress.
