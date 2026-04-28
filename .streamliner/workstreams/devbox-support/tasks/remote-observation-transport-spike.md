# Remote observation transport spike

## Outcome

The workstream has selected a first-slice transport strategy for observing devbox
session state from Streamliner and understands its latency, consistency,
permissions, and failure behavior. Downstream implementation should not need to
choose between polling remote files, forwarding events, installing a devbox
helper, or another transport.

## Design References

- `docs/design/session-system.md` - local watcher, registry import, and runtime
  overlay behavior.
- `docs/design/workstream-format.md` - local runtime-state separation and
  single-writer expectations.
- `docs/design/decisions/001-observation-based-session-tracking.md` - startup
  scan, polling, hook-signal, and compatibility-probe rationale.

## Inputs

- Access model from `devbox-access-spike`.
- Remote session-state facts from `remote-session-state-spike`.

## Exports

- A recommended first-slice remote observation transport.
- Expected latency and consistency behavior for startup scan, ongoing activity,
  turn boundaries, and ended/stale detection.
- Failure-mode handling for unreachable hosts, interrupted connections, partial
  reads, permission errors, and incompatible Copilot state.

## Boundaries

### In scope

- Remote scan/watch transport selection.
- Degraded and retry behavior required to make the transport operationally
  trustworthy.
- Evidence from a small prototype, command sequence, or comparable proof.

### Out of scope

- Host registration UI implementation; owned by `devbox-host-registration`.
- Registry merge identity; owned by `environment-identity-spike`.
- Portfolio-level presentation; out of scope for this workstream.

## Inherited decisions

- Runtime observation facts remain local runtime/cache state, not committed graph
  changes. The selected transport must preserve that artifact/runtime separation.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md` for the accepted remote
observation transport. Flag `decision-needed` if the transport requires a
long-lived devbox agent or service that would constrain future remote support
workstreams.

## Success criteria

- The chosen transport has a clear minimum viable implementation path.
- The finding explains how Streamliner behaves when the devbox is offline or
  slow without fabricating freshness.
- The finding gives downstream tasks enough detail to avoid rediscovering remote
  observation mechanics.

## Engagement

Operator review is expected before this finding is accepted because the
transport choice is likely to constrain later WSL, launch, and recovery work.
