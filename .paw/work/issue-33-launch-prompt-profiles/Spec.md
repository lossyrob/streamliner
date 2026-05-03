# Feature Specification: PAW Launch Configuration and Prompt Defaults

**Branch**: feature/issue-33-launch-prompt-profiles  |  **Created**: 2026-05-02  |  **Status**: Draft
**Input Brief**: GitHub issue #33 asks Streamliner to prepare PAW-only graph launches with configurable launch defaults and worker kickoff prompts.

## Overview

Streamliner builders need to launch workstream graph nodes into focused PAW worker sessions without manually assembling branch names, work areas, context references, or worker command arguments. The launch experience should make the launch configuration explicit before preparation starts and should show the exact defaults that will be used if the builder makes no changes.

After a builder chooses a graph node and confirms configuration, Streamliner should prepare a worker launch package rather than immediately starting a visible terminal. Preparation should make the selected node's generated context available to the future worker, initialize the PAW work area with the selected launch configuration, and return a complete handoff for the later terminal launch step.

The resulting worker prompt should be concise, file-based, and unambiguous: it should point the worker at the prepared Streamliner context artifact, preserve launch identity and nonce metadata for later binding, and clearly separate any builder-provided message from generated Streamliner instructions.

## Objectives

- Enable builders to review and adjust PAW launch options before preparation begins.
- Show reusable default worker command arguments and allow launch-specific overrides without requiring per-node duplication.
- Produce a complete prepared launch handoff without starting the visible worker session.
- Keep context delivery file-based by referencing a prepared context artifact from the worker prompt.
- Preserve launch identity metadata so downstream binding and terminal launch work can correlate the worker session to the graph node.

## User Scenarios & Testing

### User Story P1 - Configure a PAW graph launch

Narrative: As a Streamliner builder, I can press launch on a ready, backend-readable workstream graph node, inspect default PAW launch settings, adjust the supported options, and confirm before any SDK preparation runs.

Independent Test: Trigger launch for a graph node and verify a configuration dialog appears with default PAW, worker command, terminal/work area, and custom-message fields before preparation begins.

Acceptance Scenarios:
1. Given a launchable graph node, When the builder starts launch, Then Streamliner shows a PAW-focused configuration dialog before invoking SDK preparation.
2. Given the dialog is open, When defaults are shown, Then the builder can see PAW launch options, default worker command arguments, terminal/work area choices, and an optional custom-message input.
3. Given the builder cancels the dialog, When the launch action ends, Then SDK preparation does not run.

### User Story P1 - Prepare a structured PAW launch handoff

Narrative: As downstream terminal launch integration, I need a handoff that includes all prepared launch inputs required to start the worker later, including location, identity, prompt, command arguments, environment, and context references.

Independent Test: Confirm a configured graph launch and verify preparation returns structured launch data without starting the worker command or opening a terminal.

Acceptance Scenarios:
1. Given the builder confirms the launch dialog, When preparation succeeds, Then the returned handoff contains the prepared working location, branch, PAW work area, PAW workflow context path, Streamliner context reference, kickoff prompt, worker command arguments, environment, session state location, and launch metadata.
2. Given launch preparation runs, When PAW initialization is needed, Then preparation initializes the PAW work area with Streamliner-specific instructions and the selected launch configuration.
3. Given launch preparation completes, When downstream terminal code receives the handoff, Then it has enough data to start the visible worker session using existing terminal launch mechanics.

### User Story P2 - Preserve worker context and builder guidance

Narrative: As the launched PAW worker, I receive an initial prompt that tells me exactly which workflow context and Streamliner launch context artifact to read, while any builder-authored guidance is clearly labeled as such.

Independent Test: Generate kickoff prompts with and without a custom builder message and verify both reference the context file and preserve identity metadata, while only the custom-message case includes the labeled builder section.

