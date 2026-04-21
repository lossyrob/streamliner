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

Streamliner needs to discover and monitor Copilot CLI sessions that are executing workstream nodes. The runtime tracking model must work across different terminal environments (VS Code, iTerm, Windows Terminal), detect when sessions need the builder's attention, and keep session state separate from committed workstream artifacts. The accepted scope for this design is local launches on one machine; remote observation is deferred.

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
- **Binding**: use launch claims keyed by `launchNonce` plus `cwd`/branch/launch-window guardrails; confirm the match by finding the nonce in the session's early `user.message` events

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
- **Streamliner must run a startup compatibility probe** that asserts the presence and approximate shape of the event types it depends on (`assistant.turn_start`, `assistant.turn_end`, `tool.execution_start`, `tool.execution_complete`, `session.start`, hook signals) against a sample of recent session directories. If the probe finds an unknown event layout or a missing required type, Streamliner surfaces a "Copilot CLI compatibility unverified" diagnostic in the UI and degrades overlay confidence until the builder acknowledges or a new watcher release ships.
- **The supported Copilot CLI version range is recorded in Streamliner's source** and surfaced on the same diagnostic surface as the PAW contract range. The probe uses `copilot --version` where available as an additional signal.
- Turn boundary detection requires reading the tail of `events.jsonl` and parsing event types. This is bounded (read last 64KB, grow to 512KB if needed) but is more complex than reading a simple status file.
- Node-to-session binding requires a separate mechanism (launch claims keyed by `launchNonce` with `cwd`/branch/window guardrails) since Copilot's session files do not know about Streamliner's graph model.
- The kickoff prompt becomes part of the binding contract because it must carry the launch nonce into the session's early event stream.
- Remote session observation remains out of scope for the accepted design. If Streamliner later supports remote launches, it will need a separate design for discovering and reading remote session-state roots.

## Open questions

- **CLI upgrade playbook**: What is the process when a new Copilot CLI version changes event shapes? Options include shipping watcher fixes before auto-upgrading, pinning a known-good CLI version at the Streamliner level, or accepting a grace period of degraded overlay confidence. Pick before the first production-impacting CLI change.
