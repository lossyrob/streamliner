# Runtime Overlay Polish Work Shaping

## Problem Statement

Streamliner's Wave 4 launch/session tracking closeout needs the Windows terminal launch path to remain stable while making the future portability boundary explicit. The same closeout pass should also remove launch/runtime overlay noise that surfaced during dogfooding: GitHub tracker references without loaded snapshots should not look like runtime degradation, and saved PAW launch prompt profiles should be available when the launch dialog opens instead of being blocked behind slower launch-record lookups.

The users who benefit are builders launching PAW work from Streamliner and future contributors adding non-Windows terminal support. Builders keep the existing Windows Terminal and PowerShell behavior, while future adapter work gets a clear seam below launch claims, node launch records, relaunch, and registry binding.

## Work Breakdown

### Core functionality

- Introduce a terminal launch adapter seam that normalizes compatibility-facing options into an adapter-facing request.
- Keep public terminal preference values and launch result values compatible: `default`, `windows-terminal`, `powershell`, and launch methods `windows-terminal` / `powershell`.
- Centralize Copilot resume command construction so relaunch and restart/copy UI actions do not drift.
- Demote missing GitHub tracker snapshots to informational linked-tracker metadata rather than runtime degradation.
- Prefetch and cache saved PAW launch prompt profiles when a launchable node is selected, independent of selected-node launch-state lookup.

### Supporting features

- Preserve Windows Terminal title/color behavior and PowerShell fallback behavior.
- Keep node launch duplicate gating, launch claims, terminal-spawn failure handling, and registry binding unchanged.
- Document the terminal adapter seam and future adapter ownership in `docs/design/session-system.md`.
- Add regression coverage around the adapter seam, resume command quoting, tracker metadata handling, and prompt profile prefetch/caching.

## Edge Cases and Expected Handling

- Windows Terminal is unavailable: `default` and `windows-terminal` preferences fall back to PowerShell; explicit `powershell` skips Windows Terminal probing.
- PowerShell Core is unavailable: the Windows adapter falls back to Windows PowerShell.
- Terminal titles or paths include Windows Terminal-sensitive separators: Windows Terminal arguments escape semicolons.
- Relaunch resume ids contain single quotes: the shared PowerShell literal helper quotes the full `--resume=<id>` argument safely.
- Launch profile list resolves after a profile is saved: cache merge keeps the newest profile by profile id and preserves the saved profile.
- Selected-node launch-state lookup is slow: profile fetch still completes and the dialog can show saved profiles.
- GitHub tracker reference exists without a loaded issue/PR snapshot: overlay marks tracker status as linked, records an informational issue, and does not degrade node or gate readiness.

## Rough Architecture

The launch pipeline remains layered:

1. Streamliner product layer owns launch claims, duplicate launch gating, node launch records, registry binding, and relaunch validation.
2. Terminal launch seam normalizes existing `TerminalLaunchOptions` into `TerminalLaunchRequest`.
3. `TerminalLaunchAdapter` implementations own terminal host selection, shell command/script encoding, process spawning, and method mapping.

The current default adapter is Windows-only and owns Windows Terminal discovery, PowerShell fallback, launch script generation, and PowerShell command construction. Future macOS/Linux adapters should implement the same adapter-facing request without moving product launch state or changing shared node launch contracts.

The PAW launch dialog profile flow shifts profile loading up to `App`, because `App` knows when a launchable node is selected. `PawLaunchDialog` receives cached profile state as props and remains responsible for applying and saving profiles.

## Critical Analysis

The value is mostly boundary clarity and closeout reliability, not new user-visible terminal functionality. Preserving compatibility is more important than renaming public strings to be platform-neutral. Keeping the existing strings avoids graph/config migrations and avoids changing persisted node launch records while still making platform-specific behavior adapter-local.

The prompt-profile prefetch is a small UX fix with a clear architectural fit: dialog-local fetching was too late and coupled the dropdown to dialog lifecycle. Moving profile cache ownership to `App` makes profile loading independent from other launch lookups and avoids duplicate fetches.

## Codebase Fit

- `src/server/terminal-launch.ts` is already the terminal spawn boundary and is the right place for adapter types, request normalization, and the Windows adapter.
- `src/session-registry/relaunch.ts` and `src/components/session-policies.ts` both need the same resume command quoting, so `src/terminal-command.ts` is a shared location for that helper.
- `src/workstream-runtime-overlay.ts` already separates informational issues from readiness-impacting degradation; missing tracker snapshots can use `readinessImpact: "none"`.
- `src/App.tsx` already owns selected node state and launch dialog orchestration, making it the correct owner for profile prefetch and cache merge.
- `docs/design/session-system.md` is the authoritative design surface for launch, relaunch, registry binding, and terminal integration.

## Risk Assessment

- Terminal launch behavior is OS- and shell-sensitive; tests need to preserve exact Windows Terminal and PowerShell argv behavior.
- The adapter seam should not leak into public API names in a way that implies unsupported cross-platform behavior.
- Shared resume command construction must preserve the existing Copilot CLI invocation shape and avoid adding a positional path argument.
- Moving profile loading up to `App` can create stale-state or unmount issues if asynchronous fetches resolve after navigation; the cache update path must guard mounted state.
- Tracker metadata demotion should not hide real runtime failures; only missing live tracker snapshots should become informational.

## Open Questions

None for this closeout. macOS, iTerm2, Linux terminal, WSL terminal, live GitHub fetching, and cross-machine profile sync remain downstream work.

## Session Notes

- PR #71 is the implementation vehicle and closes issue #56.
- The dedicated execution checkout is `C:\Users\robemanuele\proj\streamliner\streamliner-runtime-overlay-polish` on `feature/runtime-overlay-polish`.
- Human review is configured as final-pr-only; automated planning and final agent reviews remain required by workflow configuration.
