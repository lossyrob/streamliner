---
kind: decision
number: 3
status: accepted
date: 2026-04-20
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 003. PAW hardened state as the workflow progression source

## Context

Streamliner needs to know where a PAW workflow is — which activity is current, whether gates are resolved, whether review is pending — to render the runtime overlay and decide when a node is effectively complete. Inferring this from the presence or modification time of artifacts like `Spec.md`, `ImplementationPlan.md`, or `ReviewContext.md` is brittle: artifacts can exist in partial states, be regenerated, or belong to superseded branches.

The [phased-agent-workflow hardening](https://github.com/lossyrob/phased-agent-workflow) effort (PR #300) introduces a durable control-state contract: `WorkflowContext.md` and `ReviewContext.md` carry a `## Hardened State` section listing required activities (`init`, `spec`, `spec-review`, `code-research`, `planning`, `plan-review`, `planning-docs-review`, `final-review`, `final-pr`, `phase:<n>:<slug>`), gate items (`transition:after-*`), configured procedure items, statuses (`pending | in_progress | blocked | resolved | not_applicable`), and a `Reconciliation` marker (`not_run | current | stale | external_unverified`). PAW skills read and write this section as their durable source of truth; mutation-affecting decisions require a current reconciliation marker.

## Decision

Treat the PAW `## Hardened State` section as the authoritative source for Streamliner's `pawWorkflow` derived field. The runtime overlay reads:

- Required activity items and their statuses → current activity, blocked activities.
- Gate items (`transition:after-*`) → gate resolution state between stages.
- Procedure items (including `procedure:review-mode`) → configured behavior for this workflow.
- `Reconciliation` marker → whether the hardened state is trustworthy for decisions Streamliner surfaces (e.g., "ready to launch the next phase").
- For PAW Review sessions, `ReviewContext.md` hardened state including Terminal External Review State (`none | pending-review-created | manual-posting-provided`).

When the `## Hardened State` section is absent (legacy workflow artifacts or pre-hardening PAW versions), Streamliner falls back to best-effort inference from artifact presence and emits a lower-confidence indicator in the UI. This fallback path is permanent but secondary.

Streamliner never writes to `## Hardened State`. PAW skills own that contract; Streamliner is a reader.

## Alternatives considered

**Infer workflow state entirely from artifact presence.** Rejected as the primary path: fragile across branches, regenerations, and partial runs. Kept only as a fallback for workflows without hardened state.

**Maintain a parallel workflow-state store inside Streamliner runtime state.** Rejected: duplicates PAW's durable state and creates drift. The whole point of hardened state is that PAW's artifacts are the truth. Streamliner can cache projections but must not diverge.

**Collapse session tracking and workflow tracking into one pipeline.** Rejected: see [Decision 001](001-observation-based-session-tracking.md). Session liveness and workflow progression are independent concerns and stay separate.

## Consequences

- Streamliner's `pawWorkflow` field has a well-defined, parseable source rather than ad-hoc heuristics. UI overlays can show "phase 2 in progress, reconciliation: current" instead of "some files exist."
- Streamliner depends on a specific PAW contract version. Changes to the hardened-state format require a corresponding Streamliner parser update. The dependency is read-only, so the blast radius is bounded to the overlay.
- PAW Review sessions become first-class runtime entities: the overlay can surface Terminal External Review State to tell the builder whether a review is awaiting manual posting.
- The legacy-inference fallback path must be maintained so Streamliner works with older PAW artifacts, but should be treated as a compatibility shim, not a parallel design.
- This decision does not close the "explicit paw-lite identity" gap (workflow mode is not carried in hardened state). That remains tracked separately in PAW and may require additional metadata in the future.
- Streamliner should consume hardened state at overlay-render time (read-on-demand with caching), not mirror it into a long-lived index. Mirroring would re-introduce the drift problem.
