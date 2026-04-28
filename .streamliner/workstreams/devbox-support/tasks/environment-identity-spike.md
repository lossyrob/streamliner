# Environment identity spike finding

## Status

Identity model captured for operator review and downstream implementation.

Tracker: [issue #23](https://github.com/lossyrob/streamliner/issues/23)

## Recommendation

Use **environment-scoped observation identity** for devbox sessions. The registry
row `id` remains Streamliner-owned and stable. The Copilot session id remains a
linked observation fact, but it is only comparable inside a Streamliner-owned
`environmentId`.

The automatic observed-session key is:

```text
(environmentId, copilotSessionId)
```

Local sessions normalize to `environmentId: "local"`. A registered devbox uses a
builder/local-runtime environment id that represents one host/session-state-root
observation scope for this Streamliner install. The environment id is not the
devbox hostname, Azure resource id, tunnel id, SSH alias, credential name, or a
filesystem path.

If a devbox registration is retargeted to a different host or a different
Copilot session-state root, Streamliner should treat that as a new environment
or an explicit migration, not as the same identity silently reused.

## Identity model

| Fact | Owner | Normalization rule |
| --- | --- | --- |
| `id` | Streamliner registry | Durable registry row id. Never derived from host, path, or Copilot session id. |
| `environmentId` | Streamliner local runtime config | Stable observation scope. Required on observations, trusted signals, snapshots, registry rows, and list entries. Legacy rows without the field normalize to `local`. |
| `environmentKind` | Local runtime config | `local` or `devbox` for this workstream. Drives display and policy; does not imply launch support. |
| `environmentDisplayName` | Local runtime config / builder | Non-secret display label cached on registry rows so the UI can distinguish "Local" from named devboxes without a portfolio shell. |
| `environmentProvider` | Local runtime config | Non-secret hint such as `local`, `microsoft-dev-box`, `ssh`, or `dev-tunnel`. Not a credential or tunnel secret. |
| `copilotSessionId` | Copilot CLI / bridge observation | Linked session-state id scoped by `environmentId`; never globally unique and never a registry primary key. |
| `cwd` | Observation or builder | Environment-native absolute path. For devboxes this is the remote Windows path reported by the devbox, not a local path mapping. |
| `repo` | Observation or builder | Normalize to `owner/name` when a Git remote can prove it; otherwise keep an environment-native repo root path or `null`. |
| `branch` | Observation or builder | Last known branch string or `null`. Used as a guardrail, not a sufficient identity by itself. |
| `sessionStateRoot` | Local runtime config / bridge health | Defines the session-state scope for the environment. Multiple roots require distinct environment ids or explicit migration. |
| Host/provider ids | Local runtime config diagnostics | Useful for duplicate-registration and reachability checks, but not persisted as session identity. |

## Merge rules

1. If a registry row has the same `environmentId` and `copilotSessionId`, update
   that row.
2. Else if an active launch/relaunch claim with the same `environmentId`
   resolves to a known registry row, link the discovered session to that row.
   Current launch claims are local-only; devbox observation must not bind to
   local launch claims until a later devbox launch/recovery design adds remote
   claims.
3. Else if exactly one non-archived manual row has the same `environmentId`, no
   `copilotSessionId`, `lastSeenAt: null`, and matching `cwd`, `repo`, and
   `branch` (ignoring fields that are `null` on both sides), attach the observed
   session to that manual row.
4. Else create a new `origin.kind: observed` row.

Observation may refresh `copilotSessionId`, `cwd`, `repo`, `branch`,
`lastSeenAt`, and observation-driven `ended` transitions. Runtime environment
config may refresh cached display/provider metadata. Observation must not rewrite
`environmentId`, archive a row, or overwrite builder-owned `title`,
`description`, `color`, `tags`, `graphBinding`, or builder-driven lifecycle
state.

Different `environmentId` values always prevent automatic merge, even if the
same `cwd`, `repo`, `branch`, or `copilotSessionId` appears in both places. The
UI may surface a possible relationship, but cross-environment reconciliation is
a builder action.

Ambiguity remains conservative:

- More than one plausible manual row means no auto-attach.
- A local manual row without an explicit environment id normalizes to `local` and
  therefore never auto-attaches to a devbox observation.
- Path mappings can help display and future launch work, but they do not make a
  remote cwd equivalent to a local cwd for merge.
- Direct SSH probes and bridge observations for the same registered devbox must
  report through the same `environmentId`; otherwise they are different
  observation sources and cannot merge automatically.

## Field placement

| Fact | Registry row/list | Local runtime/config | Derived overlay/runtime cache | External credential or OS state |
| --- | --- | --- | --- | --- |
| `environmentId` | Yes | Yes | Yes | No |
| `environmentKind`, display name, provider | Cached non-secret display metadata | Authoritative | Rendered as row badges | No |
| Remote `cwd`, `repo`, `branch`, `copilotSessionId` | Yes | No | Used for liveness/merge views | No |
| Session-state root and path conventions | No, except through environment id and environment-native paths | Authoritative | Health/capability cache | No |
| Access kind, SSH target, Dev Tunnel id, bridge URL/ports | No | Yes, with redaction in diagnostics | Connector health only | May rely on SSH/Azure/Dev Tunnel state |
| Repo/path mappings | No | Yes | Display hints only | No |
| Bridge health/capabilities, cursors, offsets, freshness timestamps, compatibility diagnostics | No durable identity | Cached per environment | Yes | No |
| SSH keys, passphrases, Azure/Dev Tunnel tokens, bridge bearer secrets, private certs | No | Credential reference at most | Redacted diagnostics only | Yes |

The registry stores enough environment metadata to render and merge rows through
the single session surface. Access setup, health, credentials, and compatibility
remain runtime facts so stale or unreachable devboxes do not look like fresh
session state.

## UI and graph binding implications

- Session lists should show an environment badge from
  `environmentDisplayName`/`environmentProvider`, falling back to
  `environmentId` when the registration is missing.
- Devbox rows can be displayed in the existing Sessions/registry surface without
  portfolio-shell work because the row already carries the environment display
  fields needed to distinguish them from local sessions.
- `graphBinding` remains explicit registry metadata. Devbox observations do not
  infer graph binding from remote cwd, repo, or branch. Future remote launch
  claims must include `environmentId` before they can bind observed devbox
  sessions.
- Relaunch and remote control stay out of scope. A devbox row can preserve
  identity and history even when no safe "join" or "relaunch" action exists.

## Design impact

Update `docs/design/session-system.md` with the environment fields, merge
precedence, and devbox field-placement rules. A new decision record is not
required because the model preserves the accepted invariant from Decision 004:
one canonical registry row per tracked session, keyed by a Streamliner-owned
registry id. The change scopes observation identity more precisely; it does not
replace the registry with a host or Copilot-session primary key.

Open a decision record later only if implementation needs to change that
invariant, introduce multi-machine registry sync, make devbox launch/recovery a
first-class identity source, require a privileged or always-on devbox service, or
store credential material inside Streamliner-managed artifacts.

## Downstream exports

- `devbox-host-registration` should create stable local `environmentId` values
  and reject duplicate or retargeted registrations unless the builder explicitly
  migrates them.
- `devbox-session-discovery` should attach `environmentId` to bridge snapshots,
  event tails, trusted signal reads, and any direct probe fallback.
- `devbox-registry-merge` should implement `(environmentId, copilotSessionId)`
  matching plus the strict manual-row attach rule above.
- `devbox-operational-surface` should display environment badges and avoid
  implying local freshness or local relaunch for devbox rows.
- `devbox-health-spike` still owns exact reachability/freshness/degraded-state
  vocabulary.
- `devbox-security-spike` still owns credential references, bridge auth rules,
  and diagnostic redaction beyond the no-secrets field-placement boundary.
