# PAW Launch Configuration and Prompt Defaults

## Overview

Streamliner can now prepare a selected workstream graph node for a PAW worker session without starting the visible terminal session. The implementation adds a PAW-focused graph launch dialog, a backend launch-preparation route, constrained PAW workflow initialization, kickoff prompt generation, WorkflowContext configuration editing, and a structured handoff for later terminal integration.

This work intentionally narrows the launch MVP to PAW. It does not introduce a general non-PAW launch profile system, and it keeps terminal start, launch-claim persistence, and session binding as separate follow-up responsibilities.

## Architecture and Design

### High-Level Architecture

The launch path has three cooperating pieces:

1. The React graph dashboard resolves the selected node and active workstream registry entry, then opens a PAW launch dialog only when the node is ready and the graph path is backend-readable.
2. `POST /api/launch-preparations` normalizes the launch configuration, initializes the PAW work area, asks existing launch-context assembly to write the worker context into that PAW work area, and builds the kickoff prompt.
3. The API returns a handoff that downstream terminal launch work can use later: working directory, branch, PAW work directory, workflow/context paths, CLI args, environment, session-state root, launch metadata, kickoff prompt, and the context package.

The visible Copilot CLI worker is not started by this feature. The returned handoff is the boundary between preparation and future terminal launch/claim-binding work.

### Design Decisions

**PAW WorkflowContext front end.** The issue originally references prompt profiles, but the implemented scope is deliberately PAW-focused rather than a generic profile abstraction. After preview feedback, the dialog was hot-rescoped from a small defaults form into a front end for PAW `WorkflowContext.md` options. It includes PAW and PAW Lite identities because both are PAW WorkflowContext values, while non-PAW launch profiles remain deferred.

**Preparation before terminal launch.** Streamliner prepares the launch artifacts first and shows the resulting handoff in the UI. This prevents a worker terminal from starting with incomplete context or a failed PAW initialization.

**Backend-readable graph gate.** The UI enables launch only for `entry.operationalStatus === "ready"` and workstream registry entries whose graph file is available to the backend. Browser-directory sources remain visible but unsupported for this MVP because the backend cannot read their graph path.

**Constrained SDK PAW initializer.** The default initializer uses `@github/copilot-sdk` with a single Streamliner-owned `initialize_paw_workflow` tool. Built-in tools are denied, and the allowed tool writes only the expected `WorkflowContext.md` path. Tests inject a runner to keep API behavior deterministic.

**File-based context handoff.** Launch preparation reuses context assembly and passes the PAW work directory as `outputDir`, so the worker-facing context is written to `.paw/work/<work-id>/streamliner/context.md`. The kickoff prompt points to that file instead of inlining context content.

**PAW-native validation.** The UI and backend use PAW's documented rules from `paw-init`, `paw-status`, planning/final review skills, and the PAW specification. Examples: minimal mode requires local review strategy; planning-only/final-PR-only policies require local strategy; PAW Lite requires custom/local/final-PR-only; Society-of-Thought review enables the corresponding planning/final review gate; single-model modes cannot carry multiple comma-separated models; multi-model modes require multiple models.

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

Select a ready graph node, then use **Launch PAW worker** in the inspector. Streamliner opens a preparation dialog showing presets, work identity, branches, WorkflowContext options, review modes, model fields, terminal preference, graph source, and optional builder custom message.

Choose **Cancel** to close the dialog without contacting the preparation API. Choose **Prepare launch** to initialize the PAW work area and generate the handoff. On success, the dialog shows the branch, PAW work directory, workflow context path, Streamliner context path, CLI args, and a collapsible kickoff prompt.

### Advanced Usage

The builder can clear the CLI args field to intentionally launch with no Copilot CLI arguments later; an explicit empty list is preserved rather than replaced with the default `--yolo`. The optional builder message is appended to the kickoff prompt in a `## Builder Custom Message` section and is omitted entirely when empty.

The default preset sends PAW defaults for a full local workflow with `reviewPolicy: "final-pr-only"`, planning docs review enabled, final local agent review disabled, and concrete model ids `gpt-5.5`, `claude-opus-4.7`, and `claude-opus-4.6-1m`. The dialog also provides presets for full local reviews, planning-only, minimal handoff, and PAW Lite. Terminal launch mode is manual because this feature prepares artifacts but does not open a terminal.

### WorkflowContext Options

The launch dialog maps to the PAW `WorkflowContext.md` header fields:

| Dialog group | WorkflowContext fields |
| --- | --- |
| Identity and execution | Work title/id, workflow identity, base/target branch, workflow mode, review strategy, review policy, session policy, remote, artifact lifecycle, artifact paths |
| Planning and implementation | Planning docs review, planning review mode/interactive/models, plan generation mode/models, implementation model |
| Final review | Final agent review, final review mode/interactive/models |
| Society of Thought and specialist routing | Planning/final specialists, interaction mode, specialist models, perspectives, perspective caps |
| Instructions and context | Custom workflow instructions, initial prompt marker, builder custom message |

The UI keeps common fields visible and places Society-of-Thought routing behind an expandable section. Validation errors are shown inline and disable **Prepare launch** until the configuration is internally consistent.

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

Configuration supports work title/id, base and target branch, cwd, PAW work directory, CLI args, environment variables, custom message, PAW workflow settings, and terminal preferences. PAW workflow settings include WorkflowContext values for identity/mode, review strategy/policy, session policy, planning/final review enablement, review modes/interactivity/models, Society-of-Thought routing, implementation/plan-generation models, custom instructions, initial prompt, remote, artifact lifecycle, and artifact paths. Invalid fields return a typed validation error instead of silently falling back.

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
- `buildKickoffPrompt` builds the worker prompt from context paths, launch metadata, and optional builder guidance.
- `PawLaunchDialog` is the UI component for editing launch defaults and reading the returned handoff.

## Testing

### How to Test

As a human, open the dashboard on the session-launching workstream, select `launch-prompt-profiles`, and choose **Launch PAW worker**. Confirm the dialog appears before any network preparation call, cancel closes it without preparing, and prepare shows a handoff summary without opening a terminal.

For visual review, use the screenshot harness against `.streamliner\workstreams\session-launching-and-tracking\graph.json` with the launch node selected and the launch button clicked.

### Edge Cases

- Non-ready nodes show a disabled launch action with an explanation.
- Browser-directory and missing/unreadable graph sources show an unsupported-source explanation.
- Empty CLI args are sent as `[]` and preserved.
- Single-model review modes reject multiple comma-separated models; multi-model modes require at least two models.
- PAW Lite requires workflow mode `custom`, review strategy `local`, and review policy `final-pr-only`.
- Society-of-Thought final review requires final agent review enabled; Society-of-Thought planning review requires planning docs review enabled.
- PAW init and context-preparation errors are shown in the dialog and do not produce a success-shaped handoff.
- Missing context package paths are treated as a preparation error.

## Limitations and Future Work

- The feature prepares launch artifacts only; it does not start Copilot CLI, create launch claims, or bind observed sessions to claims.
- Browser-only graph sources cannot launch until a backend-readable source bridge exists.
- Non-PAW launch profiles and persisted host-specific launch defaults are deferred.
- The PAW initializer writes the current WorkflowContext text shape and can be expanded later if PAW adds first-class machine-readable init APIs.
