# Remote Copilot state spike finding

## Status

Completed by the real devbox probe evidence collected during issue #19. The
devbox session-state shape is compatible enough for the local observation model
to be reused through a devbox-side bridge.

Source evidence: [devbox access spike](devbox-access-spike.md)

## Outcome

The workstream has evidence about Copilot CLI session-state shape on the devbox:
where it lives, which files exist, which fields/events match local observation,
and which differences require devbox-specific normalization or degraded
confidence. The result lets downstream transport and discovery nodes reuse the
local observation model substantially as-is.

## Design References

- `docs/design/session-system.md` - local Copilot session-state expectations and
  registry import behavior.
- `docs/design/decisions/001-observation-based-session-tracking.md` - observed
  file/event model and compatibility-probe requirement.
- `docs/design/decisions/004-session-registry-primary-surface.md` - registry
  import behavior for sessions in environments not yet observed.

## Inputs

- Access recommendation and probe evidence exported by `devbox-access-spike`.

## Compatibility finding

| Category | Finding | Downstream implication |
| --- | --- | --- |
| Reusable | The default `~/.copilot/session-state` root exists on the devbox and recent session directories contain `workspace.yaml` and `events.jsonl`. | The same session-directory discovery concept applies remotely when executed on the devbox host. |
| Reusable | Event tails parsed without JSON errors and included the expected observation event types: user messages, assistant turns, tool execution, lifecycle/info events, and hook events. | The local watcher event-shape compatibility probe can be reused behind the bridge. |
| Reusable | In-use lock files are interpretable on the devbox host as `live`, `stale_lock`, or `none`. | Process liveness should be computed by the bridge on the devbox, not by the laptop. |
| Normalized | Paths use Windows conventions and may not match laptop paths. | Registry identity must distinguish remote cwd/path facts from local cwd facts. |
| Normalized | Hook events appeared in active plugin-era sessions but not every older sampled session. | Hook availability is a capability/diagnostic per environment or session, not a universal assumption. |
| Normalized | Workspace summaries may be present but can reveal work context. | Transport should send summary presence/length by default and only expose raw summaries under a later explicit content policy. |
| Degraded | Missing hooks do not make session-state observation impossible. | Sessions without trusted hooks remain observed-only/diagnostic until a trusted signal admits them. |
| Degraded | Stale lock files are expected on old sessions. | Stale locks should produce interrupted/resumable or stale confidence, not live status. |
| Blocking | None found in the sampled devbox evidence. | Remote observation can proceed to the transport contract without a different session-state model. |

## Recommended devbox compatibility probe shape

The production bridge should expose the same checks the issue #19 probe proved:

- session-state root exists and is readable;
- recent session directories can be enumerated within a bounded limit;
- `workspace.yaml` exposes id/cwd/repository/branch/timestamp fields or a
  diagnosable absence;
- `events.jsonl` exists, has size/mtime metadata, and yields known event types
  from a bounded tail;
- hook-event presence is summarized without assuming it is mandatory;
- in-use lock files are resolved to `live`, `stale_lock`, or `none` on the
  devbox host;
- host platform/path convention is reported;
- diagnostics are returned as metadata, not as raw file contents.

## Exports

- Devbox Copilot session-state files are compatible with the local observation
  model when read by a host-local bridge.
- The remote transport does not need a new source of truth; it needs a bounded,
  privacy-preserving way to expose the same observed facts.
- Windows path normalization and environment identity must be handled before
  merging remote observations into the shared registry.
- Hook signals should be treated as trusted admission when present and degraded
  diagnostics when absent, matching the local trust/observation split.

## Boundaries

### In scope

- Copilot CLI session-state root discovery on the devbox.
- `workspace.yaml`, `events.jsonl`, and hook-signal availability and shape.
- Compatibility and degradation evidence.

### Out of scope

- Long-running remote watch transport; owned by
  `remote-observation-transport-spike`.
- Registry identity and merge policy; owned by `environment-identity-spike`.
- Updating implementation code.

## Design impact

`docs/design/session-system.md` already documents that devbox observation keeps
Copilot session-state files as the observed facts behind a devbox-side bridge.
No separate ADR is required for the session-state shape because the evidence does
not change Decision 001's observation-based tracking model.
