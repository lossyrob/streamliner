---
kind: design-doc
status: draft
last_updated: 2026-05-03
update_semantics: rewrite-in-place
authoritative_for: "Session launching, lifecycle, registry contract, tracking, and runtime overlay"
scope_tags:
  - sessions
  - registry
  - launch
  - tracking
  - runtime-overlay
code_paths:
  - src/App.tsx
  - src/session-registry*.ts
  - src/session-registry/**
  - src/server/**
  - src/components/NodeInspector.tsx
  - src/components/PawLaunchDialog.tsx
  - src/components/SessionsPage.tsx
  - src/server/session/**
  - src/server/context/**
  - src/components/session/**
  - copilot-plugin/streamliner/**
references_decisions:
  - 1
  - 2
  - 4
  - 5
  - 6
  - 8
---

# Session System

The session system is how Streamliner launches, monitors, and surfaces AI coding agent sessions. A **session** is a Copilot CLI agent instance executing a specific node's work in a workstream — or, equivalently, any Copilot CLI instance the builder has chosen to track. Streamliner maintains a local, graph-independent **session registry** as the authoritative record for tracked sessions ([Decision 004](decisions/004-session-registry-primary-surface.md)), observes each session's Copilot CLI state files to populate liveness and workflow-status fields, and projects that combined state onto the committed graph as a runtime overlay without writing ephemeral telemetry back into `graph.json`. Sessions launched from the graph and sessions the builder tracks manually are the same kind of record; the launch pipeline writes onto an existing or newly created registry row rather than maintaining a parallel store.

## Launch Contract

The Wave 3 launch MVP is **PAW-only launch initialization**. The contract is the interface between the graph UI, which lets the builder configure and run PAW init for a ready node, and the backend, which prepares the PAW work area, worker context, kickoff prompt, and structured handoff. Launch preparation and worker launch are distinct: Streamliner uses Copilot SDK to prepare context, run PAW initialization, and compile prompts, but the visible worker session is still a Copilot CLI interactive session. Starting that terminal and binding the discovered session to a launch claim remain separate downstream steps.

### Launch Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Workstream ID | Graph selection | Which workstream the node belongs to |
| Node ID | Graph selection | Which node to execute |
| Target repo | Graph `repos` + config | Where the code lives |
| Backend-readable graph path | Workstream registry entry | Local `graph.json` path the backend can read |
| Launch instructions | Builder edit + default text | Natural-language guidance for the graph-launched PAW session. PAW init may use it to derive work title, work ID, target branch, review policy, and model settings, but general operating guidance belongs in the kickoff prompt rather than verbatim `Custom Workflow Instructions`. |
| PAW prompt profile | Local Streamliner state | Optional reusable text snippet that can populate or update the launch instructions field |
| CLI arguments | Default + builder override | Copilot CLI flags for the later worker launch; an explicit empty list is valid |
| Terminal preference | Default + builder edit | Manual terminal launch handoff in this MVP |
| Launch nonce | Caller/downstream launch owner | Token preserved for later claim binding |

The builder selects a node in the graph and initiates launch from the inspector. Streamliner only enables the action when the selected `WorkstreamDerivedNode` is operationally ready and the active workstream registry entry is backend-readable. Browser-directory workstreams remain visible in the graph UI, but they are not launchable in this MVP because the backend cannot read their graph file.

This design specifies **local launches only**. The launch contract keeps an environment dimension so future remote execution can fit the same shape, but `devbox` launch is not defined here. Devbox observation is defined later as an extension of the session-tracking model, not as a launch mode.

### Launch Sequence

Launch is a two-phase process: a **PAW init phase** that prepares all worker artifacts, followed later by a **Copilot CLI interactive launch** that starts the visible worker session. The preparation phase is not the worker session itself; it exists to assemble context, initialize PAW, compile the prompt, resolve CLI arguments, select the working directory, and preserve launch-claim metadata for terminal integration. The implemented MVP covers the PAW init phase and returns the terminal handoff; it does not start the worker terminal.

#### Phase 1 — PAW Launch Initialization

Streamliner's backend prepares a PAW handoff with one fully capable internal Copilot SDK session. Backend code still validates the selected graph node, computes deterministic metadata, and chooses local package paths, but context synthesis and PAW initialization now share the same SDK session, model context, tool access, and progress stream. The session preloads the installed `paw-init` skill, enables config discovery, approves built-in tool use, and adds Streamliner-owned `save_streamliner_context` and `complete_paw_init` tools. Initialization:

1. **Normalizes launch configuration** — applies defaults for workflow instruction text, CLI args, terminal mode, and environment values.
2. **Prepares context inputs** — deterministically collects graph, brief, design-doc, and tracker/spec references plus freshness/unavailable-input metadata. This creates the target `launch-contexts/<context-id>/context.md` location but does not start a separate context SDK session.
3. **Saves worker context** — the internal SDK session reads repository, design-doc, GitHub, and configured MCP context as needed, synthesizes the selected node's Layer 0-3 `context.md`, and persists it through `save_streamliner_context`.
4. **Runs PAW init** — the same SDK session uses the `paw-init` skill with Copilot CLI-style repository, shell, GitHub, configured MCP, and custom-tool access. The prompt supplies the builder launch instructions, selected node, tracker URL, and saved context path, and tells PAW init to use documented defaults/best judgment rather than asking follow-up questions. Streamliner asks PAW init to treat the builder text as launch guidance and configuration input, not as verbatim custom workflow-stage instructions unless the text explicitly defines a custom PAW sequence.
5. **Installs the context file** — after `paw-init` writes `WorkflowContext.md` through the normal PAW workflow path, the Streamliner-owned completion tool, `complete_paw_init`, copies the saved context package to `.paw/work/<work-id>/streamliner/context.md` and verifies that `WorkflowContext.md` records the installed Streamliner context as an Additional Input. The Additional Inputs line should only carry the worker-facing Streamliner context file, not internal launch metadata such as staged context package paths, graph path, context ID, node ID, or nonce.
6. **Preserves launch metadata** — carries the launch nonce and future claim reference fields through metadata without owning claim persistence.
7. **Compiles kickoff prompt** — turns PAW workflow context, installed Streamliner context path, work identity, branch, nonce, target repos, and tracker URL into the initial instruction for the worker session.
8. **Returns structured output** — returns the handoff the terminal launcher needs.

Launch preparation output:

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | string | Worktree or checkout path where the session should run |
| `branch` | string | Branch name created or checked out |
| `pawWorkDir` | string | PAW work directory containing launch artifacts |
| `workflowContextPath` | string | Path to `WorkflowContext.md` |
| `streamlinerContextPath` | string | File path to the worker-facing `streamliner/context.md` |
| `cliArgs` | string[] | Copilot CLI arguments after layered defaults and builder overrides |
| `environment` | object | Non-secret environment values for the later terminal launch |
| `sessionStateRoot` | string | Path to Copilot session state directory in the local environment |
| `launchMetadata` | object | Workstream, node, repo, branch, work ID/title, tracker, nonce, and claim metadata |
| `contextPackage` | object | Context package metadata from context assembly |
| `kickoffPrompt` | string | Initial prompt passed to Copilot CLI interactive mode |

#### Phase 2 — Copilot CLI Interactive Launch

After PAW launch initialization completes, future terminal integration will:

1. **Record launch claim** — write a launch claim to Streamliner's runtime state binding the node to the expected session location before the worker session starts
2. **Launch Copilot CLI** — reuse the lower-level terminal spawning path used by session relaunch, opening a visible terminal in the returned `cwd` and starting Copilot CLI interactive mode with the selected/default CLI arguments
3. **Pass the kickoff prompt** — launch the worker session with the initial prompt already populated, conceptually equivalent to `copilot <cli-args> -i "<kickoff prompt>" .`
4. **Bind on discovery** — when the session watcher detects the new Copilot session, bind it to the launch claim

### PAW Launch Configuration and Init Instructions

The implemented launch surface is a text-guided PAW init dialog, not the full PAW `WorkflowContext.md` configuration UI. Defaults are intentionally visible to the builder in the instructions textarea:

- PAW should use a local final-PR-only workflow.
- PAW should not pause for intermediate review unless there is a serious blocker, unsafe ambiguity, missing credentials/infrastructure, or material scope mismatch.
- PAW should use `gpt-5.5`, `claude-opus-4.7`, and `claude-opus-4.6-1m` where it asks for concrete multi-model planning or review choices.
- PAW should proceed through implementation and documentation, then create the final PR.
- CLI args default to `--yolo`; an explicit empty override remains empty.
- Terminal launch mode is `manual` with a default terminal preference because this phase returns a handoff rather than opening a terminal.

The dialog supports lightweight PAW prompt profiles: named reusable text snippets stored at the local Streamliner server state level. Profiles are not PAW-owned metadata and do not encode structured constraints; selecting one only replaces the free-text launch instructions, and the builder can edit the text before running PAW init. The dialog can save the current text as a new profile or update the selected profile.

After PAW init succeeds, the dialog loads the generated `WorkflowContext.md` so the builder can review or make last-minute manual edits before future terminal launch. The edit surface is intentionally bounded to the prepared PAW work directory. It is a debugging and correction affordance for the launch MVP, not a replacement for PAW init's normal workflow generation.

Reusable non-PAW launch profiles, persisted host-specific defaults, broader instance/project/workstream/node layering, and the rich PAW configuration form are deferred. The rich PAW form is tracked in issue #43 and should use PAW-owned metadata rather than reimplementing PAW init rules in Streamliner.

### Kickoff Prompt

The kickoff prompt is a first-class launch artifact, not ad hoc terminal text. It tells the worker session what kind of run this is and how to begin. At minimum it must encode:

- The selected launch instructions and PAW configuration expectations
- The work item identity (workstream, node, repo, branch/worktree)
- Where the prepared context artifacts live
- The launch nonce on a dedicated line so the watcher can confirm the intended binding
- Any CLI-argument assumptions, review-policy expectations, or launch-time operating constraints
- Any PAW-specific startup guidance, such as workflow/review configuration text

Opening a terminal in the correct directory is not a launch. A launch is only complete once Streamliner has prepared the kickoff prompt and started Copilot CLI interactive mode with that prompt.

For the PAW MVP, the kickoff prompt starts by telling the worker to read both `WorkflowContext.md` and `streamliner/context.md`. It then lists launch identity fields including project, workstream, node, branch, work ID, launch nonce, future claim reference, target repos, and tracker URL when one is available. The prompt includes the builder's launch instructions from the graph settings so pause policy, review expectations, blocker handling, and PR-description preferences travel with the worker session without overloading PAW's `Custom Workflow Instructions` field. The prompt states that the Streamliner context has already been installed into the PAW work directory and recorded as an Additional Input.

### Failure Modes

| Failure | Behavior |
|---------|----------|
| Node not launchable (wrong status, unmet deps) | Disable in the UI or reject with explanation |
| Graph source is browser-only or unavailable to the backend | Disable in the UI or reject with unsupported-source explanation |
| Target repo not registered or inaccessible | Reject with explanation |
| Branch conflict (already exists, dirty state) | Prompt builder for resolution |
| Launch preparation failure (PAW initialization, context assembly, prompt compilation) | Report typed error with step/input details; do not start terminal |
| PAW init asks a clarification question during preparation | Treat as `paw_init_failed`; surface the question/error in the dialog rather than waiting indefinitely |
| Internal SDK launch session stalls | No short default timeout is applied; operators can set `STREAMLINER_PAW_LAUNCH_TIMEOUT_MS` as a whole-run watchdog and inspect the internal session state path surfaced in progress/logs |
| Copilot CLI launch failure | Report error, clean up launch claim |

## Context Assembly

Context assembly builds a single worker-facing `context.md` that orients a worker session to a node's mission without copying authoritative source material wholesale. The file preserves the conceptual Layer 0–3 sections, but delivery is consolidated so the worker has one file to read. Context assembly runs inside launch preparation. Streamliner deterministically collects source material and metadata, then the same fully capable SDK session that runs PAW init synthesizes the markdown so workstream-level background can be reframed as worker-relevant context instead of conflicting task instructions.

### Layer 0 — Project Design Context

Layer 0 tells the worker that the repo's design layer is the authority and that it should navigate the design docs directly. The workstream's `designRefs`, brief references, and node spec links are hints into that design layer, not a required reading list, fixed ordering, or exhaustive design scope.

- Point at the design index (`docs/design/index.md`) as the cold-reader entry point
- Treat `designRefs` and brief references as possible starting points
- Follow the index and referenced docs into other `current` design docs and accepted decision records when they are relevant to the node
- Surface `draft` design docs only as hints when they are explicitly named in `designRefs` or the node's spec

Design docs are already committed files. Layer 0 is worker-facing navigation guidance, not a copied design-doc bundle or an agent-chosen set of required reading. The worker reads the authoritative docs directly from the target repo (or registered design repo) at the current HEAD, using any listed paths as hints.

### Layer 1 — Worker Mission

Synthesized from the selected node's tracker/spec, the graph node, and relevant workstream intent:

- The selected node's concrete responsibility
- Key boundaries and non-goals for this worker
- Relevant source-of-truth links the worker should read directly

### Layer 2 — Relevant State

Synthesized from workstream state, decisions, and source metadata:

- Current state that affects this node
- Decisions and constraints that change how the worker should approach the node
- Missing or degraded context inputs when they are actionable

### Layer 3 — Coordination Context

Synthesized from the graph neighborhood and tracker/spec references:

- **Wave context**: which checkpoint/wave the node belongs to, what preceded it, what follows
- **Node spec reference**: the GitHub issue URL or local spec file path; the worker reads that source directly
- **Coordination notes**: any cross-node coordination context from the orchestrator
- **Relevant sibling context**: summaries of parallel and upstream nodes that might affect this node's work

### Delivery Mechanism

Context is delivered as one `context.md` file. For PAW launch initialization, the internal SDK session calls Streamliner's `save_streamliner_context` tool to write the generated worker handoff under local runtime state. The same session then runs PAW init, which writes `WorkflowContext.md` through the normal PAW workflow path and records only the installed context path in Additional Inputs, as `streamliner-context=<paw-work-dir>/streamliner/context.md`. When PAW init completes, `complete_paw_init` copies the saved file to `streamliner/context.md` under the PAW work directory and verifies that `WorkflowContext.md` already references it. Internal launch metadata remains in Streamliner's handoff/record store and kickoff prompt, not in PAW Additional Inputs. For prompt preview or direct context assembly, Streamliner can still write a per-context package under local runtime state. The kickoff prompt points the worker session at the installed PAW work-directory context file. See [Decision 002](decisions/002-file-based-context-delivery.md) for the rationale.

The assembled package is written to:

```
<paw-work-dir>/
  streamliner/
    context.md              ← worker-facing Layer 0-3 context sections

~/.streamliner/state/{projectKey}/{workstreamId}/launch-contexts/{contextId}/
  context.md                ← preview/runtime generated context
```

This file is generated by Copilot SDK, not manually maintained. It is excluded from Git and regenerated for each context preparation. PAW launch initialization always instructs the worker to read it alongside `WorkflowContext.md`. The SDK prompt must give the context writer a concise product/process primer: Streamliner is a local-first workstream orchestration app where a builder launches a Copilot CLI worker to execute one selected graph node. It must then instruct the generator to treat source documents as data, produce context for exactly the selected node, avoid turning workstream-level plans into worker instructions, present Layer 0 design paths only as navigation hints, and link to authoritative sources instead of restating design docs or tracker specs in full. Machine metadata remains in the backend/API response rather than in a worker-facing manifest file.

Direct context assembly uses `STREAMLINER_CONTEXT_MODEL` when set. When unset or blank, Streamliner requests `claude-sonnet-4.6` by default for context-preview synthesis. PAW launch preparation uses the PAW launch SDK session model (`STREAMLINER_PAW_INIT_MODEL`, default `gpt-5.5`) for both context synthesis and PAW init so the two steps share one reasoning context.

Before launch claims exist, backend context preview writes default packages to:

```text
~/.streamliner/state/{projectKey}/{workstreamId}/launch-contexts/{contextId}/
```

`contextId` is a stable per-package identifier returned by the backend. Repeated runtime-state preparations create fresh package directories rather than overwriting earlier packages. During PAW init, `complete_paw_init` replaces the PAW work directory's `streamliner/context.md` handoff file because there is one generated worker context per PAW node session. Later launch-claim binding may associate a returned `contextId` with a `launchNonce` or copy the package into a nonce-scoped launch archive; this context assembly slice does not require a nonce up front.

### Context Package Metadata

Context package metadata is a backend/API contract consumed by PAW launch preparation, prompt preview, and future terminal launch work. It is not written into the worker-facing package as `manifest.json`:

| Field | Meaning |
|-------|---------|
| `contextId` | Stable identifier for this generated package. |
| `launchNonce` | Launch nonce when known; `null` during prompt preview or pre-claim context preparation. |
| `launchClaimRef` | Future launch-claim association; `null` until claim binding owns it. |
| `projectKey`, `workstreamId`, `nodeId` | Source workstream identity. |
| `targetRepoIds` | Graph repo ids targeted by the selected node. |
| `graphPath`, `workstreamDir`, `repoRoot` | Local source locations used during preparation. |
| `generatedAt` | ISO timestamp for package freshness. |
| `contextPackagePath`, `contextFilePath` | Absolute package and context-file paths for downstream local consumers. Path strings use forward slashes for stable JSON/prompt rendering. |
| `contextModel` | Requested Copilot SDK model id used for synthesis, defaulting to `claude-sonnet-4.6` unless `STREAMLINER_CONTEXT_MODEL` is set. |
| `sourceReferences` | Graph, brief, design, tracker, and local-spec references with git object hashes or content hashes when available. |
| `unavailableInputs` | Missing or degraded optional inputs, such as missing design docs or local tracker files. |

### Backend Preparation APIs

The local API exposes PAW launch preparation as both a compatibility synchronous route and the UI-facing run route:

```http
POST /api/launch-preparations
POST /api/launch-preparations/runs
GET /api/launch-preparations/runs/:runId
GET /api/launch-preparations/runs/:runId/events
```

Request body:

| Field | Required | Meaning |
|-------|----------|---------|
| `nodeId` | yes | Selected graph node id. |
| `graphPath` | no | Backend-readable graph file to use; the UI supplies the active workstream registry path. |
| `launchNonce` | no | Optional nonce preserved in metadata and the kickoff prompt for later claim binding. |
| `configuration` | no | PAW launch configuration overrides: workflow instruction text, CLI args, environment, and terminal preferences. |

The synchronous response body, and the run route's final `result`, contain:

| Field | Meaning |
|-------|---------|
| `cwd`, `branch`, `pawWorkDir` | Execution handoff location and branch. |
| `workflowContextPath`, `streamlinerContextPath` | Prepared PAW and Streamliner context files the worker must read. |
| `kickoffPrompt` | Initial worker prompt for the future Copilot CLI session. |
| `cliArgs`, `environment`, `sessionStateRoot` | Launch command inputs for downstream terminal integration. |
| `launchMetadata` | Workstream/node/repo/branch/work/nonce/claim/tracker metadata. |
| `contextPackage` | Full context package metadata produced by context assembly. |

Validation, PAW initialization, and context-preparation failures return JSON with `code`, `error`, `step`, and `input` fields. The route never starts a terminal.

The dialog uses the run route. `POST /api/launch-preparations/runs` returns a `runId`, then the browser subscribes to `GET /api/launch-preparations/runs/:runId/events` as an SSE stream. Streamed events are intentionally sanitized progress records: phase changes, assistant status messages, tool start/finish names, final success, or typed failure. Raw prompts, full tool arguments, secrets, and model reasoning deltas are not browser-facing status.

Internal SDK launch sessions persist under Streamliner's local state rather than the normal Copilot session-state root. The default root is `~/.streamliner/state/copilot-sdk/paw-launch/<context-id>/`, with `STREAMLINER_COPILOT_SDK_STATE_ROOT` available for override. Run progress and API logs surface the SDK `sessionId` and workspace path for debugging, but these internal sessions are not intended to appear in Streamliner's observed Sessions view.

The PAW launch dialog is intentionally text-guided for this MVP. It exposes launch instructions, lightweight reusable text profiles, CLI args, terminal preference, graph source, and the prepared handoff after backend PAW init. The primary action is labeled as running PAW init because the SDK session may read repository files, inspect git/GitHub context, execute shell tools, and write the PAW work artifacts before returning the structured handoff. PAW-owned metadata, structured presets, specialists, and dependent WorkflowContext constraints are deferred to issue #43 so Streamliner does not duplicate PAW's configuration rules.

Reusable text prompt profiles are exposed as:

```http
GET /api/paw-launch-prompt-profiles
POST /api/paw-launch-prompt-profiles
PUT /api/paw-launch-prompt-profiles/:id
```

Profiles are stored in local Streamliner state as `paw-launch-prompt-profiles.json`. Each record contains an id, name, instructions, created timestamp, and updated timestamp. `POST` creates a new profile from the current workflow text; `PUT` updates the selected profile. The server validates non-empty names and instruction text but does not interpret PAW semantics.

The post-init review/edit surface for PAW WorkflowContext is exposed as:

```http
GET /api/paw-workflow-context?path=<WorkflowContext.md>
PUT /api/paw-workflow-context
```

The workflow-context route only accepts `WorkflowContext.md` paths under `.paw/work` for the current server worktree. `GET` returns `{ path, content, updatedAt }`; `PUT` writes the supplied content and returns the same shape. This lets the builder inspect or edit PAW init output before a later terminal launch without giving the browser arbitrary filesystem write access.

The local API exposes context assembly as:

```http
POST /api/launch-contexts
```

Request body:

| Field | Required | Meaning |
|-------|----------|---------|
| `nodeId` | yes | Selected graph node id. |
| `graphPath` | no | Graph file to use; defaults to the API-configured graph path. |
| `outputDir` | no | Absolute PAW work directory supplied by launch preparation. Streamliner writes `{outputDir}/streamliner/context.md`. Defaults to runtime-state `launch-contexts/{contextId}/context.md`. |
| `launchNonce` | no | Optional nonce when a caller already has one. |

Response body:

| Field | Meaning |
|-------|---------|
| `contextId` | Stable generated package id. |
| `contextPackagePath` | Absolute package directory. |
| `contextFilePath` | Absolute path to the generated worker-facing `context.md`. |
| `metadata` | Structured system-level context metadata for PAW launch preparation, prompt preview, and terminal launch work. |
| `unavailableInputs` | Convenience JSON copy of `metadata.unavailableInputs`; consumers should use one source to avoid duplicate warnings. |

Missing or invalid graph/node request inputs are client errors. Missing optional context sources are recorded in `unavailableInputs` while still producing a package. Path fields in the JSON response use forward slashes for stable string comparison and prompt rendering, even on Windows. They remain local absolute paths unless marked as relative paths.

## Session Lifecycle

### Observed States

Streamliner does not require sessions to self-report their status. Instead, it observes Copilot CLI's own session state files and derives lifecycle state from what it sees. See [Decision 001](decisions/001-observation-based-session-tracking.md) for the rationale.

```
launching → discovered → active ⇄ idle → ended
```

| State | Meaning | How detected |
|-------|---------|--------------|
| `launching` | Launch preparation done, Copilot CLI worker launch in progress | Launch claim recorded by Streamliner |
| `discovered` | Session directory appeared, metadata being read | `workspace.yaml` exists in session state |
| `active` | Agent turn in progress | `events.jsonl` recently modified |
| `idle` | Agent turn completed, waiting for user input or next action | Turn boundary detected (no new `assistant.turn_start` after `assistant.turn_end` or `agentStop` hook) |
| `ended` | Session finished or went stale | Hook signal, prolonged inactivity, or session directory removed |

### Derived UI Fields

Beyond the core lifecycle state, the session watcher derives additional fields for the UI:

| Field | Source | Description |
|-------|--------|-------------|
| `pendingInputRequest` | Unresolved `ask_user` tool request in `events.jsonl` | The session is blocked waiting for the builder to answer a question |
| `phase` | Latest event types in `events.jsonl` | Human-readable: "reasoning", "tool-calling", "idle" |
| `endReason` | Hook signal or inactivity | Why the session ended: "hook-signal", "idle-timeout", "user_exit" |
| `turnCount` | Count of `user.message` events | How many user turns have occurred |
| `pawWorkflow` | PAW work directory on disk, when present | Artifact-derived workflow summary: work id/title when discoverable, likely workflow kind, latest/coarsest stage indicated by PAW artifacts, artifact freshness, and any ambiguity diagnostics. See [Decision 008](decisions/008-paw-artifacts-for-workflow-status.md). |

### Key Distinction: Idle vs. Ended

- **Idle** means the agent completed its turn and is waiting. The builder may need to go interact with the session (answer a question, provide input, review output). This is the most important status for the builder's attention allocation.
- **Ended** means the session is no longer running. The artifacts (commits, PRs, code changes) are the result.

### State Transitions

- **launching → discovered**: Session state directory appears in Copilot session state root
- **discovered → active**: `events.jsonl` starts being written to
- **active → idle**: Agent turn completes (`assistant.turn_end` event, `agentStop` hook, or inactivity threshold)
- **idle → active**: New `assistant.turn_start` event (builder sent input, or agent resumed)
- **active → ended**: Session end hook signal or prolonged inactivity beyond ended threshold
- **idle → ended**: Prolonged inactivity beyond ended threshold or session end hook signal
- **discovered → ended**: No events written within timeout (session failed to start)

### Stale Session Detection

A session is considered ended when its `events.jsonl` modification time exceeds the ended threshold (default: 30 minutes of inactivity). This is conservative — sessions that the builder is actively using interactively may have long pauses between turns, so the threshold must accommodate human-paced interaction.

Crash recovery is not automatic. The builder decides whether the work is recoverable (relaunch from the same PAW work directory) or needs a fresh start.

## Session Tracking

### Observation Model

Streamliner tracks sessions by observing Copilot CLI's own session state files. See [Decision 001](decisions/001-observation-based-session-tracking.md) for the rationale.

Each Copilot CLI session maintains state at:

```
~/.copilot/session-state/{session-id}/
  workspace.yaml          ← session metadata (id, cwd, repo, branch, summary)
  events.jsonl            ← append-only event log (turns, tool calls, hooks)
```

### Session Registry

The **session registry** is Streamliner's authoritative, local-first record for tracked sessions. See [Decision 004](decisions/004-session-registry-primary-surface.md) for the product framing and [Decision 005](decisions/005-session-registry-storage-and-identity.md) for the concrete storage/identity contract. The registry is graph-independent and exists so cross-session context survives restarts regardless of whether a session was launched from the graph.

#### Record shape

Each registry entry is a persisted `SessionRegistryRecord`. The stored lifecycle field is named **`lifecycleStatus`** rather than bare `status` so it cannot be confused with the observation-derived liveness states from [Observed States](#observed-states).

| Field | Type | Required | Source | Notes |
|-------|------|----------|--------|-------|
| `schemaVersion` | integer | yes | Streamliner | Record schema version. Starts at `1`. |
| `version` | integer | yes | Streamliner | Monotonic builder-edit version used by the HTTP API for optimistic concurrency. Legacy records default to `0`. |
| `id` | string | yes | Streamliner | Stable Streamliner-owned identifier. It is never the Copilot session id. |
| `title` | string | yes | Builder | Short editable label. Observation-created rows bootstrap this from `workspace.yaml.summary`, then fall back to repo/cwd naming until the builder edits it. |
| `description` | string | yes | Builder | Longer editable notes; empty string allowed. |
| `color` | string or `null` | yes | Builder | Palette token or hex; single source of truth for terminal/UI color bridges. |
| `cwd` | string | yes | Observation or builder | Absolute relaunch path and merge guardrail. |
| `repo` | string or `null` | yes | Observation or builder | Normalized `owner/name` when known; otherwise the repo root path; `null` when unknown. |
| `branch` | string or `null` | yes | Observation or builder | Last known branch when one is available. |
| `copilotSessionId` | string or `null` | yes | Observation | Linked Copilot CLI session id when the row is tied to an observed session. |
| `aiSummary`, `aiSummaryModel`, `aiSummaryUpdatedAt`, `aiSummaryEventsFingerprint`, `aiSummaryStatus`, `aiSummaryError` | string/status fields or `null` | yes | Worker | Optional persisted conversation description and refresh metadata. The worker may transiently read bounded recent `events.jsonl` user turns to produce `aiSummary`, but it does not persist the raw prompt/event bodies in these fields. |
| `lifecycleStatus` | `active \| paused \| ended \| archived` | yes | Builder + observation | Durable coarse lifecycle. Observation only owns the transition into `ended`; archiving is builder-driven. |
| `lastSeenAt` | ISO 8601 string or `null` | yes | Observation | Last observed activity timestamp; `null` for never-observed manual entries. |
| `createdAt`, `updatedAt` | ISO 8601 string | yes | Streamliner | Record creation and last persisted update timestamps. |
| `tags` | string[] | yes | Builder | Freeform labels; default `[]`. |
| `origin.kind` | `manual \| observed \| launched` | yes | Streamliner | How the row first entered the registry. The `origin` object is discriminated by this field. |
| `origin.importedFromCopilotSessionId` | string or `null` | no | Observation | Present when the row was originally created from discovery import. |
| `origin.launchClaimId` | string or `null` | no | Launch pipeline | Present when the row was created from or first linked through a launch/relaunch claim. |
| `graphBinding` | object or `null` | yes | Launch pipeline or builder | Optional `{ workstreamId, nodeId, launchClaimId }` binding for graph projection. |

`lifecycleStatus` is intentionally coarse and durable. The fine-grained, observation-derived liveness of a currently-live Copilot session (`launching`, `discovered`, `active`, `idle`, `ended`) is an orthogonal derived view layered on top of the registry row at render time, not a field stored on the row. A single registry entry can be `lifecycleStatus: active` and observation-`idle` simultaneously — those are independent axes and the overlay composes them.

Only observed rows may carry `origin.importedFromCopilotSessionId`; only launched rows may carry `origin.launchClaimId`; manual rows carry neither. Persisted schema and API types should encode that constraint directly rather than relying on convention.

`graphBinding` is the shared linkage contract between My Sessions and the graph. The registry stores stable IDs only; display labels, grouping names, and navigation targets are derived by joining `{ workstreamId, nodeId }` against the current workstream catalog and graph. When the workstream or node cannot be resolved, the Sessions view keeps the row visible with degraded "unknown workstream/node" labeling rather than dropping the linkage.

Registry entries are created in three ways:

1. **Manual** — the builder explicitly creates a row before Streamliner has observed a session.
2. **Observed** — the watcher discovers a Copilot session with no matching registry row and creates one from the observation metadata it has.
3. **Launched** — the launch/relaunch pipeline creates or reserves a row first, then observation later links the live Copilot session onto that row.

#### Storage layout

The registry lives under a global subtree of Streamliner's local runtime-state root:

```text
~/.streamliner/state/
  session-registry/
    api.lock
    index.json
    entries/
      {registry-id}.json
    quarantine/
      {timestamp}-{registry-id}.json
    registry.lock
  {projectKey}/{workstream-id}/
    runtime.json
    sessions.json
    tracker-cache.json
```

- **`entries/{registry-id}.json` is authoritative.** Each file holds one full `SessionRegistryRecord`.
- **`index.json` is a denormalized summary, not the source of truth.** It exists for fast list rendering and rebuilds from the entry files whenever it is missing, malformed, version-incompatible, or observably stale. It carries the exact list-surface fields needed by `listSessions()`, including `version`, `title`, `description`, `tags`, lifecycle, origin, freshness, and graph-binding metadata.
- **`registry.lock` is an advisory single-writer lock.** Exactly one process is expected to mutate registry files at a time; readers never require the lock.
- **`api.lock` is the standalone API process lock.** It prevents accidental duplicate Streamliner API processes from owning the same registry worker and live event stream.
- **`quarantine/` holds bad inputs.** Malformed JSON, unsupported schema versions, and partially written files are moved here and excluded from normal reads until the builder repairs or deletes them.

Hand-edited files are tolerated when they still parse and match the supported schema version. Unknown extra fields are preserved on rewrite rather than dropped opportunistically. If an entry file and `index.json` disagree, the entry file wins: missing index rows are rebuilt from entries, and orphaned index rows are dropped on rebuild.

#### Autosave and write semantics

- UI edits to `title`, `description`, and `color` debounce for **500 ms** and flush immediately on blur, submit, or shutdown.
- Writers update files with **write-then-rename** in the destination directory so readers never see a half-written JSON payload.
- Builder mutations carry `expectedVersion` from the row snapshot the builder edited. If the latest row has a different `version`, the API rejects the write with `409 Conflict` and returns `{ error, latest, conflictingFields }`.
- Successful builder mutations increment `version` when they change builder-owned fields (`title`, `description`, `color`, `tags`, `graphBinding`, or builder-driven `lifecycleStatus`). Derived observation updates do not increment `version`, so liveness refreshes do not churn open edit sheets.
- After a conflict, the UI reloads the latest row and asks the builder to re-apply their intended field edits rather than silently overwriting another page's save.
- Writers that cannot acquire `registry.lock` stay read-only rather than writing blind. This keeps the near-term concurrency model aligned with the runtime-state single-writer rule.

#### Observation import and merge

The observation model defined by [Decision 001](decisions/001-observation-based-session-tracking.md) remains authoritative for session-state discovery and liveness. The discovery source of truth is Copilot CLI's session-state root:

- **`workspace.yaml`** — session id, cwd, repository, branch, timestamps
- **`events.jsonl`** — activity and turn/event stream
- **Hook signal files** (`{id}.start.json`, `{id}.turn.json`, `{id}.end.json`) — low-latency hints only, never the durable source of truth

Discovery uses both a **startup scan** of the session-state root and **`fs.watch()`** for ongoing updates. Merge precedence is:

1. If a registry row already has the same `copilotSessionId`, update that row.
2. Else if an active launch/relaunch claim resolves to a known registry row, link the discovered session onto that row.
3. Else if there is **exactly one** non-archived manual row with no `copilotSessionId`, `lastSeenAt: null`, and matching `cwd`, `repo`, and `branch` (ignoring fields that are `null` on both sides), attach the discovered session to that row and preserve the builder-owned fields already on it.
4. Else create a new `origin.kind: observed` row.

Observation may refresh `copilotSessionId`, `cwd`, `repo`, `branch`, `lastSeenAt`, and the transition from `lifecycleStatus: active | paused` to `ended`. It does **not** overwrite builder-edited `title`, `description`, `color`, `tags`, or an existing `graphBinding` unless a launch/relaunch claim explicitly owns that binding update.

The manual-row attach rule is deliberately strict. Streamliner does **not** fuzzy-match by `cwd` alone, and it does not auto-attach when more than one manual row could plausibly match. Ambiguous cases fall back to a new observed row plus an explicit builder bind/reconcile step.

Observation never auto-archives. A linked row becomes `ended` when a clean end signal arrives or when the stale-session fallback fires after the watcher has not seen activity within the configured timeout. `archived` is only reached through an explicit builder action. Archived rows stay archived and are excluded from automatic rediscovery matching; a newly observed session creates a fresh row unless a relaunch flow explicitly reactivates the archived entry first.

#### Trusted Copilot CLI signals

Filesystem discovery alone is intentionally weak: it can see Copilot SDK/helper sessions as well as terminal sessions the builder actually cares about. Streamliner therefore treats Copilot CLI plugin hooks as the trust/admission layer and the Copilot session-state files as the observation layer:

1. A trusted hook signal creates or updates a registry row for a real Copilot CLI/Agency session.
2. The background worker watches the matching `~/.copilot/session-state/{session-id}` folder for workspace metadata, process locks, transcripts, and summarization.
3. Filesystem-only observed rows remain diagnostics-only by default. Helper-like rows are pruned or hidden.

Trusted signal fields are persisted on both full records and list entries:

| Field | Meaning |
|-------|---------|
| `trustedSignalSource` | Source that admitted the session, currently `copilot-cli-hook`. `null` means filesystem-only/diagnostic. |
| `trustedStartedAt` | Timestamp of the latest trusted `session.started` signal. |
| `trustedEndedAt` | Timestamp of the latest trusted `session.ended` signal. |
| `trustedLastSignalAt` | Timestamp of the latest trusted signal of any supported type. |
| `trustedStartSource` | Copilot hook start source such as `new`, `resume`, or `startup`. |
| `trustedEndReason` | Copilot hook end reason such as `complete`, `user_exit`, `error`, `abort`, or `timeout`. |
| `trustedExecutionKind` | Whether the trusted session came from direct Copilot CLI (`copilot_cli`) or Agency (`agency`). |
| `trustedInitialPromptLength`, `trustedLastPromptLength` | Privacy-preserving prompt metadata. Hook prompt bodies are reduced to lengths before persistence; raw hook prompt text is not stored in trusted-signal registry fields. |

The default Sessions view prioritizes trusted lifecycle buckets:

- **Active Copilot sessions** — trusted start, no trusted end, and a live process lock.
- **Interrupted / resumable** — trusted start, no trusted end, but no live process lock. This is the expected restart/crash recovery state and remains `lifecycleStatus: active`.
- **Recently ended** — trusted end signal seen recently.
- **Pinned / launched** — manual or launched rows the builder created explicitly.
- **Observed diagnostics** — filesystem-only rows, visible through "Show all observed" rather than the default view.

Trusted signals do not override archive intent. Archived rows reject automatic observation/trusted-signal reactivation unless a future explicit relaunch flow reactivates them first.

#### Trusted signal transport

The Streamliner Copilot CLI plugin under `copilot-plugin/streamliner/` ships hooks for `sessionStart`, `userPromptSubmitted`, and `sessionEnd`. The hook script emits Streamliner-normalized events:

| Plugin hook | Streamliner event | Required fields | Optional fields |
|-------------|-------------------|-----------------|-----------------|
| `sessionStart` | `session.started` | `source`, `sessionId`, `timestamp`, `cwd` | `repo`, `branch`, `hookSource`, `executionKind`, `initialPromptLength` |
| `userPromptSubmitted` | `prompt.submitted` | `source`, `sessionId`, `timestamp`, `cwd` | `executionKind`, `promptLength` |
| `sessionEnd` | `session.ended` | `source`, `sessionId`, `timestamp`, `cwd` | `endReason`, `executionKind` |

The hook script first tries `STREAMLINER_SESSION_SIGNAL_ENDPOINT`, typically `POST /api/sessions/signals` on the local Streamliner host. If no endpoint is configured or the POST fails quickly, it writes a complete JSON file to the local spool:

```text
~/.streamliner/state/session-signals/
  pending/
    {timestamp}-{pid}-{session-id}-{random}.json
  failed/
    {original-file-name}.json
```

The background worker drains `pending/` before discovery and summarization. Successfully ingested files are deleted. Invalid files move to `failed/` for inspection. Missing-file races are ignored because another process may have drained or cleaned a file between directory listing and read.

Registry import also inherits Decision 001's compatibility contract. If the Copilot compatibility probe cannot verify the expected event/file shapes, Streamliner may still create or update rows from `workspace.yaml`, but any observation-derived freshness or liveness that depends on unverified event parsing is surfaced as degraded confidence rather than fabricated certainty.

#### Local API service

The session registry is served by a standalone local Express process, not by the Vite development server. See [Decision 006](decisions/006-local-streamliner-api-service.md). The API process owns registry mutations, trusted signal ingestion, background observation/summarization, and the live session event stream. Vite is a frontend-only process and proxies `/api/*` to the API process in development and preview.

The default service address is loopback-only:

| Setting | Default | Meaning |
|---------|---------|---------|
| `STREAMLINER_API_HOST` | `127.0.0.1` | Interface the local API binds to. |
| `STREAMLINER_API_PORT` | `4319` | TCP port for direct API access and Vite proxying. |
| `STREAMLINER_GRAPH` | unset | Optional default graph path served by `GET /api/graph.json`. |

The local HTTP surface includes:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Process liveness probe used by dev tooling. |
| `GET /api/graph.json` | Load the configured graph file or default fixture. |
| `GET /api/recents` | Return recently opened graph files. |
| `POST /api/pick-file` | Native local file picker bridge. |
| `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions`, `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id`, `POST /api/sessions/:id/archive` | Registry list/read/mutation API. |
| `POST /api/sessions/signals` | Loopback-only trusted Copilot CLI hook signal intake. |
| `GET /api/sessions/events` | Server-sent event stream for live registry changes. |

The initial live sync protocol uses `EventSource` over `GET /api/sessions/events`. New clients receive a `snapshot` event unless they reconnect with a replayable `Last-Event-ID`. Subsequent buffered changes are emitted as `session.upserted`, `session.deleted`, or `session.rebuilt` with monotonic event ids; id-less `heartbeat` events keep intermediaries from treating the stream as idle without consuming replay ids. The API keeps a bounded replay buffer, and the browser also refreshes on window focus/visibility changes so reconnect gaps degrade to a normal reload rather than stale UI.

In development, `npm run dev` starts both long-lived processes: `npm run dev:api` for the API and `npm run dev:web` for Vite. Vite dev and preview are loopback-bound by default so trusted signal intake cannot be exposed to the LAN through the frontend proxy. Frontend HMR or a Vite restart does not restart the registry worker, and API restarts do not require rebuilding the frontend. For direct API debugging, run `npm run api` or `npm run dev:api` and call `http://127.0.0.1:4319/api/...` directly.

#### Public surface

The dashboard and future relaunch flows consume the registry through the local API. The API delegates to the shared store contract under `src/session-registry/`, keeping persisted schema shapes separate from consumer-facing view/mutation shapes.

| Operation | Contract |
|-----------|----------|
| `listSessions(options?)` | Returns list items sorted by `lastSeenAt` then `updatedAt`; excludes archived rows by default; `options.text` matches `title`, `description`, and `tags`. |
| `getSession(id)` | Returns the full registry record or `null`. |
| `upsertSession(input)` | Creates or replaces a row for manual, observed, or launched sources using the identity/merge rules above. Lifecycle input is source-sensitive: observation may create newly discovered active rows and may also upsert rows that are already `ended`; caller-driven manual/launch upserts may not create `ended` or `archived` rows directly. |
| `attachObservedSession(id, observation)` | Links a discovered Copilot session onto an existing manual or launched row without rewriting its original `origin.kind`. Observation-owned fields (`copilotSessionId`, `lastSeenAt`, `cwd`, `repo`, `branch`, observation-driven `ended`) flow through this operation. This operation does not let observation write builder-owned `paused` or `active` lifecycle transitions onto an existing row. |
| `patchSession(id, patch)` | Applies builder-owned edits (`title`, `description`, `color`, `tags`, `graphBinding`, builder-driven lifecycle changes). Builder patches do not force `ended`; HTTP callers pass `expectedVersion` for conflict detection. |
| `archiveSession(id)` | Convenience mutation that sets `lifecycleStatus` to `archived`. |
| `deleteSession(id)` | Explicit destructive cleanup for rows the builder intentionally wants removed; never used by observation. |
| `subscribe(listener)` | Emits discriminated change notifications: `upsert` carries `{ registryId, snapshot }`, `delete` carries `{ registryId }`, and `rebuild` carries `{ registryIds }`. |

The public contract deliberately separates **persisted schema shapes** from **consumer-facing view/mutation shapes**. The persisted record/index types live in `src/session-registry-schema.ts`; the API-facing list, patch, upsert, event, and store-contract types live in `src/session-registry-contract.ts`.

### Discovery

Streamliner watches the session state root directory (`~/.copilot/session-state/`) using filesystem notifications (`fs.watch`). When a new session directory appears, the watcher reads `workspace.yaml` for initial metadata, creates or updates the corresponding registry entry, and begins polling `events.jsonl` for activity.

### Activity Detection

The watcher polls `events.jsonl` modification times at a configurable interval (default: 30 seconds). When the file's mtime changes:

1. Read only the new bytes since the last read (incremental tail, anchored on the byte offset of the last parsed event) rather than a point-in-time tail window. This guarantees every event is seen exactly once regardless of log size.
2. Extract metadata: repository, branch, turn count
3. Detect turn boundaries: look for `assistant.turn_end` events or `agentStop` hook events without a subsequent `assistant.turn_start`
4. Detect pending input: maintain a **per-session incremental index of open tool requests**. As each `assistant.message.toolRequests` entry is observed, record its tool-call ID in the session's open-requests set; as each `tool.execution_complete` is observed, remove the matching ID. `pendingInputRequest` is true iff the open-requests set contains an `ask_user` call. The index persists across watcher restarts (rehydrated from runtime state) so long-running sessions do not lose pending-input detection when an unresolved request falls outside any bounded tail window.
5. Detect PAW artifact status when applicable: for sessions launched through Streamliner's PAW flow, sessions with PAW launch metadata, or sessions with a reachable `.paw/work/*/` directory, inspect the durable PAW artifact set and derive a coarse workflow-status summary. `WorkflowContext.md` and `ReviewContext.md` may contribute artifact identity or headings, but `## Control State` is not authoritative. See [Decision 008](decisions/008-paw-artifacts-for-workflow-status.md).

