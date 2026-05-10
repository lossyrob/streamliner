# Managed Session Console Plan

## Problem and approach

Issue #85 needs SDK-managed Streamliner work to become observable in the browser through a read-only, terminal-looking console. The existing Wave 2 substrate already stores sanitized managed runtime progress, exposes runtime actions, and streams PAW launch-preparation progress; this implementation will factor a shared console presentation over those safe projections and wire it into the launch dialog, node inspector, and My Sessions detail surfaces.

The implementation will avoid raw terminal mirroring, prompt/reasoning/tool-argument/tool-result display, and interactive input. Where the current projection is too thin, it will add narrowly scoped sanitized fields for typed waiting reasons and PR-ready trust context rather than exposing raw event bodies.

## Work items

1. Extend the managed-runtime projection contract so UI code can render typed waiting reasons, suggested builder actions, PR-ready links, branch/base/worktree trust markers, cleanup blockers, and replay/truncation context from sanitized metadata and evidence. This explicitly includes cleanup blockers, cancellation timeouts, SDK process loss, permission failures, and manual takeover requirements, plus PR URL, branch name, base branch, branch-to-base diff link, worktree cleanliness, and deterministic PR/head-state checks.
2. Add reusable managed-session console presentation primitives that can consume both PAW launch progress events and managed runtime projections, render terminal-like transcript rows, show current lifecycle/status emphasis, handle empty/replay/truncated states, and remain explicitly read-only.
3. Wire the shared console vocabulary into PAW launch preparation, node inspector runtime details, and My Sessions detail so builders can monitor launch, reopen background-session progress, see lifecycle/interrupt/takeover/cleanup/failure/completion states, and trigger existing managed runtime actions without mixing actions into the transcript as input.
4. Add focused unit/UI coverage for projection sanitization, console rendering, launch progress replacement, managed-session replay, typed waiting reasons, missing optional projection fields, and PR-ready trust markers including deterministic PR/head-state checks.
5. Capture representative Streamliner dashboard screenshots with the managed-session console visible using the iterative-ui workflow, then keep screenshot artifacts out of the feature branch.

## Key considerations

- The console must be a projection over already sanitized Streamliner events; it must not add raw SDK/terminal event persistence.
- Reopened-session replay should come from the existing bounded sanitized managed runtime progress/evidence projection in the session registry. Any additional persisted projection fields must remain bounded, optional, sanitized, and additive.
- PAW launch preparation should reuse the existing launch-preparation SSE progress event shape; managed background monitoring should reuse managed runtime progress/evidence projections.
- Suggested builder actions should render adjacent to the transcript as safe action affordances or guidance, not as terminal input inside the console.
- Optional projection fields must degrade gracefully for existing managed sessions that predate this work.
- Terminal-like styling must not depend on color alone; transcript rows should keep accessible text labels and live-region semantics where practical.
- Existing managed actions and launch-claim behavior stay authoritative; this node should not broaden into startup reconciliation, cleanup semantics, or automated graph promotion.
- The PAW Lite workflow requires planning-docs review before implementation and multi-model final review before final PR.

## Success criteria

- Launch preparation progress uses the shared terminal-like console instead of the plain status list, with tests covering launch progress rows and a screenshot of the dialog.
- Managed background sessions render a reopenable replay from bounded sanitized registry progress/evidence, with tests covering empty, replayed, and missing-optional-field states.
- The console is visibly read-only and never renders raw prompts, reasoning, tool arguments/results, terminal stdout/stderr, hook payloads, secrets, tokens, or provider telemetry.
- Waiting, failure, interrupt, takeover, cleanup, PR-ready, and completion states share one vocabulary across launch dialog, node inspector, and My Sessions detail.
- Typed waiting reasons and suggested builder actions distinguish cleanup blockers, cancellation timeouts, SDK process loss, permission failures, and manual takeover requirements.
- PR-ready transcript/trust context shows the PR URL and available branch/base/diff/worktree/PR-head check fields without raw tool output.
