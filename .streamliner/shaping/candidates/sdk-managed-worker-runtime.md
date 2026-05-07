# SDK-Managed Worker Runtime

## Stage

Promoted to `.streamliner/workstreams/sdk-managed-worker-runtime/`.

## Seed Idea

Explore using Copilot SDK as the default execution runtime for autonomous Streamliner worker sessions, with visible terminal launch becoming an optional takeover/resume path rather than the steady-state execution path.

The current Session Launching and Tracking design uses Copilot SDK for PAW launch initialization, then launches a visible Copilot CLI terminal for the actual worker. That makes the session observable and interactive, but once it is in a terminal Streamliner has limited control over the session. For fire-and-forget node work where the builder is waiting for a PR anyway, a fully armed SDK worker may be a better default.

Potential future shape:

1. Streamliner launches a managed Copilot SDK worker with the same tools/context/authority a CLI worker would receive.
2. The SDK worker runs the PAW workflow and produces the PR.
3. Streamliner can directly coordinate follow-up work, review loops, re-prompts, cancellation, and status because it owns the execution loop.
4. If the builder wants to inspect or take over, Streamliner can resume or open the underlying Copilot session state in Copilot CLI.

## Why It Matters

Automated review loops reveal the limits of terminal-first execution. If Streamliner launches implementation and review sessions into terminals, it can observe them but not easily coordinate them. It cannot reliably route review comments back into the original implementation session without either remote-controlling an interactive terminal or launching a separate address-review session.

SDK-managed execution changes the product model:

- implementation and review sessions become controllable actors;
- review/address/re-review loops can run as a managed workflow;
- the builder can still inspect or take over when desired;
- terminal visibility becomes an affordance, not the runtime substrate.

This would advance Streamliner from "launch and observe agent sessions" toward "operate autonomous agent workflows with optional human takeover."

## Candidate Scope

### In Scope

- Explore whether a Copilot SDK worker can match the capabilities and context of the current Copilot CLI worker path.
- Define SDK-managed implementation session lifecycle: start, run, pause, resume, cancel, error, PR-ready, review-ready, completed.
- Define how the builder can inspect progress without a terminal.
- Define how the builder can take over by opening/resuming the SDK session state in Copilot CLI.
- Define how managed SDK sessions appear in My Sessions and graph-node runtime overlays.
- Define how SDK-managed implementation sessions interact with Automated PAW Review Loop.
- Decide when terminal-first execution is still preferred.

### Out of Scope

- Replacing all terminal launches immediately.
- Removing visible terminal launch support.
- Designing remote/multi-user execution.
- Assuming SDK-managed workers are safe for every task without builder configuration.

### Deferred

- Cloud/remote execution pools.
- Multi-agent scheduler.
- Full terminal live-stream mirroring.
- General-purpose workflow engine beyond Streamliner node/review execution.

## Product Tradeoff

| Runtime mode | Strength | Weakness |
|---|---|---|
| Terminal-first Copilot CLI | Visible, familiar, builder can jump in immediately. | Streamliner can mostly observe, not manage; hard to automate follow-up turns. |
| SDK-managed worker | Streamliner can manage prompts, turns, review loops, pause/resume, and state transitions. | Less ambient visibility; builder interaction requires a UI surface or terminal takeover. |
| Hybrid | Default autonomous work runs managed; builder can open terminal on demand. | Requires clear handoff/takeover semantics and shared session-state assumptions. |

## Relationship to Automated PAW Review Loop

This candidate may be the cleanest way to support the builder's preferred review workflow:

- The original implementation session remains the actor that addresses review comments.
- The PAW Review session can run as a second managed SDK actor.
- Streamliner can alternate between reviewer and implementer without launching new terminals.
- Terminal takeover remains available if the builder wants to inspect, intervene, or steer.

Without SDK-managed workers, the review-loop workstream must either programmatically send follow-up prompts into an existing terminal session or fall back to launching a separate address-review worker. SDK-managed execution makes original-session continuation much more tractable.

## Sequencing Decision

This workstream becomes a high-priority follow-on once Session Launching and
Tracking concludes, because automated review loops expose the limits of
terminal-first session management. If the desired near-term review-loop behavior
is "send review comments back to the original implementation session," SDK-managed
workers or an equivalent managed-continuation substrate are likely needed before
that path can be reliable.