### Two Orthogonal State Sources

Session tracking combines a required liveness source with optional workflow-artifact sources that should not be collapsed:

- **Copilot session state** (`~/.copilot/session-state/{id}/`) — liveness, turn boundaries, pending input requests, end reasons. Authoritative for *is the session alive and does it need attention?*
- **PAW artifact state** (`.paw/work/<work-id>/...`) — for PAW-backed sessions only: durable workflow artifacts such as specs, plans, research, implementation phase artifacts, review artifacts, and PR/finalization artifacts. Authoritative for *what PAW artifacts exist and what coarse workflow status they imply?*

Streamliner overlays Copilot session state onto every bound graph node and overlays PAW artifact status when a session has PAW artifacts or PAW launch metadata. Neither subsumes the other: a session can be idle while PAW artifacts indicate mid-workflow progress, and PAW artifacts can advance across sessions that this watcher never observed. Launch and tracking require PAW initialization for the MVP graph-launch path, but they do not require `## Control State` parsing to succeed.

### Hook Signals

Copilot CLI plugin hooks are the trusted admission signal for default-visible sessions. They complement polling but do not replace Copilot's session-state files:

| Hook | Streamliner event | Purpose |
|------|-------------------|---------|
| `sessionStart` | `session.started` | Admits a real Copilot CLI/Agency terminal session and starts observation for its session-state folder. |
| `userPromptSubmitted` | `prompt.submitted` | Updates trusted activity timestamps and prompt-length-only metadata without storing prompt text. |
| `sessionEnd` | `session.ended` | Records clean session exit and reason. |

