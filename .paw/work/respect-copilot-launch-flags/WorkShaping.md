# Work Shaping: Respect Copilot Launch Flags

## Issue

Issue 88 asks Streamliner to preserve Copilot CLI launch flags such as `--yolo`
when restarting sessions. Today PAW terminal launches default to `--yolo`, but
session relaunch builds a plain `copilot --resume=<id>` command and drops the
default flags that made the original launch autonomous.

## Current behavior

- PAW launch preparation defaults omitted `cliArgs` to `["--yolo"]`.
- The launch dialog also seeds the terminal CLI args field with `--yolo`.
- Session relaunch constructs a resume command from the Copilot session id only.
- Settings currently contain only PAW prompt profiles, so there is no global
  place to adjust default Copilot CLI launch args.
- Launch-claim reserved rows have durable origin metadata, but they do not
  record the resolved Copilot CLI args used for terminal launches.

## Target behavior

- Add a Settings section for default Copilot CLI launch arguments.
- Store the default args under Streamliner's local state root so they are shared
  by the dashboard and API server.
- Apply the configured args to Streamliner-managed Copilot CLI launches when a
  launch flow omits explicit args.
- Apply the same configured args to session relaunch/resume commands.
- Preserve explicit empty launch args as an intentional override.
- Record resolved terminal launch args in launched session origin metadata so a
  relaunch of a launched session can replay those args even if defaults later
  change.
- Keep relaunch cwd, terminal title, tab color, and trusted signal synthesis
  behavior unchanged.
- Managed SDK launches remain out of scope because they do not shell out through
  the Copilot CLI.

## Proposed precedence

1. Recorded launched-session Copilot CLI args, when present.
2. Configured default Copilot CLI args from Settings.
3. Built-in fallback defaults, currently `--yolo`.

Explicit empty launch args are recorded as an empty array and therefore suppress
configured defaults for that launched session.

## Notes

- The settings API should validate that args are strings and reject resume flags;
  `--resume` is owned by Streamliner during relaunch.
- The resume command should append `--resume=<id>` after configured defaults and
  quote all values with the existing PowerShell literal helper.
- The visible restart command in the Sessions UI should match relaunch behavior
  where practical.
- Documentation should explain how to configure defaults and include `--yolo` as
  the primary example.
