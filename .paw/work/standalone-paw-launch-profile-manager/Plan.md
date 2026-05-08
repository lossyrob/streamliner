# Plan: Standalone PAW Launch Profile Manager

## Problem and approach

Issue 81 asks for PAW launch prompt profiles to become a first-class local management surface instead of being reachable only inside a node launch dialog. The existing code already persists prompt profiles and loads them non-cacheably for the launch dialog, so the implementation should preserve launch behavior while extracting profile operations into reusable client helpers, adding DELETE support, and wiring a standalone `/profiles` route.

The second axis is workstream-level default profile selection. This should extend the existing `launchDefaults` graph configuration beside terminal defaults, parse and persist the selected profile id through the workstream configuration API, and have the launch dialog gracefully preselect the profile only when it exists in the loaded profile set.

## Work items

1. Shared prompt profile API/client layer
   - Move save/delete/copy-relevant profile API calls out of `PawLaunchDialog` into reusable helpers.
   - Keep `GET /api/paw-launch-prompt-profiles` using `cache: "no-store"`.
   - Add client helpers for create/update/delete with typed response checks.
   - Use one lifted App-level profile state as the shared source for both `/profiles` and the launch dialog; helpers live with `paw-prompt-profiles.ts`, while React state remains in `App.tsx` rather than a separate module-level cache.

2. Server DELETE endpoint
   - Add `DELETE /api/paw-launch-prompt-profiles/:id`.
   - Return `204` when deleted and `404` with `prompt_profile_not_found` when absent.
   - Extend server tests for delete and post-delete listing.
   - Match the existing sibling route error envelope (`{ code, error }`) and do not scan or cascade workstream references; dangling defaults degrade at read time.

3. Standalone profile manager route and UI
   - Add `/profiles` to dashboard routing, top navigation, landing page, and browser-native link handling.
   - Add a profile manager page that lists profiles, selects one, shows full instructions, copies instructions, creates, edits, duplicates, and deletes with confirmation.
   - Reuse the shared profile helpers/state and update in-memory profile state after mutations.
   - Include loading/error states, an empty-state create affordance, duplicate-name validation consistent with the server, duplicate-as-copy behavior with a distinct copy name, clipboard copy of instructions text only, and delete confirmation copy that warns workstreams configured for the profile will fall back to no default.

4. Launch dialog shared state and default preselection
   - Keep current launch dialog profile save/load behavior unchanged from the user's perspective.
   - Use the shared client helpers and accept a `defaultPromptProfileId`.
   - When the default id resolves to an existing profile, preselect it and load its instructions; when missing/deleted/renamed, leave custom instructions selected without error.
   - Data flow mirrors terminal defaults: `graph.json` `launchDefaults.promptProfileId` -> `WorkstreamLaunchDefaults` parsing -> dashboard `launchDefaults` memo -> `PawLaunchDialog` prop.
   - Apply a resolved default profile only when initializing a newly opened dialog; do not overwrite user edits or selection changes within the same open dialog.

5. Workstream configuration default profile
   - Extend `WorkstreamLaunchDefaults` and graph parsing to support `promptProfileId`.
   - Extend workstream configuration normalization/persistence and the configuration dialog UI.
   - Show available profile names/ids clearly enough for users to choose defaults.
   - Treat `promptProfileId` as a best-effort local hint in the shared workstream graph. It stores a stable profile id rather than a name; profile renames continue to resolve, while missing/deleted ids are accepted by parsing and ignored by launch preselection.
   - Touchpoints: `src/workstream-schema.ts`, `src/workstream-view-model.ts`, `src/server/workstream-configuration.ts`, `src/components/WorkstreamConfigurationDialog.tsx`, and the dashboard launch defaults in `src/App.tsx`.

6. Tests, design docs, and visual evidence
   - Add/adjust App tests for standalone management, route/link behavior, shared-state refresh after manager mutations, default profile preselection, and missing/deleted default fallback.
   - Add parser/configuration tests for `promptProfileId`.
   - Add server API tests for profile deletion, 404 envelope shape, and post-delete listing.
   - Update `docs/design/workstream-format.md` and `docs/design/session-system.md` or related design docs to describe standalone profile management and DELETE.
   - If a new design doc or decision record is added, update `docs/design/index.md` and `docs/design/.vitepress/config.ts` per the design-docs skill; otherwise keep edits in existing docs with frontmatter intact.
   - Capture representative screenshots with `scripts/screenshot.mjs`, including the new profile manager and route entry point where practical.

## Traceability

| Issue expectation | Plan coverage |
|---|---|
| Open a manager without selecting a node | Work item 3 (`/profiles` route/nav/landing) |
| List/select/view full instructions | Work item 3 profile list, selection, detail textarea |
| Copy instructions | Work item 3 clipboard copy of instructions text |
| Create/edit/duplicate/delete profiles | Work items 1-3 shared helpers, API, and manager actions |
| Add DELETE endpoint | Work item 2 |
| Keep GET non-cacheable | Work item 1 |
| Share source with launch dialog | Work items 1 and 4 |
| Preserve launch dialog behavior | Work item 4 |
| Workstream default profile | Work item 5 and launch data flow in work item 4 |
| Missing/renamed/deleted defaults degrade | Work items 4-5 and degradation matrix below |
| Browser-native routing | Work item 3 and test coverage in work item 6 |
| Server/UI/parser tests | Work item 6 |
| Design docs | Work item 6 |
| Representative screenshot | Work item 6 |

## Default profile degradation matrix

| Scenario | Behavior |
|---|---|
| Profile renamed but id unchanged | Default continues to resolve because the workstream stores the id. |
| Profile id missing on launch dialog open | Dialog selects custom launch instructions and shows no blocking error. |
| Profile deleted after being configured | Future launches ignore the dangling id and use custom instructions. |
| Configuration dialog sees dangling id | It should show no selected saved profile/default option rather than failing to render. |
| Profile deleted while configured by workstreams | DELETE succeeds; users are warned in confirmation copy that affected workstreams fall back to no default. |

## Implementation dependencies

`shared-profile-client` should land before the standalone manager and launch dialog refactor. `workstream-profile-config` should land before final default preselection wiring. Documentation, tests, and screenshots follow the UI/API/config work.

## Notes and considerations

- Prompt profiles remain local runtime state under `~/.streamliner/state`, not committed workstream artifacts.
- The workstream default stores a profile id in the committed graph as a machine-local hint. This is intentionally best-effort, analogous to a local convenience default, and must not make a shared graph invalid on machines without the profile.
- The profile manager should not introduce a WorkflowContext configuration UI or taxonomy/import/export features.
- Out of scope: WorkflowContext configuration UI, model presets, workflow validation, profile taxonomy, versioning, import/export, profile sharing/sync, search/filter, bulk operations, and cross-workstream reference scanning.
- The launch dialog should not auto-refresh profiles after every render; the shared load should refresh non-cacheably on profile manager mount and launch dialog open, while successful mutations update App-level state immediately.
- This work is not expected to modify `copilot-plugin/streamliner/`; if it does, run `npm run refresh-copilot-plugin` before manual verification.
