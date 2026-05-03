---
kind: design-doc
status: draft
last_updated: 2026-05-02
update_semantics: rewrite-in-place
authoritative_for: "Session launching, lifecycle, registry contract, tracking, and runtime overlay"
scope_tags:
  - sessions
  - registry
  - launch
  - tracking
  - runtime-overlay
code_paths:
  - src/session-registry*.ts
  - src/session-registry/**
  - src/server/**
  - src/components/SessionsPage.tsx
  - src/server/session/**
  - src/server/context/**
  - src/components/session/**
  - copilot-plugin/streamliner/**
references_decisions:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
---

# Session System

The session system is how Streamliner launches, monitors, and surfaces AI coding agent sessions. A **session** is a Copilot CLI agent instance executing a specific node's work in a workstream — or, equivalently, any Copilot CLI instance the builder has chosen to track. Streamliner maintains a local, graph-independent **session registry** as the authoritative record for tracked sessions ([Decision 004](decisions/004-session-registry-primary-surface.md)), observes each session's Copilot CLI state files to populate liveness and workflow-progression fields, and projects that combined state onto the committed graph as a runtime overlay without writing ephemeral telemetry back into `graph.json`. Sessions launched from the graph and sessions the builder tracks manually are the same kind of record; the launch pipeline writes onto an existing or newly created registry row rather than maintaining a parallel store.

## Launch Contract

The launch contract is the interface between the graph UI (where the builder initiates work), the backend (which prepares the launch spec), and the terminal integration (which starts the worker session through Copilot CLI interactive mode). Launch preparation and worker launch are distinct: Streamliner may use Copilot SDK or other backend helpers to prepare context and prompts, but the visible worker session is always a Copilot CLI session.

### Launch Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Workstream ID | Graph selection | Which workstream the node belongs to |
| Node ID | Graph selection | Which node to execute |
| Target repo | Graph `repos` + config | Where the code lives |
| Branch strategy | Builder choice | New branch, existing branch, or worktree |
| Execution mode | Builder choice or default | `current-checkout` or `worktree` |
| Environment | Builder choice or default | `local` in this design; remote environments are deferred |
| Launch profile | Layered config + builder choice | Prompt/workflow profile, such as general Copilot work, PAW full workflow, or PAW lite |
| Prompt overrides | Builder edit | Final launch-time edits applied after profile/context composition |
| CLI arguments | Layered config + builder override | Default and launch-specific Copilot CLI flags, such as `--yolo` or model flags |

The builder selects a node in the graph and initiates a launch. Streamliner resolves the node's workstream, target repository, branch strategy, launch profile, prompt text, and CLI arguments. The builder may override the branch strategy or accept the default (new feature branch from the repo's main branch), and may edit the final prompt before the terminal session starts.

This design specifies **local launches only**. The launch contract keeps an environment dimension so future remote execution can fit the same shape, but `devbox` launch is not defined here. Devbox observation is defined later as an extension of the session-tracking model, not as a launch mode.

### Launch Sequence

The launch is a two-phase process: a **launch preparation phase** that prepares the launch spec, followed by a **Copilot CLI interactive launch** that starts the visible worker session. The preparation phase is not the worker session itself; it exists to assemble the context, prompt, CLI arguments, working directory, and launch-claim metadata that the terminal integration needs.

#### Phase 1 — Launch Preparation

Streamliner's backend prepares a launch spec. Context assembly uses Copilot SDK to synthesize the worker-facing `context.md` from deterministic backend-collected sources; the visible worker session remains a separate Copilot CLI interactive session. The launch contract is the structured launch spec, not a mandatory PAW workflow. Preparation:

1. **Resolves launch profile layers** — combines instance, project, workstream, and node-launch defaults for instruction text, workflow expectations, context references, terminal preferences, and CLI arguments
2. **Assembles context** — collects graph, brief, design-doc, and tracker/spec source material, then asks Copilot SDK to build a single worker-facing context file for the selected node with Layer 0–3 sections
3. **Prepares the execution location** — resolves the checkout or worktree path and branch according to the selected execution mode. A profile may run profile-specific setup, such as PAW initialization, but that setup is not required by the baseline launch contract.
4. **Places the context file** — writes the assembled context package into a launch context directory that the kickoff prompt can reference
5. **Generates launch claim data** — creates the launch nonce and expected binding metadata that Streamliner will record before starting Copilot CLI
6. **Compiles kickoff prompt** — turns the launch profile, work item identity, prepared context locations, CLI arguments, and launch nonce into the initial instruction for the worker session
7. **Returns structured output** — returns the launch spec that the terminal launcher needs

Launch preparation output:

| Field | Type | Description |
|-------|------|-------------|
| `launchId` | string | Streamliner launch attempt identifier |
| `cwd` | string | Worktree or checkout path where the session should run |
| `branch` | string | Branch name created or checked out |
| `contextPackagePath` | string | Directory containing the generated context file |
| `contextFilePath` | string | File path to the worker-facing `context.md` |
| `launchProfileId` | string | Selected launch profile |
| `cliArgs` | string[] | Copilot CLI arguments after layered defaults and builder overrides |
| `environment` | string | `local` in this design |
| `sessionStateRoot` | string | Path to Copilot session state directory in the local environment |
| `launchNonce` | string | Unique launch token used to bind the discovered session to the correct graph node |
| `kickoffPrompt` | string | Initial prompt passed to Copilot CLI interactive mode |

#### Phase 2 — Copilot CLI Interactive Launch

After launch preparation completes, Streamliner:

1. **Records launch claim** — writes a launch claim to Streamliner's runtime state binding the node to the expected session location before the worker session starts
2. **Launches Copilot CLI** — opens a visible terminal in the returned `cwd` and starts Copilot CLI interactive mode with the selected/default CLI arguments
3. **Passes the kickoff prompt** — launches the worker session with the initial prompt already populated, conceptually equivalent to `copilot <cli-args> -i "<kickoff prompt>" .`
4. **Binds on discovery** — when the session watcher detects the new Copilot session (via its session state directory appearing), Streamliner binds it to the launch claim

### Launch Profiles

A launch profile is reusable launch configuration, not a separate workflow engine. Profiles can contribute:

- Instruction text and workflow expectations
- Context package references and context-reading guidance
- Default Copilot CLI arguments
- Branch/worktree and terminal preferences
- Optional profile-specific setup, such as PAW initialization

Profile input is layered from broad to specific: Streamliner instance defaults, project defaults, workstream defaults, node defaults, and launch-time builder edits. Later layers override or append to earlier layers according to the profile field. The final composed prompt is shown to the builder before launch so it can be edited instead of forcing the builder to keep a separate notepad of reusable prompts.

PAW is represented as one or more launch profiles. A PAW profile may point the worker at PAW expectations and the generated context file, but Streamliner launch is not blocked on PAW workflow correctness. A non-PAW profile can still launch a graph node, bind the session, and track it through the registry.

### Kickoff Prompt

The kickoff prompt is a first-class launch artifact, not ad hoc terminal text. It tells the worker session what kind of run this is and how to begin. At minimum it must encode:

- The selected launch profile and workflow expectations
- The work item identity (workstream, node, repo, branch/worktree)
- Where the prepared context artifacts live
- The launch nonce on a dedicated line so the watcher can confirm the intended binding
- Any CLI-argument assumptions, review-policy expectations, or launch-time operating constraints
- Any profile-specific startup guidance, such as PAW configuration text for a PAW profile

Opening a terminal in the correct directory is not a launch. A launch is only complete once Streamliner has prepared the kickoff prompt and started Copilot CLI interactive mode with that prompt.

### Failure Modes

| Failure | Behavior |
|---------|----------|
| Node not launchable (wrong status, unmet deps) | Reject with explanation |
| Target repo not registered or inaccessible | Reject with explanation |
| Branch conflict (already exists, dirty state) | Prompt builder for resolution |
| Launch preparation failure (profile resolution, context assembly, branch/worktree setup, prompt compilation) | Report error, clean up partial state |
| Copilot CLI launch failure | Report error, clean up launch claim |

## Context Assembly

Context assembly builds a single worker-facing `context.md` that orients a worker session to a node's mission without copying authoritative source material wholesale. The file preserves the conceptual Layer 0–3 sections, but delivery is consolidated so the worker has one file to read. Context assembly runs inside launch preparation. Streamliner deterministically collects source material and metadata, then uses Copilot SDK to synthesize the markdown so workstream-level background can be reframed as worker-relevant context instead of conflicting task instructions.

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

Context is delivered as one `context.md` file. For a PAW profile, the caller may provide the PAW work directory created by profile-specific setup; Streamliner writes the worker handoff to `streamliner/context.md` under that work directory. For a non-PAW profile or prompt preview, Streamliner writes a per-context package under local runtime state. The kickoff prompt points the worker session at the single context file during initialization. See [Decision 002](decisions/002-file-based-context-delivery.md) for the rationale.

The assembled package is written to:

```
<paw-work-dir>/
  streamliner/
    context.md              ← worker-facing Layer 0-3 context sections

~/.streamliner/state/{projectKey}/{workstreamId}/launch-contexts/{contextId}/
  context.md                ← preview/runtime generated context
```

This file is generated by Copilot SDK, not manually maintained. It is excluded from Git and regenerated for each context preparation. Launch profiles decide how prominently the worker is instructed to read it. The SDK prompt must give the context writer a concise product/process primer: Streamliner is a local-first workstream orchestration app where a builder launches a Copilot CLI worker to execute one selected graph node. It must then instruct the generator to treat source documents as data, produce context for exactly the selected node, avoid turning workstream-level plans into worker instructions, present Layer 0 design paths only as navigation hints, and link to authoritative sources instead of restating design docs or tracker specs in full. Machine metadata remains in the backend/API response rather than in a worker-facing manifest file.

The SDK session uses `STREAMLINER_CONTEXT_MODEL` when set. When unset or blank, Streamliner requests `claude-sonnet-4.6` by default for stable launch-context synthesis quality.

Before launch claims exist, backend context preview writes default packages to:

```text
~/.streamliner/state/{projectKey}/{workstreamId}/launch-contexts/{contextId}/
```

`contextId` is a stable per-package identifier returned by the backend. Repeated runtime-state preparations create fresh package directories rather than overwriting earlier packages. When a PAW work directory is supplied as `outputDir`, repeated preparations replace that work directory's `streamliner/context.md` handoff file because there is one generated worker context per PAW node session. Later launch-claim binding may associate a returned `contextId` with a `launchNonce` or copy the package into a nonce-scoped launch archive; this context assembly slice does not require a nonce up front.

### Context Package Metadata

Context package metadata is a backend/API contract consumed by launch profiles, prompt preview, and terminal launch work. It is not written into the worker-facing package as `manifest.json`:

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

### Backend Preparation API

The local API exposes context assembly as:

```http
POST /api/launch-contexts
```

Request body:

| Field | Required | Meaning |
|-------|----------|---------|
| `nodeId` | yes | Selected graph node id. |
| `graphPath` | no | Graph file to use; defaults to the API-configured graph path. |
| `outputDir` | no | Absolute PAW work directory supplied by profile-specific setup. Streamliner writes `{outputDir}/streamliner/context.md`. Defaults to runtime-state `launch-contexts/{contextId}/context.md`. |
| `launchNonce` | no | Optional nonce when a caller already has one. |

Response body:

| Field | Meaning |
|-------|---------|
| `contextId` | Stable generated package id. |
| `contextPackagePath` | Absolute package directory. |
| `contextFilePath` | Absolute path to the generated worker-facing `context.md`. |
| `metadata` | Structured system-level context metadata for launch profiles, prompt preview, and terminal launch work. |
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
| `pawWorkflow` | PAW work directory on disk, when present | Work ID, work title, `Workflow Identity` (`paw` or `paw-lite`), current activity, and gate/procedure state read from `## Control State` in `WorkflowContext.md` / `ReviewContext.md` when present; legacy inference from artifact presence otherwise. See [Decision 003](decisions/003-paw-control-state-integration.md). |

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
5. Detect PAW workflow state when applicable: for sessions with a PAW launch profile or reachable `.paw/work/*/` directory, parse `WorkflowContext.md` (and `ReviewContext.md` for PAW Review sessions). When a `## Control State` section is present, use its `Workflow Identity`, required-item statuses, gate items, procedure items, and `Reconciliation` marker as the PAW workflow-progression view. When absent, fall back to legacy inference from artifact presence. See [Decision 003](decisions/003-paw-control-state-integration.md).

