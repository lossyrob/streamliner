# Tracker Required Launch Policy Plan

## Problem and approach

Issue #47 asks Streamliner to optionally block graph node launches unless the selected node is backed by a tracker issue, with GitHub issues as the first supported tracker requirement. The policy must be durable project/workstream configuration, default off for existing graphs, enforced before PAW launch preparation and terminal launch side effects, and visible in the graph launch UI.

I will add a small top-level `launchPolicy` shape to `graph.json`/`WorkstreamDocument`, evaluate it through a shared launch-policy helper, enforce it in both `preparePawLaunch` and `launchPreparedNode`, and surface the same guidance in the inspector/dialog error path. The `session-launching-and-tracking` workstream graph will opt into the GitHub issue requirement because this workstream is the dogfooding case that motivated the issue.

## Work items

1. Schema and policy model
   - Add an extensible launch-policy type to `src/workstream-schema.ts`.
   - Parse optional `workstream.launchPolicy` in `src/workstream-view-model.ts` with absent config preserving current behavior: existing graphs without `launchPolicy` parse cleanly, need no migration, and allow launches exactly as before.
   - Reject malformed or unknown `requiredTracker` values during graph parsing rather than silently ignoring them. The first supported value is `github-issue`; this keeps forward-compat decisions explicit and avoids fail-open policy behavior.
   - Add a shared policy evaluator that recognizes `requiredTracker: "github-issue"` and treats only `node.tracker?.type === "github"` with a positive owner/repo/number issue reference as satisfying it. Missing trackers and `local` trackers do not satisfy the GitHub issue requirement.
   - Update `docs/design/workstream-format.md` for the new graph field and `docs/design/session-system.md` for the launch precondition/failure-mode contract.
   - Update the active `session-launching-and-tracking` workstream graph only after auditing nodes to confirm the opt-in will not unexpectedly block currently launchable dogfood work.

2. Backend enforcement
   - Enforce the policy in PAW preparation before context assembly or PAW init begins.
   - Enforce the policy in terminal launch before duplicate-claim checks, launch-claim creation, or terminal spawn.
   - Re-read and evaluate the current graph at `launchMetadata.graphPath` during terminal launch so stale prepared handoffs cannot bypass a policy that changed after preparation or a node tracker that was removed after preparation.
   - Return typed errors with a stable code, policy name, node id, and clear remediation guidance. The human message should tell the builder to create/promote a GitHub issue for the node or edit the workstream `launchPolicy` if untracked launches are intentional.
   - Log policy rejections in the local API path at an appropriate non-error level for diagnosis without creating launch claims.
   - Add tests for default allowed behavior, schema parsing/defaults, malformed policy rejection, policy-blocked untracked/local-tracker nodes, allowed GitHub-tracked nodes, route-level error bodies, no claim creation on blocked terminal launch, and stale-handoff re-check behavior.

3. UI blocked state
   - Add the policy check to the graph launch readiness computation.
   - Disable the launch action in the inspector when the selected ready node fails the configured launch policy.
   - Show clear inspector guidance that a GitHub issue must be created/promoted, or that the workstream `launchPolicy` in `graph.json` should be edited/removed if untracked launches are intentional. Do not imply there is an in-app toggle or per-launch override.
   - Keep `PawLaunchDialog` messaging consistent for already-prepared launches: if the inspector can still open because a prior launch record exists, terminal launch errors should show the same remediation guidance from the backend.
   - Preserve the existing launch path for nodes that already have GitHub issue trackers.
   - Add App tests for the blocked state and run the iterative UI screenshot loop.

4. Validation, review, and PR
   - Run focused tests while iterating, then project validation (`npm test -- --run`, lint/build as appropriate).
   - Complete the configured final multi-model review after implementation.
   - Create the final PR via `paw-pr`; include `#47` in the title and a collapsible `<details><summary>Docs.md</summary>` section in the PR description.

## Notes and considerations

- The top-level graph config is durable workstream/project-scoped state; local runtime state is not appropriate for this policy.
- Default/unconfigured graphs must continue to allow untracked or local-spec launches.
- Node launch consumes a prepared handoff, so it must re-check the graph policy by `launchMetadata.graphPath` to prevent bypassing the UI or PAW preparation path.
- Backend policy failures should happen before stateful side effects; terminal launch should not create a claim when blocked.
- UI changes touch rendered React surfaces, so the iterative UI screenshot workflow applies.
- Out of scope remains unchanged: no automatic issue creation, no next-wave promotion workflow, no global GitHub Issues requirement, and no non-GitHub tracker implementation beyond an explicit policy shape that can evolve later.

## Success criteria

- Unconfigured workstreams continue to allow launching ready nodes with no tracker or a local tracker.
- A workstream with `launchPolicy.requiredTracker: "github-issue"` blocks launch preparation for a ready node without a GitHub issue tracker before context assembly or PAW init runs.
- The same policy blocks terminal launch from a prepared handoff before duplicate-claim lookup, launch-claim creation, or terminal spawn; no launch claim or registry row is created on the blocked path.
- A stale prepared handoff is rejected if the graph policy or selected-node tracker changed after preparation.
- A node with a valid GitHub issue tracker continues through the existing PAW preparation and terminal launch flow unchanged.
- HTTP responses use typed policy error codes and include remediation text that the UI can display directly.
- The inspector disables launch with actionable guidance; prepared-launch dialog errors remain consistent with backend policy failures.
- The active `session-launching-and-tracking` graph is either safely opted in after audit or left unconfigured with the mechanism documented for a follow-up opt-in.
