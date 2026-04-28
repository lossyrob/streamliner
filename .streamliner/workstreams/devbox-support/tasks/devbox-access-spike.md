# Devbox access spike finding

## Status

Laptop-side contract draft. The access recommendation below is concrete enough
to prototype, but the spike should remain open until a real devbox session runs
the validation probe and records whether the assumptions hold.

Tracker: [issue #19](https://github.com/lossyrob/streamliner/issues/19)

## Recommendation

Target the first devbox observability slice at a **builder-managed access
channel to a devbox-side Streamliner bridge**.

For managed Windows Dev Boxes, inbound SSH may be unavailable or routed through
policy-controlled layers. The devbox-side bridge is therefore the intended
steady-state observation endpoint because trusted Copilot CLI hooks and
process-lock checks are host-local facts:

1. The builder registers a devbox in Streamliner's local runtime config.
2. Streamliner verifies the registration through a non-secret reachability probe.
3. The Streamliner Copilot CLI plugin is installed on the devbox.
4. Devbox hooks POST to a bridge bound to devbox loopback.
5. The bridge spools trusted signals locally and exposes bounded observation
   endpoints for session-state snapshots/tails.
6. The local Streamliner process reaches the bridge through either an SSH local
   port forward or an authenticated Dev Tunnel.

Direct SSH reads of `~/.copilot/session-state` remain valuable when SSH is
available, but they are not required for the first slice. They do not give hooks
a reliable local endpoint and local Windows cannot validate remote process locks
without asking the devbox. A locked-down devbox can instead expose only the
bridge over Dev Tunnels and keep all filesystem/process inspection host-local.

## What the builder configures

The builder should be able to configure the first slice with local-only facts:

- a logical devbox/environment id,
- a display name such as "work-devbox",
- an access channel kind such as `dev-tunnel-bridge` or `ssh-port-forward`,
- an SSH target or host alias only when SSH is available,
- a Dev Tunnel id/name and local bridge port when Dev Tunnels are used,
- the remote Copilot session-state root when it is not the default
  `~/.copilot/session-state`,
- an optional bridge remote port and local forwarded port,
- optional repo/path mappings used only for presentation and later launch work.

The first implementation should not require a cloud-hosted Streamliner service,
multi-machine registry sync, devbox launch, or a general host-fleet manager.

## What Streamliner can verify automatically

Before accepting a devbox registration as observable, Streamliner can run a
read-only probe through the configured access channel:

- the bridge endpoint is reachable in batch/non-interactive mode,
- the direct SSH target is reachable when SSH is configured,
- the remote platform/path conventions are known,
- the configured session-state root exists or is absent in a diagnosable way,
- recent session directories expose `workspace.yaml` and `events.jsonl` with the
  expected local observation shape,
- in-use lock files can be interpreted on the devbox into `live`, `stale_lock`,
  or `none`,
- the bridge health endpoint responds when the bridge is configured,
- the Streamliner Copilot CLI plugin/hook endpoint can be tested without storing
  prompt text.

The laptop-side probe should report summaries and capability flags only. It
should not persist the concrete SSH target, username, key path, token, or raw
session output into committed artifacts.

## Minimal registration field split

### Committed artifact fields

Committed workstream/design artifacts should not contain concrete devbox
connection details. They may refer only to portable vocabulary:

| Field | Purpose |
| --- | --- |
| `environmentKind: "devbox"` | Declares that a future launch or observation contract targets a devbox-like environment. |
| `requiredCapabilities` | Names capabilities such as `copilot-cli-session-observation` or `trusted-hook-forwarding` without naming a host. |
| `environmentSelector` | Optional logical selector for future launch policies. It must not be a hostname, username, token, tunnel id, or path containing secrets. |

For issue 19's observability-only slice, no committed graph node needs a
concrete devbox registration. Host registration belongs in Streamliner's local
runtime/config layer.

### Local runtime/config fields

These are acceptable in local Streamliner config or runtime state:

| Field | Purpose |
| --- | --- |
| `environmentId` | Stable local id used by registry rows and diagnostics; Streamliner-owned, not a Copilot session id. |
| `displayName` | Builder-facing label. |
| `provider` | `microsoft-dev-box`, `ssh`, `dev-tunnel`, or similar non-secret provider hint. |
| `access.kind` | First slice: `dev-tunnel-bridge` or `ssh-port-forward`. |
| `sshTarget` | SSH config host alias or target string when one exists. |
| `sshUser`, `sshPort` | Optional overrides when not supplied by the SSH alias. |
| `devTunnelId` | Dev Tunnel id/name when the bridge is reached through Dev Tunnels. |
| `sessionStateRoot` | Remote Copilot session-state root; default `~/.copilot/session-state`. |
| `bridge.remotePort`, `bridge.localPort` | Loopback bridge endpoint and local forwarded port. |
| `pathConventions` | `windows` or `posix` for path display/normalization. |
| `repoPathMappings` | Optional local-to-remote repo path hints; local runtime only because paths can reveal machine layout. |
| `devCenter.endpoint`, `devCenter.project`, `devCenter.boxName` | Optional non-secret Azure Dev Center identifiers for power-state checks. |
| `lastVerifiedAt`, `capabilities`, `diagnostics` | Derived reachability and compatibility cache. |

### External credential-manager or OS state

These must not be committed and should not be copied into Streamliner runtime
JSON as raw values:

- SSH private key material and passphrases,
- Azure CLI refresh tokens and Dev Center bearer tokens,
- Dev Tunnel auth tokens,
- bridge bearer/shared secrets if the bridge needs authentication,
- SSH known-host trust store and any private certificate material.

Local config may reference a credential by name or rely on the OS/SSH/Azure CLI
to resolve it, but the secret itself remains outside Streamliner artifacts.

## Access models rejected for the first slice

| Model | Reason rejected |
| --- | --- |
| Mounted remote filesystem as the primary path | It can expose files but not trusted hook delivery, remote process liveness, or clear host health. It also makes permission and caching failures look like normal local filesystem behavior. |
| Local Streamliner directly reading devbox files over ad hoc SSH commands as the whole design | Useful as a spike baseline when SSH is available, but too polling-heavy and cannot give hooks a reliable local endpoint when the laptop is offline or unreachable. |
| Copilot SDK or remote-control tunnel as the first slice | The prior reference implementation explored forwarded SDK/control behavior, but issue 19 is observability, not remote launch/control. Using SDK control first would expand scope and obscure the session-tracking question. |
| VS Code/editor remote channel | Too editor-specific for Streamliner's local-first web app direction and hard to test independently. |
| Azure Dev Tunnel without a devbox-side bridge | A tunnel is a transport channel, not a host registration, trust, or observation model. It is acceptable as the reachability channel when it exposes the bridge contract. |
| Cloud-hosted Streamliner relay | Violates the first workstream's local-first boundary and introduces multi-user/cloud security questions before they are needed. |

## Devbox validation plan

Run the probe from the spike branch on the devbox:

```powershell
cd <streamliner spike worktree on the devbox>
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-probe.ps1 -MaxSessions 10
```

If a prototype bridge is running, include its URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-probe.ps1 -MaxSessions 10 -BridgeUrl http://127.0.0.1:<bridge-port>
```

Until the production bridge exists, the spike branch includes a temporary
loopback smoke bridge that exposes `/health` and `/snapshot` without storing raw
prompt content:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-bridge-smoke.ps1 -Port <bridge-port>
```

The probe intentionally reports metadata and event type shapes, not prompt
content. The devbox-side result should answer:

- Does the default session-state root exist on the devbox?
- Do recent sessions have `workspace.yaml` fields compatible with local
  observation?
- Do recent `events.jsonl` tails include the event types Streamliner depends on?
- Do hook events appear in the event log when the plugin is installed?
- Can in-use lock files be interpreted on the devbox into `live`, `stale_lock`,
  or `none`?
- Does a bridge health endpoint make remote trusted-signal forwarding plausible?

Run the laptop-to-devbox SSH probe from the laptop once the builder has selected
the SSH target. If the target is in `~/.ssh/config`, pass the alias:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-ssh-probe.ps1 -SshTarget <ssh-host-alias> -RemoteWorktreePath <remote spike worktree> -MaxSessions 10
```

If there is no SSH config alias, pass the host details explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-ssh-probe.ps1 -SshHost <host> -SshUser <user> -SshPort <port> -RemoteWorktreePath <remote spike worktree> -MaxSessions 10
```

If an SSH local port forward to a prototype bridge is active, include the local
bridge URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-ssh-probe.ps1 -SshTarget <ssh-host-alias> -RemoteWorktreePath <remote spike worktree> -MaxSessions 10 -LocalBridgeUrl http://127.0.0.1:<forwarded-port>
```

For a locked-down Windows Dev Box where SSH is unavailable, use Dev Tunnels to
expose only the bridge port. The evidence needed from this path is whether the
laptop can connect to a devbox-hosted loopback bridge and receive a health or
snapshot response. On the devbox, create the tunnel and start the temporary
smoke bridge in one shell:

```powershell
devtunnel user login
devtunnel create <tunnel-id> --expiration 30d
devtunnel port create <tunnel-id> -p <bridge-port> --protocol http
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-bridge-smoke.ps1 -Port <bridge-port>
```

In another devbox shell, host the tunnel:

```powershell
devtunnel host <tunnel-id>
```

On the laptop, after authenticating with the same provider:

```powershell
devtunnel user login
devtunnel connect <tunnel-id>
powershell -NoProfile -ExecutionPolicy Bypass -File .\.streamliner\workstreams\devbox-support\tasks\devbox-access-ssh-probe.ps1 -LocalBridgeUrl http://127.0.0.1:<bridge-port>
```

This does not validate remote file access directly. It validates the preferred
locked-down-device shape: the bridge does host-local file/process inspection and
the laptop reaches only the bridge through an authenticated outbound tunnel.

## Devbox evidence

Probe run from `feature/issue-19-devbox-access-spike` on the active devbox with
the default session-state root and `-MaxSessions 10`.

- `~/.copilot/session-state` exists on the devbox and was readable without
  permission or enumeration errors.
- All 10 sampled recent session directories had both `workspace.yaml` and
  `events.jsonl`.
- The sampled event tails parsed without JSON errors and exposed the expected
  observation shape: `user.message`, `assistant.turn_start`,
  `assistant.turn_end`, `tool.execution_start`, `tool.execution_complete`,
  session lifecycle/info events, and hook events.
- Hook events appeared in 7 of the 10 sampled sessions. The sessions without
  hook events were older investigation-style session directories, so the active
  plugin path is present but Streamliner should treat hook availability as a
  capability observed per session or per devbox registration.
- `inuse.*.lock` files were interpretable on the devbox. The sample included
  `live`, `stale_lock`, and `none`, confirming the probe can distinguish a live
  local process from stale or absent locks when it runs on the devbox host.
- The devbox uses Windows path conventions for the observed session state. This
  is compatible with the proposed `pathConventions` registration field and means
  local observation code must not assume POSIX-style remote paths.
- No bridge URL was supplied, so bridge health was not tested. This run validates
  devbox-local filesystem and process evidence; laptop-to-devbox SSH
  reachability and any bridge endpoint still need separate validation.

### Dev Tunnel evidence

Follow-up run from `feature/issue-19-devbox-access-spike` after the laptop
handoff commit `4838057` validated the locked-down Windows Dev Box path with the
temporary loopback smoke bridge on `127.0.0.1:17619`.

- `devtunnel` is installed on the managed devbox. Its cached login token had
  expired, but `devtunnel user login` succeeded without committing or recording
  auth material.
- The smoke bridge bound successfully to `127.0.0.1:17619` without requiring
  local administrator changes.
- Local devbox requests to `/health` and `/snapshot` both succeeded. `/health`
  returned `status: "ok"` with the session-state root present, and `/snapshot`
  returned schema version 1 with 10 sampled sessions and no probe errors.
- A private Dev Tunnel could be created, port `17619` could be attached with
  HTTP protocol, and `devtunnel host` reported the tunnel ready to accept
  connections. This validates the devbox-hosted, outbound tunnel side without
  relying on inbound SSH.
- Laptop-to-devbox bridge reachability was not completed from this devbox-only
  session. No devbox-side blocker was observed; the remaining check is an
  authenticated laptop client or browser request through the tunnel to confirm
  the laptop can reach the hosted `/health` or `/snapshot` endpoint.

The evidence is enough to accept the devbox-local side of the design:
session-state observation and process-lock interpretation should run on the
devbox host. It also supports Dev Tunnels as the locked-down-device transport
candidate when inbound SSH is unavailable, pending a laptop-side reachability
check against the hosted bridge.

## Open evidence needed

- A laptop-to-devbox SSH reachability probe using the builder's chosen target or
  host alias.
- Confirmation of the actual SSH target or alias shape the builder wants to use.
- A laptop-side Dev Tunnel client or browser check against the hosted bridge.
- Confirmation that installing the Streamliner Copilot CLI plugin on the devbox
  can point hooks at the devbox-local bridge without slowing or breaking Copilot
  sessions.
