# Managed Runtime Wave 2 Punch List

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-runtime-wave-2-punch-list`
- Type: task
- Wave: 2 / `managed-runtime-usable`
- Tracker: #87
- Status: planned

## Purpose

Collect and resolve small Wave 2 usability and closeout fixes before
`managed-runtime-usability-gate` (#76). This node is intentionally scoped for
focused polish and confidence gaps discovered while dogfooding the managed
runtime path.

Large missing prerequisite features should still be promoted into separate
nodes. This punch list should not become a catch-all for new product surfaces or
post-gate dogfood hardening.

## Initial Items

1. **Sessions filtered-open clarity.** When a managed-session card action opens
   My Sessions filtered to a specific session, the Sessions UI should make the
   active filter criteria visible. In the observed case, the target managed
   session was ended, so the builder had to enable "show ended" before anything
   appeared, but the UI did not say a session-specific filter was active or what
   criteria were hiding the result.

## Promoted Elsewhere

- **Managed SDK row startup reconciliation** is tracked as #89 instead of this
  punch list because stale active runtime rows are a safety/trust prerequisite
  for the usability gate, not small polish.
- **Typed waiting reasons and PR-ready trust markers** are part of
  `managed-session-console` (#85) because they belong to the core monitoring
  surface.

## Scope

In scope:

- Small UI clarity fixes, copy changes, state-label improvements, and closeout
  tweaks needed to make Wave 2 validation understandable.
- Fixes directly tied to launch, session routing, managed runtime monitoring,
  terminal takeover, cleanup, or usability gate validation.
- Updating this local task and issue #87 as additional small findings are
  discovered before #76.

Out of scope:

- New large product surfaces or missing prerequisite features.
- Dogfood hardening beyond the initial usable-runtime gate.
- Automated PAW Review Loop orchestration.
- Remote/cloud execution.

## Success Criteria

- The Sessions filtered-open clarity issue is resolved.
- Additional small Wave 2 punch-list items captured here are fixed, explicitly
  promoted to separate nodes, or intentionally deferred before #76.
- The usability gate can run without known small UI/flow clarity issues
  undermining validation.