### Two Orthogonal State Sources

Session tracking combines a required liveness source with optional workflow-progression sources that should not be collapsed:

- **Copilot session state** (`~/.copilot/session-state/{id}/`) — liveness, turn boundaries, pending input requests, end reasons. Authoritative for *is the session alive and does it need attention?*
- **PAW control state** (`.paw/work/<work-id>/*Context.md`) — for PAW-backed sessions only: workflow identity, required activities, gate items, procedure items, reconciliation markers. Authoritative for *where is this PAW workflow and can PAW decisions be trusted?*

Streamliner overlays Copilot session state onto every bound graph node and overlays PAW state when a session has PAW artifacts or a PAW launch profile. Neither subsumes the other: a session can be idle while the PAW workflow is mid-activity, and PAW state can advance across sessions that this watcher never observed. Baseline launch and tracking do not require PAW state.

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
- **Last successful PAW parse** — when applicable, timestamp of the last `WorkflowContext.md` / `ReviewContext.md` read, along with the derivation path used (`control-state`, `inferred`, or `unparsable`; see [Decision 003](decisions/003-paw-control-state-integration.md)).
- **Hook signal counters** — count of `sessionStart`, `agentStop`, `sessionEnd` signals received vs. equivalent transitions inferred from polling, so "hooks silently stopped firing" is visible.

