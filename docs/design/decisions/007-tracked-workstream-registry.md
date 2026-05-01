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

The primary open/relink affordance is the browser's native directory picker. For picker-selected workstream directories, the browser owns access to the directory and Streamliner stores browser-local metadata plus a persisted directory handle; path-based entries remain supported for legacy recents and server-side graph sources. Browser-selected workstreams reload and poll `graph.json` through the directory handle in the same browser, but another browser profile or machine must relink the workstream directory.

Update: server-side workstream sources are now the primary tracking model. Users register local source directories with the API, either as a project root containing `.streamliner\workstreams\*\graph.json` or as a workstreams root containing `*\graph.json`. Source configuration, scan health, discovered workstreams, archive state, and conflict diagnostics live in Streamliner runtime state under `~/.streamliner/state/workstream-registry/`; the browser directory picker remains legacy/local-browser support rather than the primary workflow.

Source-discovered workstreams keep the same `/workstreams/{projectKey}/{workstreamId}` identity. Path-backed registry entries continue to take route precedence when they overlap with source-discovered graphs, and all duplicate candidates are reported as conflicts with their origin and path. Archiving a workstream hides the identity from the default list without mutating graph files or hiding source/conflict diagnostics. Source deletion removes only Streamliner source configuration; it does not delete graph files.

This decision is a scoped portfolio-shell step. It makes workstream navigation durable across browser tabs and reloads without introducing project grouping, cross-workstream coordination, or new session attachment semantics.
