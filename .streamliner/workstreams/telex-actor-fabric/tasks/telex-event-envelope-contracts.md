# Telex Event Envelope Contracts

## Node

- Workstream: `telex-actor-fabric`
- Node ID: `telex-event-envelope-contracts`
- Type: research
- Wave: 1 / `actor-contract-proven`
- Status: planned

## External Dependency

This node consumes the stable Workstream Node Worker `node-implementer` and
`node-reviewer` subrole identifiers from Plugin Role Skills Wave 1.

## Purpose

Define transport-only Telex envelopes for field-report provenance, blockers, and
PR lifecycle events without taking ownership of role obligations, payload
semantics, PAW transitions, GitHub authority, reconciliation, or autonomous
execution policy.

## Inputs

- `.streamliner/workstreams/telex-actor-fabric/brief.md`
- Stable `role-context-v1` role/subrole identifiers
- `.streamliner/shaping/node-gate-flow.md`
- `paw-pr-lifecycle` implementer/reviewer guides and deterministic sentries
- Released Telex message, attention, threading, acknowledgement, and disposition
  contracts
- Campaign 2 field-report and reconciliation boundary

## Scope

### In scope

- Field-report transport envelope and Telex message/thread provenance.
- `telex-pr-lifecycle-events-v1` event envelope.
- Events for `review-ready`, `review-posted`, `review-addressed`,
  `rereview-requested`, `merge-ready`, `merged`, and `blocker`.
- Explicit implementer, reviewer, and orchestrator routing.
- GitHub repository/PR/head/review/comment/check evidence pointers.
- One Telex thread per PR lifecycle.
- One canonical emitter per event class.
- Deterministic sentry/runtime precedence for GitHub-derived events.
- Stable `sourceEventKey` derivation and dedupe across retries or emitter
  handoff.
- Default attention and required-disposition guidance.
- Stale-head and out-of-order handling requirements.

### Out of scope

- Field-report payload schema, requested-disposition semantics, or
  reconciliation behavior owned by Campaign 2.
- Role reporting obligations owned by Plugin Role Skills.
- PAW markers, sentries, transitions, approval triage, or re-review policy.
- Automatic actor launching, loop bounds, comment posting, merge policy, or
  human-floor decisions.
- Treating Telex receipt or disposition as proof of GitHub state.

## Expected Output

- Versioned transport-envelope specifications.
- Canonical emitter table and transition rules for changing emitter ownership.
- `sourceEventKey` derivation and dedupe examples.
- Attention/disposition/routing matrix.
- Provenance convention for promotion into durable Streamliner artifacts.

## Success Criteria

- Actor and sentry retries cannot double-author the same authoritative event.
- Receivers can reject or revalidate stale-head events.
- GitHub remains authoritative for PR, review, checks, and merge state.
- PAW and Campaign 2 policy are referenced rather than duplicated.
- Field reports can carry provenance before Campaign 2 finalizes their payload
  and reconciliation schema.
