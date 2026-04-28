# Devbox access spike finding

## Status

Laptop-side contract draft. The access recommendation below is concrete enough
to prototype, but the spike should remain open until a real devbox session runs
the validation probe and records whether the assumptions hold.

Tracker: [issue #19](https://github.com/lossyrob/streamliner/issues/19)

## Recommendation

Target the first devbox observability slice at a **builder-managed SSH access
profile with a devbox-side Streamliner bridge**.

SSH is the baseline access primitive because it is already available for a real
Microsoft Dev Box, works without committing secrets, and gives Streamliner a
simple reachability test. The devbox-side bridge is the intended steady-state
observation endpoint because trusted Copilot CLI hooks and process-lock checks
are host-local facts:

1. The builder registers a devbox in Streamliner's local runtime config.
2. Streamliner verifies the registration with a non-interactive SSH probe.
3. The Streamliner Copilot CLI plugin is installed on the devbox.
4. Devbox hooks POST to a bridge bound to devbox loopback.
5. The bridge spools trusted signals locally and exposes bounded observation
   endpoints for session-state snapshots/tails.
6. The local Streamliner process reaches the bridge through an SSH local port
   forward. Azure Dev Tunnels can be evaluated as an equivalent channel after
   the SSH path works, but they are not the first required access primitive.

Direct SSH reads of `~/.copilot/session-state` remain valuable for the spike and
as a degraded fallback. They are not the preferred steady-state design because
they do not give hooks a reliable local endpoint and local Windows cannot
validate remote process locks without asking the devbox.

## What the builder configures

The builder should be able to configure the first slice with local-only facts:

- a logical devbox/environment id,
- a display name such as "work-devbox",
- an SSH target or host alias,
- the remote Copilot session-state root when it is not the default
  `~/.copilot/session-state`,
- an optional bridge remote port and local forwarded port,
- optional repo/path mappings used only for presentation and later launch work.

The first implementation should not require a cloud-hosted Streamliner service,
multi-machine registry sync, devbox launch, or a general host-fleet manager.

## What Streamliner can verify automatically

Before accepting a devbox registration as observable, Streamliner can run a
read-only probe over SSH:

- the SSH target is reachable in batch/non-interactive mode,
- the remote platform/path conventions are known,
- the configured session-state root exists or is absent in a diagnosable way,
- recent session directories expose `workspace.yaml` and `events.jsonl` with the
  expected local observation shape,
- in-use lock files can be interpreted on the devbox into `live`, `stale_lock`,
  or `none`,
- the bridge health endpoint responds when the bridge is configured,
- the Streamliner Copilot CLI plugin/hook endpoint can be tested without storing
  prompt text.

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
| `provider` | `microsoft-dev-box`, `ssh`, or similar non-secret provider hint. |
| `access.kind` | First slice: `ssh-port-forward`. Later equivalent channels can be added explicitly. |
| `sshTarget` | SSH config host alias or target string. Prefer an alias so host/user/port can stay in SSH config. |
| `sshUser`, `sshPort` | Optional overrides when not supplied by the SSH alias. |
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
| Local Streamliner directly reading devbox files over ad hoc SSH commands as the whole design | Useful as a spike baseline, but too polling-heavy and cannot give hooks a reliable local endpoint when the laptop is offline or unreachable. |
| Copilot SDK or remote-control tunnel as the first slice | The prior reference implementation explored forwarded SDK/control behavior, but issue 19 is observability, not remote launch/control. Using SDK control first would expand scope and obscure the session-tracking question. |
| VS Code/editor remote channel | Too editor-specific for Streamliner's local-first web app direction and hard to test independently. |
| Azure Dev Tunnel as the only access model | A tunnel is a transport channel, not a host registration, trust, or observation model. It can be evaluated as a substitute for SSH port forwarding after the bridge contract is proven. |
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

## Open evidence needed

- A real devbox probe result from this branch.
- Confirmation of the actual SSH target or alias shape the builder wants to use.
- Confirmation whether Azure Dev Tunnels add value beyond SSH port forwarding for
  this observability slice.
- Confirmation that installing the Streamliner Copilot CLI plugin on the devbox
  can point hooks at the devbox-local bridge without slowing or breaking Copilot
  sessions.