Hooks are **trust signals, not complete state**. If the plugin is not installed, Streamliner may still discover session folders for diagnostics, but those rows stay observed-only by default because they may be SDK/helper sessions. Once a hook admits a session, the worker uses polling over `workspace.yaml` and `events.jsonl` to keep the registry current even if later prompt/end signals are delayed.

### Devbox Observation Access

Devbox support extends the same trust/observation split across a host boundary.
The first devbox observability slice targets a builder-registered devbox reached
through local runtime configuration, not committed workstream secrets. A concrete
devbox registration supplies a logical environment id, display name, access
method, remote Copilot session-state root, and optional repo/path hints in local
Streamliner config. Credentials, tokens, key material, and tunnel secrets remain
owned by SSH, Azure CLI, the OS credential store, or an equivalent external
credential manager.

The preferred access model is a devbox-side Streamliner bridge reached from the
local Streamliner process through a builder-managed access channel such as an
SSH local port forward or an authenticated Dev Tunnel. The bridge listens on
devbox loopback, accepts the same normalized trusted hook signal payloads as
`POST /api/sessions/signals`, spools them on the devbox when the laptop is
unreachable, and exposes bounded observation endpoints for session-state
snapshots and event tails. The bridge is not a replacement source of truth for
session status: Copilot CLI's `workspace.yaml`, `events.jsonl`, and in-use lock
files remain the observed facts.

