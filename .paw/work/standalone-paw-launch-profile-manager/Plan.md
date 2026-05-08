# Plan: Standalone PAW Launch Profile Manager

## Problem and approach

Issue 81 asks for PAW launch prompt profiles to become a first-class local management surface instead of being reachable only inside a node launch dialog. The existing code already persists prompt profiles and loads them non-cacheably for the launch dialog, so the implementation should preserve launch behavior while extracting profile operations into reusable client helpers, adding DELETE support, and wiring a standalone `/profiles` route.

The second axis is workstream-level default profile selection. This should extend the existing `launchDefaults` graph configuration beside terminal defaults, parse and persist the selected profile id through the workstream configuration API, and have the launch dialog gracefully preselect the profile only when it exists in the loaded profile set.

## Work items

1. Shared prompt profile API/client layer
   - Move save/delete/copy-relevant profile API calls out of `PawLaunchDialog` into reusable helpers.
   - Keep `GET /api/paw-launch-prompt-profiles` using `cache: "no-store"`.
   - Add client helpers for create/update/delete with typed response checks.

2. Server DELETE endpoint
   - Add `DELETE /api/paw-launch-prompt-profiles/:id`.
   - Return `204` when deleted and `404` with `prompt_profile_not_found` when absent.
   - Extend server tests for delete and post-delete listing.

3. Standalone profile manager route and UI
   - Add `/profiles` to dashboard routing, top navigation, landing page, and browser-native link handling.
   - Add a profile manager page that lists profiles, selects one, shows full instructions, copies instructions, creates, edits, duplicates, and deletes with confirmation.
   - Reuse the shared profile helpers/state and update in-memory profile state after mutations.

4. Launch dialog shared state and default preselection
   - Keep current launch dialog profile save/load behavior unchanged from the user's perspective.
   - Use the shared client helpers and accept a `defaultPromptProfileId`.
   - When the default id resolves to an existing profile, preselect it and load its instructions; when missing/deleted/renamed, leave custom instructions selected without error.

5. Workstream configuration default profile
   - Extend `WorkstreamLaunchDefaults` and graph parsing to support `promptProfileId`.
   - Extend workstream configuration normalization/persistence and the configuration dialog UI.
   - Show available profile names/ids clearly enough for users to choose defaults.

6. Tests, design docs, and visual evidence
   - Add/adjust App tests for standalone management and default profile preselection.
   - Add parser/configuration tests for `promptProfileId`.
   - Update `docs/design/workstream-format.md` and `docs/design/session-system.md` or related design docs to describe standalone profile management and DELETE.
   - Capture a representative screenshot of the new profile manager for the PR.

## Notes and considerations

- Prompt profiles remain local runtime state under `~/.streamliner/state`, not committed workstream artifacts.
- The workstream default stores the profile id rather than the display name so renames keep working; missing ids degrade to custom launch instructions.
- The profile manager should not introduce a WorkflowContext configuration UI or taxonomy/import/export features.
- The launch dialog should not auto-refresh profiles after every render; the existing non-cacheable load should be shared and explicitly refreshed after profile-manager mutations.
