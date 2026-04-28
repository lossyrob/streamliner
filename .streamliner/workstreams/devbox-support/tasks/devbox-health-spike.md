# Devbox health and freshness spike

## Outcome

The workstream has a trusted health and freshness model for devbox observation.
The model distinguishes live sessions, stale sessions, unreachable hosts,
degraded compatibility, permission failures, and unknown states without
presenting stale or unverified data as fresh truth.

## Design References

- `docs/design/session-system.md` - observed states, registry lifecycle status,
  and runtime overlay separation.
- `docs/design/workstream-format.md` - runtime-state freshness and artifact
  separation.
- `docs/design/decisions/001-observation-based-session-tracking.md` - local
  liveness, stale fallback, and compatibility-probe expectations.

## Inputs

- Remote transport recommendation from `remote-observation-transport-spike`.

## Exports

- A devbox health/freshness vocabulary mapped to existing session registry and
  runtime overlay concepts.
- Rules for when remote observations become stale, degraded, unreachable, or
  incompatible.
- A minimum UI/diagnostic expectation for downstream implementation nodes.

## Boundaries

### In scope

- Observation confidence and freshness semantics.
- Host-level versus session-level health states.
- Diagnostic behavior when remote access or compatibility fails.

### Out of scope

- Visual design of the portfolio shell.
- Implementing UI components.
- Remote process control or session recovery.

## Inherited decisions

- Durable registry lifecycle and observation-derived liveness are separate axes.
  Devbox health must compose with that model instead of replacing it with a
  single overloaded status field.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md` if the health model
adds new runtime overlay states or diagnostics.

## Success criteria

- An unreachable devbox cannot make old sessions appear fresh.
- Compatibility uncertainty is visible as degraded confidence, not silent
  success.
- The model gives implementation workers observable behavior to test without
  prescribing component layout.