The sequencing relationship should stay explicit:

- Session Launching and Tracking provides launch/session/node/PR substrate.
- SDK-Managed Worker Runtime explores controllable implementation actors and
  terminal takeover/resume.
- Automated PAW Review Loop uses that manageability when it needs to route review
  comments back to the original implementation session.

If Automated PAW Review Loop chooses a first slice that launches separate
address-review workers, SDK-managed workers can run in parallel or follow later.
If the first slice must match the builder's current original-session workflow,
this workstream should run first or as the first enabling wave.

## Dependencies

### Depends On

- Session Launching and Tracking, because it already defines launch preparation, context packages, launch claims, registry rows, PAW artifact observation, and graph-node overlays.

### Enables

- [Automated PAW Review Loop](automated-paw-review-loop.md), especially original implementation-session continuation.
- Issue-native loose-work launching, because issue work may not need a visible terminal by default.
- More reliable autonomous execution status and cancellation.

### Related Candidates

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because managed SDK sessions still need role guidance.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because terminal takeover may become the way the builder enters hot work.

## Workstream Shape

This is likely a major workstream if pursued. It changes the default execution substrate from interactive terminal sessions to managed SDK sessions with optional terminal takeover.

Likely work areas:

- Research/verify Copilot SDK and Copilot CLI session-state interoperability.
- Define SDK-managed worker lifecycle and state model.
- Define progress visibility in Streamliner without terminal output.
- Define terminal takeover/resume UX.
- Define how SDK-managed workers participate in session registry and graph overlays.
- Define how PAW artifacts and PR detection work for SDK-managed implementation sessions.
- Define safety/permission model for unattended SDK execution.
- Prototype an SDK-managed worker for a single graph node before making it the default.

## Exported Interfaces and Dependencies

Potential exports:

- Managed worker runtime contract.
- Terminal takeover/resume contract.
- SDK worker lifecycle statuses.
- Session registry metadata for SDK-managed worker sessions.
- Requirements for automated review loops to coordinate implementation/reviewer actors.

Potential imports:

- Node launch context package.
- PAW launch configuration.
- Session registry identity and runtime overlay model.
- Copilot SDK session-state behavior.

## Open Questions

- Can every needed Copilot CLI capability be made available to the SDK worker?
- What exactly is required to resume an SDK session state through Copilot CLI?
- What progress stream should the builder see while the SDK worker runs?
- When should Streamliner pause and ask the builder instead of continuing headlessly?
- What does terminal takeover do to the managed SDK state: transfer ownership, fork, or continue shared state?
- Is SDK-managed execution a prerequisite for automated review loops, or a later enhancement?

## Handoff Brief

Shape this as an enabling workstream for Automated PAW Review Loop if the review
loop needs reliable original implementation-session continuation. The first
formation question is whether to build a narrow managed-continuation slice for
review loops or a broader SDK-managed worker runtime foundation.

## Promotion

Promoted into `.streamliner/workstreams/sdk-managed-worker-runtime/` as a formed
workstream.

Formation chose the broader foundational runtime path rather than a narrow
review-loop continuation slice. The workstream is active, uses local Wave 1 task
specs, and has no GitHub issues yet.

Initial execution shape:

- `sdk-capability-parity-research` is the first ready node.
- `managed-worker-runtime-contract` consumes the capability report.
- `foundation-contract-gate` blocks implementation until the builder accepts the
  managed-worker runtime contract.
- Later implementation nodes cover managed execution substrate, builder-facing
  runtime UI, one-way terminal takeover, cleanup-after-merge, dogfooding, and the
  export gate for Automated PAW Review Loop.

Important formation decisions:

- SDK-managed execution is a node-level launch option, not an immediate global
  replacement for terminal-first launch.
- First-cut terminal takeover is one-way: SDK-managed session to Copilot CLI, not
  round-trip back to SDK.
- Cleanup after merge is in scope because autonomous SDK runs should not require
  opening a terminal only to clean up linked worktrees/local branches.
- Automated PAW Review Loop should wait for this workstream's managed-worker
  runtime contract rather than inventing a separate continuation substrate.

Retain this promoted candidate note as the historical seed and pointer to the
formed workstream until Streamliner has a first-class candidate archive or
lifecycle migration.
