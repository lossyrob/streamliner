# SDK capability parity research

## Node

- Workstream: `sdk-managed-worker-runtime`
- Node ID: `sdk-capability-parity-research`
- Type: research
- Status: completed

## Outcome

Streamliner has evidence-backed confidence about whether a managed Copilot SDK
worker can act as a practical replacement for the current Copilot CLI worker path
for graph-node work. The output should identify which CLI-worker capabilities
are available through SDK execution, which require additional Streamliner
plumbing, which are unknown or blocked, and what constraints the runtime contract
node must inherit.

## Design References

- `INDEX.md` - top-level navigation for project docs
- `WORKSTREAM-DESIGN.md` - workstream and node-boundary philosophy for this
  workstream
- `.streamliner/shaping/candidates/sdk-managed-worker-runtime.md` - shaped
  candidate and original dependency framing
- `.streamliner/workstreams/sdk-managed-worker-runtime/brief.md` - current
  workstream intent and boundaries
- `.streamliner/workstreams/session-launching-and-tracking/brief.md` - upstream
  launch/session substrate this workstream imports
- `.streamliner/workstreams/session-launching-and-tracking/graph.json` -
  upstream node/checkpoint state and remaining exports
- `docs/design/session-system.md` - current launch, registry, lifecycle, and
  runtime overlay design
- `docs/design/decisions/001-observation-based-session-tracking.md` - current
  Copilot CLI observation model
- `docs/design/decisions/002-file-based-context-delivery.md` - current context
  delivery rationale
- `docs/design/decisions/008-paw-artifacts-for-workflow-status.md` - current PAW
  workflow-status source

## Inputs

- Existing Copilot SDK usage in Streamliner's PAW launch initialization path.
- Current Copilot CLI worker launch behavior from Session Launching and Tracking.
- Current Streamliner Copilot plugin and hook behavior.
- Any builder-provided reference codebase or prior SDK-worker implementation, if
  supplied before this node runs.

## Exports

- A durable capability report at
  `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md`
  unless the findings are promoted directly into the project design layer.
- A recommended go/no-go or constrained-go decision for SDK-managed graph-node
  execution.
- A list of constraints and unknowns that `managed-worker-runtime-contract` must
  inherit.

## Completion

Completed by PR #63, which closed GitHub issue #60. The accepted result is
constrained-go for a first SDK-managed graph-node worker runtime, backed by a
workstream-local capability report and reusable spike harness.

## Boundaries

### In scope

- Verify whether SDK-managed workers can access the same practical capability set
  expected from Copilot CLI worker sessions: repository context, shell/file/Git
  tools, GitHub operations, skills, configured MCP/plugin context, Copilot
  instructions, and PAW workflow execution.
- Investigate whether hooks and plugin behavior are available or need a
  Streamliner-specific substitute when the worker is SDK-managed.
- Investigate SDK session-state persistence and what is required for first-cut
  one-way Copilot CLI terminal takeover.
- Verify whether the SDK path can surface a useful progress stream without
  exposing raw prompts, secrets, sensitive tool arguments, or model reasoning.
- Identify any constraints on cancellation/interruption semantics relative to
  pressing cancel in an interactive Copilot CLI session.
- Identify whether cleanup-after-merge can be driven as a managed SDK lifecycle
  action or should be modeled as a PAW-specific prompt/action.

### Out of scope

- Implementing production SDK-managed node execution.
- Implementing the launch UI, progress panel, registry schema, graph overlay, or
  cleanup action.
- Designing the full Automated PAW Review Loop.
- Replacing or removing the terminal-first launch path.
- Solving SDK -> CLI -> SDK round-tripping after terminal takeover.

## Inherited decisions

- This workstream is foundational runtime work, not a narrow review-loop
  continuation slice.
- The target is practical near-parity with Copilot CLI worker sessions. Partial
  parity is only acceptable if the gaps are explicit and the runtime contract
  designs around them.
- First-cut terminal takeover is one-way: once the builder opens the managed
  session in Copilot CLI, ownership transfers to the terminal path.
- Runtime selection is a builder choice at node launch time.

## Design-impact expectation

No project design update is required unless the research changes current
assumptions about launch, session state, context delivery, hooks, or PAW status.
If it does, report the design impact clearly for
`managed-worker-runtime-contract` rather than silently changing implementation
scope.

## Success criteria

- The report covers tools, skills, plugin behavior, hooks, instructions, MCP or
  configured context, auth/GitHub behavior, session persistence, and PAW
  execution.
- The report states whether a managed SDK worker can plausibly produce a PR for a
  graph node with the same authority and context as a Copilot CLI worker.
- The report states what is known about Copilot CLI takeover from SDK-managed
  session state and what must be prototyped or constrained later.
- The report identifies progress-stream events that appear safe and useful for a
  browser-facing terminal-like display.
- The report identifies lifecycle semantics that are blocked, risky, or
  different from terminal-first execution.
- The downstream contract node can proceed without rediscovering SDK capability
  basics.

## Engagement

The builder should review the capability findings before
`managed-worker-runtime-contract` finalizes the runtime contract. If the research
finds a fundamental parity or takeover blocker, pause and ask whether to narrow
the workstream or redesign the runtime goal.