The first production transport over that bridge is versioned HTTP/JSON polling,
not a remote filesystem mount and not a cloud relay. The minimum bridge surface
is:

| Endpoint | Role |
|----------|------|
| `GET /health` | Bridge reachability, version, host clock, session-root access, hook-spool health, and diagnostics. |
| `GET /capabilities` | Supported observation features and limits, including snapshot, event tail, signal ingest/read, lock liveness, and path conventions. |
| `GET /sessions/snapshot` | Bounded startup/current-state scan of recent sessions with workspace metadata, event-file cursors, event-shape summaries, trusted-signal summaries, and lock state. |
| `GET /sessions/{copilotSessionId}/events` | Offset-based incremental event tail returning complete normalized event envelopes and the next byte offset. |
| `GET /signals` | Replayable cursor read of trusted hook signals accepted or spooled on the devbox. |
| `POST /api/sessions/signals` | Devbox-local Copilot CLI hook target using the same normalized signal payload as local sessions. |

The bridge returns metadata and normalized event shapes by default. Raw prompt
text, assistant message text, tool arguments, and complete JSONL lines do not
cross the bridge in the first slice; prompt bodies are reduced to lengths, and
workspace summaries are represented by presence/length unless a later content
policy explicitly opts into bounded raw-content reads. Local Streamliner stores
per-environment snapshot cursors, signal cursors, event-tail offsets, compatibility
diagnostics, and freshness timestamps in local runtime state only. Those cursors
are advanced only after successful ingestion by the local registry worker.

