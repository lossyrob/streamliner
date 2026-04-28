# Remote observation transport spike finding

## Status

Draft issue #22 contract. The recommendation below is the candidate transport
model to validate with a real devbox run before the finding is accepted or the
PR is marked ready for review.

Tracker: [issue #22](https://github.com/lossyrob/streamliner/issues/22)

## Recommendation

Use a **devbox-side Streamliner bridge reached through a builder-managed
loopback channel** as the first production remote observation transport.

The local Streamliner process should not mount or poll the devbox filesystem
directly as steady state. Instead, the bridge runs on the devbox, reads Copilot
CLI session-state files and process locks host-locally, accepts trusted Copilot
CLI hook signals on devbox loopback, and exposes a small HTTP/JSON observation
contract to the laptop through an authenticated Dev Tunnel or optional SSH local
port forward.

The first slice should be **HTTP polling with versioned snapshots, event-tail
offsets, and signal cursors**. Streaming, WebSockets, server-sent events, or
long-polling can be later optimizations, but they are not required to make
devbox sessions operationally trustworthy.

## Production bridge contract

The bridge owns host-local observation. The laptop owns registry import, merge,
and UI projection. Every response is versioned and generated from devbox-local
facts at request time or from the bridge's local signal spool.

### Minimum endpoint set

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /health` | Reachability, bridge version, host clock, session-root access, hook-spool health, and high-level diagnostics. | Must be safe to call before registration is trusted. |
| `GET /capabilities` | Machine-readable support flags and limits for snapshot, event tail, signal ingest/read, process-lock liveness, and path conventions. | May be folded into `/health` by the first implementation if the fields remain explicit. |
| `GET /sessions/snapshot?limit=<n>` | Bounded startup/current-state scan of recent sessions. | Returns session metadata, event-file cursors, event shape summaries, trusted-signal summaries, and lock state. |
| `GET /sessions/{copilotSessionId}/events?afterOffset=<n>&maxBytes=<n>` | Incremental event tail for one session. | Returns complete parsed event envelopes after the byte offset and the next offset to persist locally. |
| `GET /signals?after=<cursor>&limit=<n>` | Cursor read of trusted hook signals accepted or spooled on the devbox. | Reads are replayable; local Streamliner deduplicates by signal id. |
| `POST /api/sessions/signals` | Copilot CLI plugin hook target on the devbox. | Accepts the same normalized signal payload as the local Streamliner endpoint. |

The exact URL prefix can change during implementation, but the versioned surface
above is the contract downstream tasks should preserve. Keeping `POST
/api/sessions/signals` compatible with the existing plugin hook target lets the
devbox plugin use the same `STREAMLINER_SESSION_SIGNAL_ENDPOINT` shape as local
sessions.

### Snapshot shape

`GET /sessions/snapshot` returns an envelope similar to:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-28T00:00:00.000Z",
  "environmentId": "local-runtime-id",
  "pathConventions": "windows",
  "sessionStateRoot": "~/.copilot/session-state",
  "sessions": [
    {
      "copilotSessionId": "session-id",
      "sessionDirName": "session-id",
      "workspace": {
        "cwd": "C:\\path\\to\\repo",
        "repository": "owner/repo-or-path",
        "branch": "feature/example",
        "createdAt": "2026-04-28T00:00:00.000Z",
        "updatedAt": "2026-04-28T00:00:00.000Z",
        "summaryPresent": true,
        "summaryLength": 42
      },
      "events": {
        "exists": true,
        "sizeBytes": 123456,
        "lastWriteTimeUtc": "2026-04-28T00:00:00.000Z",
        "nextOffset": 123456,
        "latestEventType": "assistant.turn_end",
        "latestEventTimestamp": "2026-04-28T00:00:00.000Z",
        "eventTypes": ["assistant.turn_end", "user.message"]
      },
      "locks": {
        "processState": "live",
        "lockCount": 1
      },
      "trustedSignals": {
        "admitted": true,
        "latestSignalAt": "2026-04-28T00:00:00.000Z",
        "latestSignalType": "prompt.submitted"
      },
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
```

Paths, repository names, and summaries are local runtime facts. They may cross
the private bridge connection to the builder's local Streamliner process, but
they must not be copied into committed workstream artifacts. The bridge should
not return raw prompt text, assistant message text, tool arguments, or complete
event lines by default. Prompt bodies are reduced to lengths; workspace summaries
are represented by presence and length unless a later, explicit summarization
feature opts into bounded raw-content reads.

### Event-tail shape

`GET /sessions/{copilotSessionId}/events` is offset based, matching the local
watcher's incremental-tail model. The bridge parses complete JSONL records and
returns normalized envelopes:

```json
{
  "schemaVersion": 1,
  "copilotSessionId": "session-id",
  "fromOffset": 1024,
  "nextOffset": 4096,
  "events": [
    {
      "offset": 2048,
      "byteLength": 180,
      "type": "tool.execution_complete",
      "timestamp": "2026-04-28T00:00:00.000Z",
      "toolCallId": "call-id",
      "toolName": "ask_user",
      "promptLength": null,
      "rawContentOmitted": true
    }
  ],
  "diagnostics": []
}
```

The bridge does not advance the caller's offset. Local Streamliner persists
offsets in local runtime state only after successfully ingesting the response. If
an events file is truncated, rewritten, or shorter than the stored offset, the
bridge returns a `cursor_invalid` diagnostic and a safe resync point; the laptop
then performs a bounded rescan rather than assuming the session ended.

### Trusted signal spool

The devbox Copilot CLI plugin should set:

```powershell
$env:STREAMLINER_SESSION_SIGNAL_ENDPOINT = "http://127.0.0.1:<bridge-port>/api/sessions/signals"
```

When the bridge is running, hook POSTs are accepted on loopback and written to a
devbox-local append/spool log before the hook exits. When the bridge is not
running, the plugin's existing fallback writes signal files under the devbox's
Streamliner runtime state. On startup, the bridge should drain both its own spool
and the plugin fallback spool into the cursor-readable signal log. This preserves
trusted admission/end signals across bridge restarts and laptop disconnects.

Signal reads are replayable rather than destructive. Local Streamliner dedupes by
`signalId` when present, otherwise by `(environmentId, copilotSessionId,
signalType, timestamp, hookSource)`.

## Local Streamliner consumption model

### Configuration ownership

Builder/local runtime configuration supplies:

- logical `environmentId` and display name,
- access kind: `dev-tunnel-bridge` or `ssh-port-forward`,
- bridge base URL after the local connector is active,
- Dev Tunnel id/name and local port, or SSH target/local-forward details,
- remote session-state root override when it is not the default,
- optional path/repo mapping hints for display.

Credentials and tokens remain outside Streamliner artifacts and ordinary runtime
JSON. Dev Tunnel login state, SSH keys, bridge bearer tokens, and OS credential
material are owned by Azure CLI/Dev Tunnels, SSH, the OS credential store, or a
future credential manager.

### Connection setup

The first implementation may treat the access channel as builder-managed: the
builder or a setup helper starts `devtunnel connect <id>` or an SSH local forward,
and Streamliner receives a local bridge URL. Streamliner can later spawn and
monitor those connector commands, but it must still treat authentication expiry
as an external credential failure rather than silently creating new credentials.

The bridge itself should be a user-scoped helper process for the first slice, not
a cloud relay and not a privileged service. Installing it as a login task or
turning it into a long-lived service is a later operational decision. If that
choice becomes mandatory for devbox support, open an ADR before implementation
depends on it.

### Observation loop

1. Verify `/health` and `/capabilities`.
2. Run a bounded `/sessions/snapshot` startup scan.
3. Read trusted signals with `/signals`.
4. For sessions that are active, recently changed, admitted by a trusted signal,
   or shown in the snapshot with a changed `events.sizeBytes`, read incremental
   `/sessions/{id}/events` from the locally persisted offset.
5. Merge observations into the primary local session registry using the normal
   registry writer. The bridge never writes the laptop's registry.
6. Store per-environment cursors, offsets, compatibility diagnostics, and
   freshness timestamps in local runtime/cache state only.

The default poll cadence can match the local watcher at 30 seconds. Trusted hook
signals shorten perceived latency to the next poll and can support a shorter
burst poll window after `session.started` or `prompt.submitted`, but stale/ended
decisions still require observed session-state or lock facts from the devbox.

## Latency and consistency expectations

| Concern | Expected behavior |
| --- | --- |
| Startup scan | One health/capability request plus a bounded snapshot. Large histories are summarized and paged rather than fully transferred. |
| Ongoing activity | Poll snapshot/signals at the normal watcher cadence; tail only sessions whose size, mtime, signal cursor, or trusted state changed. |
| Turn boundary | Derived from normalized event envelopes and trusted hook signals, with the same precedence as local observation. |
| Prompt submission | Hook signal updates trusted activity time and prompt length. Raw prompt text does not cross the bridge in the first slice. |
| Session end | Clean end hook is trusted when observed; stale fallback requires a recent successful bridge observation. |
| Watcher restart | Local cursors/offsets rehydrate from runtime state. Invalid cursors trigger bounded rescan and degraded diagnostics, not data loss. |
| Clock skew | Bridge responses include `generatedAt` and raw file mtimes. Freshness uses local receipt time plus bridge diagnostics so a skewed devbox clock cannot fabricate freshness. |

## Failure handling

| Failure | Local Streamliner behavior |
| --- | --- |
| Dev Tunnel or SSH connector unavailable | Mark environment transport `unreachable`; keep registry rows, but make observation freshness stale once the freshness window expires. |
| Dev Tunnel authentication expired | Surface `credential_expired` or equivalent diagnostic with re-login guidance; do not delete or end sessions solely because auth expired. |
| Bridge not listening | Mark bridge `unavailable`; retry with backoff; do not infer session end from bridge downtime. |
| `/health` version mismatch | Mark compatibility `unsupported_bridge_version`; skip snapshot/tail parsing unless the version is explicitly backward compatible. |
| Session-state root missing or denied | Surface environment compatibility/permission diagnostic; do not create fresh observations from incomplete data. |
| Partial JSONL line | Bridge withholds the incomplete record until a later read and does not advance `nextOffset` past unparsed data. |
| Event parse error | Return a per-session diagnostic and continue with metadata that is still verified; liveness confidence is degraded for event-dependent fields. |
| Events file truncated or shorter than offset | Return `cursor_invalid`; local Streamliner performs bounded resync and keeps last-known state stale until reverified. |
| Hook endpoint unavailable | Plugin fallback spools locally; bridge drains on restart. Sessions without trusted hooks remain observed-only/diagnostic by default. |
| Stale lock files | Bridge reports `stale_lock`; local Streamliner may show interrupted/resumable but not live. |
| Slow bridge response | Time out the poll, preserve last-known data as stale, and retry with backoff. Registry mutation waits for verified data. |

## Security and privacy boundary

- Bridge binds to devbox loopback by default.
- Dev Tunnels should be private/authenticated; SSH local forwarding should rely on
  SSH's normal host trust.
- If the bridge is ever exposed beyond loopback or a private tunnel, require an
  explicit auth scheme owned by the devbox security spike before implementation.
- Committed artifacts may describe field names and endpoint shapes, but must not
  include real tunnel ids, hostnames, usernames, paths containing secrets, tokens,
  or raw session output.
- First-slice endpoints return metadata and normalized event shapes. Raw prompt
  text, assistant message text, and tool arguments are out of scope.

## Evidence

Issue #19 validated the transport premise:

- the managed Windows Dev Box can run a loopback HTTP bridge on
  `127.0.0.1:<bridge-port>` without local administrator changes;
- `/health` and `/snapshot` succeeded locally on the devbox;
- a private authenticated Dev Tunnel can expose that loopback port without
  inbound SSH;
- the laptop can connect through `devtunnel connect` and call the bridge health
  endpoint through `http://127.0.0.1:<mapped-port>`;
- the devbox-local probe verified readable Copilot session-state directories,
  compatible `workspace.yaml` and `events.jsonl` shapes, hook events in current
  plugin sessions, Windows path conventions, and host-local lock interpretation.

This evidence is not sufficient by itself to accept issue #22 because it tested
only the issue #19 access/smoke bridge. Issue #22 still needs a live devbox run
against the transport-specific smoke bridge and probe added in this branch.

## Required issue #22 validation

The branch includes a devbox-side smoke bridge and a laptop/devbox probe for the
candidate endpoint contract:

- `remote-observation-transport-bridge-smoke.ps1`
- `remote-observation-transport-probe.ps1`

The devbox validation should prove:

- `/health` returns `status: "ok"` and reports the session-state root;
- `/capabilities` advertises snapshots, offset event tails, signal POST, signal
  cursor reads, process-lock liveness, and raw-content omission;
- `/sessions/snapshot` returns real devbox session metadata without raw prompt or
  assistant content;
- `/sessions/{id}/events?afterOffset=...` can tail at least one real devbox
  session by byte offset and returns normalized event envelopes;
- `POST /api/sessions/signals` accepts a synthetic normalized signal on devbox
  loopback;
- `/signals?after=...` returns that synthetic signal through a replayable cursor;
- the same probe succeeds from the laptop through `devtunnel connect`, not only
  from the devbox itself.

Once that evidence is committed back to the branch, update this section with the
observed results and move the issue #22 graph node from `in-progress` to
`completed`.

## Design impact

Update `docs/design/session-system.md` with the transport vocabulary: bridge
health/capabilities, bounded snapshots, offset event tails, signal cursors,
Dev Tunnel/SSH consumption, and freshness degradation. A new ADR is not required
for this spike because it preserves the accepted local-first registry and
observation model. Open an ADR only if downstream implementation requires a
privileged or always-on devbox service, a cloud relay, raw transcript transport,
or remote control semantics.

## Downstream exports

- `devbox-host-registration` should register local runtime bridge/access fields
  and verify `/health` before accepting a host as observable.
- `devbox-session-discovery` should implement the bridge client, snapshot import,
  event-tail cursors, and signal-cursor ingestion.
- `environment-identity-spike` owns how `environmentId`, remote cwd, repo, branch,
  and Copilot session ids merge into registry identity.
- `devbox-health-spike` owns exact UI/state vocabulary for stale, unreachable,
  degraded, credential-expired, and bridge-version failures.
- `devbox-security-spike` owns credential references, bridge auth, and diagnostic
  redaction beyond the no-secrets boundary above.
