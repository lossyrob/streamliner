# Devbox security and credential spike finding

## Status

Security and credential boundary captured for operator review and downstream
implementation.

Tracker: [issue #27](https://github.com/lossyrob/streamliner/issues/27)

## Recommendation

Keep the first devbox observation slice **local-first, builder-managed, and
credential-external**.

Streamliner should store non-secret environment registration and diagnostic state
in local runtime/config files, but it should not become the owner of SSH keys,
Dev Tunnel tokens, Azure refresh tokens, bridge bearer secrets, passphrases, or
private trust stores. The first slice can rely on a devbox bridge bound to devbox
loopback and reached through an authenticated private Dev Tunnel or SSH local
forward. A separate Streamliner bridge-auth scheme is not required unless the
bridge is exposed beyond loopback/private tunnel or later gains remote control,
raw transcript transfer, or multi-user semantics.

No fresh devbox-side action is required for this spike. Issue #19 proved the
locked-down Dev Box can host a loopback bridge and expose it through an
authenticated Dev Tunnel; issue #22 proved the private tunnel can carry the
bridge contract without committing the concrete tunnel id or URLs.

## Credential ownership

| Secret or trust material | Owner | Streamliner behavior |
| --- | --- | --- |
| SSH private keys, passphrases, SSH agent state, private certs | SSH/OS credential store | Never copied into committed artifacts, registry rows, runtime JSON, or diagnostics. Streamliner may reference an SSH alias and let SSH authenticate. |
| SSH known-host trust | SSH | SSH remains authoritative. Streamliner may cache a non-secret fingerprint/trust status locally for diagnostics and duplicate-registration warnings. |
| Azure CLI, Dev Center, and Dev Tunnel tokens | Azure CLI, Dev Tunnel tooling, OS credential manager | Streamliner records connector status, expiry/auth diagnostics, and remediation guidance only. |
| Dev Tunnel id/name, SSH alias/target, bridge URL/ports | Local Streamliner runtime/config | Allowed locally as operational identifiers; redacted from committed artifacts and default logs. |
| Bridge bearer/shared secret, if later required | OS credential manager or explicit secret provider | Not needed for first slice. If added later, Streamliner stores a credential reference only, not the raw secret. |

Local runtime/config may contain:

- `environmentId`, display name, provider, and access kind,
- SSH alias/target and optional port/user when not secret,
- Dev Tunnel id/name and local mapped port,
- bridge local URL/ports,
- session-state root override and path conventions,
- optional credential references,
- non-secret host/provider fingerprints, last verification timestamps,
  capabilities, and redacted diagnostics.

Committed artifacts may contain only portable vocabulary such as
`environmentKind`, capability names, endpoint shapes, and redaction rules. They
must not contain real hostnames, usernames, tunnel ids, private paths, credential
names that reveal secrets, tokens, keys, passphrases, raw tunnel URLs, or raw
session content.

## Registration and verification rules

1. Registration writes non-secret environment/access metadata into local
   runtime/config and creates or references external credential state through the
   owning tool.
2. Verification calls `/health` and `/capabilities` through the configured
   connector and requires a compatible bridge version, configured session-state
   root access, expected path convention, required capabilities, and loopback or
   private-channel posture.
3. If provider identity, SSH host trust, bridge instance identity, or
   session-state root changes unexpectedly, Streamliner marks the environment
   `unverified` or `host-identity-changed` and requires builder review.
4. Retargeting a registration to a different host or session-state root requires
   explicit migration or a new `environmentId`.
5. Credential expiry, denied auth, or missing bridge auth preserve last-known
   registry rows as stale history and emit remediation diagnostics; they do not
   delete rows, archive rows, or mark sessions ended.

## Bridge authentication boundary

For the first slice:

- bridge binds to devbox loopback,
- the builder-managed channel is private/authenticated through Dev Tunnels or
  SSH,
- trusted hook POSTs target the devbox-local loopback bridge,
- the bridge exposes metadata/normalized event shapes, not raw transcripts.

Open a new security design or ADR before implementation depends on any of these
expanded shapes:

- bridge listening beyond loopback or a private tunnel,
- app-layer bridge bearer/shared secrets,
- persistent Streamliner-managed credential cache,
- cloud relay or hosted Streamliner control plane,
- multi-user access control,
- remote launch/control/recovery actions,
- raw prompt/assistant/tool-argument transport.

If app-layer bridge auth is added later, the secret belongs in an OS credential
manager or explicit secret provider. Streamliner runtime config stores only a
credential reference and redacted status.

## Diagnostics and redaction

Diagnostics should be structured and allowlisted.

Safe to persist/display/log by default:

- environment id, display label, provider kind, and access kind,
- bridge version, path convention, capability booleans, loopback/private-channel
  status,
- timestamps, freshness expiry, cursor/offset numbers, event counts, byte sizes,
  prompt lengths, and process-state enums,
- diagnostic codes such as `credential-expired`, `auth-denied`,
  `bridge-auth-required`, `host-identity-changed`, `session-root-unreadable`, and
  `redaction-applied`.

Redact or omit by default:

- tokens, bearer secrets, passphrases, private keys, private certs, refresh
  tokens, and credential payloads,
- raw tunnel URLs when they embed secrets,
- usernames, hostnames, tunnel ids, and credential reference names outside local
  runtime/config,
- full private filesystem paths in committed artifacts or issue-ready logs,
- raw prompt text, assistant text, tool arguments, workspace summaries, and
  complete JSONL event lines.

When a diagnostic cannot be emitted without sensitive detail, emit the diagnostic
code plus `redaction-applied` and a short remediation hint.

## Design impact

Update `docs/design/session-system.md` with the security/credential boundary,
registration verification rules, bridge-auth escalation point, and redaction
expectations. A new decision record is not required for the first slice because
the model preserves Streamliner's local-first boundary and keeps credentials with
existing SSH/Azure/OS owners.

Open an ADR later if devbox support requires Streamliner-managed credential
storage, app-layer bridge secrets as a product invariant, a privileged or
always-on bridge service, cloud relay, multi-user access control, remote
launch/control, or raw transcript transport.

## Downstream exports

- `devbox-host-registration` should persist only non-secret local config, verify
  health/capabilities, detect unexpected host/bridge/session-root identity
  changes, and surface credential diagnostics.
- `devbox-session-discovery` should use credential-owning tools rather than
  reading secrets, and should redact connector identifiers in default logs.
- `devbox-registry-merge` should never copy access-channel identifiers,
  credentials, or private path mappings into durable registry identity beyond the
  accepted environment fields.
- `devbox-operational-surface` should present security/credential failures as
  actionable environment diagnostics while preserving stale last-known session
  rows.
- `devbox-research-contract-gate` should treat this finding as sufficient for the
  first observability slice and require a new ADR only for the expanded shapes
  listed above.
