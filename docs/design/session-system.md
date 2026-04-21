---
kind: design-doc
status: draft
last_updated: 2026-04-14
update_semantics: rewrite-in-place
authoritative_for: "Session launching, lifecycle, tracking, and runtime overlay"
scope_tags:
  - sessions
  - launch
  - tracking
  - runtime-overlay
code_paths:
  - src/server/session/**
  - src/server/context/**
  - src/components/session/**
references_decisions:
  - 1
  - 2
  - 3
  - 4
---

# Session System

The session system is how Streamliner launches, monitors, and surfaces AI coding agent sessions. A **session** is a Copilot CLI agent instance executing a specific node's work in a workstream — or, equivalently, any Copilot CLI instance the builder has chosen to track. Streamliner maintains a local, graph-independent **session registry** as the authoritative record for tracked sessions ([Decision 004](decisions/004-session-registry-primary-surface.md)), observes each session's Copilot CLI state files to populate liveness and workflow-progression fields, and projects that combined state onto the committed graph as a runtime overlay without writing ephemeral telemetry back into `graph.json`. Sessions launched from the graph and sessions the builder tracks manually are the same kind of record; the launch pipeline writes onto an existing or newly created registry row rather than maintaining a parallel store.

## Launch Contract

The launch contract is the interface between the graph UI (where the builder initiates work), the backend (which performs SDK-based preparation), and the terminal integration (which starts the worker session through Copilot CLI interactive mode). SDK preparation and worker launch are distinct: Streamliner uses Copilot SDK to prepare the work, but the visible worker session is always a Copilot CLI session.

### Launch Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Workstream ID | Graph selection | Which workstream the node belongs to |
| Node ID | Graph selection | Which node to execute |
| Target repo | Graph `repos` + config | Where the code lives |
| Branch strategy | Builder choice | New branch, existing branch, or worktree |
| Execution mode | Builder choice or default | `current-checkout` or `worktree` |
| Environment | Builder choice or default | `local` in this design; remote environments are deferred |
| Execution path | Builder choice or default | `full-paw`, `paw-lite`, or `just-do-it` |
| Review policy | Execution path default or override | Which review gates the launched workflow should expect |

The builder selects a node in the graph and initiates a launch. Streamliner resolves the node's workstream, target repository, and branch strategy. The builder may override the branch strategy or accept the default (new feature branch from the repo's main branch).

This design specifies **local launches only**. The launch contract keeps an environment dimension so future remote execution can fit the same shape, but `devbox` launch and remote session observation are not defined here.

### Launch Sequence

The launch is a two-phase process: an **SDK preparation phase** that prepares the execution environment, followed by a **Copilot CLI interactive launch** that starts the visible worker session. The preparation phase is not the worker session itself; it exists to assemble the launch spec that the terminal integration needs.

#### Phase 1 — SDK Preparation

Streamliner runs a Copilot SDK session that:

1. **Assembles context** — builds the Layer 0–3 context package for the node (LLM-driven; the SDK session reads design docs, extracts brief sections, resolves node specs)
2. **Runs paw-init** — `paw-init` owns branch naming, worktree creation, and PAW work directory setup. Streamliner passes the intent (workstream, node, branch strategy, execution mode); `paw-init` decides the feature slug, worktree path, and branch details.
3. **Places context files** — writes the assembled context package into the PAW work directory that `paw-init` created
4. **Generates launch claim data** — creates the launch nonce and expected binding metadata that Streamliner will record before starting Copilot CLI
5. **Compiles kickoff prompt** — turns the execution path, review policy, work item identity, prepared context locations, and launch nonce into the initial instruction for the worker session
6. **Returns structured output** — the SDK session returns the launch spec that the terminal launcher needs

SDK preparation output:

| Field | Type | Description |
|-------|------|-------------|
| `workId` | string | PAW work identifier |
| `cwd` | string | Worktree or checkout path where the session should run |
| `branch` | string | Branch name created or checked out |
| `pawWorkDir` | string | Full path to `.paw/work/<work-id>/` |
| `environment` | string | `local` in this design |
| `sessionStateRoot` | string | Path to Copilot session state directory in the local environment |
| `executionPath` | string | `full-paw`, `paw-lite`, or `just-do-it` |
| `reviewPolicy` | string | Review behavior the worker session should follow |
| `launchNonce` | string | Unique launch token used to bind the discovered session to the correct graph node |
| `kickoffPrompt` | string | Initial prompt passed to Copilot CLI interactive mode |

#### Phase 2 — Copilot CLI Interactive Launch

After SDK preparation completes, Streamliner:

1. **Records launch claim** — writes a launch claim to Streamliner's runtime state binding the node to the expected session location before the worker session starts
2. **Launches Copilot CLI** — opens a visible terminal in the returned `cwd` and starts Copilot CLI interactive mode
3. **Passes the kickoff prompt** — launches the worker session with the initial prompt already populated, conceptually equivalent to `copilot -i "<kickoff prompt>" .`
4. **Binds on discovery** — when the session watcher detects the new Copilot session (via its session state directory appearing), Streamliner binds it to the launch claim

### Kickoff Prompt

The kickoff prompt is a first-class launch artifact, not ad hoc terminal text. It tells the worker session what kind of run this is and how to begin. At minimum it must encode:

- The execution path (`full-paw`, `paw-lite`, or `just-do-it`)
- The work item identity (workstream, node, repo, branch/worktree)
- Where the prepared context artifacts live
- The launch nonce on a dedicated line so the watcher can confirm the intended binding
- Any review-policy expectations or launch-time operating constraints

Opening a terminal in the correct directory is not a launch. A launch is only complete once Streamliner has prepared the kickoff prompt and started Copilot CLI interactive mode with that prompt.

### Failure Modes

| Failure | Behavior |
|---------|----------|
| Node not launchable (wrong status, unmet deps) | Reject with explanation |
| Target repo not registered or inaccessible | Reject with explanation |
| Branch conflict (already exists, dirty state) | Prompt builder for resolution |
| SDK preparation failure (`paw-init`, context assembly, prompt compilation) | Report error, clean up partial state |
| Copilot CLI launch failure | Report error, clean up launch claim |

## Context Assembly

Context assembly builds the Layer 0–3 context package that gives a worker session everything it needs to execute a node's mission. It runs inside the SDK preparation phase so the LLM can make intelligent decisions about what context to include before the worker session is launched.

### Layer 0 — Project Design Context

Layer 0 starts from the repo's configured design docs path, using the workstream's `designRefs` as prioritization hints:

- Read the design index (`docs/design/index.md`) as the cold-reader entry point
- Front-load each `current` design doc referenced in `designRefs`
- Follow the index and those front-loaded docs into other `current` design docs and accepted decision records when they are relevant to the node
- Include `draft` design docs when they are explicitly referenced in `designRefs` or the node's spec

Design docs are already committed files. Context assembly may prioritize a subset for the generated Layer 0 bundle, but the worker is not restricted to that subset; it can continue reading the broader design set from the target repo (or registered design repo) at the current HEAD.

### Layer 1 — Workstream Intent

Extracted from the workstream's `brief.md`:

- Purpose
- Approach
- Design References
- Boundaries

### Layer 2 — Operational State

Extracted from the workstream's `brief.md`:

- Current State
- Decisions
- Open Questions

### Layer 3 — Node Context

Assembled from the graph and tracker:

- **Wave context**: which checkpoint/wave the node belongs to, what preceded it, what follows
- **Node spec**: the issue body (from GitHub) or local spec file content
- **Coordination notes**: any cross-node coordination context from the orchestrator
- **Relevant sibling context**: summaries of parallel and upstream nodes that might affect this node's work

### Delivery Mechanism

Context is delivered as files written into the PAW work directory that `paw-init` created. The kickoff prompt points the worker session at these files during initialization. See [Decision 002](decisions/002-file-based-context-delivery.md) for the rationale.

The assembled context is written to:

```
.paw/work/<work-id>/
  context/
    layer-0-design.md       ← front-loaded design docs + pointers into the wider design set
    layer-1-intent.md       ← extracted brief sections
    layer-2-state.md        ← extracted operational state
    layer-3-node.md         ← node spec + wave context
```

These files are generated, not manually maintained. They are excluded from Git (via `.gitignore` in the context directory) and regenerated on each launch. The PAW workflow skill reads them during initialization.

## Session Lifecycle

### Observed States

Streamliner does not require sessions to self-report their status. Instead, it observes Copilot CLI's own session state files and derives lifecycle state from what it sees. See [Decision 001](decisions/001-observation-based-session-tracking.md) for the rationale.

```
launching → discovered → active ⇄ idle → ended
```

| State | Meaning | How detected |
|-------|---------|--------------|
| `launching` | SDK preparation done, Copilot CLI worker launch in progress | Launch claim recorded by Streamliner |
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
| `pawWorkflow` | PAW work directory on disk | Work ID, work title, `Workflow Identity` (`paw` | `paw-lite`), current activity, and gate/procedure state read from `## Control State` in `WorkflowContext.md` / `ReviewContext.md` when present; legacy inference from artifact presence otherwise. See [Decision 003](decisions/003-paw-control-state-integration.md). |

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

The **session registry** is Streamliner's authoritative, local-first record for tracked sessions. See [Decision 004](decisions/004-session-registry-primary-surface.md) for the rationale; the registry is graph-independent and exists so cross-session context survives restarts regardless of whether a session was launched from the graph.

Each registry entry carries:

| Field | Source | Purpose |
|-------|--------|---------|
| `id` | Streamliner | Registry-scoped id, distinct from the Copilot session id |
| `title`, `description` | Builder | Human-meaningful context, autosaved on change |
| `color` | Builder | Single source of truth for platform color bridges (e.g., Windows Terminal tab color) |
| `cwd`, `repo`, `branch` | Observation + builder override | Relaunch target and binding guardrails |
| `copilotSessionId` | Observation | Links the entry to a live or historical Copilot CLI session when one is known |
| `lifecycleStatus` | Builder + observation-driven transition to `ended` | Durable coarse lifecycle: `active | paused | ended | archived`. Carries across session ends and Streamliner restarts |
| `lastSeenAt` | Observation | Drives staleness surfacing and sort order |
| `tags` | Builder | Freeform; grouping semantics deferred |
| `graphBinding` | Launch pipeline / builder | Optional `{ workstreamId, nodeId, launchClaimId }` — populated when the session is bound to a graph node |

`lifecycleStatus` is intentionally coarse and durable. The fine-grained, observation-derived liveness of a currently-live Copilot session (`launching`, `discovered`, `active`, `idle`, `ended`, see [Observed States](#observed-states) below) is an orthogonal derived view layered on top of the registry row at render time, not a field stored on the row. A single registry entry can be `lifecycleStatus: active` and observation-`idle` simultaneously — those are independent axes and the overlay composes them. Observation is the only writer of the transition from `active` to `ended` on `lifecycleStatus`; all other `lifecycleStatus` transitions are builder-driven.

Registry entries are created either by **observation import** (the watcher discovers a Copilot session without a matching registry row and creates one in `lifecycleStatus: active` with the metadata it has, which the builder can then edit) or as **manual entries** (the builder creates a row for a session Streamliner has not yet observed, or for a session running in an environment not yet watched). Manual entries become linked when observation later finds a matching Copilot session.

Observation is the authoritative source for observation-derived fields — the registry never fabricates `lastSeenAt`, the `active → ended` transition on `lifecycleStatus`, or session-end reasons that observation has not confirmed. Builder-editable fields (`title`, `description`, `color`, `tags`, non-`ended` `lifecycleStatus` transitions) are durable across session ends and Streamliner restarts.

Storage shape is local-first under Streamliner's runtime-state root. The default direction is per-session JSON plus an index file, aligned with how Copilot CLI already persists state; that default is revisitable if query patterns make SQLite compelling. Entries carry a schema version; entries outside the supported range render with a "schema out of range" badge and are not mutated until reconciled.

Launched-from-graph sessions (see Launch Contract above) register into the same store: the launch pipeline creates or updates a registry row and writes `graphBinding` onto it. There is no separate "launched sessions" table.

### Discovery

Streamliner watches the session state root directory (`~/.copilot/session-state/`) using filesystem notifications (`fs.watch`). When a new session directory appears, the watcher reads `workspace.yaml` for initial metadata, creates or updates the corresponding registry entry, and begins polling `events.jsonl` for activity.

### Activity Detection

The watcher polls `events.jsonl` modification times at a configurable interval (default: 30 seconds). When the file's mtime changes:

1. Read only the new bytes since the last read (incremental tail, anchored on the byte offset of the last parsed event) rather than a point-in-time tail window. This guarantees every event is seen exactly once regardless of log size.
2. Extract metadata: repository, branch, turn count
3. Detect turn boundaries: look for `assistant.turn_end` events or `agentStop` hook events without a subsequent `assistant.turn_start`
4. Detect pending input: maintain a **per-session incremental index of open tool requests**. As each `assistant.message.toolRequests` entry is observed, record its tool-call ID in the session's open-requests set; as each `tool.execution_complete` is observed, remove the matching ID. `pendingInputRequest` is true iff the open-requests set contains an `ask_user` call. The index persists across watcher restarts (rehydrated from runtime state) so long-running sessions do not lose pending-input detection when an unresolved request falls outside any bounded tail window.
5. Detect PAW workflow state: for each active `.paw/work/*/` directory reachable from the session's `cwd`, parse `WorkflowContext.md` (and `ReviewContext.md` for PAW Review sessions). When a `## Control State` section is present, use its `Workflow Identity`, required-item statuses, gate items, procedure items, and `Reconciliation` marker as the authoritative view of workflow progression. When absent, fall back to legacy inference from artifact presence. See [Decision 003](decisions/003-paw-control-state-integration.md).

