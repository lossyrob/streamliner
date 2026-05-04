# Launch Context - Terminal launch integration

## Layer 0 - Design Context Hints

Use the repo's design docs directly as the design authority. If you are unsure where to start, begin at `docs/design/index.md` and navigate from there rather than treating this context as exhaustive.

Possible starting points for this node:

- `docs/design/session-system.md` - launch preparation, kickoff prompt, terminal launch handoff, launch claims, trusted hook binding, registry binding, and graph overlay separation.
- `docs/design/decisions/001-observation-based-session-tracking.md` - why launch binding depends on observed Copilot session state plus prompt-nonce/trusted-hook evidence.
- `docs/design/decisions/004-session-registry-primary-surface.md` and `docs/design/decisions/005-session-registry-storage-and-identity.md` - launched sessions must flow through the local session registry rather than a parallel launch telemetry store.
- `docs/design/decisions/002-file-based-context-delivery.md` - worker context is installed under the PAW work directory as `streamliner/context.md` after PAW init.
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - PAW workflow progress is later overlay enrichment from artifacts, not a Wave 3 launch blocker.

Workstream source files worth checking for current scope and dependencies:

- `.streamliner/workstreams/session-launching-and-tracking/brief.md`
- `.streamliner/workstreams/session-launching-and-tracking/graph.json`
- Tracker spec: https://github.com/lossyrob/streamliner/issues/44

## Layer 1 - Worker Mission

Your assignment is exactly the `terminal-launch-integration` node: close Wave 3 by wiring Streamliner's completed PAW launch preparation, launch-claim binding, and terminal spawning pieces into one API-callable graph launch action that starts a visible Copilot CLI worker session.

The intended outcome is that a ready graph node can proceed beyond PAW preparation and open a visible Copilot CLI interactive session using the prepared handoff: `cwd`, branch, PAW work directory, `WorkflowContext.md`, installed `streamliner/context.md`, kickoff prompt, CLI args, environment, session-state root, launch metadata, and context-package metadata. Do not rerun context assembly or PAW init in this final launch step; consume the handoff produced by the existing preparation flow.

Key responsibilities for this node:

- Add or update a graph-launch service/API path that performs the final launch step after PAW launch preparation succeeds.
- Create/use a launch claim before or as part of terminal startup, preserving the same launch nonce across preparation, claim creation, and the final prompt sent to Copilot.
- Ensure the Copilot kickoff prompt includes the Tier 1 launch nonce in the canonical prompt-nonce form expected by the launch-claim binding scanner.
- Pass `STREAMLINER_LAUNCH_CLAIM_ID` into the spawned Copilot CLI process environment for Tier 2 trusted-hook binding.
- Start the visible Copilot CLI worker through the existing lower-level terminal spawning path where practical, rather than creating a second terminal launcher.
- If terminal spawning fails, surface a real launch failure and transition the launch claim through the claim-failure path; do not leave success-shaped fallbacks or silent pending claims.
- Keep the launch path API-first so the graph UI is just the first caller; future CLI/skill/MCP wrappers should be able to call the same product pipeline.

Boundaries from issue #44: context package assembly, PAW launch dialog/prompt profiles/SDK `paw-init`/WorkflowContext review, and launch-claim store/binding internals are already owned by upstream nodes. Sessions grouping/linking UI, graph-node status pills, PAW artifact status parsing, and future distribution CLI/daemon work are downstream or separate work.

## Layer 2 - Relevant State

Wave 3 is a PAW-only MVP launch-from-graph flow. Three upstream nodes are complete and should be treated as existing inputs:

- `backend-context-assembly` / issue #31: selected ready graph nodes can produce worker-facing Streamliner context packages and source metadata before a PAW work directory exists. The launch path later places/references the generated context from the PAW work directory.
- `launch-prompt-profiles` / issue #33 / PR #41: the graph launch dialog and backend preparation route collect PAW workflow instructions, prompt-profile snippets, CLI args, and terminal preferences; run a fully capable SDK PAW init session; install `.paw/work/<work-id>/streamliner/context.md`; expose bounded `WorkflowContext.md` review/editing; and return a structured terminal handoff without starting the visible worker.
- `launch-claim-binding` / issue #32 / PR #42: the launch-claim subsystem exists, including local claim store, reserved registry rows, `createLaunchClaim`, `markClaimFailed`, prompt nonce binding, trusted-hook binding through `STREAMLINER_LAUNCH_CLAIM_ID`, claim sweep/diagnostics, read-only claim APIs, and `graphBinding` on registry rows.