Dev Tunnel authentication expiry, SSH-forward failure, bridge unavailability,
permission errors, cursor invalidation, and bridge version mismatch are
environment diagnostics, not registry-deletion or session-ended signals. A remote
session can become stale when the freshness window expires after the last
successful bridge observation, but Streamliner must not fabricate fresh liveness
or clean session ends solely from transport outage.

Direct SSH reads of `~/.copilot/session-state` are the bootstrap/probe path and
may remain a degraded fallback. They are sufficient to verify reachability,
session-state shape, and remote process-lock interpretation, but they are not the
preferred steady-state transport because trusted hooks need a devbox-local
endpoint and process liveness must be evaluated on the devbox. On managed
Windows Dev Boxes where SSH is unavailable or undesirable, an authenticated Dev
Tunnel can be the first reachability channel for the bridge; it does not replace
the bridge or the registry identity model.

Devbox observation does not imply devbox launch, remote control, or
multi-machine registry sync. A devbox-observed registry row still uses a
Streamliner-owned `id`; the Copilot session id, remote host/environment id, and
remote cwd are separate identity facts used for merge and display.

### Node-to-Session Binding

Streamliner binds sessions to graph nodes through **launch claims**. When a launch is initiated:

1. Streamliner records a launch claim in its runtime state: `{nodeId, workstreamId, launchNonce, expectedCwd, expectedBranch, launchedAt}`
2. The kickoff prompt includes the `launchNonce` on a dedicated line so it appears in the session's early `user.message` events
3. When the session watcher discovers a new session, it first narrows candidates by `cwd`, `branch`, and launch window, then confirms the match by finding the `launchNonce` in the session's early events
4. If multiple claims remain plausible or the nonce has not appeared yet, the session stays unbound until more evidence arrives rather than guessing
5. The binding is stored as `graphBinding` on the session's registry row ([Decision 004](decisions/004-session-registry-primary-surface.md)), not in the Copilot session files and not in a separate binding store

