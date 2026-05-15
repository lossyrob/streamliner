# Plan: Issue 100 PAW Review Companion Launch

## Approach Summary
Ship the launch-only prototype as a terminal-first companion flow. Keep saved PAW Review kickoff templates separate from PAW init prompt profiles, add a generic loopback-only companion terminal API, then wire the node launch dialog so the optional companion terminal launches only after the main terminal launch succeeds.

## Key Decisions
- Use a separate saved-template store from PAW launch prompt profiles.
- Support only `{{githubIssue}}` for the first template variable.
- Use a generic companion terminal endpoint with no launch claim or registry binding.
- Hide or disable the option outside terminal CLI launches and when no GitHub tracker exists.
- Default the companion launch option off.

## Work Items
1. Add a PAW Review template store and client helpers, including create, select, edit/update, and use behavior for companion kickoff prompts.
2. Add a generic companion terminal launch endpoint that is loopback-only, validates its request shape, calls the existing terminal launch adapter, and has tests proving non-loopback requests are rejected.
3. Wire the launch dialog and App launch flow with an off-by-default companion option, template selection/save/update, `{{githubIssue}}` substitution, disabled/explanatory no-tracker behavior, and companion error reporting that does not invalidate the successful main launch.
4. Add targeted tests and run validation, including the required UI screenshot capture for the affected launch dialog surface.

## Template Rendering Contract
- `{{githubIssue}}` is replaced with the selected node's GitHub tracker issue number as decimal text.
- Nodes without a GitHub tracker do not enable companion launch; the dialog explains that a GitHub tracker is required.
- Unknown template tokens are preserved so saved prompts are not destructively rewritten by the prototype.

## Companion Launch Contract
- The main terminal launch remains the gating operation. Streamliner launches the companion only after the main launch endpoint returns success.
- Companion launch failure is reported separately in the dialog and does not rewrite the successful main launch operation into a failure.
- The companion request reuses the prepared handoff's resolved `cwd`, terminal preference, and tab color, and appends ` REVIEW` to the main terminal title.
- The generic companion endpoint is protected by the same local loopback trust boundary used by node launch APIs.

## Success Criteria
- A PAW Review prompt template can be created, selected, edited, and used from the node launch dialog.
- `{{githubIssue}}` renders to the tracked GitHub issue number.
- Launching the main terminal with the companion option enabled opens the second terminal with matching working directory, terminal preference, color, and a ` REVIEW` title suffix.
- Nodes without GitHub trackers show a clear explanation and cannot enable the companion launch.
- Companion launch errors are visible without marking the already-successful main launch as failed.
- Tests cover template rendering, saved-template API behavior, and loopback rejection for the companion launch endpoint.

## Risks and Mitigations
- **Confusing template/profile UX:** keep labels explicit: PAW Review prompt templates are separate from launch instruction profiles.
- **Accidental companion launch without issue context:** require a GitHub issue number before enabling the launch option.
- **Main launch blocked by companion errors:** sequence the companion launch after the main launch result and surface companion errors separately.
- **Scope creep into automated review orchestration:** do not add loop state, review routing, or session-chain records in this prototype.
