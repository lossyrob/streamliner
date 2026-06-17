# Session Attention Widget

## Stage

Seeded; downstream of WS-C (2026-06 coverage partition).

## Coverage Partition (2026-06 refactor)

**Downstream candidate of WS-C Local Actor Fabric.** Consumes WS-C **attention levels** and worker
**lifecycle** signals (and #122 desktop toast). Note the convergence: Telex already defines the
same attention levels (interrupt / next-checkpoint / background / fyi) this widget should surface
OS-natively.

## Seed Idea

Create an ambient Streamliner companion surface for session attention: system
tray/notification behavior plus an always-on-top overlay or widget that keeps
important session states visible while the builder works elsewhere.

The current My Sessions view is useful, but it lives in browser tabs that are
easy to lose behind other work. The builder may have many workstream tabs open,
multiple My Sessions views across desktops, and active worker/review sessions
that need attention. If a session is paused and waiting for input, blocked,
failed, review-ready, or checkpoint-ready, the builder should not have to
remember to revisit the browser tab to discover that.

The builder also has a reference app in another repository that already
implements an always-on overlay triggered by a keystroke. A formed workstream
should inspect that code as prior art before deciding the exact desktop
technology and interaction model.

## Why It Matters

Streamliner is becoming an always-on coordination environment for multiple agent
sessions. The main UI can show rich session detail, but it is not always in the
builder's attention field. Missed attention states slow down work: sessions wait
for input, review loops stall, checkpoints sit ready, and the builder loses the
benefit of parallelism.

This candidate is about **attention routing**, not another full dashboard. The
widget should answer: "Do I need to do something now?"

## Candidate Scope

### In Scope

- Define a small always-visible companion surface for actionable session states.
- Include both notification/tray behavior and an always-on-top overlay/widget in
  the target direction.
- Surface sessions that need builder attention without requiring a browser-tab
  context switch.
- Distinguish high-priority waiting states from lower-priority completed/ready
  states as Streamliner's status model matures.
- Provide click-through actions to open the relevant Streamliner session,
  workstream, graph node, PR, checkpoint, or relaunch/resume path.
- Reuse or learn from the builder's existing overlay reference app in another
  repository.
- Define an efficient data feed so the companion does not worsen API/request
  pressure.

### Out of Scope

- Replacing the My Sessions view.
- Building a full mini-dashboard in the first version.
- Solving all session-status semantics by itself.
- Remote/mobile notification infrastructure.
- Multi-user notification routing.

### Deferred

- Rich filtering/rules engine.
- Cross-machine synced attention state.
- Custom themes/layouts beyond what is needed for the first usable widget.
- Deep OS-specific integrations beyond first-platform viability.

## Product Model

The widget should consume a small **attention model**, not the entire session
registry. Sessions can have detailed status in Streamliner, but the companion
surface should focus on actionable states:

| Attention state | Widget behavior |
|---|---|
| Running normally | Quiet count or minimal presence. |
| Needs input / question pending | Prominent visible alert. |
| Blocked / failed / stale | Prominent visible alert. |
| PR ready / completed | Lower-priority ready state. |
| Checkpoint ready | Builder-validation state. |
| Review loop waiting | Attention state tied to review automation. |

The first version should probably show a compact list/count of attention-needing
sessions, not all sessions. It should let the builder click into the right
Streamliner surface quickly.

## UI / Runtime Direction

First-slice direction:

- A system tray or notification presence so Streamliner can alert from outside
  the browser.
- An always-on-top overlay/widget for persistent ambient visibility.
- A quick reveal/hide interaction, potentially informed by the existing reference
  app that shows an overlay on a keystroke.
- Efficient subscription to the local Streamliner API through a lightweight
  attention endpoint or event stream.

Possible implementation technologies remain open. Tauri is plausible for tray
and always-on-top behavior, but the formed workstream should compare it with
lighter alternatives and the existing reference app.

## Dependencies

### Depends On

- Session Launching and Tracking workstream, because it owns session registry,
  liveness, relaunch, and graph/workstream links.
- Session Status Signals workstream
  (`.streamliner/workstreams/session-status-signals/`), because the widget should
  consume its operational-status and informational-signal contract rather than
  inventing a separate attention taxonomy.
- [Streamliner Performance and Robustness](streamliner-performance-robustness.md),
  because another always-on client must not add uncontrolled polling or request
  fanout.

### Enables

- [Automated PAW Review Loop](automated-paw-review-loop.md), because review loops
  need visible "waiting for builder" and "ready for re-review" attention states.
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md), because
  checkpoint-ready validation should be visible outside the browser tab.
- [SDK-Managed Worker Runtime](sdk-managed-worker-runtime.md), because managed
  workers can provide richer progress and waiting signals for an ambient widget.

### Related Candidates

- [Work Geometry Canvas](work-geometry-canvas.md), because the widget can be a
  narrow attention surface over the larger work geometry.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because
  builder takeover/hot-work moments may be triggered from attention signals.

## Workstream Shape

This is likely a small-to-medium standalone workstream if it creates a desktop
companion app. It could be smaller if the first slice is browser notifications
only, but the builder's target direction is both notifications/tray behavior and
an always-on-top overlay/widget.

Likely work areas:

- Inspect the existing overlay reference app and extract reusable patterns.
- Define the minimal attention-state API or event stream the widget consumes.
- Define the first-platform desktop wrapper approach.
- Build a minimal tray/notification presence.
- Build a minimal always-on-top overlay/widget that shows attention-needing
  sessions.
- Add click-through into Streamliner session/workstream/node surfaces.
- Verify the companion remains lightweight with many tabs/workstreams open.

## Exported Interfaces and Dependencies

Potential exports:

- Session attention model separate from detailed session status.
- Lightweight attention endpoint/event stream requirements.
- Desktop companion app packaging/runtime choice.
- Overlay/tray interaction conventions.
- Click-through route contract for session/workstream/node attention items.

Potential imports:

- Session registry status/liveness from Session Launching and Tracking.
- Operational status, active-vs-quiet waiting, ready-review, blocked/stale, heat,
  confidence, and informational-signal semantics from
  `.streamliner/workstreams/session-status-signals/`.
- Efficient API/event-stream policy from Streamliner Performance and Robustness.
- Checkpoint/review-loop states as they become available.
- Reference overlay implementation from the builder's other repository.

## Open Questions

- Which repository contains the reference always-on overlay app, and what parts
  are reusable?
- Which platform should the first desktop companion target?
- Should the first version be Tauri, another desktop wrapper, or a lighter
  notification/tray approach with overlay as a follow-up?
- Which Session Status Signals outputs are available for the widget's first
  slice, and which attention states need to wait for later status nodes?
- How should the widget distinguish "completed and ready for review" from
  "paused and asking a question" once that signal exists?
- Should the widget show only attention-needing sessions or also a quiet running
  count?
- What route should each attention item open: My Sessions, graph node, PR,
  terminal relaunch, or checkpoint panel?

## Handoff Brief

Not ready yet. Shape a Session Attention Widget workstream around ambient builder
attention, not a full dashboard. The target direction is both tray/notification
behavior and an always-on-top overlay/widget, informed by the builder's existing
reference app in another repository. The first useful slice should surface
attention-needing sessions with efficient local API usage and click-through back
to the relevant Streamliner surface.