This keeps the binding in Streamliner's domain while relying on Copilot's files for everything about the session itself. `cwd` remains an important guardrail, but it is no longer treated as a sufficient identifier on its own.

### Launch Claim Lifecycle

Launch claims are transient. They must be actively reconciled or aged out, or they become ambient noise that corrupts future bindings.

- **Claim creation** writes the claim atomically to runtime state before the terminal launch command runs. Streamliner's `createLaunchClaim` helper uses a row-first, claim-second canonical write order: it pre-mints both the launch-claim id and a reserved `SessionRegistryRecord` id, writes the registry row with `origin.kind = "launched"`, `origin.launchClaimId`, and `graphBinding`, then writes the claim file with `reservedRegistryId` populated. A crash between the two writes is recovered by the `reconcileOrphanReservedRows` startup routine in the background worker. If launch preparation fails before the launch command is issued, the claim is deleted on the same failure path that cleans up the generated context package.
- **Path A (default) vs Path B**: with row reservation enabled (the default), discovery may transiently produce a duplicate observed row for the same Copilot session id. The binding pass detects this and fuses the duplicate into the reserved row atomically via the `fuseObservedRowIntoReservedRow` registry primitive, then deletes the duplicate. Path B (`reserveRegistryRow: false`, intended only for diagnostic / preview flows) writes `graphBinding` directly onto the existing observed row via `bindClaimToRow`; `origin.kind` stays `"observed"` and `graphBinding.launchClaimId` provides linkage.
- **Two binding tiers**: there are two complementary ways the claim can be bound to its session, and Streamliner runs both:
  - **Tier 1 — kickoff-prompt nonce** (always available). The launcher renders `kickoffNonceLine(launchNonce)` into the kickoff prompt; the binding pass scans the discovered session's early `events.jsonl` for the nonce token and binds when a unique match is found. Works without the Copilot CLI plugin installed.
  - **Tier 2 — trusted hook signal carrying `launchClaimId`** (preferred when plugin installed). The launcher sets `STREAMLINER_LAUNCH_CLAIM_ID` in the spawned Copilot CLI process environment; the plugin's `sessionStart` hook script forwards it on the `session.started` signal payload; on intake, Streamliner calls `bindClaimViaTrustedSignal` to atomically bind the claim. Cannot be defeated by builder edits to the kickoff prompt and binds on first signal arrival rather than waiting for the next worker poll cycle. Tier 1 remains the fallback when the plugin is missing or the hook cannot deliver.
  - The two tiers are race-safe: whichever wins first marks the claim `bound`; the loser's bind attempt is rejected by the existing atomic primitives (`reserved-row-already-attached` / `graph-binding-conflict` / `already-bound`) and recorded as a deferred outcome in the diagnostic logs.
