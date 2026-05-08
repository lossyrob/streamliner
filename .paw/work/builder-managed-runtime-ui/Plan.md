# Builder Managed Runtime UI Plan

## Problem and approach

Issue #74 needs the dashboard to expose SDK-managed graph-node execution without disrupting the existing terminal-first PAW launch path. The accepted contract keeps the session registry as the canonical surface, separates managed lifecycle from PAW artifact status, and restricts browser progress to a redacted, bounded projection. The backend substrate for actual SDK ownership is a sibling node, so this implementation will add typed UI seams and honest placeholders where backend actions are not yet available.

The implementation will extend the current PAW launch dialog, node inspector, graph overlay, and My Sessions surfaces to recognize two runtime modes:

- `terminal-cli`: the current visible Copilot CLI path after PAW init, left as the safe default.
- `managed-sdk`: a builder-selected Streamliner-owned SDK worker mode with explicit `managed-autonomous` posture, sanitized progress, lifecycle identity, and disabled takeover/cleanup affordance placeholders.

No design amendment appears necessary from the initial review. The UI can follow the accepted field concepts while keeping final API wiring narrow and typed for later substrate reconciliation.

The canonical managed lifecycle vocabulary for this UI node is the accepted runtime contract: `preparing`, `starting`, `running`, `idle`, `waiting_for_builder`, `interrupt_requested`, `interrupted`, `canceled`, `failed`, `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaning_up`, `cleaned_up`, and `terminal_takeover`. These values are distinct from PAW workflow status and graph committed status.

## Work items

1. Define managed runtime UI contract types for runtime kind, runtime owner, permission profile, lifecycle state, progress events, links, and action placeholders. Use literal/union types rather than free strings: `runtimeKind: "terminal-cli" | "managed-sdk"`, `runtimeOwner: "terminal" | "streamliner-sdk"`, and `permissionProfile: "managed-autonomous"` for this first managed profile.
2. Split contract additions by surface: `NodeLaunchRecord`/launch operation projections may carry launch-time `runtimeKind` and `permissionProfile`; session registry list/projection fields may carry managed SDK metadata, lifecycle state, sanitized progress, PR/blocker/error summaries, and action availability. Do not add a new registry identity, alternate primary key, or SDK-session-keyed store; SDK session id, SDK workspace path, and SDK state root remain metadata on the Streamliner-owned registry row/projection.
3. Define the safe progress event shape used by the UI as a projection-only contract, for example timestamp, lifecycle/phase label, short summary, optional safe kind/status, and optional safe links/counters. Treat server/runtime projection as the redaction boundary; React components only render already-sanitized data. UI lists must be bounded, with tests asserting cap behavior and that raw prompt/tool-output-like fields are ignored.
4. Add runtime selection to the PAW launch dialog so builders can clearly choose terminal-first or managed SDK execution. Keep terminal-first visually distinct and available. Display `managed-autonomous` as informational consent copy tied to the managed SDK option, not as a per-tool approval choice.
5. Add a typed managed-launch client path that preserves terminal-first behavior. The `managed-sdk` option remains selectable; if the backend managed endpoint is missing or returns not-implemented, the dialog shows an inline typed "Managed runtime not yet available on this build" error and does not create a registry row or silently fall back to terminal launch.
6. Render managed SDK sessions in My Sessions with runtime identity, lifecycle state, SDK metadata, PR/blocker/error summaries, sanitized progress preview, and takeover/cleanup placeholders. Placeholders should be rendered visibly disabled with explanatory copy such as "Available in a future update" rather than hidden or no-op.
7. Enhance graph/node overlays and the inspector to project managed lifecycle, PR-ready/completed/blocker/failure states, runtime identity, permission posture, and terminal-like sanitized progress without raw SDK content. Use the managed lifecycle enum from this plan and never infer graph promotion from managed lifecycle alone.
8. Update targeted tests for managed runtime projection and UI rendering, run repository validation, and capture before/after dashboard screenshots against a representative workstream graph. Required screenshot states: launch dialog with both runtime options, managed SDK unavailable result, My Sessions managed runtime row/detail with disabled takeover/cleanup affordances, node inspector managed runtime view, and graph overlay managed lifecycle badges.

## Notes and considerations

- Managed lifecycle is not PAW workflow status; graph overlays should not treat `pr_ready`, `review_ready`, or `completed` as committed graph promotion.
- SDK ids, workspace paths, and state roots are metadata. The registry row id remains canonical.
- Progress rendering must stay read-only and must not display raw prompts, reasoning, tool arguments/results, terminal stdout/stderr, hook payloads, secrets, tokens, provider telemetry, or arbitrary unreviewed event payloads.
- Terminal takeover and cleanup buttons are affordances only in this node; the follow-on node owns backend behavior.
- If the sibling substrate lands before PR close, reconcile endpoint and field names before final review. If it does not, keep the placeholders explicit and typed.
