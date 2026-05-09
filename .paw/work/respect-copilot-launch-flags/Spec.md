# Feature Specification: Respect Copilot Launch Flags

**Branch**: feature/issue-88-launch-flags  |  **Status**: Draft
**Input Brief**: GitHub issue 88 asks Streamliner to preserve Copilot CLI launch
flags such as `--yolo` when sessions are relaunched.

## Overview

Streamliner users launch Copilot CLI sessions from workstream nodes and later use
the Sessions view to resume those sessions. The existing launch experience
defaults terminal sessions to autonomous `--yolo` mode, but the relaunch path
builds a plain resume command and drops that launch mode.

This feature gives users one visible place to configure the default Copilot CLI
launch flags Streamliner applies to terminal launches and relaunches. Relaunches
should behave like the original session whenever Streamliner has recorded the
original terminal flags, and otherwise use the current configured defaults.

The feature must avoid changing managed SDK launches, Copilot's consent model,
or historical sessions that have no recorded launch flags. Those sessions use
the current configured defaults on their next relaunch.

## Objectives

- Preserve autonomous Copilot CLI behavior across Streamliner session relaunches.
- Make default terminal launch flags configurable and clearable by users.
- Record resolved terminal launch flags for newly launched sessions so later
  relaunches are stable even if defaults change.
- Keep existing relaunch context behavior intact, including working directory,
  terminal presentation, and trusted signal handling.

## User Scenarios & Testing

### User Story P1 - Relaunch with preserved flags

Narrative: A user launches a Copilot CLI session with autonomous flags, later
returns to the Sessions view, and relaunches the session without manually
retyping flags.

Independent Test: Relaunch a recorded terminal session and inspect the generated
resume command.

Acceptance Scenarios:
1. Given a launched session with recorded flags, when the user relaunches it,
   then Streamliner uses the recorded flags before the resume argument.
2. Given a launched session with recorded empty flags, when the user relaunches
   it, then Streamliner does not apply configured defaults.
3. Given a launched session with recorded flags and malformed defaults, when the
   user relaunches it, then relaunch still proceeds using the recorded flags.

### User Story P2 - Configure defaults

Narrative: A user updates Streamliner's default Copilot CLI flags once and
expects future terminal launches and relaunches without recorded flags to use
that setting.

Independent Test: Save a new default flag list, then start a launch flow and
relaunch an unrecorded session.

Acceptance Scenarios:
1. Given a fresh settings store, when defaults are loaded, then `--yolo` is the
   initial default flag.
2. Given the user saves a non-empty default flag list, when a terminal launch
   flow omits explicit flags, then Streamliner applies the saved defaults.
3. Given the user saves an empty default flag list, when a terminal launch flow
   omits explicit flags, then Streamliner applies no default flags.
4. Given the user opens Settings, when they edit session launch defaults, then
   the UI can save non-empty defaults or intentionally clear them.

### User Story P3 - Copy accurate restart commands

Narrative: A user copies the visible restart command from the Sessions view and
expects it to match Streamliner's relaunch behavior.

Independent Test: Compare the copied restart command with the command used by
the relaunch action for the same session state.

Acceptance Scenarios:
1. Given recorded flags are available, when the restart command is displayed,
   then it includes the recorded flags.
2. Given no recorded flags are available, when defaults are loaded, then the
   displayed command includes the configured defaults.

### Edge Cases

- Missing recorded flags means "use configured defaults."
- Recorded empty flags means "use no defaults."
- Recorded non-empty flags means "use the recorded flags."
- Historical sessions without recorded flags are not migrated; they use the
  configured defaults at relaunch time.
- Default settings reject resume-specific flags because Streamliner owns the
  resume argument during relaunch.
- Default settings are option tokens only; users should express option values as
  `--flag=value`. Positional kickoff prompts and shell parsing syntax are out of
  scope for the default flag setting.

## Requirements

### Functional Requirements

- FR-001: Streamliner exposes a user-visible settings surface to view, update,
  and clear default Copilot CLI terminal launch flags. (Stories: P2)
- FR-002: A fresh configuration starts with `--yolo` as the default Copilot CLI
  terminal launch flag. (Stories: P2)
- FR-003: Saving an empty default flag list is an intentional override and must
  not reset to the built-in default. (Stories: P2)
