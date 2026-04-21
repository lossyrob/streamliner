---
kind: decision
number: 3
status: accepted
date: 2026-04-20
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 003. PAW control state as the workflow progression source

## Context

Streamliner needs to know where a PAW workflow is — which activity is current, whether gates are resolved, whether review is pending — to render the runtime overlay and decide when a node is effectively complete. Inferring this from the presence or modification time of artifacts like `Spec.md`, `ImplementationPlan.md`, or `ReviewContext.md` is brittle: artifacts can exist in partial states, be regenerated, or belong to superseded branches.

The [phased-agent-workflow hardening](https://github.com/lossyrob/phased-agent-workflow) effort introduces a durable control-state contract: `WorkflowContext.md` and `ReviewContext.md` carry a `## Control State` section along with a `Workflow Identity` marker (`paw` or `paw-lite`). The section lists required items, gate items, configured procedure items, statuses (`pending | in_progress | blocked | resolved | not_applicable`), and a `Reconciliation` marker (`not_run | current | stale | external_unverified`). The required-item set depends on `Workflow Identity`:

- **`paw`** — `init`, `spec`, `spec-review`, `code-research`, `planning`, `plan-review`, `planning-docs-review`, `final-review`, `final-pr`, plus `phase:<n>:<slug>` entries and `transition:after-*` gate items.
- **`paw-lite`** — `init` → `planning` → `implementation` → `final-review` → `final-pr`, with a `procedure:final-review` item and no gate items.

Review workflows carry an analogous section in `ReviewContext.md` including Terminal External Review State (`none | pending-review-created | manual-posting-provided`). PAW skills read and write control state as their durable source of truth; mutation-affecting decisions require a current reconciliation marker.

## Decision

Treat the PAW `## Control State` section as the authoritative source for Streamliner's `pawWorkflow` derived field. The runtime overlay reads:

- `Workflow Identity` → which required-item set applies and whether to render the workflow as full PAW or paw-lite.
- Required-item statuses → current activity, blocked activities.
- Gate items (`transition:after-*`, full PAW only) → gate resolution state between stages.
- Procedure items (including `procedure:final-review`, `procedure:review-mode`) → configured behavior for this workflow.
- `Reconciliation` marker → whether the control state is trustworthy for decisions Streamliner surfaces (e.g., "ready to launch the next phase").
- For PAW Review sessions, `ReviewContext.md` control state including Terminal External Review State.

When the `## Control State` section is absent (legacy workflow artifacts or pre-hardening PAW versions), Streamliner falls back to best-effort inference from artifact presence and emits a lower-confidence indicator in the UI. This fallback path is permanent but secondary.

Streamliner never writes to `## Control State`. PAW skills own that contract; Streamliner is a reader.

## Alternatives considered

**Infer workflow state entirely from artifact presence.** Rejected as the primary path: fragile across branches, regenerations, and partial runs. Kept only as a fallback for workflows without control state.

**Maintain a parallel workflow-state store inside Streamliner runtime state.** Rejected: duplicates PAW's durable state and creates drift. The whole point of control state is that PAW's artifacts are the truth. Streamliner can cache projections but must not diverge.

**Collapse session tracking and workflow tracking into one pipeline.** Rejected: see [Decision 001](001-observation-based-session-tracking.md). Session liveness and workflow progression are independent concerns and stay separate.

## Consequences

- Streamliner's `pawWorkflow` field has a well-defined, parseable source rather than ad-hoc heuristics. UI overlays can show "phase 2 in progress, reconciliation: current" instead of "some files exist."
- `Workflow Identity` makes full PAW vs. paw-lite explicit, so the overlay can render the correct required-item ladder without inferring workflow mode from artifact presence or default config values.
- Streamliner depends on a specific PAW contract version. Changes to the control-state format require a corresponding Streamliner parser update. The dependency is read-only, so the blast radius is bounded to the overlay.
- PAW Review sessions become first-class runtime entities: the overlay can surface Terminal External Review State to tell the builder whether a review is awaiting manual posting.
- The legacy-inference fallback path must be maintained so Streamliner works with older PAW artifacts, but should be treated as a compatibility shim, not a parallel design.
- Streamliner should consume control state at overlay-render time (read-on-demand with caching), not mirror it into a long-lived index. Mirroring would re-introduce the drift problem.