### Two Orthogonal State Sources

Session tracking combines two independent sources that should not be collapsed:

- **Copilot session state** (`~/.copilot/session-state/{id}/`) — liveness, turn boundaries, pending input requests, end reasons. Authoritative for *is the session alive and does it need attention?*
- **PAW control state** (`.paw/work/<work-id>/*Context.md`) — workflow identity, required activities, gate items, procedure items, reconciliation markers. Authoritative for *where is the workflow and can decisions be trusted?*

Streamliner overlays both onto the graph node. Neither subsumes the other: a session can be idle while the PAW workflow is mid-activity, and PAW state can advance across sessions that this watcher never observed.

### Hook Signals

Copilot CLI plugin hooks provide low-latency hints that complement polling:

| Hook | Signal file | Purpose |
|------|-------------|---------|
| `sessionStart` | `{id}.start.json` | Triggers immediate session scan |
| `agentStop` | `{id}.turn.json` | Signals turn completion for fast idle detection |
| `sessionEnd` | `{id}.end.json` | Signals clean session exit with reason |

Hook scripts write a small JSON signal file to a signals directory and exit immediately (<100ms). The session watcher picks up these files via a second filesystem watch. Signal files are deleted after processing.

Hooks are **hints, not the source of truth**. If a hook fails to fire (plugin not installed, script error), the watcher still detects the same state transitions through polling — just with higher latency.

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