- **Binding window**: a claim is eligible for binding only while its launch window is open. The default window is 5 minutes from `launchedAt`. Inside the window, the watcher attempts to bind discovered sessions by nonce plus `cwd`/branch guardrails.
- **Claim expiry**: if no session binds within the window, the claim transitions to one of two terminal states. `nonce-missing` indicates that at least one Copilot session was observed in `expectedCwd` during the window but never produced a nonce match (recorded in `seenCandidateCopilotSessionIds`). `expired` indicates that no candidate session ever appeared. The legacy term *abandoned* is preserved in older docs but is no longer a status — the two-bucket distinction is more useful for diagnostics. Terminal claims are retained for a short inspection period (default: 1 hour) so the builder can see that a launch failed to attach, then pruned by the sweep.
- **Reserved-row cleanup**: when a non-`bound` terminal transition happens, the reserved row is conditionally deleted via the `deleteSessionIf(rowId, copilotSessionId === null)` primitive (predicate evaluated under the registry write lock). When a real session attached during the gap, the row is preserved and its `graphBinding` is cleared via `bindClaimToRow(..., { graphBinding: null })`; the row appears in the future "Unbound sessions" surface.
- **Nonce tampering**: the kickoff prompt includes the launch nonce on a dedicated line (see `kickoffNonceLine` helper). If the builder edits or deletes the nonce token before pressing Enter, Tier 1 binding will not see the expected nonce. When Tier 2 is also in play, the binding still succeeds via the env-var-backed hook path. With only Tier 1, the claim transitions to `nonce-missing` after the binding window closes; the orphan session is surfaced in the UI so the builder can rebind it manually or discard it.
- **Unbound-session surface**: sessions discovered by the watcher that match no claim within the binding window (or are deliberately launched outside Streamliner) appear in a dedicated "Unbound sessions" panel. The builder can bind them to a node explicitly, ignore them, or let them age out with the rest of the session history.
- **Single session per claim**: a claim binds at most one session. Once bound, the claim is marked `bound` and subsequent discoveries matching the same nonce are logged via the `launch-claim-rebind-attempt` diagnostic rather than rebinding.
- **Ambiguity**: if more than one discovered Copilot session in `expectedCwd` matches the nonce in the same binding-pass cycle (defensive case; nonces are 128-bit), the claim transitions to the terminal `ambiguous` status and the sessions remain unbound for manual recovery.

#### Atomicity primitives

The race-free behavior above relies on three primitives on `SessionRegistryFileStore` (`src/session-registry/file-store.ts`), each acquiring the registry write lock once around its read–validate–write sequence:

- `bindClaimToRow(id, expected, desired)` — re-reads the row under the lock, re-validates `cwd`/`branch`/`repo`/`graphBinding.launchClaimId` against the binding-pass decision, and writes `graphBinding` (or clears it). Returns a typed reason on mismatch so the caller can retry or surface a diagnostic.
- `deleteSessionIf(id, predicate)` — predicate-checked delete under the lock; closes the gap between sweep decision and delete.
- `fuseObservedRowIntoReservedRow(args)` — atomic transfer of observation fields onto the reserved row plus deletion of the duplicate observed row in a single locked transaction; emits one `upsert` then one `delete` so SSE consumers see a coherent state.

The startup recovery routine `reconcileOrphanReservedRows(claimStore, registryStore)` (in `src/session-registry/launch-claims.ts`) lists launched-origin rows whose `origin.launchClaimId` is missing from the claim store and applies the same conditional cleanup. It runs synchronously inside `SessionRegistryBackgroundWorker.start()` once per process lifecycle, before the first poll cycle.

The launch-claim store lives at `~/.streamliner/state/launch-claims/` (override via `STREAMLINER_LAUNCH_CLAIMS_ROOT`) with the same advisory-lock + write-then-rename + per-record JSON file layout as the session registry.

#### Diagnostic surface

A read-only HTTP API exposes the claim store for UI consumption:

- `GET /api/launch-claims` — versioned envelope `{ apiVersion, items, nextCursor, meta: { total, serverTime, diagnosticsSummary } }` with summary entries (status, derived lifecycle phase, bound-session pointers); supports `?status`, `?workstreamId`, `?nodeId`, `?limit` (default 50, max 200).
- `GET /api/launch-claims/:id` — full claim record plus `derived: { lifecyclePhase, bindingWindowExpiresAt, retentionExpiresAt }`.

Both endpoints are loopback-only.

### Watcher Diagnostics

Because session tracking combines several independent observation sources, the watcher exposes a per-session diagnostic record so operational disagreements between the UI and reality are debuggable without ad-hoc log archaeology.

Each session carries:

- **Last successful Copilot parse** — timestamp and byte offset of the last `events.jsonl` read that succeeded, plus the number of open tool requests in the incremental index.
- **Last successful PAW artifact scan** — when applicable, timestamp of the last PAW work directory scan, the artifact patterns recognized, and any ambiguity or unavailable-path diagnostics. See [Decision 008](decisions/008-paw-artifacts-for-workflow-status.md).
- **Hook signal counters** — count of `sessionStart`, `agentStop`, `sessionEnd` signals received vs. equivalent transitions inferred from polling, so "hooks silently stopped firing" is visible.

In addition, the watcher emits structured diagnostic events (not free-form logs) for every degradation mode it recognizes: `hook-miss`, `tail-truncation`, `nonce-absent-after-window`, `launch-claim-ambiguous`, `launch-claim-rebind-attempt`, `launch-claim-orphan-session` (case `"a"` for candidate-with-no-nonce, case `"b"` for preserved-reserved-row whose claim went non-bound), `copilot-compatibility-probe-failed`, `paw-workdir-unavailable`, `paw-artifact-ambiguous`, `paw-artifact-layout-unknown`. PAW-specific diagnostics are emitted only for sessions with PAW artifacts or Streamliner PAW launch metadata. Launch-claim diagnostics are emitted as JSONL log lines under `withScope("launch-claim.binding")` and `withScope("launch-claim.sweep")` in the API logger; the durable per-claim inspection record is the claim's own `evidence` ledger, exposed via `GET /api/launch-claims/:id`. The UI shows a compact degradation badge on any session whose diagnostics are non-empty so the builder never has to guess whether the overlay can be trusted.

## Runtime Overlay

The runtime overlay is how Streamliner presents live session and tracker state in the UI without modifying the committed graph. The overlay is a **projection of the session registry** ([Decision 004](decisions/004-session-registry-primary-surface.md)) filtered to entries whose `graphBinding` resolves to a visible node, joined with that node's committed status, observed liveness, tracker state, and PAW artifact status when artifacts are available. Sessions without `graphBinding` remain visible in the registry UI but do not render on the graph.

### Overlay Model

The UI renders each node's state by combining three sources:

```
Displayed state = committed graph status
                + runtime session status (from observation)
                + tracker status (from cached issue/PR state)
```

| Committed status | Runtime session | Displayed as |
|-----------------|-----------------|--------------|
| `ready` | `launching` | Launching |
| `ready` | `active` | In Progress |
| `ready` | `idle` | Needs Attention |
| `ready` | `idle` + `pendingInputRequest` | Needs Input |
| `ready` | `ended` | Completed (pending artifact promotion) |
| `ready` | none | Ready |
| `in-progress` | any | Session status takes precedence |
| `completed` | any | Completed |

Graph nodes use the same compact status pulse/pill language as My Sessions for bound runtime state. When multiple non-archived sessions bind to one node, the graph shows the highest-attention state first (`needs input` before `idle`, `active`, `launching`, then ended/history) and includes a count so the builder can open the linked session list for details.

### PAW Artifact Status Rendering

