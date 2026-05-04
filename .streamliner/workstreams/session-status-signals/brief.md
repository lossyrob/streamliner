# Session status signals

## Purpose
Make Streamliner session status legible enough for the builder to know what
action, if any, is needed, while also surfacing interpretation signals that help
with reconciliation and workstream-design learning.

The desired end state is a session surface that clearly separates operational
status from informational signals: whether a session needs the builder, is still
working, is ready for review, is blocked, or is stale should be visually distinct
from signals like heat, reconciliation need, boundary pressure, design impact,
attachment, environment, and summarizer confidence.

## Approach
Treat this as a small design-and-implementation workstream centered on the
session registry/status surface. Start by converting the initial shaping in
`docs/initial-shaping.md` into an explicit session-status design contract, then
build the detection and UI slices behind that contract.

The workstream should preserve two principles:

1. **Action status and interpretation signals are separate lanes.** Operational
   status tells the builder what to do next. Informational signals explain how to
   interpret the session and what may matter during reconciliation.
2. **Heat is a scalar signal, not a binary badge.** The UI should avoid a fire
   emoji or other good/bad cue. A neutral heat index, likely rendered as a
   thermal dot/ring with current, peak, and trend semantics, should indicate the
   degree of active builder-agent co-shaping.

Implementation should consume the existing session registry and observed session
state rather than creating a parallel tracking model. Status summaries should be
runtime overlay data, not committed graph state.

## Design References
- `streamliner:docs/design/index.md` - entry point for the project design set
- `streamliner:docs/design/product.md` - product scope, operational picture, and
  workstream-level feedback-loop framing
- `streamliner:docs/design/operating-model.md` - roles, information flow,
  presence, and artifact-first communication
- `streamliner:docs/design/workstream-format.md` - workstream support docs and
  runtime/artifact separation
- `streamliner:docs/design/session-system.md` - session registry, observation,
  status, and runtime overlay design this workstream extends
- `streamliner:docs/design/decisions/001-observation-based-session-tracking.md`
  - rationale for observing Copilot CLI session state rather than controlling it
  directly
- `streamliner:docs/design/decisions/004-session-registry-primary-surface.md`
  - session registry as the primary session surface
- `streamliner:docs/design/decisions/005-session-registry-storage-and-identity.md`
  - persisted session identity and builder-owned fields
- `streamliner:docs/design/decisions/008-paw-artifacts-for-workflow-status.md`
  - PAW artifact status is workflow enrichment, separate from general Copilot
  liveness and attention state

Support context:
- `.streamliner/workstreams/session-status-signals/docs/initial-shaping.md` -
  initial brainstorm and shaping context for this workstream

## Boundaries
- **In scope:** Session operational-status taxonomy, informational signal model,
  heat-index semantics and heuristics, AI/status summarizer structured output,
  distinction between waiting-on-builder and ready-to-review, confidence/reason
  strings, session-card/subcard UI organization, and reconciliation-related
  runtime signals such as needs-reconciliation and boundary pressure.
- **Out of scope:** Full workstream reconciliation automation, committing heat or
  transient status signals to `graph.json`, replacing the session registry,
  portfolio-shell redesign, devbox-specific observation behavior, graph launch
  mechanics, non-Copilot runtimes, and implementing a full analytics system for
  builder performance.
- **Deferred:** Cross-environment status nuances, portfolio-wide status rollups,
  graph-node overlay reuse beyond consuming the shared status contract, manual
  heat overrides, and long-term heat/history visualizations.

## Current State
The workstream has been shaped from a brainstorming session about detecting hot
work, distinguishing "needs my input" from "ready for review," and organizing the
session UI around separate operational and informational status lanes. The
initial shaping context is captured in `docs/initial-shaping.md`.

No tracker issues have been created yet. The first executable node is to turn
the shaping into an explicit status-lane design contract and update the relevant
project design surface, most likely `docs/design/session-system.md`.

This workstream depends on the existing session registry and observation work in
`session-launching-and-tracking`; it should not redefine session identity,
storage, launch binding, or PAW artifact workflow status.

## Decisions
- Use a two-lane status model: operational status for next action, informational
  signals for interpretation and reconciliation.
- Operational status drives sorting, attention, and notifications; informational
  signals do not automatically imply urgency.
- Model heat as an index with current, peak, and trend semantics rather than a
  binary "hot" flag.
- Avoid a fire emoji as the primary heat UI because it can read as good/bad or
  celebratory. Prefer a neutral thermal dot/ring or similar scalar indicator.
- Heat means active builder-agent co-shaping density. It does not mean quality,
  importance, urgency, or whether the hot work was inspired or recovery.
- Status summaries should include reasons and confidence so the builder can see
  why Streamliner believes a session needs input, is ready for review, is blocked,
  or has meaningful interpretation signals.
- Keep fast-moving session status and heat data in runtime overlay state. The
  committed workstream artifacts should only change through reconciliation or
  explicit workstream planning updates.

## Open Questions
- Which Copilot CLI state-file events are reliable enough to count user turns,
  assistant turns, tool activity, and unanswered assistant questions?
- What initial heat-score inputs, weights, time windows, and decay rules are
  good enough for a first version?
- How often should an AI/status summarizer run, which model should it use, and
  how should its output be cached?
- What confidence threshold should make the UI show low-confidence status rather
  than overstate "needs you" or "ready to review"?
- How should the thermal indicator meet accessibility requirements without
  relying on color alone?
- Which reconciliation and boundary-pressure signals are available in V1, and
  which should wait until orchestration/reconciliation infrastructure is more
  explicit?
