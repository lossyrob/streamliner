---
date: 2026-05-07T17:16:25.9921510-04:00
git_commit: dfa02647ae7aa94822c49e1ecda117e4f07d3cb5
branch: feature/runtime-overlay-polish
repository: lossyrob/streamliner
topic: "Terminal launch portability seam"
tags: [research, codebase, terminal-launch, node-launch, relaunch]
status: complete
last_updated: 2026-05-07
---

# Research: Terminal launch portability seam

## Research Question

Map the current terminal launch path for GitHub issue #56 so implementation planning can preserve Windows behavior while isolating Windows Terminal and PowerShell assumptions behind a clearer seam.

## Summary

The terminal launch path is centered on `src/server/terminal-launch.ts`, which defines terminal launch options and results, chooses Windows Terminal or PowerShell, sanitizes the spawn environment, writes PowerShell launch scripts, and constructs the Copilot CLI interactive command (`src/server/terminal-launch.ts:7-29`, `src/server/terminal-launch.ts:69-85`, `src/server/terminal-launch.ts:104-141`, `src/server/terminal-launch.ts:156-201`, `src/server/terminal-launch.ts:203-264`). Graph node launches and session relaunches both depend on the same `TerminalLaunchOptions` / `TerminalLaunchResult` types and `launchTerminal` function (`src/server/node-launch.ts:12-17`, `src/server/node-launch.ts:330-343`, `src/session-registry/relaunch.ts:5-9`, `src/session-registry/relaunch.ts:104-149`). Public/shared contracts currently expose Windows-specific preference and result strings in the node launch handoff and response (`src/node-launch-record-contract.ts:3-10`, `src/node-launch-record-contract.ts:114-126`).

Launch preparation produces a `PawLaunchHandoff` with terminal preferences after merging defaults, workstream launch defaults, and per-launch configuration (`src/server/launch-preparation.ts:93-114`, `src/server/launch-preparation.ts:454-516`, `src/server/launch-preparation.ts:1739-1758`, `src/server/launch-preparation.ts:1881-1927`). The launch route validates the handoff, constraining `preferredTerminal` to `"default"`, `"windows-terminal"`, or `"powershell"` before calling the node launch service (`src/server/routes/node-launches.ts:193-219`, `src/server/routes/node-launches.ts:296-329`). Workstream graph configuration, parsing, and UI also use the same terminal preference literals (`src/workstream-schema.ts:32-38`, `src/workstream-view-model.ts:241-258`, `src/server/workstream-configuration.ts:86-129`, `src/components/WorkstreamConfigurationDialog.tsx:28-47`, `src/components/PawLaunchDialog.tsx:74-78`).

## Documentation System

- **Framework**: VitePress (`package.json:25-27`, `docs/design/.vitepress/config.ts:1-7`)
- **Docs Directory**: `docs/design` (`package.json:25-27`, `docs/design/index.md:23-35`)
- **Navigation Config**: `docs/design/.vitepress/config.ts` defines the VitePress nav/sidebar (`docs/design/.vitepress/config.ts:16-61`)
- **Style Conventions**: Design docs use YAML frontmatter and prose sections; the design index declares reading order and satellite document tables (`docs/design/index.md:1-21`, `docs/design/index.md:29-52`)
- **Build Command**: `npm run docs:build` (`package.json:25-27`)
- **Standard Files**: `docs/design/index.md` is the design entry point; `docs/design/session-system.md` contains terminal integration and relaunch design surface (`docs/design/index.md:23-35`, `docs/design/session-system.md:1088-1185`)

## Verification Commands

- **Test Command**: `npm test` (`package.json:23`)
- **Lint Command**: `npm run lint` (`package.json:12`)
- **Build Command**: `npm run build` (`package.json:11`)
- **Type Check**: `npm run build` includes `tsc -b` before `vite build` (`package.json:11`)
- **Focused Tests for this area**: `npm test -- src\server\terminal-launch.test.ts src\server\node-launch.test.ts src\server\launch-preparation.test.ts src\session-registry\relaunch.test.ts src\server\app.test.ts`

