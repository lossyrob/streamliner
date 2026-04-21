---
kind: decision
number: 5
status: accepted
date: 2026-04-21
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 005. Session registry storage and identity model

## Context

[Decision 004](004-session-registry-primary-surface.md) established that the session registry is Streamliner's primary session surface, but intentionally left the concrete record identity, on-disk storage shape, and end/archive behavior to the living session-system design. Issue #11 requires those details to be nailed down so downstream work on the manual registry UI, relaunch, and observation layers can proceed without re-litigating the primitives.

The design needs a contract that works for:

- manual entries that exist before a Copilot session is observed,
- launched sessions that need a durable row before the Copilot session id exists,
- observed sessions whose Copilot state may later be cleaned up,
- and local-first file storage without introducing a database for the first implementation wave.

## Decision

Adopt the following concrete session-registry model:

1. **Registry rows use Streamliner-owned stable ids.** The registry record's `id` is never the Copilot session id. A linked Copilot session id is stored separately as nullable metadata (`copilotSessionId`).
2. **The registry lives in a global local-runtime subtree.** Store it under `~/.streamliner/state/session-registry/`, not under `{projectKey}/{workstream-id}`, because the registry is graph-independent and may outlive any individual workstream.
3. **Per-record files are authoritative; the index is derived.** Persist one full JSON file per registry row under `entries/{id}.json` and keep `index.json` as a denormalized list/cache rebuilt from the entry files when needed.
4. **Use explicit quarantine instead of partial parsing.** Malformed JSON, unsupported schema versions, and partial-write remnants are moved to `quarantine/` and ignored until repaired.
5. **Expect a single logical writer.** Mutations coordinate through an advisory `registry.lock`. If a conflicting write still slips through, mutation paths re-read the latest entry and resolve the caller's explicit changes with last-writer-wins on the fields being changed.
6. **Observation may end rows; it never archives them.** Observation owns the transition into `ended` for linked sessions, but `archived` is builder-only so historical rows are not silently hidden or repurposed.

## Alternatives considered

**Use the Copilot session id as the primary key.** Rejected. Manual rows, pre-observation launch rows, and post-cleanup historical rows all need a durable identity before or after a live Copilot session exists.

**Store the registry under each workstream's runtime subtree.** Rejected. The registry is explicitly graph-independent and must hold ad-hoc or cross-workstream sessions that do not belong to one workstream coordinate system.

**Use SQLite instead of JSON files.** Rejected for the first wave. Query needs are still simple enough for per-record JSON plus a derived index, and the file-based model matches the observation-first local-runtime design already used elsewhere in Streamliner.

## Consequences

- Downstream UI, relaunch, and observation work can all target the same stable registry id regardless of how a row entered the system.
- Index corruption or drift is recoverable because `entries/{id}.json` remains authoritative.
- Builders may hand-edit files when necessary, but malformed or incompatible edits are quarantined rather than half-interpreted.
- Archived rows are preserved until the builder explicitly deletes them; observation never silently resurrects or reuses them.
- The registry now has a concrete storage contract that `workstream-format.md`, `session-system.md`, and the TypeScript schema/contract files can share.