- **Claim creation** writes the claim atomically to runtime state before the terminal launch command runs. If SDK preparation fails before the launch command is issued, the claim is deleted on the same failure path that cleans up context files.
- **Binding window**: a claim is eligible for binding only while its launch window is open. The default window is 5 minutes from `launchedAt`. Inside the window, the watcher attempts to bind discovered sessions by nonce plus `cwd`/branch guardrails.
- **Claim expiry**: if no session binds within the window, the claim transitions to `abandoned`. Abandoned claims are retained for a short inspection period (default: 1 hour) so the builder can see that a launch failed to attach, then pruned.
- **Nonce tampering**: the kickoff prompt includes the launch nonce on a dedicated line. If the builder edits or deletes the nonce line before pressing Enter, the session's early events will not contain the expected nonce. The claim expires normally; the orphan session is surfaced in the UI (see below) so the builder can rebind it manually or discard it.
- **Unbound-session surface**: sessions discovered by the watcher that match no claim within the binding window (or are deliberately launched outside Streamliner) appear in a dedicated "Unbound sessions" panel. The builder can bind them to a node explicitly, ignore them, or let them age out with the rest of the session history.
- **Single session per claim**: a claim binds at most one session. Once bound, the claim is marked `bound` and subsequent discoveries matching the same nonce are logged as anomalies rather than rebinding.