## Detailed Findings

### Core terminal launcher

- `TerminalLaunchResult` returns a `method` of `"windows-terminal"` or `"powershell"` plus optional PID; `TerminalLaunchOptions` accepts `cwd`, optional shell `command`, optional env, optional `preferredTerminal`, title, and tab color (`src/server/terminal-launch.ts:7-29`).
- Windows Terminal availability is cached in module state and checked with `execSync("where wt")`; PowerShell Core availability is checked with `execSync("where pwsh")` (`src/server/terminal-launch.ts:31-62`).
- `launchTerminal` routes `"powershell"` directly to PowerShell, routes `"windows-terminal"` to Windows Terminal with PowerShell fallback, and routes default preference to Windows Terminal with PowerShell fallback (`src/server/terminal-launch.ts:69-85`).
- Spawn environment construction copies the base env, canonicalizes Windows PATH casing, merges extra env values, and filters `node_modules/.bin` entries from PATH (`src/server/terminal-launch.ts:91-141`).
- PowerShell launch scripts are written under `STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT` or `~\.streamliner\state\terminal-launches`; scripts remove themselves, set `$ErrorActionPreference`, set location, then append the provided command (`src/server/terminal-launch.ts:147-172`).
- `buildCopilotInteractiveCommand` serializes the kickoff prompt as JSON, decodes it via PowerShell `ConvertFrom-Json`, PowerShell-quotes CLI args, and invokes `copilot -i $streamlinerKickoffPrompt` (`src/server/terminal-launch.ts:174-201`).
- `launchWindowsTerminal` builds `wt.exe new-tab` args, applies title/tab color/cwd, wraps commands through `pwsh.exe -NoExit -File <script>`, spawns detached with sanitized env, and returns method `"windows-terminal"` (`src/server/terminal-launch.ts:203-237`).
- `launchPowerShellTerminal` chooses `pwsh.exe` when available or `powershell.exe` otherwise, passes either `-Command Set-Location` or `-File <script>`, spawns detached with sanitized env, and returns method `"powershell"` (`src/server/terminal-launch.ts:239-264`).

### Node launch integration

- `launchPreparedNode` imports `buildCopilotInteractiveCommand`, `launchTerminal`, and terminal types from the terminal launcher (`src/server/node-launch.ts:12-17`).
- The node launch service validates launch policy and duplicate active launch claims before creating a new launch claim (`src/server/node-launch.ts:242-295`).
- After claim creation, it appends launch binding prompt lines, builds the Copilot interactive command, creates `TerminalLaunchOptions` with handoff `cwd`, command, environment, preferred terminal, title, and tab color, then calls the injected or default terminal launcher (`src/server/node-launch.ts:297-343`).
- Terminal spawn failure marks the launch claim failed with `terminal-spawn-failed`, logs failure details, and throws a typed `NodeLaunchError` (`src/server/node-launch.ts:354-397`).
- The node-launch tests assert terminal options include `preferredTerminal`, title, tab color, and trusted hook env values, and assert failed terminal spawns mark claims failed (`src/server/node-launch.test.ts:237-317`).

### Node launch API and records

- `parseTerminal` in the `/api/node-launches` route requires `launchMode: "manual"`, accepts the three current preference strings, normalizes title and tab color, and rejects any other preference (`src/server/routes/node-launches.ts:193-219`).
- `POST /api/node-launches` rejects non-loopback requests, blocks duplicate active operations, marks the operation launching, invokes `launchPreparedNode`, marks terminal launched, and returns the launch result (`src/server/routes/node-launches.ts:296-329`).
- `NodeLaunchRecordStore` stores operation statuses including `launching`, `launched_pending_binding`, and `terminal_failed` (`src/server/node-launch-record-store.ts:28-38`).
- `markTerminalLaunching`, `markTerminalLaunched`, and `markTerminalFailed` update persisted launch operations with terminal launch responses or operation errors (`src/server/node-launch-record-store.ts:358-399`).
- `NodeTerminalLaunchResponse` stores terminal method `"windows-terminal"` or `"powershell"` and optional PID in both route responses and persisted operation state (`src/node-launch-record-contract.ts:114-140`).

