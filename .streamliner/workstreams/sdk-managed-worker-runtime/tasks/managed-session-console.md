# Managed Session Console

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-session-console`
- Type: task
- Wave: 2 / `managed-runtime-usable`
- Tracker: #85
- Status: planned
- Depends on: #94

## Problem Statement

SDK-managed execution must not feel like an opaque batch job. Builders need a
first-class way to open a Streamliner surface and watch managed work progress in
a familiar, Copilot-CLI-like shape without taking over the session.

The current Wave 2 implementation has the right substrate and summaries, but the
original product intent was stronger: PAW launch preparation and background
sessions should have a terminal-looking, read-only console that streams or
replays sanitized activity so the builder can understand what is happening.

## Shaped Intent

The console is a browser monitoring surface, not a terminal emulator. It should
look and read like a CLI transcript: chronological rows, current activity,
status/phase labels, timestamps or relative timing, and clear lifecycle markers.
It must remain non-interactive while Streamliner owns the SDK session.

Terminal takeover remains the escape hatch for interactivity. The console should
make that boundary obvious: watch in Streamliner, take over in Copilot CLI when
the builder wants to type or directly control the session.

## Core Functionality

- Provide a reusable terminal-looking transcript component for sanitized
  Streamliner activity events.
- Use the same visual vocabulary for PAW launch preparation and SDK-managed
  background-session progress.
- Let builders reopen a background session from the launch dialog aftermath,
  graph/node inspector, and My Sessions/detail surfaces.
- Support live updates while the local API is connected and replay of the recent
  bounded event buffer after reopening.
- Render lifecycle, assistant status summaries, tool start/finish metadata,
  permission auto-approval decisions, MCP/skill status, PR/completion/cleanup
  evidence, blockers, failures, interrupts, and terminal takeover markers.
- Render typed `waiting_for_builder` reasons and suggested builder actions.
  Cleanup blockers, cancellation timeouts, SDK process loss, permission
  failures, and manual takeover requirements must be visibly distinct.
- When a managed session reaches `pr_ready`, show the PR URL and available trust
  context such as branch name, base branch, branch-to-base diff link, worktree
  cleanliness, and deterministic PR/head-state check results.
- Show enough closeout context after completed, failed, interrupted,
  cleanup-ready, cleaned-up, or terminal-takeover states to explain what
  happened.

## Explicit Boundaries

In scope:

- Terminal-like presentation for sanitized events.
- Openable read-only console/dialog/sheet for background sessions.
- Launch-preparation progress using the same console presentation where
  practical.
- Empty, stale/reconnecting, truncated, failed, completed, cleanup, and takeover
  states.
- Typed blocker/waiting reasons and PR-ready trust markers where backend
  projections provide enough sanitized data.
- Accessibility basics for a live log region.

Out of scope:

- Raw Copilot CLI terminal mirroring.
- Raw stdout/stderr, prompt text, reasoning, tool arguments, tool results, hook
  payloads, secrets, tokens, or provider telemetry.
- Interactive input, command execution, or keyboard control in the console.
- SDK -> CLI -> SDK round-tripping after takeover.
- New worker orchestration semantics beyond event projection/replay needed for
  the console.

## Architecture Fit

The console should consume bounded API-safe projections instead of creating a
parallel raw runtime store:

- PAW launch preparation already emits progress events through the launch dialog
  stream.
- Managed SDK sessions should expose bounded sanitized runtime progress through
  the coalesced projections from `managed-runtime-api-responsiveness` (#94), and
  through supervisor-isolated projections if `managed-runtime-supervisor-isolation`
  (#95) determines that a child-process boundary is required.
- The UI should factor shared formatting/presentation primitives so My Sessions,
  graph/node inspector, and launch surfaces do not each invent different event
  vocabularies.

If the existing projections are too thin for a useful console, this node may add
small projection fields or replay endpoints, but raw SDK/terminal event bodies
remain excluded.

## Edge Cases

- **No events yet:** show the lifecycle/launch state and explain that activity
  will appear when available.
- **Lost API connection:** preserve replayed events and show stale/reconnecting
  state.
- **Truncated buffer:** indicate that only recent sanitized activity is retained.
- **Timeout/failure:** show the last successful activity before the failure
  reason.
- **Waiting for builder:** make the blocker visible without creating an input
  prompt inside the console. Include the typed reason and expected builder
  action; do not collapse distinct blockers into a generic waiting state.
- **PR ready:** show the PR URL and available review context in the transcript so
  the builder can decide where to inspect the diff without losing the managed
  session trail.
- **Terminal takeover:** add a takeover marker, stop managed-console streaming,
  and point to the visible terminal-owned session.
- **Cleanup complete:** preserve enough final context to show what cleanup did
  and which PR/session it relates to.

## Success Criteria

- During PAW launch preparation, the dialog shows terminal-like progress rather
  than only a plain status list.
- During a background session, the builder can reopen a Streamliner surface and
  watch a live/replayed console-like transcript of sanitized work.
- The console makes SDK-managed work observable without becoming interactive or
  exposing excluded raw content.
- Interrupt, takeover, cleanup, failure, typed waiting reasons, PR-ready trust
  markers, and completion states use the same console vocabulary.
- The managed runtime usability gate can validate monitoring by watching a real
  managed node progress through launch, background execution, and either
  completion or takeover/cleanup.

## Notes

This node exists because the original workstream design discussion included a
stronger monitoring experience than the initial Wave 2 UI captured. It should be
treated as a Wave 2 prerequisite before the usability gate rather than deferred
dogfood polish.
