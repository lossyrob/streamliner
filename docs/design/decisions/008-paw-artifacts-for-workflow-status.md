---
kind: decision
number: 8
status: accepted
date: 2026-05-02
update_semantics: append-only
superseded_by: null
supersedes: 3
---

# 008. PAW artifacts for workflow status

> Supersedes: [003-paw-control-state-integration](003-paw-control-state-integration.md)

## Context

Decision 003 made PAW `## Control State` in `WorkflowContext.md` and `ReviewContext.md` the intended workflow-progression source. That depended on PAW workflows reliably maintaining a precise control-state contract.

The current product direction no longer assumes that control state is the durable workflow truth. For Streamliner's MVP graph launch and runtime overlay, the consistent facts are the PAW artifacts present in the PAW work directory and the general Copilot session state already tracked by the session registry. Streamliner needs to show useful status without depending on models to maintain exact control-state behavior.

## Decision

Use PAW artifacts as the workflow-status source for PAW-backed sessions. Streamliner reads the PAW work directory and derives a coarse artifact status from durable files and directories such as specifications, plans, research artifacts, implementation phase artifacts, review artifacts, and PR/finalization artifacts.

Copilot session state remains the source for session liveness and attention state: launching, active, idle, needs input, ended, and related diagnostics. PAW artifact status does not replace Copilot session observation, and Copilot session status does not infer workflow progress by itself.

`WorkflowContext.md` and `ReviewContext.md` may still be read as artifacts when useful, but Streamliner does not treat a `## Control State` section as authoritative and does not require it to render the overlay.

## Alternatives considered

**Keep control state as authoritative.** Rejected for the current product path. It creates a hard dependency on precise model-maintained PAW behavior, which is not reliable enough to block Streamliner's launch and tracking work.

**Infer workflow status only from Copilot event logs.** Rejected because session liveness and workflow progress are different concerns. Event logs can indicate activity, idleness, and input needs, but they do not reliably describe which PAW artifacts have landed.

**Maintain a separate Streamliner workflow-state store.** Rejected because it would duplicate the PAW artifact trail and introduce another source of drift. Streamliner should derive status from artifacts and cache projections only as runtime acceleration.

## Consequences

- Streamliner's `pawWorkflow` field becomes an artifact-derived workflow summary, not a control-state parser result.
- The runtime overlay can show PAW status even when `WorkflowContext.md` has no `## Control State` section or contains stale/untrusted control-state text.
- PAW status rendering should be coarse and transparent: it reports what artifacts exist and what stage they imply, not a guaranteed workflow automaton state.
- Diagnostics shift from control-state parse errors to artifact-scan freshness, inaccessible work directories, ambiguous artifact sets, and unknown artifact layouts.
- Decision 003 remains historical context for why control-state parsing was considered, but it is no longer the current design direction.

## Open questions

- What exact PAW artifact patterns should define each coarse status label for full PAW, PAW lite, and PAW Review workflows?
- How much artifact content, if any, should Streamliner inspect beyond filenames, frontmatter, and known section headings?
- Should artifact-derived status distinguish "ready for next activity" from "latest artifact present", or leave next-action interpretation to the builder/orchestrator?
