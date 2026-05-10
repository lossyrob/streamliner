# Managed Session Console

## Overview

The managed session console makes SDK-managed Streamliner work observable in the browser without turning the browser into an interactive terminal. It adds a read-only, terminal-looking transcript for sanitized Streamliner activity so builders can monitor PAW launch preparation and reopen SDK-managed background sessions from Streamliner surfaces.

The console solves the opaque-batch-job problem for managed runtime nodes. Builders can see current lifecycle state, recent bounded progress, typed waiting guidance, managed runtime actions, and PR-ready trust context without exposing raw prompts, reasoning, tool arguments, tool results, stdout/stderr, hook payloads, secrets, tokens, or provider telemetry. Terminal takeover remains the path for interactive Copilot CLI control.

## Architecture and Design

### High-Level Architecture

The implementation keeps the existing session registry and managed runtime model as the source of truth:

- Managed SDK runners continue to write bounded, sanitized runtime metadata to the session registry.
- The managed runtime contract projects registry metadata into UI-safe fields.
- The runtime overlay passes session-aware context, including branch, worktree, and derived GitHub refs, into the projection.
- React surfaces render the projection through one reusable read-only console component.

There is no raw terminal mirroring and no new raw event store. Replay uses the bounded progress and evidence already retained on managed runtime metadata. Launch preparation uses the existing launch-preparation progress event stream and formats those events with the same console vocabulary.

### Design Decisions

The console is intentionally a projection rather than a transcript capture layer. This keeps the privacy boundary aligned with the managed runtime contract: only short, redacted, allowlisted activity summaries can reach the browser.

Managed runtime guidance is modeled as typed projection data instead of inferred UI strings wherever practical. `waitingReason` distinguishes cleanup blockers, cancellation timeouts, SDK process loss, permission failures, manual takeover requirements, builder-input requests, and unknown waiting states. `prReady` carries safe GitHub PR context and trust checks. `replay` describes how many sanitized events are retained and whether older retained activity was truncated.

PR/head-state trust checks require independently observed branch-head data before they report a pass or failure. A single PR evidence SHA is displayed as PR-head context, but it is not self-compared as proof that the branch and PR still match.

The transcript stays read-only. Suggested actions and managed runtime controls render adjacent to the console footer or waiting guidance, not as prompt text or browser terminal input.

### Integration Points

The shared console is used in three user-facing surfaces:

- PAW launch dialog: shows terminal-like launch preparation and managed SDK start progress.
- Node inspector runtime details: shows the selected node's background session console, replay, waiting reason, PR context, and existing managed runtime actions.
- My Sessions managed runtime detail: shows the same console for reopened background sessions with fuller session metadata.

The projection contract integrates with:

- `SessionRegistryRuntimeMetadata.progressEvents` and `evidence`
- graph runtime overlay projection
- session registry list-item projections
- existing interrupt, cancel, terminal takeover, and cleanup action buttons

## User Guide

### Prerequisites

The console appears when a node or session has Streamliner-managed SDK runtime metadata, or while PAW launch preparation is actively running. Existing terminal-launched sessions continue to use the terminal-first surfaces and do not gain a fake browser terminal.

### Basic Usage

During PAW launch preparation, open a node launch dialog and start PAW init or managed launch. The progress area renders as a terminal-like, read-only console with the current activity line and retained progress rows.

During managed background execution, select the node in the graph inspector or open the session from My Sessions. The managed runtime section shows:

- current lifecycle state
- retained sanitized transcript rows
- replay retention note
- typed waiting or blocker guidance when available
- PR-ready trust context when a PR is known
- existing managed runtime action buttons in the footer

The `streamliner $` prompt marker is visual framing only. It does not accept input.

### Advanced Usage

When a session waits for builder action, use the waiting reason and action footer to decide whether to interrupt, cancel, take over in a terminal, or retry cleanup. Terminal takeover opens real Copilot CLI control and remains one-way for the session row.

When a session reaches PR-ready or later PR-related states, inspect the PR URL, branch/base information, compare link, worktree cleanliness, and PR/head-state checks that are available. Missing fields render as not reported rather than failing open.

## API Reference

### Key Components

`ManagedSessionConsole` is the reusable React component for the read-only transcript. It accepts a title, state label/tone, current message, sanitized events, optional replay metadata, optional waiting reason, optional PR-ready trust context, a live-region flag, and an optional footer for actions.

`ManagedSessionConsoleEvents` contains conversion helpers for turning managed runtime projections and PAW launch progress events into console transcript events. It also centralizes lifecycle tone and live-console state helpers.

`managedRuntimeProjectionFromSession` projects managed runtime metadata with session context so UI code can render branch/worktree/GitHub trust context without each surface reimplementing the rules.

### Configuration Options

There is no new user configuration. The console is driven by existing managed runtime metadata and appears automatically on managed runtime surfaces.

The projection remains backward compatible. Optional fields such as `waitingReason`, `prReady`, and `replay` degrade gracefully for older sessions or sessions where producers have not emitted enough sanitized context.

## Testing

### How to Test

As a human user, start a managed SDK node launch and watch the PAW launch dialog. The progress area should look like a read-only terminal transcript and should not show raw prompts or tool payloads.

To test replay, reopen a managed background session from the node inspector or My Sessions after progress has accumulated. The console should show retained sanitized rows, a replay note, and the current lifecycle message.

To test waiting and actions, use a managed runtime state that reports `waiting_for_builder` or cleanup blockers. The console should show a typed waiting reason and suggested action while action buttons remain outside the transcript.

To test PR-ready trust context, use a managed session with PR-ready evidence and branch/base metadata. The console should show a safe GitHub PR link and only report PR/head match status when independent head data is available.

### Edge Cases

Empty retained activity renders a waiting row with the configured empty message.

Truncated replay reports that older retained activity was dropped at the retained event limit.

Missing optional projection fields render as absent or not reported; they do not create broken UI or misleading trust passes.

Unsafe PR and compare URLs are dropped unless they are HTTPS GitHub pull-request or compare URLs. Derived GitHub links are generated only from safe repo and ref values.

Active managed consoles opt into polite live-region announcements. Terminal or completed managed states do not announce as live logs.

## Limitations and Future Work

The console currently uses the existing bounded progress buffer. It cannot replay raw historical turns and intentionally does not preserve raw SDK or terminal content.

Replay truncation is inferred from retained event count reaching the retention limit. A future producer-side truncation flag could make the replay note more precise.

The visible console window is larger than the compact projection limit to support reopened-session monitoring. Future documentation can clarify the distinction between compact projection limits and full console replay windows if the contract grows.

Additional producer support can improve PR-ready trust context by consistently emitting sanitized branch head, PR head, base branch, compare URL, and worktree cleanliness metadata.
