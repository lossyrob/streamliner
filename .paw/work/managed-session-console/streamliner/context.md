# Launch Context - Managed session console

## Layer 0 - Design Context Hints

Start with `docs/design/index.md` if design orientation is needed, then follow the session/runtime-specific references below. Treat these documents as navigational authority and read the relevant sections before changing session lifecycle, registry projection, launch dialog, or managed-runtime UI code.

- `docs/design/session-system.md` - authoritative for session launching, registry identity, runtime overlay, launch preparation progress, managed SDK runtime state, and graph/session projections.
- `docs/design/decisions/009-sdk-managed-worker-runtime.md` - accepted SDK-managed graph-node worker runtime contract: builder-selected `managed-sdk`, canonical registry rows, redacted bounded progress, explicit managed-autonomous posture, one-way terminal takeover, and deterministic cleanup.
- `docs/design/decisions/010-terminal-takeover-and-cleanup.md` - terminal takeover and cleanup action semantics, including trusted hook evidence, lifecycle patch assertions, cleanup guardrails, and typed blockers.
- `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md` - implementation-facing contract summary for this workstream, including the progress projection and console expectations.
- `.streamliner/workstreams/sdk-managed-worker-runtime/tasks/managed-session-console.md` - selected-node task brief and success criteria.
- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` and `.streamliner/workstreams/sdk-managed-worker-runtime/graph.json` - workstream-level context and sibling-node coordination only.

## Layer 1 - Worker Mission

Implement node `managed-session-console` for workstream `sdk-managed-worker-runtime`, tracked by GitHub issue https://github.com/lossyrob/streamliner/issues/85.

The node's responsibility is to add the missing read-only, terminal-looking browser console for Streamliner-managed work. Builders should be able to watch live or replayed sanitized activity for both PAW launch preparation and SDK-managed background sessions in a familiar Copilot-CLI-like presentation, without the console becoming an interactive terminal or exposing raw SDK/terminal content.

Primary outcomes:

- Provide reusable terminal-like transcript/presentation primitives for sanitized Streamliner activity events.
- Use a shared console vocabulary across launch preparation and managed background-session monitoring where practical.
- Make background sessions reopenable from relevant Streamliner surfaces such as launch aftermath, graph/node inspector, and My Sessions/detail surfaces.
- Support live updates while connected and replay of the bounded recent event buffer after reopening.
- Render lifecycle transitions, status summaries, tool start/finish metadata, permission decisions, MCP/skill status, blockers, failures, interrupts, takeover markers, PR/completion/cleanup evidence, and closeout states without surfacing raw excluded data.
- Render typed `waiting_for_builder` reasons and suggested builder actions so cleanup blockers, cancellation timeouts, SDK process loss, permission failures, and manual takeover requirements remain visibly distinct.
- When a managed session reaches `pr_ready`, show the PR URL plus available trust context such as branch, base branch, branch-to-base diff link, worktree cleanliness, and deterministic PR/head-state checks. If existing projections are too thin, add small sanitized projection fields rather than raw tool output.

Explicit boundaries:

- Do not implement raw Copilot CLI terminal mirroring, raw stdout/stderr display, prompt/reasoning/tool-argument/tool-result exposure, hook payload display, secrets, tokens, provider telemetry, or any interactive browser terminal input.
- Do not create new worker orchestration semantics beyond projection/replay fields needed for this console.
- Terminal takeover remains the path to a real interactive terminal. The console should make that boundary clear and close/mark streaming appropriately after takeover.

## Layer 2 - Relevant State

Workstream state:

- Parent workstream: `sdk-managed-worker-runtime` (#59), Wave 2 / `managed-runtime-usable`.
- This selected node is `ready` and depends on `terminal-takeover-cleanup-actions`, which is completed via PR #86.
- Completed upstream nodes include managed execution substrate (#73 / PR #79), builder-facing managed runtime UI (#74 / PR #78), and terminal takeover/cleanup actions (#75 / PR #86).
- `managed-runtime-startup-reconciliation` (#89) is also ready and adjacent safety work. Treat it as coordination background only; this worker owns the console node, not startup reconciliation.
- Downstream `managed-runtime-wave-2-punch-list` (#87) and `managed-runtime-usability-gate` (#76) depend on this console experience being usable enough for real managed-node validation.

Current accepted runtime contract:

- The session registry row is canonical for managed workers. SDK ids, Copilot ids, workspace paths, and state roots are metadata rather than primary keys.
- Managed lifecycle/progress state is separate from PAW artifact-derived workflow status and must not be written into committed `graph.json`.
- Browser progress is terminal-like, read-only, allowlisted, redacted, bounded by count/byte retention, and replayable on reconnect or reopen.
- Allowed progress classes include lifecycle changes, short redacted assistant status messages, tool start/finish metadata, permission decisions, MCP/skill status, PR/review/cleanup events, and optional usage counters.
- Always exclude raw prompts, assistant reasoning, tool arguments/results, terminal stdout/stderr, hook payload bodies, secrets, tokens, credential data, and provider telemetry beyond node-safe context.
- Managed lifecycle states include `preparing`, `starting`, `running`, `idle`, `waiting_for_builder`, `interrupt_requested`, `interrupted`, `canceled`, `failed`, `pr_ready`, `review_ready`, `completed`, `cleanup_ready`, `cleaning_up`, `cleaned_up`, and `terminal_takeover`.
- Terminal takeover is one way: after visible `copilot --resume <sdkSessionId>` launches and ownership transfers, SDK control does not resume for that registry row.
- Cleanup is a deterministic backend action with typed blockers and guardrails. The console should report cleanup progress/outcomes, not delegate cleanup to a prompt.

Issue #85 success criteria:

- PAW launch preparation shows terminal-like progress instead of only a plain status list.
- A builder can reopen a Streamliner surface during a background session and see a live/replayed console-like transcript of sanitized work.
- The console makes managed work observable without becoming interactive or exposing excluded raw content.
- Takeover, interrupt, cleanup, failure, typed waiting reasons, PR-ready trust markers, and completion states are visible in one console vocabulary.
- The managed runtime usability gate can validate monitoring by watching a real managed node progress through launch, background execution, and either completion or takeover/cleanup.

## Layer 3 - Coordination Context

Selected repository: `lossyrob/streamliner` from the launch checkout at `C:\Users\robemanuele\proj\streamliner\streamliner` on initial branch `main`.

Use the Streamliner worktree policy for execution: keep the launch checkout as the base/coordination checkout, do not check out the target branch there, and run implementation in a sibling worktree for the node branch. Place PAW artifacts under the execution checkout's `.paw/work/<workId>` directory.

Expected PAW launch posture:

- PAW Lite process with final-PR-only review policy.
- Planning docs review and final agent review should be non-interactive multi-model review with pre/post mortem perspectives, using Opus 4.7 where model selection is required.
- Commit-and-clean PAW artifacts.
- The builder expects to review only the final PR. Continue autonomously unless a serious blocker appears.
- If issue amendments appear necessary, pause and propose the amendments rather than editing issue scope silently.
- Final PR title should include issue number `#85` and workstream id `sdk-managed-worker-runtime`.
- Final PR description should include a collapsible `<details>` section with `<summary>Docs.md</summary>` containing the completed Docs.md for the implementation, following the `paw-docs-guidance` template.
- Include UI screenshots in the PR where appropriate, using the repo's screenshot workflow and keeping screenshot artifacts out of the feature PR diff.

Coordination notes:

- Sibling/upstream nodes are context, not assigned work. Do not broaden this node into startup reconciliation (#89), Wave 2 punch-list cleanup (#87), or the usability gate (#76) unless direct integration points require small compatibility adjustments.
- If the existing backend projection lacks data required for PR-ready trust markers or typed waiting reasons, prefer narrowly scoped sanitized projection additions over exposing raw runtime event bodies.
- Preserve terminal-first launch support and existing managed runtime actions while adding the console experience.
