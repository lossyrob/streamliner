---
kind: decision
number: 7
status: accepted
date: 2026-05-01
update_semantics: append-only
superseded_by: null
supersedes: null
---

# Tracked workstream registry

Streamliner will keep a local tracked-workstream registry for operator navigation and URL-addressable graph views. The registry is local runtime state, not a committed workstream artifact, and lives under `~/.streamliner/state/workstream-registry/`.

Each registered workstream is addressed by `/workstreams/{projectKey}/{workstreamId}`. `workstreamId` comes from `graph.json.id`; `projectKey` comes from `graph.json.projectKey` when present, then from the sole or primary repo id when available, and otherwise from the workstream id. Both URL segments must remain kebab-case identifiers.

Opening a graph registers it. Existing `~/.streamliner/recent-graphs.json` data is migrated into the registry without deleting the legacy file. Missing, moved, or unreadable graph files soft-fail in the UI with relink and untrack actions; neither action mutates graph files or session attachments.

This decision is a scoped portfolio-shell step. It makes workstream navigation durable across browser tabs and reloads without introducing project grouping, cross-workstream coordination, or new session attachment semantics.
