# Respect Copilot Launch Flags

## Overview

Streamliner now treats Copilot CLI terminal launch flags as local configuration
instead of a hard-coded dashboard default. The default remains `--yolo`, but a
user can replace it or intentionally save an empty list from Settings. When
Streamliner launches a terminal Copilot session, the resolved option tokens are
recorded on the session so relaunch later preserves the original launch mode.

This solves the issue where relaunching a session dropped launch flags such as
`--yolo`, forcing interrupted sessions to resume with different permissions than
the original launch.

## Architecture and Design

### High-Level Architecture

The implementation adds a small local settings document, an API route, and typed
session metadata:

- Settings storage lives at `session-launch-settings.json` under the local
  Streamliner state root and exposes `defaultCliArgs`.
- `GET /api/session-launch-settings` and `PUT /api/session-launch-settings`
  read and update the default Copilot CLI option tokens.
- PAW terminal launch preparation loads the configured defaults only when a
  launch request omits `configuration.cliArgs`.
- Terminal launches record the resolved args on launched session origins as
  `origin.cliArgs`.
- Session relaunch and visible restart commands resolve args with the same
  precedence.

### Design Decisions

The settings value is an argv array, not a shell string. The dashboard presents a
line-oriented editor where each non-empty line is one option token. This avoids
ambiguous shell parsing and keeps values such as `--model=gpt-5.5` explicit.

Streamliner rejects `--resume` and `--resume=<id>` in defaults because relaunch
owns the resume argument and appends it last. Defaults also reject positional
tokens so kickoff prompts stay in launch instructions instead of hidden global
configuration.

Historical sessions are not migrated. Sessions without recorded launch args use
the current configured defaults when relaunched. Sessions with recorded args do
not read settings during relaunch, so a malformed settings file cannot block a
session that already carries its original launch flags. If settings are
malformed during relaunch of a historical session, Streamliner falls back to the
built-in `--yolo` default so the session remains recoverable.

### Integration Points

The settings route is mounted by the local API next to existing session and PAW
profile routes. The PAW launch dialog receives formatted defaults from the
loaded settings state, while the Sessions page receives the parsed argv array so
restart command previews can match backend relaunch behavior.

Launch-claim reservation records carry the resolved terminal args before the
trusted hook binding pass, which lets later session writes preserve the launch
mode after the Copilot CLI plugin reports the real session id.

## User Guide

### Basic Usage

Open **Settings -> Session launch**. The default editor contains one Copilot CLI
option token per line. A fresh install shows `--yolo`.

Click **Save defaults** after changing the list. Future terminal PAW launches
that do not explicitly override CLI args use the saved defaults.

### Advanced Usage

To intentionally launch without defaults, clear the editor and click **Save
defaults**. Streamliner preserves the empty list, so future default-based
terminal launches and historical-session relaunches do not add `--yolo`.

New terminal sessions record the resolved CLI args. If defaults change later,
relaunching those recorded sessions still uses their recorded args. Historical
sessions that predate recorded args use the current defaults.

## API Reference

### Key Components

- `session-launch-settings.ts` owns validation, default path resolution, and
  async/sync settings reads used by launch and relaunch paths.
- `routes/session-launch-settings.ts` exposes the settings API.
- `terminal-command.ts` builds `copilot` resume commands with configured args
  followed by Streamliner's `--resume=<session>` argument.
- `session-policies.ts` builds the user-visible restart command with the same
  precedence as backend relaunch.

### Configuration Options

`defaultCliArgs` is a JSON array of strings. Missing settings fall back to
`["--yolo"]`. An explicit empty array is meaningful and disables default flags.

The settings file defaults to `~/.streamliner/state/session-launch-settings.json`.
If `STREAMLINER_STATE_ROOT` is set, the file is stored under that state root.

## Testing

### How to Test

Open Settings, change the Session launch defaults, and save. Then open a PAW
launch dialog for a terminal launch; the CLI args field should match the saved
defaults. Create or inspect a launched session in Sessions; restart command
previews should include recorded launch args when present, otherwise current
defaults.

### Edge Cases

- Empty settings are preserved as an intentional empty default list.
- Recorded empty args win over configured defaults during relaunch.
- Malformed settings are surfaced in Settings. Historical relaunches that need
  defaults fall back to built-in `--yolo`; recorded-args relaunches do not read
  settings.
- `--resume` is rejected in settings because Streamliner appends it during
  relaunch.

## Limitations and Future Work

This implementation only applies to terminal Copilot CLI launches. Managed SDK
launches do not consume or record Copilot CLI flags. The settings editor does not
perform shell parsing; users should enter one option token per line and use
`--flag=value` when an option needs a value.
