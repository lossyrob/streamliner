# PAW Launch Configuration and Prompt Defaults

## Overview

Streamliner can now prepare a selected workstream graph node for a PAW worker session without starting the visible terminal session. The implementation adds a PAW-focused graph launch dialog, a backend launch-preparation route, staged Streamliner context generation, constrained PAW init skill orchestration, kickoff prompt generation, and a structured handoff for later terminal integration.

This work intentionally narrows the launch MVP to PAW. It does not introduce a general non-PAW launch profile system, and it keeps terminal start, launch-claim persistence, and session binding as separate follow-up responsibilities.

## Architecture and Design

### High-Level Architecture

The launch path has three cooperating pieces:

1. The React graph dashboard resolves the selected node and active workstream registry entry, then opens a PAW launch dialog only when the node is ready and the graph path is backend-readable.
2. `POST /api/launch-preparations` normalizes CLI/terminal options and the builder's natural-language PAW workflow instructions, stages the Streamliner context package in local Streamliner state, asks the PAW init skill to derive the PAW workflow and install that staged context into the PAW work area, and builds the kickoff prompt.
3. The API returns a handoff that downstream terminal launch work can use later: working directory, branch, PAW work directory, workflow/context paths, CLI args, environment, session-state root, launch metadata, kickoff prompt, and the context package.

The visible Copilot CLI worker is not started by this feature. The returned handoff is the boundary between preparation and future terminal launch/claim-binding work.

### Design Decisions

**Text-guided PAW init.** The issue originally references prompt profiles, but the implemented scope is deliberately PAW-focused rather than a generic profile abstraction. After preview feedback, the richer `WorkflowContext.md` configuration form was deferred to follow-up issue #43 so it can use PAW-owned metadata. The current dialog accepts natural-language PAW workflow instructions and lets the PAW init skill derive work title, work ID, target branch, review policy, model choices, and WorkflowContext settings.

**Preparation before terminal launch.** Streamliner prepares the launch artifacts first and shows the resulting handoff in the UI. This prevents a worker terminal from starting with incomplete context or a failed PAW initialization.

**Backend-readable graph gate.** The UI enables launch only for `entry.operationalStatus === "ready"` and workstream registry entries whose graph file is available to the backend. Browser-directory sources remain visible but unsupported for this MVP because the backend cannot read their graph path.

**Constrained SDK PAW initializer.** The default initializer uses `@github/copilot-sdk` with a custom PAW init agent that preloads the installed `paw-init` skill. Built-in tools are denied. The only exposed tool is `complete_paw_init`, which writes `WorkflowContext.md`, copies the staged Streamliner context into the PAW work directory, and appends the installed context path to `Additional Inputs`. Tests inject a runner to keep API behavior deterministic.

**Staged context handoff.** Launch preparation first reuses context assembly without `outputDir`, so the worker-facing context is written to Streamliner's local state under `launch-contexts/<context-id>/context.md`. PAW init then installs that staged file into `.paw/work/<work-id>/streamliner/context.md` and records it as an additional workflow input. The kickoff prompt points to the installed file instead of inlining context content.

**Question handling.** Launch preparation is non-interactive. The PAW init prompt explicitly tells the skill to use documented defaults and best judgment rather than asking follow-up questions. If PAW init still asks a question or cannot safely proceed, the API reports a typed `paw_init_failed` error instead of waiting indefinitely or returning a success-shaped handoff.

### Integration Points

- `src/App.tsx` coordinates selected-node launch state, posts launch preparation requests, and renders success/error handoff state.
- `src/components/NodeInspector.tsx` displays the launch action and unsupported-state messaging for the selected node.
- `src/components/PawLaunchDialog.tsx` owns the editable PAW launch form and handoff summary.
- `src/components/paw-launch-config.ts` defines shared PAW launch defaults and UI/backend request types.
- `src/server/routes/launch-preparations.ts` exposes the preparation route under `/api/launch-preparations`.
- `src/server/launch-preparation.ts` contains launch configuration normalization, PAW initialization, kickoff prompt generation, and handoff assembly.
- `src/server/launch-context.ts` remains the source of the worker-facing Streamliner context package.

## User Guide

### Prerequisites

- The graph node must be selected in the Streamliner dashboard.
- The selected node must be operationally ready.
- The active workstream must be registered from a backend-readable local graph path with `fileStatus: "available"`.

### Basic Usage

Select a ready graph node, then use **Launch PAW worker** in the inspector. Streamliner opens a preparation dialog showing a PAW workflow instructions textarea, Copilot CLI args, terminal preference, and graph source.

Choose **Cancel** to close the dialog without contacting the preparation API. Choose **Prepare launch** to initialize the PAW work area and generate the handoff. On success, the dialog shows the branch, PAW work directory, workflow context path, Streamliner context path, CLI args, and a collapsible kickoff prompt.

### Advanced Usage

The builder can clear the CLI args field to intentionally launch with no Copilot CLI arguments later; an explicit empty list is preserved rather than replaced with the default `--yolo`.