### Launch preparation and configuration flow

- `PawLaunchTerminalPreferences` in launch preparation uses launch mode `"manual"`, preferred terminal `"default" | "windows-terminal" | "powershell"`, title, and tab color (`src/server/launch-preparation.ts:93-98`).
- `parseConfigurationInput` normalizes terminal overrides and merges `DEFAULT_TERMINAL_PREFERENCES`, workstream terminal defaults, and request overrides (`src/server/launch-preparation.ts:282-287`, `src/server/launch-preparation.ts:454-516`).
- Workstream terminal defaults are derived from `launchDefaults.terminal` and optional title templates before configuration parsing (`src/server/launch-preparation.ts:1739-1758`).
- `preparePawLaunch` finalizes the handoff with terminal preferences, merged environment, kickoff prompt, launch metadata, context package, and optional SDK session debug data (`src/server/launch-preparation.ts:1881-1927`).
- Launch preparation route requests pass `configuration` into `preparePawLaunch`, expose both direct and run-based preparation endpoints, store active operations, and emit progress events over SSE for run-based launches (`src/server/routes/launch-preparations.ts:69-102`, `src/server/routes/launch-preparations.ts:171-230`, `src/server/routes/launch-preparations.ts:258-340`).
- Launch preparation tests cover default handoff terminal values, workstream terminal defaults, invalid preferred terminal values, direct route responses, run-based operation records, and duplicate preparation gating (`src/server/launch-preparation.test.ts:532-597`, `src/server/launch-preparation.test.ts:764-845`, `src/server/launch-preparation.test.ts:943-1160`).

### Session relaunch integration

- Relaunch imports the same terminal launcher types and function used by node launch (`src/session-registry/relaunch.ts:5-9`).
- `RelaunchResult.method` is currently `"windows-terminal" | "powershell"` and `buildRelaunchParams` creates `TerminalLaunchOptions` from `derivedWorktreePath ?? cwd`, optional `copilot --resume=<id>` command, title, and color (`src/session-registry/relaunch.ts:21-28`, `src/session-registry/relaunch.ts:39-45`, `src/session-registry/relaunch.ts:104-120`).
- `relaunchSession` calls the terminal launcher and reports `colorApplied` only when tab color was present and method is `"windows-terminal"`; it synthesizes a trusted `session.started` signal for resumed Copilot sessions (`src/session-registry/relaunch.ts:146-185`).
- Relaunch tests assert cwd-only launches, resume command construction, tab color propagation, derived worktree preference, and quote escaping for resume IDs (`src/session-registry/relaunch.test.ts:166-202`).
- The session relaunch route enforces loopback and JSON content type, calls `relaunchSession`, logs method, and returns the relaunch result or typed errors (`src/server/routes/sessions.ts:118-161`).

### Shared contracts and UI surfaces

- `NodeLaunchPreferredTerminal`, `NodeLaunchTerminalPreferences`, `NodeLaunchHandoff`, and `NodeTerminalLaunchResponse` define the shared frontend/backend node launch contract (`src/node-launch-record-contract.ts:3-10`, `src/node-launch-record-contract.ts:46-61`, `src/node-launch-record-contract.ts:114-126`).
- Workstream graph schema accepts `launchDefaults.terminal.preferredTerminal` from `WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES`, currently `"default"`, `"windows-terminal"`, and `"powershell"` (`src/workstream-schema.ts:32-38`, `src/workstream-schema.ts:119-127`).
- Workstream parsing validates launch defaults with the same preference literals (`src/workstream-view-model.ts:241-270`).
- Workstream configuration writes normalize `"default"` to absence and persist only non-default terminal values, title template, and tab color (`src/server/workstream-configuration.ts:86-129`, `src/server/workstream-configuration.ts:185-201`).
- The workstream configuration dialog labels `"windows-terminal"` as "Windows Terminal", `"powershell"` as "PowerShell", and `"default"` as "System default" (`src/components/WorkstreamConfigurationDialog.tsx:28-47`, `src/components/WorkstreamConfigurationDialog.tsx:160-179`).
- The PAW launch dialog exposes `Default`, `Windows Terminal`, and `PowerShell` options, stores the chosen preference in launch configuration, and sends terminal title/color overrides when launching a prepared handoff (`src/components/PawLaunchDialog.tsx:74-78`, `src/components/PawLaunchDialog.tsx:537-552`, `src/components/PawLaunchDialog.tsx:733-768`, `src/components/PawLaunchDialog.tsx:982-1004`).
- `App` posts terminal configuration to `/api/launch-preparations/runs`, then posts prepared handoff overrides to `/api/node-launches` and stores the `NodeTerminalLaunchResponse` in client launch operation state (`src/App.tsx:1767-1809`, `src/App.tsx:1700-1747`).