In addition, the watcher emits structured diagnostic events (not free-form logs) for every degradation mode it recognizes: `hook-miss`, `tail-truncation`, `nonce-absent-after-window`, `launch-claim-ambiguous`, `launch-claim-rebind-attempt`, `launch-claim-orphan-session` (case `"a"` for candidate-with-no-nonce, case `"b"` for preserved-reserved-row whose claim went non-bound), `legacy-inference-used`, `unknown-control-state-token`, `copilot-compatibility-probe-failed`, `paw-contract-version-out-of-range`. PAW-specific diagnostics are emitted only for sessions with PAW artifacts or a PAW launch profile. Launch-claim diagnostics are emitted as JSONL log lines under `withScope("launch-claim.binding")` and `withScope("launch-claim.sweep")` in the API logger; the durable per-claim inspection record is the claim's own `evidence` ledger, exposed via `GET /api/launch-claims/:id`. The UI shows a compact degradation badge on any session whose diagnostics are non-empty so the builder never has to guess whether the overlay can be trusted.

## Runtime Overlay

The runtime overlay is how Streamliner presents live session and tracker state in the UI without modifying the committed graph. The overlay is a **projection of the session registry** ([Decision 004](decisions/004-session-registry-primary-surface.md)) filtered to entries whose `graphBinding` resolves to a visible node, joined with that node's committed status, observed liveness, tracker state, and optional workflow details such as PAW control state. Sessions without `graphBinding` remain visible in the registry UI but do not render on the graph.

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

