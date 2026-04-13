---
kind: design-doc
status: draft
last_updated: 2026-04-13
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

The session system is how Streamliner launches, monitors, and surfaces AI coding agent sessions. A **session** is a Copilot CLI agent instance executing a specific node's work in a workstream. Streamliner launches sessions from the graph, tracks their lifecycle through file-based heartbeats, and overlays live session state onto the committed graph without writing ephemeral telemetry back into `graph.json`.

## Launch Contract

The launch contract is the interface between the graph UI (where the builder initiates work), the backend (which assembles context and prepares the environment), and the terminal (which runs the agent session).

### Launch Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Workstream ID | Graph selection | Which workstream the node belongs to |
| Node ID | Graph selection | Which node to execute |
| Target repo | Graph `repos` + config | Where the code lives |
| Branch strategy | Builder choice | New branch, existing branch, or worktree |
| Execution mode | Builder choice or default | `current-checkout` or `worktree` |

The builder selects a node in the graph and initiates a launch. Streamliner resolves the node's workstream, target repository, and branch strategy. The builder may override the branch strategy or accept the default (new feature branch from the repo's main branch).

### Launch Sequence

```
1. Resolve       → Determine workstream, repo, branch, and execution environment
2. Assemble      → Build the Layer 0–3 context package for the node
3. Prepare       → Create or check out the execution environment (branch/worktree)
4. Initialize    → Run paw-init via Copilot SDK to set up the PAW work directory
5. Launch        → Open a terminal session with Copilot CLI
6. Register      → Write session entry to runtime state
7. Bind          → Associate the session with the node in runtime state
```

### Launch Outputs

| Output | Destination | Description |
|--------|-------------|-------------|
| Session ID | Runtime state | Unique identifier for the session |
| Terminal reference | Runtime state | Process ID and terminal identifier |
| PAW work directory | Target repo | `.paw/work/<work-id>/` with WorkflowContext.md |
| Context files | PAW work directory | Assembled context package |

### Failure Modes

| Failure | Behavior |
|---------|----------|
| Node not launchable (wrong status, unmet deps) | Reject with explanation |
| Target repo not registered or inaccessible | Reject with explanation |
| Branch conflict (already exists, dirty state) | Prompt builder for resolution |
| paw-init failure | Report error, clean up partial state |
| Terminal launch failure | Report error, clean up runtime entry |

## Context Assembly

Context assembly builds the Layer 0–3 context package that gives a worker session everything it needs to execute a node's mission.

### Layer 0 — Project Design Context

Resolved from the workstream's `designRefs` and the repo's configured design docs path:

- Read the design index (`docs/design/index.md`)
- Read each `current` design doc referenced in `designRefs`
- Read accepted decision records referenced by those design docs
- Skip `draft` design docs unless the node's spec explicitly references them

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

Context is delivered as files assembled into the PAW work directory. The worker session reads these files as part of its initialization. See [Decision 002](decisions/002-file-based-context-delivery.md) for the rationale.

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

### States

```
launching → active → completing → completed
                  ↘              ↗
                   failed / crashed
```

| State | Meaning | Heartbeat? |
|-------|---------|------------|
| `launching` | Environment prepared, session starting | No — written once at registration |
| `active` | Session is running and making progress | Yes — periodic updates |
| `completing` | Session is wrapping up (final commit, PR creation) | Yes |
| `completed` | Session finished successfully | Final heartbeat, then stops |
| `failed` | Session encountered an unrecoverable error | Final heartbeat with error |
| `crashed` | Session stopped without a clean exit | Detected by stale heartbeat |

### State Transitions

- **launching → active**: First heartbeat received from the session
- **active → completing**: Session signals it is in its final phase
- **active → failed**: Session writes a failure heartbeat
- **active → crashed**: Heartbeat goes stale beyond the crash-detection threshold
- **completing → completed**: Session writes a completion heartbeat
- **completing → failed**: Session fails during wrap-up
- **completing → crashed**: Heartbeat goes stale during wrap-up
- **launching → crashed**: No heartbeat received within the launch timeout

### Crash Detection

A session is considered crashed when its heartbeat timestamp exceeds the staleness threshold (default: 120 seconds without update). Crashed sessions are surfaced in the UI so the builder can decide whether to relaunch, investigate, or mark the node as blocked.

Crash recovery is not automatic. The builder decides whether the work is recoverable (relaunch from the same PAW work directory) or needs a fresh start.

## Session Tracking

### Heartbeat Model

