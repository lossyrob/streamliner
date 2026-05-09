# Respect Copilot Launch Flags Implementation Plan

## Overview

Implement configurable Copilot CLI terminal launch defaults, record resolved
terminal launch arguments on Streamliner-launched sessions, and use those
arguments when relaunching sessions. The architecture adds a small settings
store/API, extends launch/relaunch command construction, updates dashboard
settings and session command previews, and documents the precedence rules.

## Current State Analysis

- `src\server\launch-preparation.ts` defaults omitted PAW terminal `cliArgs` to
  `["--yolo"]`, while explicit arrays, including `[]`, are honored.
- `src\App.tsx` separately seeds PAW launch dialog defaults with `--yolo`.
- `src\session-registry\relaunch.ts` builds resume commands with only
  `copilot --resume=<id>`.
- `src\terminal-command.ts` owns PowerShell literal quoting and resume command
  construction.
- `src\components\session-policies.ts` builds the visible restart command shown
  in the Sessions UI.
- `src\server\routes\paw-launch-prompt-profiles.ts` provides the local JSON
  settings pattern to reuse for persistence and atomic writes.
- `src\session-registry-schema.ts` and `src\session-registry\file-store.ts`
  currently type launched origins without recorded launch args, even though
  stored unknown fields are partially preserved.
- `src\server\node-launch.ts` has access to resolved terminal `handoff.cliArgs`
  before creating launch-claim reserved rows.

## Desired End State

- Streamliner has one persisted local setting for default Copilot CLI terminal
  launch option tokens.
- The default setting starts as `["--yolo"]`, can be replaced, and can be
  intentionally cleared to `[]`.
- Terminal launch preparation and the PAW launch dialog consume configured
  defaults when no explicit args are provided.
- Newly launched terminal sessions persist resolved launch args in typed
  launched-origin metadata; the value survives claim binding and later writes.
- Relaunch and visible restart commands use this precedence:
  1. recorded launched-session args, including `[]`;
  2. configured defaults;
  3. built-in `["--yolo"]` fallback for a missing settings document.
- Sessions with recorded args do not need to read defaults, so malformed
  settings cannot block those relaunches.

## What We're NOT Doing

- Adding Copilot CLI flags to managed SDK launches.
- Changing Copilot CLI consent, approval, or permission behavior.
- Supporting shell-specific parsing or quoting syntax beyond the current
  PowerShell command path.
- Migrating historical sessions that lack recorded launch args.
- Supporting positional kickoff prompts in the default launch flag setting.

## Phase Status

- [x] **Phase 1: Settings store and API** - Persist and validate default launch
  flags with built-in `--yolo` defaults.
- [x] **Phase 2: Registry metadata and launch recording** - Add typed recorded
  args to launched origins and write them during terminal launches.
- [ ] **Phase 3: Relaunch command precedence** - Apply recorded/default args to
  relaunch and restart command previews without regressing context behavior.
- [ ] **Phase 4: Dashboard settings integration** - Add Settings UI and replace
  the hard-coded PAW launch dialog seed with configured defaults.
- [ ] **Phase 5: Documentation and screenshots** - Document behavior and capture
  representative UI screenshots.

## Phase Candidates

<!-- None pending. -->

---

## Phase 1: Settings store and API

### Changes Required:

- **`src\server\session-launch-settings.ts`**: Add a reusable store module
  following the prompt profile route's JSON document and atomic write pattern.
  It should expose built-in defaults, load/save helpers, validation, and a
  default path under `STREAMLINER_STATE_ROOT ?? ~/.streamliner/state`.
- **`src\server\routes\session-launch-settings.ts`**: Add `GET` and `PUT`
  handlers for default launch flags.
- **`src\server\app.ts`**: Mount the route and allow tests to inject an
  isolated settings path.
- **Tests**: Add route/store tests covering fresh defaults, save/update,
  explicit empty lists, malformed store errors, and rejection of malformed or
  resume-specific option tokens.

### Success Criteria:

#### Automated Verification:
- [ ] Settings tests pass with fresh, updated, empty, malformed, and invalid
      inputs.
- [ ] Existing server route tests still pass.

#### Manual Verification:
- [ ] A fresh local state with no settings file reports `--yolo`.
- [ ] Saving an empty list remains empty after reload.

---

## Phase 2: Registry metadata and launch recording

### Changes Required:

- **`src\session-registry-schema.ts`**: Extend launched origins with typed
  `cliArgs?: string[] | null` metadata representing recorded terminal launch
  args.
- **`src\session-registry\file-store.ts`**: Update origin input parsing,
  validation, clone/preserve paths, and merge behavior so `cliArgs` round-trip
  as first-class launched-origin metadata.
- **`src\session-registry\launch-claims.ts`**: Ensure launch-claim reserved rows
  accept and preserve recorded args through trusted signal binding.
- **`src\server\launch-preparation.ts`** and **`src\server\routes\launch-preparations.ts`**:
  Accept injected default args from the settings store when request
  configuration omits `cliArgs`, while preserving explicit arrays including
  `[]`.
