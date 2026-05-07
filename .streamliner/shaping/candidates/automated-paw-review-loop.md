# Automated PAW Review Loop

## Stage

Shaping; next-up after Session Launching and Tracking.

## Seed Idea

Automate the review/address/re-review loop that currently happens manually after an implementation session produces a PR.

Current manual pattern:

1. Builder launches or asks for a PAW Review session against a PR with a specific text/configuration profile.
2. PAW Review posts review comments or drafts comments for builder review.
3. Builder asks the implementing session, or a follow-on worker, to address the comments.
4. Builder returns to the review session and asks it to verify the comments were addressed, check for new bugs, and decide whether more comments are needed.
5. The loop repeats until the reviewer says the PR is acceptable.

The desired product behavior is a configurable automated loop: when a node implementation produces a PR, Streamliner can launch the configured PAW Review session, post or stage review feedback, launch/route address-review work, re-run review, and stop safely when the review reaches approval or needs builder judgment.

## Why It Matters

PAW Review is already part of the builder's quality workflow, but running it manually creates orchestration overhead. The builder has to launch the review session, remember the configuration, inspect/post comments, return to the implementation session, then bounce between sessions until the review converges.

This is valuable enough to automate, but risky enough that it should not be a thin add-on. Automated review loops can create noisy comments, uncontrolled session chains, repeated churn, branch conflicts, or false confidence if the reviewer and implementer loop without clear termination criteria.

This was initially bolted onto Wave 5 of the Session Launching and Tracking workstream, but it likely deserves its own workstream because it is a review orchestration product, not just launch plumbing.

## Relationship to Session Launching and Tracking

The current Session Launching and Tracking workstream already includes Wave 5 nodes:

- `follow-on-review-policy` — Follow-on PAW Review automation policy.
- `pr-review-trigger-detection` — PR review trigger detection.
- `auto-paw-review-launch` — Automatic PAW Review session launch.
- `review-comment-addressing-launch` — Review comment addressing session launch.
- `review-session-chain-overlay` — Review session chain overlay.

It also includes the checkpoint `follow-on-review-automation`. These node and
checkpoint concepts are absorbed into this candidate and can be removed from the
Session Launching and Tracking workstream once that orchestrator agrees to move
Wave 5 out.

Those are useful seeds, but the boundary should shift:

- **Session Launching and Tracking owns the launch substrate:** launch claims, session registry rows, graph/node binding, PR detection seams, session role metadata, and UI overlay primitives.
- **Automated PAW Review Loop owns review orchestration:** review configuration, comment policy, implementation-session continuation, optional address-review routing, re-review rules, loop termination, safety gates, and builder control.

This candidate should import launch/session primitives from Session Launching and Tracking rather than remaining a final wave inside that workstream.

## Sequencing Decision

This workstream should be queued immediately after Session Launching and Tracking
concludes, assuming Wave 5 follow-on PAW Review automation is moved out of that
workstream. The near-term builder pain is active: implementation node sessions
can sit blocked while the builder manually launches PAW Review, routes comments
back to implementation work, and reruns review cycles. Automating that loop is a
direct development-speed improvement, not just a future polish feature.

Session Launching and Tracking should finish the substrate: launch claims,
session registry linkage, graph/node binding, PR detection seams, role metadata,
and any session-chain overlay primitives. Automated PAW Review Loop should then
take over the former Wave 5 concerns as a dedicated review-orchestration
workstream.

This can proceed before issue-native loose-work support. The first target remains
workstream-node PRs.

## Candidate Scope

### In Scope

- Define configuration for automated PAW Review loops, similar in spirit to `paw-init`/launch text configuration.
- Define when a loop starts for the first version: PR created/updated for a workstream graph node with a GitHub tracker.
- Launch a dedicated PAW Review session with PR identity, relevant context, configured review options, and session role metadata.
- Decide whether comments are posted automatically, staged for builder review, or only summarized.
- Route actionable review comments to an implementation/address-review session.
- Re-run reviewer verification after changes land.
- Detect whether comments were addressed and whether new issues were introduced.
- Stop the loop when the reviewer reaches approval, the iteration limit is reached, a safety condition fires, or builder input is required.
- Show the review/address/re-review chain in Streamliner so the builder understands current state.

