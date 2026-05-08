# Managed Execution Substrate Plan

## Problem and approach

Implement the backend/API substrate for builder-selected `managed-sdk` graph-node launches while preserving existing terminal-first behavior. The implementation will reuse the launched-row and launch-claim path as the canonical registry identity, add durable managed runtime/progress metadata, start a Streamliner-owned SDK worker under the explicit `managed-autonomous` permission posture, expose managed interruption/evidence seams, and cover the new path with focused contract, store, launch, projection, and terminal-regression tests.

No separate Spec.md or CodeResearch.md exists in this PAW-lite run. This plan therefore carries the required acceptance details directly: state machine, progress allowlist, launch/claim behavior, read surfaces, and tests.

## Work items

1. **Contracts, registry schema, and managed lifecycle state**
   - Extend `SessionRegistryRecord` and related schemas/types in `src/session-registry-contract.ts`, `src/session-registry-schema.ts`, `src/session-registry/file-store.ts`, and registry HTTP/list surfaces with optional additive runtime metadata. Existing entries without runtime metadata remain valid and default to terminal-compatible behavior at read/projection time.
   - Keep Streamliner registry IDs as primary identity. `sdkSessionId`, `copilotSessionId`, workspace paths, launch nonce, and launch claim IDs are nullable metadata and never replace the registry ID.
   - Record `runtimeKind: "managed-sdk"` and `runtimeOwner: "streamliner-sdk"` for managed workers. Terminal rows may expose `runtimeKind: "terminal-cli"` as a compatibility default, but the implementation should not retrofit unrelated terminal behavior beyond preserving existing semantics.
   - Define and persist the managed lifecycle state set exactly as: `preparing`, `starting`, `running`, `idle`, `waiting_for_builder`, `interrupt_requested`, `interrupted`, `canceled`, `failed`, `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaning_up`, `cleaned_up`, `terminal_takeover`.
   - Model transitions with explicit producers:
     - Runtime-driven: `preparing` when the row/claim is reserved; `starting` when SDK start begins; `running` while a turn/tool is active; `idle` when SDK is alive with no active turn; `failed` on typed startup/runtime failure.
     - Builder/action-driven: `interrupt_requested`, `canceled`, `terminal_takeover`, `cleaning_up`.
     - Evidence-driven: `interrupted`, `waiting_for_builder`, `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaned_up`.
   - Distinguish `idle` from `waiting_for_builder`: `idle` means SDK control remains healthy and no turn is active; `waiting_for_builder` means the managed runtime cannot safely continue without human action or inconclusive interruption evidence.

2. **Managed runtime progress store and read projection**
   - Add one sanitation chokepoint for managed progress writes before persistence/projection. All SDK, hook, route, and evidence inputs must pass through this helper rather than writing raw runtime payloads.
   - Allow only these browser progress classes: lifecycle change, short redacted assistant status, tool start/finish metadata, permission decision metadata, MCP/skill status, PR/review/completion/cleanup evidence, terminal-takeover evidence, typed error summary, and optional usage counters.
   - Exclude raw prompts, assistant reasoning, tool args/results, terminal output, hook payload bodies, secrets, tokens, credentials, and provider telemetry. Redaction tests must include hook-derived payloads and representative tool args/results.
   - Bound retained progress history to a small fixed event count and bounded string lengths so registry rows remain durable and browser-safe.
   - Extend existing session/registry and graph-node read surfaces rather than writing runtime state to `graph.json`. Graph projection should prefer the most recent non-manual row bound to the selected workstream/node and preserve terminal takeover as an ownership-transfer state rather than resuming SDK ownership.

