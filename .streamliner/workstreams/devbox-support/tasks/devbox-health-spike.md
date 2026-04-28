# Devbox health and freshness spike finding

## Status

Health and freshness model captured for operator review and downstream
implementation.

Tracker: [issue #24](https://github.com/lossyrob/streamliner/issues/24)

## Recommendation

Model devbox health as runtime observation confidence layered on top of the
primary session registry. Do not add a new overloaded registry status and do not
turn transport failures into session lifecycle transitions.

The registry row remains the durable identity/history record. Local runtime
state records whether the devbox environment can currently be reached, whether
the bridge is compatible and healthy, whether observations are fresh, and whether
per-session liveness is trusted, degraded, or unverified.

No fresh devbox-side action is required for this spike beyond the issue #19/#22
evidence: the accepted transport already verified `/health`, `/capabilities`,
bounded snapshots, offset tails, trusted signal cursors, Dev Tunnel reachability,
host-local process-lock interpretation, and the first set of failure behaviors.
Issue #24 turns that evidence into implementation-ready semantics.

## Health vocabulary

| Axis | Values | Meaning | Persistence |
| --- | --- | --- | --- |
| Environment reachability | `reachable`, `unreachable`, `unknown` | Whether local Streamliner can reach the configured access channel for the environment. | Local runtime/cache only. |
| Bridge health | `healthy`, `unavailable`, `unsupported`, `permission_denied`, `unknown` | Whether the devbox bridge is running, compatible, and able to inspect the configured session-state root. | Local runtime/cache only. |
| Observation freshness | `fresh`, `stale`, `unknown` | Whether the last successful snapshot/signal/tail ingestion is recent enough to trust as current. | Local runtime/cache, projected into UI. |
| Observation confidence | `trusted`, `degraded`, `unverified` | Whether observation-derived liveness can drive normal affordances, should be warning-badged, or should be treated as history only. | Runtime projection from health, capabilities, and diagnostics. |
| Session liveness | Local states plus devbox lock nuance | `active`, `idle`, `ended`, interrupted/resumable, or stale-lock degraded when verified by recent bridge data. | Derived overlay; durable lifecycle remains `lifecycleStatus`. |

These axes compose with existing registry fields:

- `lifecycleStatus` remains durable and coarse (`active`, `paused`, `ended`,
  `archived`).
- Observation-derived liveness remains separate from `lifecycleStatus`.
- Devbox health/freshness determines whether liveness can be trusted, not which
  registry row exists.
- Environment-level health may affect many rows at once; per-session diagnostics
  explain row-specific parse, cursor, lock, or hook issues.

## Freshness and degradation rules

| Condition | Required behavior |
| --- | --- |
| Health, capability, snapshot, signal, and needed event-tail reads succeed inside the freshness window | Environment is `reachable`, bridge is `healthy`, observations are `fresh`, and confidence is `trusted` unless compatibility diagnostics downgrade it. |
| Dev Tunnel/SSH connector unavailable, bridge not listening, or health probe timeout | Environment/bridge becomes unreachable or unavailable. Preserve registry rows. Expire observation freshness after the freshness window. Do not mark sessions ended from outage alone. |
| Dev Tunnel authentication expired or SSH auth denied | Surface a credential diagnostic with re-login guidance. Preserve rows and last-known data as stale. |
| Bridge version unsupported or required capability absent | Bridge is `unsupported`; confidence is `unverified` for feature-dependent liveness. Skip snapshot/tail parsing unless compatibility is explicitly supported. |
| Session-state root missing, denied, or unreadable | Bridge health is `permission_denied` or degraded. Do not create fresh observations from incomplete data. |
| Event tail cursor invalid, events truncated, partial JSONL, parse error, or clock skew | Keep verified metadata, perform bounded resync when possible, and mark event-dependent fields degraded until reverified. |
| Hook endpoint/capability missing | Sessions without trusted hooks remain observed-only/diagnostic by default. Missing hooks degrade admission confidence, but do not make the environment unhealthy by themselves. |
| Bridge reports `stale_lock` | Render interrupted/resumable or stale-lock degraded; never render as live. |
| Last successful observation ages past the freshness window | Row remains visible with stale badge/history semantics; current liveness affordances are suppressed. |

The freshness window should be much shorter than the session-ended inactivity
threshold. A missed poll should not immediately stale all rows, but an
unreachable devbox must stop looking operational quickly. Exact defaults are an
implementation setting for `devbox-session-discovery`; the invariant is that
transport outage affects freshness/confidence before lifecycle.

## UI and diagnostic expectations

Downstream implementation should expose:

- an environment-level badge for reachability/bridge health,
- per-session stale/degraded/unverified badges when health affects liveness,
- last successful observation time and freshness expiry for devbox rows,
- diagnostics grouped by environment and by session,
- clear re-login or bridge-start guidance for credential and bridge-unavailable
  failures,
- no destructive registry mutation from health failures alone.

The session list should continue to show stale devbox rows because they are
valuable history and context. The UI must not imply that stale rows are current,
live, or locally relaunchable.

Minimum diagnostic tokens for implementation:

| Diagnostic | Scope | Meaning |
| --- | --- | --- |
| `environment-unreachable` | Environment | Access channel cannot be reached. |
| `bridge-unavailable` | Environment | Connector reachable but bridge is not responding. |
| `credential-expired` | Environment | Dev Tunnel, SSH, or provider auth needs renewal. |
| `unsupported-bridge-version` | Environment | Bridge contract is not compatible. |
| `session-root-unreadable` | Environment | Configured session-state root is missing or denied. |
| `remote-observation-stale` | Environment/session | Last verified observation has aged out. |
| `cursor-invalid` | Session | Stored signal/event cursor can no longer be applied. |
| `event-parse-error` | Session | Event-dependent fields are degraded. |
| `bridge-clock-skew` | Environment | Host clock makes timestamps suspect; freshness uses local receipt time. |
| `missing-hook-capability` | Environment/session | Trusted hook admission is unavailable for affected rows. |
| `stale-process-lock` | Session | Devbox lock exists but is not a live process. |

## Design impact

Update `docs/design/session-system.md` with the health/freshness vocabulary,
stale/ended separation for devbox outages, diagnostic tokens, and UI confidence
expectations. A new decision record is not required because the model preserves
the accepted registry/lifecycle separation from Decisions 001, 004, and 005.

Open a decision record later only if implementation changes the durable registry
lifecycle model, introduces remote control/recovery semantics, or requires an
always-on/privileged bridge service as a product invariant.

## Downstream exports

- `devbox-host-registration` should verify initial `/health` and
  `/capabilities`, persist non-secret environment diagnostics locally, and reject
  registrations that cannot establish a compatible observation scope.
- `devbox-session-discovery` should maintain per-environment freshness,
  reachability, capability, cursor, offset, and compatibility state in local
  runtime/cache.
- `devbox-registry-merge` should mutate registry rows only from verified fresh
  observations and should never end/delete/archive rows solely because transport
  is down.
- `devbox-operational-surface` should render environment and per-session
  confidence badges and suppress current-state affordances for stale or
  unverified devbox rows.
- `devbox-security-spike` still owns credential-reference and redaction details
  for the health diagnostics above.