### Design documentation

- The workstream brief records #56 as a Wave 4 closeout item whose current launch implementation remains Windows-only while Windows Terminal / PowerShell assumptions are made adapter-local (`.streamliner/workstreams/session-launching-and-tracking/brief.md:178-187`).
- `docs/design/session-system.md` describes visible terminal sessions conceptually as `copilot -i "<kickoff prompt>" .`, with terminal adapters wrapping the command differently by local platform (`docs/design/session-system.md:1088-1099`).
- The relaunch design documents the current success response method type as `"windows-terminal" | "powershell"` and explains relaunch path resolution and resume command behavior (`docs/design/session-system.md:1126-1170`).
- The same design doc describes node launch display metadata for terminal title/color and immediate launch after PAW init (`docs/design/session-system.md:1172-1185`).

## Code References

- `src/server/terminal-launch.ts:7-264` - Core terminal launcher types, availability checks, environment sanitization, PowerShell command/script helpers, and Windows Terminal/PowerShell spawn functions.
- `src/server/node-launch.ts:233-399` - Prepared node launch service that creates claims, builds Copilot command, calls terminal launcher, and handles spawn failures.
- `src/server/routes/node-launches.ts:193-219` - Terminal handoff validation at the node launch API boundary.
- `src/server/routes/node-launches.ts:296-329` - Node launch route operation lifecycle and `launchPreparedNode` call.
- `src/server/launch-preparation.ts:93-114` - Launch preparation terminal preference and configuration types.
- `src/server/launch-preparation.ts:454-516` - Terminal preference normalization and configuration merge.
- `src/server/launch-preparation.ts:1881-1927` - Final `PawLaunchHandoff` construction.
- `src/session-registry/relaunch.ts:21-28` - Relaunch result method contract.
- `src/session-registry/relaunch.ts:104-185` - Relaunch terminal options, spawn call, and response mapping.
- `src/node-launch-record-contract.ts:3-10` - Shared preferred terminal and terminal preference contract.
- `src/node-launch-record-contract.ts:114-126` - Shared terminal launch response contract.
- `src/workstream-schema.ts:32-38` - Workstream graph terminal preference values.
- `src/components/PawLaunchDialog.tsx:74-78` - PAW launch dialog terminal options.
- `src/components/WorkstreamConfigurationDialog.tsx:28-47` - Workstream configuration terminal labels and help text.

## Architecture Documentation

The current architecture keeps launch claims, node launch records, registry binding, and relaunch as API/server concepts while using `src/server/terminal-launch.ts` for local terminal process spawning (`src/server/node-launch.ts:297-343`, `src/server/node-launch-record-store.ts:358-399`, `src/session-registry/relaunch.ts:146-185`). The public contract currently uses terminal preference strings and result method strings that identify concrete Windows host/shell implementations (`src/node-launch-record-contract.ts:3-10`, `src/node-launch-record-contract.ts:114-126`). Command construction for both node launch and relaunch is PowerShell-shaped: node launch uses `ConvertFrom-Json` and PowerShell literal quoting, while relaunch builds `copilot '--resume=<id>'` using PowerShell single-quote escaping (`src/server/terminal-launch.ts:181-201`, `src/session-registry/relaunch.ts:39-45`).

## Open Questions

None.