### Watcher Diagnostics

Because session tracking combines several independent observation sources, the watcher exposes a per-session diagnostic record so operational disagreements between the UI and reality are debuggable without ad-hoc log archaeology.

Each session carries:

- **Last successful Copilot parse** — timestamp and byte offset of the last `events.jsonl` read that succeeded, plus the number of open tool requests in the incremental index.
- **Last successful PAW parse** — timestamp of the last `WorkflowContext.md` / `ReviewContext.md` read, along with the derivation path used (`control-state`, `inferred`, or `unparsable`; see [Decision 003](decisions/003-paw-control-state-integration.md)).
- **Hook signal counters** — count of `sessionStart`, `agentStop`, `sessionEnd` signals received vs. equivalent transitions inferred from polling, so "hooks silently stopped firing" is visible.

In addition, the watcher emits structured diagnostic events (not free-form logs) for every degradation mode it recognizes: `hook-miss`, `tail-truncation`, `nonce-absent-after-window`, `legacy-inference-used`, `unknown-control-state-token`, `copilot-compatibility-probe-failed`, `paw-contract-version-out-of-range`. These events are retained alongside session history and surfaced in the diagnostic view. The UI shows a compact degradation badge on any session whose diagnostics are non-empty so the builder never has to guess whether the overlay can be trusted.

