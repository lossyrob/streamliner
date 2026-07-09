# Managed Runtime Startup Reconciliation

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `managed-runtime-startup-reconciliation`
- Type: task
- Wave: 2 / `managed-runtime-usable`
- Tracker: #89
- Status: ready

## Problem Statement

Managed SDK runtime rows are owned by the local Streamliner API process. If that
process exits while a row is `starting`, `running`, or otherwise active, the row
can look like a live background worker after restart even though no SDK owner is
attached. That undermines trust in My Sessions, graph overlays, relaunch
decisions, and the usability gate.

Streamliner already reconciles orphan launch-claim reserved rows at background
worker startup. That recovery is necessary but not sufficient for active managed
runtime rows after the SDK worker has started.

## Core Functionality

- On API/background-worker startup, scan managed SDK rows in active lifecycle
  states.
- Verify whether the SDK owner/session is still attached and verifiably live
  where the SDK/runtime supports that check.
- For rows that cannot be verified as live, move to a safe diagnostic state such
  as `interrupted` or `waiting_for_builder`.
- Record a typed diagnostic progress event/reason such as SDK owner lost,
  startup reconciliation, cancellation timeout, or manual recovery required.
- Ensure My Sessions and graph overlays do not continue to present reconciled
  rows as actively running background workers.

## Scope

In scope:

- Active managed lifecycle states including `preparing`, `starting`, `running`,
  `idle`, `waiting_for_builder`, `interrupt_requested`, `pr_ready`,
  `review_ready`, `cleanup_ready`, `cleaning_up`, and `terminal_takeover` where
  reconciliation is meaningful.
- Tests that simulate stale active rows across API startup.
- Builder-visible diagnostics and safe recovery action copy.

Out of scope:

- Remote/cloud recovery.
- Full trace/process supervision backend.
- Automatically resuming arbitrary SDK work after API restart unless liveness can
  be verified safely.
- SDK -> CLI -> SDK round-tripping after terminal takeover.

## Success Criteria

- A managed row left in `starting`, `running`, or `interrupt_requested` by a
  prior API process is reconciled at startup.
- The reconciled row has a clear typed diagnostic reason and builder action.
- Terminal outcome states such as `completed`, `failed`, `canceled`,
  `interrupted`, or `cleaned_up` are not clobbered.
- My Sessions and graph overlays do not show stale unrecoverable rows as active
  workers.
- The usability gate can cite crash/restart evidence before passing.