Implementation starting points observed in the repo:

- `src/server/launch-preparation.ts` defines `PawLaunchHandoff` and `preparePawLaunch`. The returned handoff includes `cwd`, `branch`, `pawWorkDir`, `workflowContextPath`, `streamlinerContextPath`, `kickoffPrompt`, `cliArgs`, `environment`, `sessionStateRoot`, `launchMetadata`, and `contextPackage`.
- `src/server/routes/launch-preparations.ts` exposes `POST /api/launch-preparations` and async `POST /api/launch-preparations/runs` plus event streaming. The current UI uses the async run endpoint.
- `src/App.tsx` currently starts launch preparation from the graph dialog and stores/displays the handoff; this is where the graph UI still stops short of terminal launch.
- `src/session-registry/launch-claims.ts` exports `kickoffNonceLine`, `createLaunchClaim`, and `markClaimFailed`. Use these contracts instead of duplicating claim lifecycle logic.
- `src/launch-claim-schema.ts` defines failure code `terminal-spawn-failed` and claim statuses including `pending`, `bound`, and `failed`.
- `src/session-registry/launch-claim-binding.ts` scans early Copilot `user.message` events for the launch nonce and also recognizes trusted-signal claim-id evidence. This is the binding behavior your prompt/environment must feed.
- `src/server/terminal-launch.ts` is the shared lower-level terminal launcher. It opens Windows Terminal when available, falls back to PowerShell, detaches spawned processes, and sanitizes inherited `PATH` so spawned shells use the globally installed Copilot CLI/plugin instead of the repo-local package binary.
- `src/session-registry/relaunch.ts` is the existing session relaunch service that builds terminal options and catches `spawn_failed`. Reuse the lower-level terminal launcher behavior where practical, but graph launch is a new Copilot interactive start, not a `copilot --resume` path.
- `src/server/app.ts` currently mounts launch preparation routes, launch-claim diagnostic routes when a claim store is supplied, and session routes. The final launch API should fit this routing/app composition without requiring a second server process.
- Existing tests to inspect or extend include `src/server/launch-preparation.test.ts`, `src/server/terminal-launch.test.ts`, `src/session-registry/launch-claims.test.ts`, `src/session-registry/launch-claim-binding*.test.ts`, `src/server/app*.test.ts`, and relevant UI tests in `src/App.test.tsx` if the graph dialog flow changes.

The current kickoff prompt from preparation includes launch identity and a launch nonce field, but issue #44 explicitly requires the final launched prompt to support the Tier 1 nonce scanner. Confirm whether the existing prompt includes the canonical line from `kickoffNonceLine(nonce)`; if not, wrap or augment the final prompt after claim creation so the actual Copilot `user.message` contains the expected nonce token/line while preserving the prepared instructions and context paths.

For command construction, preserve the prepared CLI args and environment values. The design describes a conceptual launch equivalent to `copilot <cli-args> -i "<kickoff prompt>" .`; follow the repository's actual Copilot CLI invocation conventions and quote/escape carefully for PowerShell/Windows Terminal paths and multiline prompt text.

## Layer 3 - Coordination Context

This node directly depends on the completed Wave 3 upstream nodes:

- `backend-context-assembly` (`completed`) - provides context package input and metadata.
- `launch-prompt-profiles` (`completed`) - provides the PAW launch preparation UI/backend handoff and default PAW workflow/CLI/terminal configuration.
- `launch-claim-binding` (`completed`) - provides the launch-claim lifecycle and binding contracts this node must consume.

This node closes the `launch-from-graph` checkpoint. Downstream Wave 4 nodes assume graph-launched sessions create/bind registry rows with `graphBinding` metadata:

- `sessions-workstream-linkage-ui` will group/filter My Sessions entries by workstream and node using bound registry rows.
- `auto-paw-review-launch` later needs the same API-first launch seam for separate review sessions, but this node should not implement follow-on review automation.
- `graph-node-session-status-ui`, `paw-artifact-status-observation`, and `runtime-overlay-ui` are downstream overlay/status work; do not block terminal launch on their UI behavior.

Issue #44 asks the worker to briefly confirm the launch sequencing choice before implementation. In this autonomous launch context, satisfy that by recording the sequencing explicitly in your plan/back-brief or PR notes: where the shared nonce comes from, when the claim is created relative to terminal spawn, how the prompt is augmented for Tier 1 binding, and where `STREAMLINER_LAUNCH_CLAIM_ID` is added to the spawned environment.
