---
kind: decision
number: 1
status: accepted
date: 2026-04-13
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 001. Heartbeat-based session tracking

## Context

Streamliner needs to discover and monitor Copilot CLI sessions that are executing workstream nodes. The runtime tracking model must work across different terminal environments (VS Code, iTerm, Windows Terminal), support crash detection, and keep session state separate from committed workstream artifacts.

The key constraint: session tracking is a runtime overlay. It must not require modifications to `graph.json` or other committed artifacts on every session state change.

## Decision

Use file-based heartbeats. Each session writes a JSON heartbeat file to Streamliner's local runtime state directory (`~/.streamliner/state/{projectKey}/{workstream-id}/sessions/{session-id}.json`). Streamliner polls these files to discover sessions, monitor status, and detect crashes.

The heartbeat contract:

- Each session is the sole writer for its heartbeat file
- Writes are atomic (write-then-rename)
- Heartbeat interval: 30 seconds
- Crash detection: heartbeat stale beyond 120 seconds
- Clean exit: final heartbeat with terminal status (`completed` or `failed`)

## Alternatives considered

**Process scanning** — enumerate OS processes, match by name or command-line pattern. Rejected: fragile across platforms, does not carry session-to-node binding, and requires OS-specific discovery code.

**Named pipes or Unix sockets** — sessions register with a local IPC endpoint. Rejected: adds complexity for a problem that does not require low-latency bidirectional communication. File polling at 10-second intervals is sufficient.

**Central registry process** — a daemon that sessions register with on startup. Rejected: introduces a single point of failure and an additional process to manage. File-based heartbeats are self-healing — if Streamliner restarts, it re-reads the directory and recovers state.

## Consequences

- Sessions need a mechanism to write heartbeats. This is likely a sidecar concern (Streamliner injects a heartbeat writer) or a PAW skill integration (the workflow skill writes heartbeats directly).
- Crash detection has a delay equal to the staleness threshold. This is acceptable for the intended use case (builder monitoring, not real-time SLA enforcement).
- The heartbeat directory can accumulate stale files from crashed sessions. Streamliner should clean up heartbeat files older than a configurable retention period.
- Multi-machine tracking is explicitly out of scope for this decision. File-based heartbeats work for single-machine operation. A future decision can layer network-based discovery on top.