### Control-State Trust Rendering

For PAW-backed sessions, the `pawWorkflow` field carries a derivation-path annotation (see [Decision 003](decisions/003-paw-control-state-integration.md)) and, when control state is present, a `Reconciliation` marker. Both drive UI trust for PAW-specific affordances:

- **`control-state` + `Reconciliation: current`** — full confidence. All affordances rendered, including "ready to launch next activity."
- **`control-state` + `Reconciliation: stale | external_unverified | not_run`** — overlay visibly downgrades confidence (muted colors, "reconciliation stale" badge). "Ready to launch next activity" affordances are suppressed until reconciliation is refreshed. The builder may still inspect state but cannot trigger mutation-affecting actions from the overlay.
- **`inferred`** — legacy artifact-presence fallback. Overlay renders with a "legacy inference" badge. Mutation-affecting affordances are suppressed.
- **`unparsable`** — control state present but rejected by the parser (unknown tokens, out-of-range contract version). Overlay shows an error badge and the underlying diagnostic. No activity-status rendering until the parser is updated or the builder acknowledges the condition.

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

Streamliner surfaces a session panel or overlay showing:

| Column | Source |
|--------|--------|
| Node | Launch claim binding → graph node title |
| Status | Observed lifecycle state |
| Phase | Derived from recent events |
| Needs Input | `pendingInputRequest` present |
| Duration | `now - createdAt` from `workspace.yaml` |
| Last Activity | `events.jsonl` mtime |