3. **Managed SDK launch runner and API integration**
   - Extend `POST /api/node-launches` request parsing to accept an explicit builder-selected runtime (`terminal-cli` default, `managed-sdk` opt-in). Leaving the runtime unspecified must follow the existing terminal-first path.
   - Extract or introduce a shared launch-claim reservation helper so terminal and managed launches both use the same duplicate active-claim protection, graph binding, launch nonce/claim lineage, and canonical launched-row reservation before worker execution.
   - For `terminal-cli`, keep the current `launchPreparedNode` behavior: command construction, `STREAMLINER_LAUNCH_CLAIM_ID`, terminal host selection, operation state, and launch-claim binding remain compatible.
   - For `managed-sdk`, start a Streamliner-owned SDK runner without spawning a visible terminal. The runner receives the reserved registry ID/claim ID directly, runs with the selected node worktree as `cwd`, propagates launch metadata through environment/config where hooks can corroborate it, records SDK workspace/session facts, and updates lifecycle/progress through the managed runtime writer.
   - Implement `managed-autonomous` as both recorded metadata and an enforced SDK permission posture. The SDK permission/approval callback or SDK configuration must auto-allow model-requested tool execution for this managed run and tests must prove no per-tool approval prompt path is invoked.
   - Treat managed and terminal launches as mutually exclusive for a node while an active launch claim or managed lifecycle state is active. Retried managed launches must fail or coalesce deterministically rather than creating duplicate rows.

4. **Interruption, cancellation, and evidence seams**
   - Add minimal backend helpers/routes for managed interruption and cancellation. Interruption flow: `interrupt_requested` -> SDK abort -> `interrupted` when abort/idle evidence is observed, `waiting_for_builder` when evidence is inconclusive, or `failed` for typed abort/runtime errors. Cancellation records `canceled` for builder-requested stop paths that should not resume SDK ownership.
   - Add idempotent evidence ingestion helpers for `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaned_up`, and `terminal_takeover`. Evidence should link to registry ID, launch claim, graph binding, and safe references such as PR URL/number or commit SHA, not raw model/tool output.
   - Detect PR/completion evidence from allowlisted SDK events and/or trusted Streamliner hook signals, with optional post-run repository/PR inspection where needed. Hook signals may corroborate but are not the only trust/admission path while Streamliner owns the SDK session.
   - Keep terminal takeover and cleanup in scope only as recorded lifecycle/evidence seams. Do not implement terminal takeover UX, visible resume orchestration, or cleanup-after-merge actions in this node.

5. **Tests and implementation docs**
   - Add contract/schema and file-store round-trip tests for managed runtime metadata, legacy entries with no runtime metadata, progress retention, and redaction.
   - Add launch/API tests proving default terminal-first behavior is unchanged and explicit `managed-sdk` launch reserves one canonical row, records `managed-autonomous`, starts the managed runner path, and blocks duplicate active launches.
   - Add graph/session projection tests for managed states, terminal takeover state, and no duplicate observed row when trusted signals/discovery corroborate an SDK-managed session.
   - Add interruption/evidence tests for `interrupt_requested` -> `interrupted`/`waiting_for_builder`/`failed`, `canceled`, and idempotent PR/review/completion evidence transitions.
   - Update implementation-facing docs only if the new code introduces a consumer-facing API shape not already represented in the accepted design. Do not update design docs merely to record exact helper or field names.

## Acceptance criteria

- An explicit `managed-sdk` node launch reserves a single canonical launched registry row before SDK execution and records `graphBinding`, launch claim/nonce lineage, runtime kind/owner, SDK identity/workspace facts, and `managed-autonomous`.
- Managed SDK tool execution is configured to proceed without per-tool builder prompts.
- Managed lifecycle supports all required states and state transitions are written through Streamliner-owned runtime/API paths.
- Browser-facing progress is allowlisted, redacted, bounded, and survives refresh/reconnect through durable registry/runtime projection.
- PR/review/completion evidence can be detected and linked back to the managed session and selected graph node without promoting graph state.
- Existing terminal-first launch behavior remains the default and keeps existing launch claims, terminal command construction, and operation polling behavior intact.

## Key decisions and constraints

- The first managed worker records `managed-autonomous`; node launch is the consent boundary and must not introduce per-tool builder prompts.
- Managed SDK workers are visible first-class node sessions, not hidden launch-prep helpers and not duplicate filesystem-observed rows.
- Launch/preparation artifacts and PAW workflow status stay separate from managed runtime lifecycle/progress state.
- Unsupported downstream UX such as full terminal takeover and deterministic cleanup-after-merge should get substrate seams only, not complete workflows.
- The existing terminal-first path remains the default and must continue to pass compatibility tests.