- FR-004: Session relaunch commands apply recorded launch flags when present,
  including the explicit empty list. (Stories: P1)
- FR-005: Session relaunch commands apply configured default flags when recorded
  launch flags are missing. (Stories: P1,P2)
- FR-006: Newly launched terminal sessions record their resolved Copilot CLI
  flags so future relaunches can preserve the original behavior. (Stories: P1)
- FR-007: Terminal launch flows that explicitly provide flags, including an
  empty list, keep that explicit value instead of configured defaults. (Stories:
  P2)
- FR-008: Relaunch preserves existing working directory, terminal title, tab
  color, and trusted signal behavior. (Stories: P1)
- FR-009: Settings validation rejects malformed default flag values and
  resume-specific values, including `--resume` and `--resume=<id>`. (Stories:
  P2)
- FR-010: Relaunch of sessions with recorded flags does not depend on loading
  configured defaults. (Stories: P1)
- FR-011: Visible restart commands in the Sessions view match the launch-flag
  precedence used by the relaunch action. (Stories: P3)
- FR-012: Streamliner documents the default launch flag setting and includes
  `--yolo` as the primary example. (Stories: P2)

### Key Entities

- Default launch flags: The user-configured Copilot CLI option tokens used when
  no launch flow or session record provides a more specific value.
- Recorded launch flags: The resolved Copilot CLI arguments saved with a
  Streamliner-launched terminal session.

## Success Criteria

- SC-001: A fresh settings store reports `--yolo` as the default launch flag.
  (FR-001, FR-002)
- SC-002: Saving an empty default list causes future default-based terminal
  launches and relaunches to omit `--yolo`. (FR-003, FR-005, FR-007)
- SC-003: A session with recorded non-empty flags relaunches with those flags
  even after defaults change. (FR-004, FR-006, FR-010)
- SC-004: A session with recorded empty flags relaunches with no default flags.
  (FR-003, FR-004)
- SC-005: A session with recorded flags still relaunches when the defaults store
  is unreadable or malformed. (FR-004, FR-010)
- SC-006: Default settings reject resume-specific values and malformed option
  tokens with a user-visible error. (FR-009)
- SC-007: The Sessions restart command preview follows the same recorded-versus-
  default precedence as the relaunch action. (FR-011)
- SC-008: Existing relaunch working-directory, terminal presentation, and trusted
  signal behavior remain unchanged. (FR-008)
- SC-009: User-facing documentation explains how to configure default launch
  flags and when recorded flags take precedence. (FR-012)

## Assumptions

- Historical sessions without recorded flags are not migrated; applying current
  defaults is acceptable and should be documented.
- Default flags are option tokens, not kickoff prompts. Users can provide launch
  prompts through existing prompt fields.
- PowerShell command quoting remains the active terminal command path for this
  feature.

## Scope

In Scope:
- Default Copilot CLI terminal launch flag settings.
- Sessions view relaunch behavior and visible restart command previews.
- Recording resolved terminal launch flags for newly launched sessions.
- Documentation for configuration and precedence.

Out of Scope:
- Adding Copilot CLI flag support to managed SDK launches.
- Changing Copilot CLI consent, approval, or permission behavior.
- Supporting shell-specific parsing or quoting syntax beyond the existing
  PowerShell command path.
- Migrating historical sessions that lack recorded launch flags.
- Supporting positional kickoff prompts in default launch flags.

## Dependencies

- Streamliner's local state store.
- Existing terminal launch and session relaunch flows.
- Existing session registry records for launched sessions.

## Risks & Mitigations

- Risk: Recorded flags are dropped during session binding or later writes.
  Mitigation: Treat recorded flags as first-class session metadata and verify the
  claim-to-bind-to-relaunch path.
- Risk: Malformed settings block relaunches unnecessarily. Mitigation: Prefer
  recorded flags before reading defaults and surface errors only when defaults
  are required.
- Risk: Users expect shell-like parsing in the settings UI. Mitigation: Present
  the setting as option tokens and document `--flag=value` for option values.

## References

- Issue: https://github.com/lossyrob/streamliner/issues/88
- Work shaping: `.paw/work/respect-copilot-launch-flags/WorkShaping.md`
- Research: `.paw/work/respect-copilot-launch-flags/CodeResearch.md`