For PAW-backed sessions, the `pawWorkflow` field carries an artifact-derived status summary (see [Decision 008](decisions/008-paw-artifacts-for-workflow-status.md)). It is intentionally coarse: it reports the artifact evidence Streamliner can see, not a guaranteed workflow automaton state.

- **Recognized artifact set** — overlay shows the coarse status implied by known PAW artifacts and can link to the relevant artifact paths.
- **Ambiguous artifact set** — overlay shows a degraded/ambiguous badge and the artifact evidence rather than guessing a precise activity.
- **Unavailable artifact path** — overlay shows liveness/session status from Copilot state and a PAW artifact diagnostic, but does not invent workflow progress.

Mutation-affecting affordances must not depend solely on artifact-derived status until the workstream explicitly defines the artifact patterns and confidence thresholds for that affordance.

### Artifact Promotion

When a session ends, the committed graph still shows the pre-session status until the orchestrator (or builder) explicitly promotes the node's artifact status. This is intentional: runtime state is an overlay, not a replacement for committed artifact changes.

Promotion happens when the orchestrator reviews the session's output (PR, code changes, design-doc updates) and updates the graph to reflect the new durable state.

## Terminal Integration

### Session Visibility

Sessions run in visible terminals. The builder sees:

- A terminal tab or window per session (in VS Code, iTerm, Windows Terminal, etc.)
- Each launched session starts with a kickoff prompt already sent, rather than an idle shell in the target directory
- Streamliner's UI shows a session list with node binding, status, and terminal reference

Conceptually, the launch integration is doing the equivalent of `copilot -i "<kickoff prompt>" .` in the prepared `cwd`, even if the exact terminal adapter wraps that command differently for the local platform.

### Operator Presence

The builder can engage with a session at any time:

- **Join**: focus the terminal tab — the session is interactive, the builder can type
- **Observe**: read the terminal output without intervening
- **Withdraw**: switch to another terminal or the Streamliner UI

Presence does not change the session's tracking state. The session watcher continues observing Copilot's state files regardless of whether the builder is watching.

### Session List in UI

Streamliner surfaces My Sessions as the primary list of tracked sessions. Rows launched from a workstream declare their `graphBinding`, so the list can group or filter by workstream and link back to the workstream graph or selected node. Manual or unbound sessions remain visible in a default/unbound grouping.

| Column | Source |
|--------|--------|
| Workstream | Registry `graphBinding.workstreamId` joined to workstream catalog; fallback "Unbound" or "Unknown workstream" |
| Node | Launch claim binding → graph node title |
| Status | Observed lifecycle state using the same pulse/pill component rendered on graph nodes |
| Phase | Derived from recent events |
| Needs Input | `pendingInputRequest` present |
| Duration | `now - createdAt` from `workspace.yaml` |
| Last Activity | `events.jsonl` mtime |

Clicking a session in the list focuses its terminal (when the terminal integration supports it) or shows the session's details. Workstream and node affordances navigate back to the workstream graph with the node selected when a binding exists.

## Session Relaunch

Relaunch restores a builder to a tracked session's working directory after an
interruption (browser close, machine restart, terminal crash). It is a
**registry operation**: the registry row is the durable session identity, and
relaunch consumes metadata from that row rather than maintaining a parallel
terminal or session store.

### Relaunch API

**Endpoint**: `POST /api/sessions/:id/relaunch`

Loopback-only (same enforcement as `/api/sessions/signals`). The local
Streamliner API process owns this action per Decision 006.

**Response on success** (200):

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Registry entry ID |
| `cwd` | string | Resolved working directory used |
| `method` | `"windows-terminal"` \| `"powershell"` | Terminal method used |
| `copilotResumed` | boolean | Whether `copilot --resume` was attempted |
| `colorApplied` | boolean | Whether tab color was applied |
| `pid` | number \| undefined | PID of spawned terminal process |

**Error response** (400 / 404 / 500):

| `code` | HTTP status | Meaning |
|--------|------------|---------|
| `session_not_found` | 404 | No registry row with this ID |
| `session_archived` | 400 | Session is archived; unarchive first |
| `session_live` | 400 | Copilot process is still live; stop it first |
| `no_cwd` | 400 | No working directory recorded |
| `cwd_not_found` | 400 | Working directory does not exist on disk |
| `spawn_failed` | 500 | Terminal process failed to launch |

### Relaunch Behavior

**Path resolution**: `derivedWorktreePath ?? cwd` — worktree path is preferred
when available, matching the existing restart-command behavior.

**Terminal selection**:
1. If Windows Terminal (`wt.exe`) is in PATH → `wt new-tab` with `--title`,
   `--tabColor` (valid `#RRGGBB` only), `-d <cwd>`, and optionally
   `--appendCommandLine -NoExit -Command "copilot --resume <id>"` so the
   builder's Windows Terminal default profile remains the shell.
2. Otherwise → `pwsh.exe` when available, falling back to `powershell.exe`,
   with `-NoExit -Command "Set-Location ...; copilot --resume <id>"`.

**Process lifecycle**: Terminals are spawned `detached` with `stdio: 'ignore'`
and `unref()`'d so they outlive the Streamliner API process. The relaunch
endpoint does not track the spawned process after returning the PID.

**Degradation rules**:
- No `copilotSessionId` → open terminal at cwd without resume (still a
  successful relaunch; the issue spec principle is "correct cwd beats full
  resume").
- No Windows Terminal → PowerShell fallback.
- Invalid or missing `color` → launch without tab color.
- Missing cwd directory → fail with `cwd_not_found`.

### Non-Mutating

Relaunch does **not** write to the registry or emit SSE change events. It is
a read-then-spawn action. A future `lastRelaunchedAt` timestamp or relaunch
claim binding would be a separate registry schema change.

### Eligibility

A session is eligible for relaunch when:
- `lifecycleStatus` is **not** `"archived"` (must unarchive first).
- `copilotProcessState` is **not** `"live"` (prevents duplicate terminal
  spawns for already-running sessions).
- A working directory is available (`derivedWorktreePath` or `cwd` is
  non-empty).

### Wave 3 Separation

Relaunch (`POST /api/sessions/:id/relaunch`) operates on an **existing**
registry row. The launch-from-graph flow (Wave 3) uses a separate endpoint
(e.g., `POST /api/sessions/launch`) that creates a new registry row after PAW
launch preparation and then launches, sharing the same terminal-launch
infrastructure.

## Scope Boundaries

### In This Design

- MVP launch from the graph for PAW-backed Copilot CLI worker sessions, including a launch configuration dialog, SDK context assembly, SDK `paw-init`, prompt-template compilation, configurable Copilot CLI arguments, launch-claim binding, and terminal launch
- Observation-based session tracking via Copilot state files
- Plugin hook signals for low-latency status hints
- Registered-devbox observation vocabulary for trusted hook forwarding and remote session-state access
- Runtime overlay onto the committed graph
- Terminal-based operator presence
- Local session tracking plus registered-devbox observation through the local Streamliner process

### Not In This Design

- Using Copilot SDK as the worker-session runtime instead of Copilot CLI interactive mode
- Non-PAW graph launch modes in the MVP
- Multi-machine registry sync, devbox launch, or remote control actions beyond observation
- Automatic crash recovery or relaunch implementation beyond the explicit `POST /api/sessions/:id/relaunch` action (this doc defines the registry contract relaunch consumes and the relaunch API contract; automatic recovery is not in scope)
- Session-to-session communication
- Rich session control beyond launch and presence
- Headless (non-terminal) session execution
- Automatic artifact promotion from session completion

## Open Questions

- **Terminal multiplexer integration**: Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/IDE terminal APIs? (See terminal note for tmux-based approach.)
- **PAW launch configuration persistence**: Which PAW init/configuration fields belong in committed project/workstream config, and which belong in local builder defaults?
- **Future launch-profile persistence**: If non-PAW profiles return, which fields belong in committed project/workstream config, and which belong in local builder defaults?
- **Multiple sessions per node**: Can a node have multiple concurrent sessions (e.g., after a crash and relaunch)? If so, how are they reconciled?
- **Context staleness**: If a session runs long enough that the workstream state changes (brief updated, graph refined), should the session be notified or continue with its original context?
- **Devbox bridge lifecycle**: Should the production bridge remain a user-started helper, be launched by Streamliner through the configured access channel, or be installed as a user login task/service after an explicit ADR?
- **Devbox hook ingest proof**: Does the production bridge receive real devbox Copilot CLI hook POSTs and drain plugin fallback spool files without slowing or breaking interactive sessions?
- **Watcher restart rehydration**: On a cold watcher start against an active session, how far back does the incremental tool-request index need to be rebuilt to catch unresolved `ask_user` calls from before the restart? Options: re-scan the full log (bounded by an explicit budget), or treat pre-restart state as unknown until the next turn.
- **Cross-runtime coordination beyond the registry**: The registry now uses `registry.lock` plus record-authoritative rebuild rules. Should the rest of the per-workstream runtime cache converge on the same coordination pattern, or keep file-specific rules?