- **`src\server\node-launch.ts`**: Store the resolved terminal `handoff.cliArgs`
  on the launch-claim reserved row for terminal launches.
- **Tests**: Add schema/file-store/launch-claim tests for recorded args
  round-tripping through create, write, bind, and reload. Add launch-preparation
  tests showing configured defaults are used only when `cliArgs` is omitted.

### Success Criteria:

#### Automated Verification:
- [ ] Schema and file-store tests prove `cliArgs` survive write/read cycles.
- [ ] Launch-claim binding tests prove recorded args survive claim binding.
- [ ] Launch-preparation tests prove configured defaults, explicit non-empty
      args, and explicit empty args all resolve correctly.

#### Manual Verification:
- [ ] A new terminal launch creates a session record with the resolved launch
      args.

---

## Phase 3: Relaunch command precedence

### Changes Required:

- **`src\terminal-command.ts`** and **`src\server\terminal-launch.ts`**: Extend
  resume command construction to accept additional Copilot CLI args, quote each
  with the existing PowerShell helper, and append the Streamliner-owned resume
  argument last.
- **`src\session-registry\relaunch.ts`**: Resolve launch args using recorded
  args before settings defaults. Do not read defaults when recorded args are
  present, including `[]`. Preserve existing relaunch working directory, title,
  color, launch-terminal dependency, and trusted signal synthesis behavior.
- **`src\server\routes\sessions.ts`** and **`src\server\app.ts`**: Wire settings
  defaults into relaunch dependencies without affecting tests that inject
  relaunch doubles.
- **`src\components\session-policies.ts`** and **`src\components\SessionsPage.tsx`**:
  Allow visible restart command previews to receive configured defaults and use
  the same recorded/default precedence as the relaunch action.
- **Tests**: Add relaunch tests for recorded non-empty args, recorded empty args,
  configured defaults, malformed settings with recorded args, malformed settings
  without recorded args, PowerShell quoting, and preserved cwd/title/color/signal
  behavior. Add session-policies tests for preview command precedence.

### Success Criteria:

#### Automated Verification:
- [ ] Relaunch tests pass for all tri-state precedence cases.
- [ ] A malformed settings store does not block recorded-args relaunch.
- [ ] Visible restart command tests match relaunch precedence.
- [ ] Existing relaunch behavior tests still pass.

#### Manual Verification:
- [ ] Copying a restart command from the Sessions view matches the relaunch
      command for the selected session.

---

## Phase 4: Dashboard settings integration

### Changes Required:

- **`src\components\session-launch-settings.ts`**: Add a client helper for the
  settings API and a shared parser/formatter for UI text and argv arrays.
- **`src\components\SessionLaunchSettingsPage.tsx`**: Add a settings page for
  default Copilot CLI terminal launch option tokens. Use a line-oriented or
  token-oriented editor rather than shell parsing, make empty saves explicit,
  and show `--yolo` as the example.
- **`src\dashboard-routing.ts`** and **`src\App.tsx`**: Expand settings routing
  to include Session launch while preserving `/settings/profiles` and
  `/profiles`. Load settings once, refresh after saves, pass defaults to
  `SessionsPage`, and replace the hard-coded `cliArgsText: "--yolo"` launch
  default with loaded settings text.
- **Tests**: Add routing/client/parser tests where practical. Ensure the parser
  rejects resume-specific tokens and does not silently split shell-quoted text
  into unsupported semantics.

### Success Criteria:

#### Automated Verification:
- [ ] UI helper tests pass for formatting, empty input, invalid tokens, and
      settings route selection.
- [ ] Existing App and session UI tests still pass.

#### Manual Verification:
- [ ] `/settings/session-launch` opens the new settings page.
- [ ] `/settings/profiles` and `/profiles` still open PAW profiles.
- [ ] Saving an empty settings input clearly persists an empty default list.
- [ ] The PAW launch dialog default args reflect the configured defaults.

---

## Phase 5: Documentation and screenshots

### Changes Required:

- **`.paw\work\respect-copilot-launch-flags\Docs.md`**: Add as-built technical
  documentation covering settings, precedence, storage, and verification.
- **`README.md` and/or `DEVELOPING.md`**: Add user-facing configuration guidance
  for default launch flags, `--yolo`, recorded-args precedence, and historical
  sessions.
- **Screenshots**: Use `scripts\screenshot.mjs` to capture the new Settings
  page. Store local screenshots under `.screenshots\` during development and
  publish PR screenshots according to repository convention.

### Success Criteria:

#### Automated Verification:
- [ ] Relevant tests pass.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.

#### Manual Verification:
- [ ] The Settings screenshot shows the new Session launch page and default flag
      guidance.
- [ ] Documentation accurately describes configured defaults, recorded args
      precedence, explicit empty settings, and historical-session behavior.

---

## References

- Issue: https://github.com/lossyrob/streamliner/issues/88
- Spec: `.paw/work/respect-copilot-launch-flags/Spec.md`
- Research: `.paw/work/respect-copilot-launch-flags/CodeResearch.md`
