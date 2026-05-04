# Terminal Launch Integration Plan

## Approach Summary

Wire the existing PAW launch preparation handoff into an API-first terminal launch path without rerunning context assembly or PAW init. The final launch step will consume the prepared `PawLaunchHandoff`, reject duplicate launches when a non-terminal or bound claim already exists for the same workstream node, create a launch claim before terminal spawn, preserve the prepared launch nonce when creating the claim, augment the actual Copilot kickoff prompt with exactly one canonical `kickoffNonceLine(claim.launchNonce)`, pass `STREAMLINER_LAUNCH_CLAIM_ID` through the spawned process environment, and use the shared terminal spawning path to start visible Copilot CLI interactive mode.

The graph UI will remain preparation-aware so the builder can inspect/edit `WorkflowContext.md` after PAW init, but it will add a terminal-launch action that calls the same backend service future CLI/skill/MCP callers can use. Node launch records will be augmented from launch-claim diagnostics so active pending/bound launches gate duplicate graph launches in the UI while failed terminal attempts remain visible and retryable. Sessions grouping/linkage UI remains out of scope.

## Work Items

- [x] Backend launch service and route (`backend-launch-service`): Add a prepared-handoff terminal launch service and `/api` route that validates the handoff, rejects duplicate active/bound launches with a typed error, creates the launch claim, launches Copilot CLI, returns structured claim/terminal results, logs launch failures, and marks claims failed on terminal-spawn errors.
- [x] Terminal environment and command support (`terminal-env-command`): Extend `src/server/terminal-launch.ts` to merge launch-specific environment values into spawned terminals, preserve PATH sanitization, propagate prepared terminal preference through the handoff if needed, and safely construct the Copilot CLI interactive command for multiline prompts and CLI args.
- [x] Launch lifecycle state seam (`launch-state-seam`): Expose latest launch-claim state through `node-launch-records` so UI can distinguish prepared-only, binding-pending, bound, and failed attempts without adding a second launch telemetry store.
- [x] Graph UI terminal launch flow (`graph-ui-flow`): Update the launch dialog and inspector so a prepared handoff can start the visible terminal, display claim/terminal outcome, and disable/replace duplicate launch actions for active pending or bound claims.
- [x] Coverage and docs (`coverage-docs`): Add targeted Vitest coverage for the service/route/terminal/UI behavior and update `docs/design/session-system.md` to reflect the implemented terminal launch contract.

## Key Decisions

- The launch nonce comes from the preparation handoff (`handoff.launchMetadata.launchNonce`) when present; that same nonce is supplied to `createLaunchClaim`. If a defensive fallback is ever needed for a nonce-less handoff, the claim-created nonce becomes the final prompt nonce, but the normal graph path preserves the single nonce minted by the UI before preparation.
- The claim is created before terminal spawn so the reserved registry row and binding window exist before Copilot CLI can emit hook signals or create observable session state.
- Duplicate launch gating is enforced in the backend launch service before claim creation by checking current launch-claim state for the workstream node. The UI uses the same state as an affordance, but non-UI callers receive the same typed rejection.
- The prepared kickoff prompt currently carries descriptive launch metadata such as `- Launch nonce: ...`; the terminal launch service owns the canonical Tier 1 line. It appends `kickoffNonceLine(claim.launchNonce)` idempotently only when that exact canonical line is absent, avoiding duplicate canonical nonce markers.
- `STREAMLINER_LAUNCH_CLAIM_ID` is added to the spawned terminal process environment through the shared terminal launcher, not by shell string interpolation, so the Copilot plugin hook can forward Tier 2 trusted claim evidence on `session.started`. Handoff env values win over inherited env except PATH remains sanitized against repo-local `node_modules/.bin`.
- Terminal-spawn failure after claim creation is not success-shaped: the service transitions the claim through `markClaimFailed(..., "terminal-spawn-failed", ...)` and returns a typed launch failure.
- Existing preparation records remain preparation metadata; active launch state is sourced from the launch-claim store and registry rows, with node launch records only acting as the graph/node lookup seam.

## Open Questions

None.