The default workflow instruction text asks PAW init for a local final-PR-only workflow, no intermediate pauses unless blocked, and concrete model ids `gpt-5.5`, `claude-opus-4.7`, and `claude-opus-4.6-1m` where PAW asks for multi-model planning or review choices. Terminal launch mode is manual because this feature prepares artifacts but does not open a terminal.

### PAW Init Prompting

The PAW init SDK prompt is built in `src/server/launch-preparation.ts` by `buildPawInitPrompt`. It includes:

| Prompt input | Purpose |
| --- | --- |
| Builder workflow instructions | Natural-language PAW workflow guidance the skill uses for workflow derivation |
| Selected node and graph path | Workstream launch identity |
| Tracker/issue URL | Optional work source for PAW work title/id derivation |
| Staged Streamliner context path | Source file that `complete_paw_init` installs into the PAW work directory |
| Non-interactive rule | Tells PAW init to use defaults/best judgment and return blocked JSON for serious blockers |

The `complete_paw_init` tool is responsible for copying the staged context to `.paw/work/<work-id>/streamliner/context.md`, writing WorkflowContext.md, and ensuring `Additional Inputs` includes `streamliner-context=<installed-path>`.

### Worktree Preview Workflow

To inspect this PR branch without disrupting a main Streamliner instance, start an isolated preview from the worktree:

```powershell
npm run preview:worktree -- --name pr-41 --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
```

The preview launcher starts detached API and Vite processes on free ports, writes runtime state under `.streamliner-preview\<name>\`, disables the session background worker, and seeds an isolated workstream registry from the supplied graph. The default `readonly` mode blocks mutating API requests; use `--mode sandbox` only when intentionally testing write flows against disposable preview state.

Stop or inspect the preview with:

```powershell
npm run preview:status -- --name pr-41
npm run preview:stop -- --name pr-41
```

## API Reference

### `POST /api/launch-preparations`

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `nodeId` | yes | Selected workstream graph node id. |
| `graphPath` | no | Backend-readable graph path; the UI supplies the active registry entry path. |
| `launchNonce` | no | Optional launch token to preserve for later claim binding. |
| `configuration` | no | PAW launch configuration overrides. |

Configuration supports cwd, CLI args, environment variables, `workflowInstructions`, and terminal preferences. Invalid fields return a typed validation error instead of silently falling back.

Response fields:

| Field | Meaning |
| --- | --- |
| `cwd` | Working directory for the future worker session. |
| `branch` | Target branch prepared for the worker. |
| `pawWorkDir` | PAW workflow directory. |
| `workflowContextPath` | Path to `WorkflowContext.md`. |
| `streamlinerContextPath` | Path to the generated `streamliner/context.md`. |
| `kickoffPrompt` | Initial prompt for the future Copilot CLI worker. |
| `cliArgs` | Copilot CLI args after defaults and overrides. |
| `environment` | Non-secret environment values to provide to the future launch. |
| `sessionStateRoot` | Copilot/Streamliner session state root used for later observation. |
| `launchMetadata` | Workstream, node, branch, work ID/title, repo, tracker, nonce, and claim metadata. |
| `contextPackage` | Full launch-context package returned by context assembly. |

Errors include `code`, `error`, `step`, and `input` so the UI can distinguish validation, PAW initialization, and context-preparation failures.

### Key Components

- `preparePawLaunch` is the backend orchestration entry point.
- `defaultPawInitRunner` is the production PAW initializer backed by a constrained Copilot SDK session.
- `buildKickoffPrompt` builds the worker prompt from context paths and launch metadata.
- `PawLaunchDialog` is the UI component for editing workflow instructions and reading the returned handoff.

## Testing

### How to Test

As a human, open the dashboard on the session-launching workstream, select `launch-prompt-profiles`, and choose **Launch PAW worker**. Confirm the dialog appears before any network preparation call, cancel closes it without preparing, and prepare shows a handoff summary without opening a terminal.

For visual review, use the screenshot harness against `.streamliner\workstreams\session-launching-and-tracking\graph.json` with the launch node selected and the launch button clicked.

### Edge Cases

- Non-ready nodes show a disabled launch action with an explanation.
- Browser-directory and missing/unreadable graph sources show an unsupported-source explanation.
- Empty CLI args are sent as `[]` and preserved.
- Empty workflow instructions disable **Prepare launch**.
- If PAW init asks a clarification question instead of using defaults, the API returns a `paw_init_failed` error and the dialog displays it.
- PAW init and context-preparation errors are shown in the dialog and do not produce a success-shaped handoff.
- Missing context package paths are treated as a preparation error.

## Limitations and Future Work

- The feature prepares launch artifacts only; it does not start Copilot CLI, create launch claims, or bind observed sessions to claims.
- Browser-only graph sources cannot launch until a backend-readable source bridge exists.
- Non-PAW launch profiles and persisted host-specific launch defaults are deferred.
- Rich PAW WorkflowContext configuration UI is deferred to issue #43 so Streamliner can use PAW-owned metadata for presets, specialists, constraints, and derived fields.