## Runtime Overlay

The runtime overlay is how Streamliner presents live session and tracker state in the UI without modifying the committed graph. The overlay is a **projection of the session registry** ([Decision 004](decisions/004-session-registry-primary-surface.md)) filtered to entries whose `graphBinding` resolves to a visible node, joined with that node's committed status, observed liveness, and PAW control state. Sessions without `graphBinding` remain visible in the registry UI but do not render on the graph.

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

The `pawWorkflow` field carries a derivation-path annotation (see [Decision 003](decisions/003-paw-control-state-integration.md)) and, when control state is present, a `Reconciliation` marker. Both drive UI trust:

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

## Scope Boundaries

### In This Design

- Launch from the graph with SDK preparation, kickoff-prompt compilation, and Copilot CLI interactive worker-session launch
- Observation-based session tracking via Copilot state files
- Plugin hook signals for low-latency status hints
- Runtime overlay onto the committed graph
- Terminal-based operator presence
- Single-machine session tracking with environment field for future remote support

### Not In This Design

- Using Copilot SDK as the worker-session runtime instead of Copilot CLI interactive mode
- Multi-machine session tracking or remote session discovery (shape is compatible; implementation is deferred)
- Automatic crash recovery or relaunch
- Session-to-session communication
- Rich session control beyond launch and presence
- Headless (non-terminal) session execution
- Automatic artifact promotion from session completion

## Open Questions

- **Terminal multiplexer integration**: Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/IDE terminal APIs? (See terminal note for tmux-based approach.)
- **Multiple sessions per node**: Can a node have multiple concurrent sessions (e.g., after a crash and relaunch)? If so, how are they reconciled?
- **Context staleness**: If a session runs long enough that the workstream state changes (brief updated, graph refined), should the session be notified or continue with its original context?
- **Remote session observation**: When sessions run on a devbox, how does Streamliner observe the remote session state directory? SSH polling or a forwarded watcher?
- **Watcher restart rehydration**: On a cold watcher start against an active session, how far back does the incremental tool-request index need to be rebuilt to catch unresolved `ask_user` calls from before the restart? Options: re-scan the full log (bounded by an explicit budget), or treat pre-restart state as unknown until the next turn.
- **Concurrent Streamliner instances**: What happens when two Streamliner processes (e.g., the UI and a background watcher, or two worktrees) observe the same `projectKey`? Coordination is deferred; see the runtime-state open question in [workstream-format](workstream-format.md).
