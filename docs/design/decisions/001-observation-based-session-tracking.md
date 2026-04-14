---
kind: decision
number: 1
status: accepted
date: 2026-04-14
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 001. Observation-based session tracking

## Context

Streamliner needs to discover and monitor Copilot CLI sessions that are executing workstream nodes. The runtime tracking model must work across different terminal environments (VS Code, iTerm, Windows Terminal), detect when sessions need the builder's attention, and keep session state separate from committed workstream artifacts.

Prior art: an earlier system originally required agents to call MCP tools to self-report status. Agents frequently skipped these calls, leaving the monitor blind to session activity. Moving to direct observation of Copilot CLI's own session state files proved far more reliable.

## Decision

Observe Copilot CLI's existing session state files rather than requiring sessions to write custom heartbeats or call registration APIs. Streamliner watches `~/.copilot/session-state/` for session directories and reads their contents:

- **`workspace.yaml`** — session metadata: id, cwd, repository, branch, summary, timestamps
- **`events.jsonl`** — append-only event log: turns, tool calls, hook invocations, errors

The observation model:

- **Discovery**: `fs.watch()` on the session state root directory detects new session directories
- **Activity**: poll `events.jsonl` modification times at 30-second intervals
- **Turn boundaries**: detect `assistant.turn_end` events and `agentStop` hook events to distinguish active (agent churning) from idle (agent turn complete, waiting for user)
- **Pending input**: detect unresolved `ask_user` tool requests to surface "needs input" status
- **Session end**: Copilot CLI plugin hooks write lightweight signal files (`{id}.end.json`) for fast detection; stale `events.jsonl` mtime (>30 min) is the fallback

Hooks are supplementary, not required. They provide low-latency hints via signal files:

| Hook | Signal | Latency |
|------|--------|---------|
| `sessionStart` | `{id}.start.json` | <100ms |
| `agentStop` | `{id}.turn.json` | <100ms |
| `sessionEnd` | `{id}.end.json` | <100ms |

If hooks are not installed or fail, the watcher still derives the same state transitions from polling — just with higher latency (~30s instead of instant).

## Alternatives considered

**Custom heartbeat files** — sessions write periodic status to Streamliner's own runtime state directory. Rejected: requires the session to know about Streamliner and actively cooperate. Agents cannot be trusted to reliably call reporting APIs or write custom files in long-running sessions. The Copilot CLI already writes `events.jsonl` as a side effect of normal operation — observing that is strictly more reliable.

**MCP tool registration** — sessions call `register`/`done` tools on a Streamliner MCP server. Rejected: prior experience showed agents frequently skipped these calls. The MCP handshake also adds 10-15 seconds of latency per lifecycle event. Signal files (<100ms) are better when explicit signals are needed.

**Process scanning** — enumerate OS processes, match by name or command-line pattern. Rejected: fragile across platforms, does not carry session-to-node binding, requires OS-specific discovery code, and provides no insight into what the session is doing.

## Consequences

- Streamliner depends on Copilot CLI's undocumented session state file format. Changes to that format require updating the watcher. This is an accepted trade-off: the format has been stable enough for production use over months of observation, and the alternative (requiring agent cooperation) is less reliable.
- Turn boundary detection requires reading the tail of `events.jsonl` and parsing event types. This is bounded (read last 64KB, grow to 512KB if needed) but is more complex than reading a simple status file.
- Node-to-session binding requires a separate mechanism (launch claims based on `cwd` matching) since Copilot's session files do not know about Streamliner's graph model.
- The observation model naturally extends to remote sessions by polling remote session state directories over SSH.
