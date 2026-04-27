---
kind: decision
number: 6
status: accepted
date: 2026-04-27
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 006. Terminal color as optional launch-time projection

## Context

[Decision 004](004-session-registry-primary-surface.md) established that registry color is a builder-owned session metadata field, not terminal state. Issue #15 tested whether the first platform bridge should project that color into Windows Terminal tabs for local Windows launch and relaunch.

Windows Terminal's supported command-line surface can create new tabs or panes with a `--tabColor` argument, but it does not provide a reliable command-line contract for recoloring an already-open tab. Relaunch also remains valuable without terminal color: the primary recovery path is opening the recorded `cwd` and resuming or starting Copilot CLI work from the registry row.

## Decision

Treat terminal color as an **optional launch-time projection** of registry metadata.

For the local Windows bridge:

1. Registry `color` remains the source of truth, but the terminal bridge receives only a resolved `#RGB` or `#RRGGBB` value.
2. Palette tokens must be resolved before crossing the terminal bridge boundary. Unknown tokens, invalid hex, and absent colors are treated as "no color". Palette-token resolution is a shared registry presentation concern; this decision does not define the palette table, and relaunch must use the same resolver as the registry UI rather than inventing a terminal-specific mapping.
3. Windows Terminal color is applied only when Streamliner creates a new Windows Terminal tab or pane. Streamliner does not attempt to recolor an existing tab in Wave 2.
4. Failure to apply terminal color never changes session identity and never blocks relaunch. The fallback is an uncolored terminal opened at the recorded `cwd`.
5. The bridge is local-Windows and Windows-Terminal-specific. Other terminal hosts, WSL, devbox, and remote contexts use the no-color fallback until they have their own explicit bridge contracts.

## Alternatives considered

**Make Windows Terminal tab color part of registry identity.** Rejected. Registry identity is Streamliner-owned and terminal-host-independent per Decision 005. Terminal color is a presentation detail that may fail or be unsupported.

**Require Windows Terminal color support for relaunch.** Rejected. Relaunch's core value is restart recovery at the recorded `cwd`; color improves recognition but should not gate the workflow.

**Track terminal tab handles now to support recolor/idempotency.** Deferred. Windows Terminal's `wt.exe` surface can target windows, but it does not expose a durable registry-row-to-tab handle or a supported recolor command. Adding handle tracking would expand Wave 2 beyond the local-first registry scope.

## Consequences

- `session-relaunch` can proceed with a clear bridge contract: normalize registry color to terminal hex, attempt Windows Terminal color only at new-tab/new-pane creation, and degrade to uncolored launch when unsupported.
- The launch/relaunch contract may add optional presentation fields such as terminal title and normalized tab color, but no registry schema, registry identity, or environment-model change is required.
- Future terminal bridges can provide their own projection contracts without changing registry color ownership.
- Builders may see duplicate tabs after repeated relaunches until a future terminal-handle model exists; duplicate-tab prevention is not part of this decision.