Acceptance Scenarios:
1. Given launch preparation builds a kickoff prompt, When the prompt is generated, Then it references the Streamliner context artifact in the PAW work area instead of inlining the full context body.
2. Given the builder provided a custom message, When the kickoff prompt is generated, Then the message appears in a clearly labeled builder-message section.
3. Given no custom message was provided, When the kickoff prompt is generated, Then no empty custom-message section is included.
4. Given launch identity metadata exists, When the kickoff prompt is generated, Then it preserves the workstream, node, branch, nonce, and tracker or issue details when present for downstream binding.

### Edge Cases

- If the selected node has no generated context package, preparation should surface a failure that identifies the missing context as the blocking condition rather than creating an incomplete handoff.
- If PAW initialization fails, preparation should return a failure that keeps the visible worker session from starting.
- If the builder removes all worker command arguments, preparation should honor the explicit empty override rather than reapplying defaults implicitly.
- If a builder custom message contains multiple paragraphs, the prompt should preserve the text inside the labeled custom-message section.
- If terminal/worktree preferences are not configured, committed defaults should be used for non-secret shared values; persisted local runtime defaults for host-specific preferences remain outside this MVP.
- If the graph source is browser-only and has no backend-readable local graph path, Streamliner should not present it as launchable in the MVP or should surface a clear unsupported-source preparation error.

## Requirements

### Functional Requirements

- FR-001: Streamliner MUST present a PAW-focused launch configuration dialog before launch preparation starts for graph-node launches. (Stories: P1 Configure)
- FR-002: The dialog MUST expose defaulted PAW launch options, default worker command arguments, command override behavior, terminal/work area launch choices, and an optional builder custom-message field. (Stories: P1 Configure)
- FR-003: Canceling the configuration dialog MUST prevent launch preparation from running. (Stories: P1 Configure)
- FR-004: Launch preparation MUST initialize the PAW work area using Streamliner-specific instructions and the selected PAW configuration. (Stories: P1 Handoff)
- FR-005: Launch preparation MUST place or reference the generated Streamliner context in the PAW work area. (Stories: P1 Handoff, P2)
- FR-006: Launch preparation MUST return structured launch data containing prepared location, branch, PAW work area, context reference, kickoff prompt, worker command arguments, environment, session state location, launch metadata, and context package references needed by downstream launch code. (Stories: P1 Handoff)
- FR-007: Launch preparation MUST NOT start the worker command or open a visible terminal. (Stories: P1 Handoff)
- FR-008: The kickoff prompt MUST point the worker at the Streamliner context artifact and PAW workflow context rather than inlining the full context body. (Stories: P2)
- FR-009: The kickoff prompt MUST preserve launch identity and nonce metadata needed for downstream claim binding, including tracker or issue details when present. (Stories: P2)
- FR-010: When a builder custom message is present, the kickoff prompt MUST include it in a clearly labeled section; when absent, the prompt MUST omit the empty section. (Stories: P2)
- FR-011: The MVP MUST remain PAW-only and MUST NOT introduce generalized non-PAW launch modes. (Stories: P1 Configure, P1 Handoff)

### Key Entities

- Launch Configuration: Builder-adjustable values for PAW launch options, worker command arguments, terminal/work area preferences, and optional custom guidance.
- Launch Handoff: Structured data returned by preparation for downstream terminal launch integration.
- Kickoff Prompt: Initial worker prompt generated from Streamliner launch metadata, context references, workflow instructions, and optional builder guidance.
- Streamliner Context Reference: File-based context package associated with the selected workstream node.

### Cross-Cutting / Non-Functional

- Preparation errors should identify the blocking launch step and the affected launch input so builders can understand why launch could not proceed.
- Reusable non-secret defaults may be shared through committed configuration, while host-specific or credential-like values must not be committed; persisted local runtime defaults for those preferences are deferred beyond this MVP.
- The configuration and preparation contracts should expose named fields for identity, context, prompt, command arguments, and environment so adjacent binding and terminal integration work can consume them without duplicating responsibilities.