Sessions write periodic heartbeat updates to Streamliner's local runtime state directory. See [Decision 001](decisions/001-heartbeat-based-session-tracking.md) for the rationale.

Each session maintains a heartbeat file at:

```
~/.streamliner/state/{projectKey}/{workstream-id}/sessions/{session-id}.json
```

### Heartbeat Schema

```json
{
  "sessionId": "string",
  "nodeId": "string",
  "workstreamId": "string",
  "pid": 12345,
  "cwd": "/path/to/worktree",
  "status": "active",
  "phase": "implementing",
  "lastUpdated": "2026-04-13T10:30:00Z",
  "startedAt": "2026-04-13T10:00:00Z",
  "error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Unique session identifier (UUID) |
| `nodeId` | string | Node this session is executing |
| `workstreamId` | string | Workstream the node belongs to |
| `pid` | number | Operating system process ID |
| `cwd` | string | Working directory (worktree path) |
| `status` | enum | Current lifecycle state |
| `phase` | string | Human-readable phase description (e.g., "planning", "implementing", "reviewing") |
| `lastUpdated` | string | ISO 8601 timestamp of last heartbeat |
| `startedAt` | string | ISO 8601 timestamp of session start |
| `error` | string \| null | Error description if status is `failed` |

### Write Contract

- The session process is the sole writer for its heartbeat file
- Writes are atomic (write to temp file, then rename)
- Heartbeat interval: every 30 seconds while the session is active
- On clean exit: write a final heartbeat with `completed` or `failed` status
- On crash: heartbeat simply stops updating — Streamliner detects staleness

### Read Contract

- Streamliner polls heartbeat files at a configurable interval (default: 10 seconds)
- Readers tolerate missing files (session not yet started or already cleaned up)
- Readers tolerate stale files (session may have crashed)
- A session directory with no heartbeat files means no sessions are tracked yet

## Runtime Overlay

The runtime overlay is how Streamliner presents live session and tracker state in the UI without modifying the committed graph.

### Overlay Model

The UI renders each node's state by combining three sources:

```
Displayed state = committed graph status
                + runtime session status (from heartbeats)
                + tracker status (from cached issue/PR state)
```

| Committed status | Runtime session | Displayed as |
|-----------------|-----------------|--------------|
| `ready` | `launching` | Launching |
| `ready` | `active` | In Progress |
| `ready` | `completing` | Completing |
| `ready` | `completed` | Completed (pending artifact promotion) |
| `ready` | `failed` | Failed |
| `ready` | `crashed` | Crashed |
| `ready` | none | Ready |
| `in-progress` | any | Session status takes precedence |
| `completed` | any | Completed |

### Artifact Promotion

When a session completes, the committed graph still shows the pre-session status until the orchestrator (or builder) explicitly promotes the node's artifact status. This is intentional: runtime state is an overlay, not a replacement for committed artifact changes.

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

Presence does not change the session's tracking state. The session continues reporting heartbeats regardless of whether the builder is watching.

### Session List in UI

Streamliner surfaces a session panel or overlay showing:

| Column | Source |
|--------|--------|
| Node | Heartbeat `nodeId` → graph node title |
| Status | Heartbeat `status` |
| Phase | Heartbeat `phase` |
| Duration | `now - startedAt` |
| Last Update | `lastUpdated` relative time |

Clicking a session in the list focuses its terminal (when the terminal integration supports it) or shows the session's details.

## Scope Boundaries

### In This Design

- Launch from the graph with context assembly
- File-based heartbeat tracking
- Runtime overlay onto the committed graph
- Terminal-based operator presence
- Single-machine session tracking

### Not In This Design

- Multi-machine session tracking or remote session discovery
- Automatic crash recovery or relaunch
- Session-to-session communication
- Rich session control beyond launch and presence
- Headless (non-terminal) session execution
- Automatic artifact promotion from session completion

## Open Questions

- **Heartbeat writer integration**: How does the Copilot CLI session write heartbeats? Does Streamliner inject a heartbeat sidecar, or does the PAW workflow skill write heartbeats directly?
- **Terminal multiplexer integration**: Should Streamliner manage terminal tabs directly, or delegate to tmux/screen/IDE terminal APIs?
- **Multiple sessions per node**: Can a node have multiple concurrent sessions (e.g., after a crash and relaunch)? If so, how are they reconciled?
- **Context staleness**: If a session runs long enough that the workstream state changes (brief updated, graph refined), should the session be notified or continue with its original context?
