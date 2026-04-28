# Remote Copilot state spike

## Outcome

The workstream has evidence about Copilot CLI session-state shape on the devbox:
where it lives, which files exist, which fields/events match local observation,
and which differences require devbox-specific normalization or degraded
confidence. The result should tell downstream nodes whether the local observation
model can be reused substantially as-is.

## Design References

- `docs/design/session-system.md` - local Copilot session-state expectations and
  registry import behavior.
- `docs/design/decisions/001-observation-based-session-tracking.md` - observed
  file/event model and compatibility-probe requirement.
- `docs/design/decisions/004-session-registry-primary-surface.md` - registry
  import behavior for sessions in environments not yet observed.

## Inputs

- Access assumptions exported by `devbox-access-spike`.

## Exports

- A compatibility finding for devbox Copilot session-state files compared to the
  accepted local observation model.
- A recommended devbox compatibility-probe shape, including what should be
  considered verified, degraded, or unsupported.
- Any normalization requirements for paths, repos, branches, timestamps, event
  tails, or hook signals.

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

## Inherited decisions

- Observation is preferred over agent self-reporting. This spike should only
  challenge that inherited decision if devbox evidence shows observation cannot
  be made reliable enough.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md` for any confirmed
remote session-state contract. If the devbox evidence requires abandoning
observation-based tracking for remote sessions, flag `decision-needed` instead
of burying that choice in the spike output.

## Success criteria

- The result is based on a real or representative devbox session-state sample,
  not only assumptions from local files.
- Differences from local observation are categorized as reusable, normalized, or
  blocking.
- Downstream workers can tell what remote file/event facts are safe to depend on.

## Engagement

Operator review is expected if the spike cannot verify the expected Copilot CLI
state shape or if it recommends a devbox-specific observation path.
