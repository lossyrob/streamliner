# Code Research: Respect Copilot Launch Flags

## Relaunch path

- `src\session-registry\relaunch.ts` builds `TerminalLaunchOptions` and calls
  `buildCopilotResumeCommand(session.copilotSessionId)` when a Copilot session
  id exists.
- The current relaunch command has no hook for default CLI args.
- Relaunch already preserves `derivedWorktreePath ?? cwd`, terminal title, tab
  color, and trusted signal synthesis.

## Command construction

- `src\terminal-command.ts` provides `quotePowerShellLiteral()` and
  `buildCopilotResumeCommand()`.
- `src\server\terminal-launch.ts` re-exports resume command helpers and builds
  interactive launch commands from `cliArgs` and kickoff prompts.

## Existing launch defaults

- `src\server\launch-preparation.ts` contains `DEFAULT_CLI_ARGS = ["--yolo"]`.
- `parseConfigurationInput()` uses explicit `configuration.cliArgs` when
  provided, including empty arrays, otherwise falls back to defaults.
- `src\App.tsx` seeds PAW launch defaults with `cliArgsText: "--yolo"`.

## Settings patterns

- `src\server\routes\paw-launch-prompt-profiles.ts` persists JSON under
  `STREAMLINER_STATE_ROOT ?? ~/.streamliner/state`, validates input, and writes
  atomically with a temp file plus rename.
- `src\App.tsx` currently routes settings only to `/settings/profiles`.
- `src\components\PawProfilesPage.tsx` is a reusable visual pattern for
  settings-page header, status, fields, and actions.

## Session list UI

- `src\components\SessionsPage.tsx` posts `{}` to
  `/api/sessions/:id/relaunch` from `RelaunchButton`.
- `src\components\session-policies.ts` builds visible restart commands with
  `buildCopilotResumeCommand(session.copilotSessionId)`.

## Session schema and launch claims

- `src\session-registry-schema.ts` currently types launched origins as
  `{ kind: "launched"; launchClaimId?: string | null }`.
- `src\session-registry\file-store.ts` preserves unknown stored origin fields on
  read and shallow-merges stored origin data, but input parsing only accepts the
  currently typed launched origin fields.
- `src\session-registry\launch-claims.ts` creates reserved launched rows and
  later binds observed trusted signals into those rows.
- `src\server\node-launch.ts` receives resolved `handoff.cliArgs` for terminal
  launches but does not currently store them in durable session origin
  metadata.

## Test surfaces

- `src\session-registry\relaunch.test.ts` covers relaunch validation and command
  construction.
- `src\server\launch-preparation.test.ts` covers launch default handling and
  explicit empty `cliArgs`.
- `src\server\app.test.ts` and route-specific tests cover API routing patterns.
- `src\components\session-policies.test.ts` covers restart command behavior.