### Out of Scope

- Replacing PAW Review itself.
- Building a general CI system.
- Assuming every PR must use automatic review.
- Letting review/address loops run without bounded policy.
- Injecting hidden prompts into an interactive terminal without explicit design.

### Deferred

- Multi-model review orchestration beyond the configured PAW Review modes.
- Organization-wide policy enforcement.
- Automatic merge after review approval.
- Full issue-native loose-work integration, unless needed as a launch target.

## Shaping Decisions

- First version targets **workstream-node PRs**. A node with a GitHub tracker produces or links a PR, and that PR becomes the review-loop target.
- The core model should not preclude issue-native loose-work PRs, but loose-work support is deferred so this workstream can build on existing launch/session primitives.
- Prefer matching the builder's current workflow: route review comments back to the **original implementation session** when that session is still resumable/controllable and has useful context. A separate address-review worker is a fallback or policy option, not necessarily the default.
- Consider **SDK-managed implementation sessions** as the path that makes original-session continuation reliable. If implementation work runs under Copilot SDK by default, Streamliner can coordinate reviewer and implementer turns directly, then open/resume the session in a terminal only when the builder wants interactive takeover.

## Core Product Questions

### Who addresses comments?

Possible models:

1. **Original implementation session**: send the comments back to the existing worker session if it is still available and appropriate.
2. **Separate address-review worker**: launch a new session on the same PR/branch/worktree context to address comments.
3. **Builder-mediated**: review is automated, but addressing only happens when the builder explicitly chooses a session.

Current launch/tracking notes lean toward model 2 to avoid remotely driving existing interactive terminals. The builder's current process leans toward model 1 because the original implementation session has useful local reasoning, branch context, and recent problem context. This workstream should treat that as the desired workflow if Streamliner can make it reliable.

The key problem becomes **managed continuation**:

- Detect when the implementation session has reached "PR ready for review".
- Keep or mark the session as available for follow-up rather than treating the PR as the end of the useful session.
- Route review comments back into that original session when possible.
- Re-observe the PR after the implementation session addresses comments.
- Fall back to a separate address-review worker when the original session is ended, stale, unavailable, unsafe to resume, or explicitly disabled by policy.

This may require better session tracking than simply `idle` versus `ended`. Copilot session liveness answers whether the session is active/idle/ended; PAW artifacts answer coarse workflow progress. The review loop needs a derived state such as `implementation-pr-ready`, `awaiting-review`, `review-comments-posted`, `addressing-review`, and `ready-for-rereview`.

There are two possible runtime foundations:

| Runtime foundation | Review-loop implication |
|---|---|
| Terminal-first implementation session | Streamliner can observe the original session but cannot easily drive follow-up review-addressing work without terminal-control semantics. Fallback address-review sessions are simpler. |
| SDK-managed implementation session | Streamliner can manage turns directly, route review comments back to the original implementation actor, coordinate reviewer/implementer loops, and offer terminal takeover only when the builder wants to inspect or intervene. |

This suggests Automated PAW Review Loop may depend on, or at least strongly benefit from, a separate SDK-Managed Worker Runtime workstream.

### When are comments posted?

Possible modes:

- **Draft only**: PAW Review produces comments for builder approval.
- **Auto-post review comments**: PAW Review posts a pending GitHub review automatically.
- **Auto-post only high-confidence comments**: configured severity/confidence threshold.
- **Summarize only**: no inline comments; produces a review summary artifact.

The builder wants automation, but comment-posting policy needs explicit configuration to avoid noisy or low-value GitHub reviews.

### What ends the loop?

Potential termination conditions:

- reviewer returns approval / `+1`;
- no open review comments remain;
- all previous comments are addressed and no new blocking issues are found;
- maximum iteration count reached;
- review session finds ambiguous product/design decision;
- address-review worker makes unexpectedly broad changes;
- tests/build fail or PR branch diverges;
- builder intervention requested.

### What is the source of truth?

Likely sources:

- GitHub PR comments/review threads for posted review state.
- PAW Review artifacts for review context and derived verdicts.
- Session registry metadata for implementation/review/address-review session chain.
- Workstream graph node binding or issue-native target for launch context.
- Runtime overlay for fast-changing state.

