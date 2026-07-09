# Launch Context - PAW launch configuration and prompt defaults

## Layer 0 - Design Context Hints

Use the repo design layer as navigation, not as a copied requirements bundle. Good starting points for this node are:

- `docs\design\index.md` for the design-doc map when you need more context.
- `docs\design\session-system.md`, especially Launch Inputs, Launch Sequence, PAW Launch Configuration, Kickoff Prompt, Context Assembly, and Delivery Mechanism.
- `.streamliner\workstreams\session-launching-and-tracking\brief.md` and `graph.json` for Wave 3 placement and adjacent nodes.
- GitHub issue #33 (`https://github.com/lossyrob/streamliner/issues/33`) as the tracker/spec source for this exact node.
- File-based context delivery and PAW artifact-status decisions: context should be referenced as a file under the PAW work directory, and Streamliner should derive PAW workflow status from artifacts rather than treating PAW control state as authoritative.

If local design text still describes a generic launch-profile system, treat issue #33 and the current workstream framing as the narrower MVP direction: graph launch is PAW-only for this wave.

## Layer 1 - Worker Mission

You own exactly GitHub issue #33 / node `launch-prompt-profiles`: **PAW launch configuration and prompt defaults** for Wave 3 launch-from-graph.

Expected outcomes:

- A graph-node launch action opens a PAW-focused configuration dialog before SDK preparation starts.
- The dialog exposes defaulted PAW init options, default/overridden Copilot CLI args such as `--yolo`, terminal/worktree choices that belong to launch configuration, and an optional builder custom-message field.
- Launch preparation can run `paw-init` through Copilot SDK using the selected PAW configuration and Streamliner-specific instructions.
- The SDK prep contract returns structured launch data, including cwd/worktree, branch, PAW work directory, context path, kickoff prompt, CLI args, launch metadata, and any context package references needed by downstream launch code.
- The kickoff prompt template points the worker at `.paw\work\<work-id>\streamliner\context.md`, preserves launch identity/nonce requirements, and places any builder custom message in a clearly labeled section.

Boundaries and non-goals:

- Do not build non-PAW launch modes for the MVP.
- Do not reimplement backend context assembly; issue #31 owns generating the selected-node `context.md` package.
- Do not implement launch claim/session binding; issue #32 owns claim creation, nonce correlation, and graph binding.
- Do not start Copilot CLI or open terminals from the SDK prep path; terminal launch integration owns the visible worker session.
- Do not make PAW control state the runtime source of truth for workflow progress; later overlay work reads PAW artifacts plus session registry state.

## Layer 2 - Relevant State

Current workstream state for this node:

- Workstream: `.streamliner\workstreams\session-launching-and-tracking`.
- Node ID: `launch-prompt-profiles`; tracker: lossyrob/streamliner#33; current issue title: `PAW launch configuration and prompt defaults (Wave 3)`.
- Wave 3 is the PAW-only MVP launch-from-graph wave. It builds on Wave 2 registry/relaunch work so launched sessions register into the existing local session surface rather than a parallel tracker.
- Backend context assembly (#31) is complete. The launch path can request a generated worker-facing context package for a selected ready node, then place/reference it under the PAW work directory.
- Launch claim binding (#32) handles runtime launch claims and claim/graphBinding correlation; issue #33 should produce prompt/configuration data that claim binding and terminal launch can consume without owning those responsibilities.

Design constraints that matter here:

- Launch preparation and visible worker launch are separate phases. SDK prep may assemble/reuse context, run `paw-init`, place/reference context, build the kickoff prompt, and return structured data; it must not start the visible Copilot CLI worker.
- The MVP configuration surface is PAW-shaped: PAW init options/defaults, CLI defaults/overrides, optional custom message placement, context path/reference handling, and the SDK `paw-init` instruction template.
- Context delivery is file-based. The worker prompt should reference the context file rather than inline the full context body.
- Keep reusable non-secret defaults in committed project/workstream config only when they are intended to be shared. Builder-specific terminal preferences, host-specific defaults, and anything credential-like belong in local runtime configuration.
- PAW workflow progress in Streamliner should be artifact-derived and coarse. `WorkflowContext.md` may be read as an artifact, but its `## Control State` is not the authoritative runtime state.

## Layer 3 - Coordination Context

Coordinate narrowly with adjacent Wave 3 nodes:

- **#31 Backend context assembly:** consume its API/contract for generated selected-node `context.md`; when a PAW work directory is known, ensure the launch flow places or references the file at `.paw\work\<work-id>\streamliner\context.md` and returns that path in structured launch data.
- **#32 Launch claim binding:** preserve a dedicated launch nonce and the expected cwd/branch/node/workstream metadata in the prepared kickoff/handoff so the watcher can bind the discovered Copilot CLI session to the correct graph node. Do not duplicate claim storage or binding logic.
- **Terminal launch integration:** provide a stable handoff contract for the later terminal node: prepared cwd, branch, PAW work directory, context path, kickoff prompt, CLI args, environment, session-state root, and launch metadata. Do not spawn the terminal in SDK prep.
- **Sessions/graph linkage:** launched sessions should flow into the existing session registry and later graph overlay. Keep identifiers explicit enough for downstream UI work to group sessions by workstream and link bound sessions back to node `launch-prompt-profiles` without adding a separate session surface.

When in doubt, keep this worker focused on the configuration, prompt-template, and SDK-prep contracts that make a PAW-backed graph launch ready for the terminal integration step.
