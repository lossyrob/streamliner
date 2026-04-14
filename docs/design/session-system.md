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
---

# Session System

The session system is how Streamliner launches, monitors, and surfaces AI coding agent sessions. A **session** is a Copilot CLI agent instance executing a specific node's work in a workstream. Streamliner launches sessions from the graph, tracks their lifecycle by observing Copilot CLI's own session state files, and overlays live session state onto the committed graph without writing ephemeral telemetry back into `graph.json`.

## Launch Contract

The launch contract is the interface between the graph UI (where the builder initiates work), the backend (which orchestrates an SDK preflight session), and the terminal (which runs the worker session).

### Launch Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Workstream ID | Graph selection | Which workstream the node belongs to |
| Node ID | Graph selection | Which node to execute |
| Target repo | Graph `repos` + config | Where the code lives |
| Branch strategy | Builder choice | New branch, existing branch, or worktree |
| Execution mode | Builder choice or default | `current-checkout` or `worktree` |
| Environment | Builder choice or default | `local` or `devbox` |

The builder selects a node in the graph and initiates a launch. Streamliner resolves the node's workstream, target repository, and branch strategy. The builder may override the branch strategy or accept the default (new feature branch from the repo's main branch).

### Launch Sequence

The launch is a two-phase process: an **SDK preflight** that prepares the execution environment, followed by a **terminal launch** that starts the visible worker session.

#### Phase 1 — SDK Preflight

Streamliner runs a Copilot SDK session that:

1. **Assembles context** — builds the Layer 0–3 context package for the node (LLM-driven; the SDK session reads design docs, extracts brief sections, resolves node specs)
2. **Runs paw-init** — `paw-init` owns branch naming, worktree creation, and PAW work directory setup. Streamliner passes the intent (workstream, node, branch strategy, execution mode); `paw-init` decides the feature slug, worktree path, and branch details.
3. **Places context files** — writes the assembled context package into the PAW work directory that `paw-init` created
4. **Returns structured output** — the SDK session returns a result object that the terminal launcher needs

SDK preflight output:

| Field | Type | Description |
|-------|------|-------------|
| `workId` | string | PAW work identifier |
| `cwd` | string | Worktree or checkout path where the session should run |
| `branch` | string | Branch name created or checked out |
| `pawWorkDir` | string | Full path to `.paw/work/<work-id>/` |
| `environment` | string | `local` or `devbox` |
| `sessionStateRoot` | string | Path to Copilot session state directory in the target environment |

#### Phase 2 — Terminal Launch

After preflight completes, Streamliner:

1. **Launches terminal** — opens a visible Copilot CLI session in the returned `cwd`
2. **Records launch claim** — writes a launch claim to Streamliner's runtime state binding the node to the expected session location
3. **Binds on discovery** — when the session watcher detects the new Copilot session (via its session state directory appearing), Streamliner binds it to the launch claim

### Failure Modes

| Failure | Behavior |
|---------|----------|
| Node not launchable (wrong status, unmet deps) | Reject with explanation |
| Target repo not registered or inaccessible | Reject with explanation |
| Branch conflict (already exists, dirty state) | Prompt builder for resolution |
| SDK preflight failure (paw-init error, context assembly error) | Report error, clean up partial state |
| Terminal launch failure | Report error, clean up launch claim |

## Context Assembly

Context assembly builds the Layer 0–3 context package that gives a worker session everything it needs to execute a node's mission. It runs inside the SDK preflight session so the LLM can make intelligent decisions about what context to include.

### Layer 0 — Project Design Context

Resolved from the workstream's `designRefs` and the repo's configured design docs path:

- Read the design index (`docs/design/index.md`)
- Read each `current` design doc referenced in `designRefs`
- Include `draft` design docs that appear in the workstream's `designRefs` or the node's spec — a `designRefs` entry is an explicit reference
- Read accepted decision records referenced by those design docs

Design docs are already committed files. Context assembly reads them from the target repo (or registered design repo) at the current HEAD.

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

Context is delivered as files written into the PAW work directory that `paw-init` created. The worker session reads these files as part of its initialization. See [Decision 002](decisions/002-file-based-context-delivery.md) for the rationale.

The assembled context is written to:

```
.paw/work/<work-id>/
  context/
    layer-0-design.md       ← concatenated design docs
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
| `launching` | SDK preflight done, terminal starting | Launch claim recorded by Streamliner |
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
| `pawWorkflow` | PAW work directory on disk | Work ID, work title, stage, and current phase from PAW artifacts |

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

### Discovery

Streamliner watches the session state root directory (`~/.copilot/session-state/`) using filesystem notifications (`fs.watch`). When a new session directory appears, the watcher reads `workspace.yaml` for initial metadata and begins polling `events.jsonl` for activity.

### Activity Detection

The watcher polls `events.jsonl` modification times at a configurable interval (default: 30 seconds). When the file's mtime changes:

1. Read the last N events from the file (tail read, bounded to avoid reading enormous logs)
2. Extract metadata: repository, branch, turn count
3. Detect turn boundaries: look for `assistant.turn_end` events or `agentStop` hook events without a subsequent `assistant.turn_start`
4. Detect pending input: look for unresolved `ask_user` tool requests (an `ask_user` in `assistant.message.toolRequests` without a matching `tool.execution_complete`)
5. Detect PAW workflow state: read `.paw/work/*/WorkflowContext.md` from the session's `cwd`

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

1. Streamliner records a launch claim in its runtime state: `{nodeId, workstreamId, expectedCwd, launchedAt}`
2. When the session watcher discovers a new session whose `cwd` matches an open launch claim, it binds the session to that node
3. The binding is stored in Streamliner's runtime state, not in the Copilot session files

This keeps the binding in Streamliner's domain while relying on Copilot's files for everything about the session itself.

## Runtime Overlay

The runtime overlay is how Streamliner presents live session and tracker state in the UI without modifying the committed graph.

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

### Artifact Promotion

When a session ends, the committed graph still shows the pre-session status until the orchestrator (or builder) explicitly promotes the node's artifact status. This is intentional: runtime state is an overlay, not a replacement for committed artifact changes.

Promotion happens when the orchestrator reviews the session's output (PR, code changes, design-doc updates) and updates the graph to reflect the new durable state.

## Terminal Integration

### Session Visibility

Sessions run in visible terminals. The builder sees:

- A terminal tab or window per session (in VS Code, iTerm, Windows Terminal, etc.)
- Streamliner's UI shows a session list with node binding, status, and terminal reference

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

- Launch from the graph with SDK preflight and context assembly
- Observation-based session tracking via Copilot state files
- Plugin hook signals for low-latency status hints
- Runtime overlay onto the committed graph
- Terminal-based operator presence
- Single-machine session tracking with environment field for future remote support

### Not In This Design

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