Committed workstream artifacts should not be rewritten for every review pulse.

## Dependencies

### Depends On

- Session Launching and Tracking workstream, especially launch claims, session registry linkage, graph/node binding, PR detection seams, and role/session-chain UI.
- PAW Review custom agent/skill behavior and its configurable review modes.
- GitHub tracker/PR integration for detecting PRs, reading review comments, and posting pending reviews.

### Enables

- Higher-confidence autonomous node execution.
- Workstream closure review, because final workstream PRs can have repeatable review-loop evidence.
- Issue-native loose-work launching, if review loops should apply to non-workstream PRs as well.

### Related Candidates

- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because review and address-review roles need consistent guidance.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md), because address-review work may change scope and should report reconciliation impacts.
- [External Dependency Tracking](external-dependency-tracking.md), because review loops can block on external decisions or approvals.
- [SDK-Managed Worker Runtime](sdk-managed-worker-runtime.md), now promoted as `.streamliner/workstreams/sdk-managed-worker-runtime/`, because SDK-managed execution may be the cleanest way to route review comments back to the original implementation session.

## Workstream Shape

This should be a dedicated workstream if the goal is automated closed-loop review rather than one-shot reviewer launch.

Likely work areas:

- Extract/refine the Wave 5 assumptions from Session Launching and Tracking into a new workstream.
- Define review-loop configuration schema and UI.
- Define review trigger detection: workstream node PR, issue-native PR, or manually selected PR.
- Define PAW Review launch context package and role metadata.
- Define comment posting policy and builder control modes.
- Define address-review session launch context and branch/worktree handling.
- Define original implementation-session continuation: how to detect PR-ready state, keep/resume the session, send review context, and decide when fallback is required.
- Evaluate whether original-session continuation should be implemented against the current terminal-first launch path or deferred until SDK-managed workers exist.
- Define re-review trigger after address-review changes.
- Define loop state machine and termination conditions.
- Define session-chain overlay across implementation, reviewer, address-review, and re-review sessions.
- Define safety gates: max iterations, confidence thresholds, broad-change detection, test failures, branch conflicts, unresolved product/design questions.

## Exported Interfaces and Dependencies

Potential exports:

- Review-loop policy/config model.
- Review-loop state machine.
- Session role taxonomy: implementation, reviewer, address-review, re-review.
- GitHub PR review posting/verification behavior.
- UI representation for review session chains.

Potential imports:

- Launch/session binding primitives from Session Launching and Tracking.
- Managed-worker runtime contract exported by `.streamliner/workstreams/sdk-managed-worker-runtime/` when the review loop needs controllable implementation/reviewer actors.
- PAW Review configuration and artifact conventions.
- Workstream/node context package behavior.
- GitHub issue/PR linking.

## Open Questions

- Should the loop target only workstream-node PRs first, or also issue-native loose-work PRs?
- Should address-review work reuse the original implementation session or always launch a new session by default?
- Should review comments be auto-posted, draft-only, or configurable by severity/confidence?
- How should the system detect that comments were addressed?
- What artifact or state records reviewer approval and final loop completion?
- What is the safest maximum iteration default?
- Should the builder approve the first automated run per workstream/project before future runs can happen unattended?

## Handoff Brief

Create an Automated PAW Review Loop workstream after Session Launching and
Tracking concludes. Treat the former Session Launching Wave 5 tasks as seeds, but
shape the workstream around review orchestration rather than launch plumbing.

The first version should target workstream-node PRs. It should import launch
claims, session registry linkage, graph/node binding, PR detection seams, role
metadata, and session-chain UI primitives from Session Launching and Tracking.
It should define configurable PAW Review launch, comment posting/staging policy,
addressing route, re-review behavior, loop state, termination criteria, safety
gates, and builder controls.

The workstream should explicitly decide how much original implementation-session
continuation is possible with the terminal-first substrate and what should wait
for the managed-worker runtime contract exported by
`.streamliner/workstreams/sdk-managed-worker-runtime/`. If original-session
continuation is required for the first useful slice, coordinate sequencing with
that workstream's foundation contract and export gate.