## Success Criteria

- SC-001: A graph-node launch action shows a configuration dialog before any launch preparation work starts. (FR-001, FR-003)
- SC-002: The dialog supports default review and override of PAW launch options, worker command arguments, terminal/work area preferences, and optional custom message input. (FR-002)
- SC-003: Confirming the dialog produces a successful preparation result with prepared location, branch, PAW work area, PAW workflow context path, Streamliner context reference, kickoff prompt, worker command arguments, environment, session state location, launch metadata, and context package references. (FR-004, FR-005, FR-006)
- SC-004: Launch preparation does not start the worker command or open a terminal. (FR-007)
- SC-005: Generated kickoff prompts reference the PAW work area's Streamliner context artifact and preserve launch identity/nonce metadata. (FR-008, FR-009)
- SC-006: Generated kickoff prompts include a labeled builder-message section only when a custom message is provided. (FR-010)
- SC-007: The implemented launch path remains PAW-only for the MVP. (FR-011)

## Assumptions

- Existing graph launch UI can identify a selected launchable node and pass its workstream/node metadata to preparation.
- For the MVP, launchable nodes are ready nodes whose graph source is readable by the backend preparation API.
- The existing backend context assembly contract can generate or locate the selected node context package.
- Issue #32 provides launch claim/nonce metadata or a compatible contract that this work can preserve in the handoff and prompt without owning claim storage.
- Existing terminal launch or relaunch utilities will be reused by downstream terminal integration after this work returns the structured handoff.

## Scope

In Scope:
- PAW-only launch configuration dialog and defaults for graph-node launch.
- Preparation contract for PAW initialization and structured launch handoff data.
- Kickoff prompt generation with context-file references, launch identity metadata, and optional labeled builder message.
- Documentation updates directly related to PAW launch configuration, prompt templating, and handoff semantics.

Out of Scope:
- Non-PAW graph launch modes.
- Backend assembly of the selected-node context package contents.
- Launch claim creation, persistence, session binding, and graph overlay progress.
- Starting Copilot CLI, opening terminals, or implementing the final visible terminal launch step.
- Treating PAW control state as the runtime source of truth for Streamliner workflow progress.
- Supporting graph launch preparation from browser-only graph sources that the backend cannot read from a local path.
- Persisting host-specific launch defaults in local runtime configuration.

## Dependencies

- Completed backend context assembly for selected graph node context packages.
- Launch claim binding metadata contract for nonce and graph binding fields.
- Existing local session tracking and terminal launch capabilities for downstream visible worker launch.
- Preparation-time automation capable of initializing PAW work areas.

## Risks & Mitigations

- Risk: Launch preparation may accidentally overlap with terminal launch responsibilities, causing duplicate starts or unclear ownership. Mitigation: keep preparation limited to PAW initialization, prompt construction, context placement/reference, and structured handoff output.
- Risk: Generalized launch-profile abstractions could over-expand MVP scope, delaying PAW graph launch delivery. Mitigation: keep configuration PAW-shaped and explicitly defer non-PAW modes.
- Risk: Prompt text may blur generated instructions with builder guidance, making it hard for the worker to distinguish required launch context from optional advice. Mitigation: place custom guidance only in a clearly labeled section.
- Risk: Context may be duplicated into prompts and become stale, causing workers to follow outdated graph-node context. Mitigation: reference the file-based context package in the PAW work area.
- Risk: Local/committed default boundaries may leak host-specific preferences, making shared defaults unreliable across machines. Mitigation: commit only reusable non-secret defaults and keep host-specific choices local.

## References

- Issue: https://github.com/lossyrob/streamliner/issues/33
- Streamliner Launch Context: launch context artifact generated for this work item.
- Design: Streamliner session-system design documentation.
- Workstream: Session launching and tracking workstream.