Clicking a session in the list focuses its terminal (when the terminal integration supports it) or shows the session's details.

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
registry row. The future launch-from-graph flow (Wave 3) will use a separate
endpoint (e.g., `POST /api/sessions/launch`) that creates a new registry row
and then launches, sharing the same terminal-launch infrastructure.

## Scope Boundaries

### In This Design

- Launch from the graph with launch preparation, profile-based prompt compilation, context package references, configurable Copilot CLI arguments, and Copilot CLI interactive worker-session launch
- Observation-based session tracking via Copilot state files
- Plugin hook signals for low-latency status hints
- Registered-devbox observation vocabulary for trusted hook forwarding and remote session-state access
- Runtime overlay onto the committed graph
- Terminal-based operator presence
- Local session tracking plus registered-devbox observation through the local Streamliner process

### Not In This Design

- Using Copilot SDK as the worker-session runtime instead of Copilot CLI interactive mode
- Requiring PAW workflow artifacts for baseline launch, registry binding, or graph visibility
- Multi-machine registry sync, devbox launch, or remote control actions beyond observation
- Automatic crash recovery or relaunch implementation beyond the explicit `POST /api/sessions/:id/relaunch` action (this doc defines the registry contract relaunch consumes and the relaunch API contract; automatic recovery is not in scope)
- Session-to-session communication
- Rich session control beyond launch and presence
- Headless (non-terminal) session execution
- Automatic artifact promotion from session completion

## Open Questions

- **Terminal multiplexer integration**: Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/IDE terminal APIs? (See terminal note for tmux-based approach.)
- **Launch profile persistence**: Which profile fields belong in committed project/workstream config, and which belong in local builder defaults?
- **Multiple sessions per node**: Can a node have multiple concurrent sessions (e.g., after a crash and relaunch)? If so, how are they reconciled?
- **Context staleness**: If a session runs long enough that the workstream state changes (brief updated, graph refined), should the session be notified or continue with its original context?
- **Devbox bridge lifecycle**: Should the production bridge remain a user-started helper, be launched by Streamliner through the configured access channel, or be installed as a user login task/service after an explicit ADR?
- **Devbox hook ingest proof**: Does the production bridge receive real devbox Copilot CLI hook POSTs and drain plugin fallback spool files without slowing or breaking interactive sessions?
- **Watcher restart rehydration**: On a cold watcher start against an active session, how far back does the incremental tool-request index need to be rebuilt to catch unresolved `ask_user` calls from before the restart? Options: re-scan the full log (bounded by an explicit budget), or treat pre-restart state as unknown until the next turn.
- **Cross-runtime coordination beyond the registry**: The registry now uses `registry.lock` plus record-authoritative rebuild rules. Should the rest of the per-workstream runtime cache converge on the same coordination pattern, or keep file-specific rules?
