# Managed Worker Runtime Contract

This is the implementation-facing contract summary for the
`sdk-managed-worker-runtime` workstream. The authoritative project design lives
in `docs/design/session-system.md`, and the durable rationale is Decision 009:
`docs/design/decisions/009-sdk-managed-worker-runtime.md`.

## Accepted direction

Streamliner accepts SDK-managed graph-node workers as a first-class local runtime
option, constrained by the upstream capability findings from issue #60 / PR #63.
Terminal-first Copilot CLI launch remains supported and is not replaced.

The first cut is **builder-selected**. Streamliner exposes `managed-sdk` as a
node launch runtime option, but it does not automatically classify nodes as safe
or unsafe for managed execution.

## Runtime selection

| Runtime | Contract |
|---------|----------|
| `terminal-cli` | Current visible Copilot CLI worker path after PAW launch preparation. Builder can watch and type in the terminal. |
| `managed-sdk` | Streamliner starts and owns a headless Copilot SDK worker for the node. Builder monitors a sanitized browser progress projection and can interrupt, take over, or clean up through managed actions. |

Runtime selection and permission profile are separate, but the first managed PAW
worker uses autonomous execution. Builder selection of `managed-sdk` at node
launch is the consent boundary; the launch records a `managed-autonomous`
profile and runs the SDK worker with a Copilot CLI YOLO/allow-all-equivalent
posture. Model-requested tool calls do not introduce per-tool approval prompts
while Streamliner owns the SDK session.

## Registry and runtime state

- The session registry row is canonical for managed workers.
- The registry row id remains Streamliner-owned and stable.
- `sdkSessionId`, `sdkWorkspacePath`, and `sdkStateRoot` are managed-runtime
  identity facts, not primary keys.
- `copilotSessionId` remains nullable and is populated by trusted terminal
  observation after visible CLI takeover.
- Managed lifecycle/progress details live in local runtime state and are exposed
  through registry/API projections.
- Runtime telemetry must not be written to committed `graph.json`.
- Active managed SDK rows must be reconciled on API startup. A row left in an
  active state by a prior API process must not continue to look live unless the
  SDK owner/session is verifiably still attached; otherwise Streamliner records a
  typed diagnostic reason and moves the row to a safe non-running or
  builder-action state.

SDK helper sessions used only for launch preparation remain hidden. SDK-managed
workers are user-visible node sessions with `graphBinding`, `pawLaunch`, runtime
metadata, and My Sessions/graph overlay projection.

## Managed lifecycle

Managed lifecycle state is separate from PAW artifact-derived workflow status.
PAW status remains `pawWorkflow` evidence from explicit PAW work directories.

Required managed states:

| State | Meaning |
|-------|---------|
| `preparing` | Node/worktree/context/permission inputs are being validated. |
| `starting` | SDK client/session creation and initial worker prompt are in progress. |
| `running` | SDK worker is processing a turn or tool call. |
| `idle` | SDK turn ended and the session can continue. |
| `waiting_for_builder` | Permission, input, cancellation, takeover, cleanup, or blocker needs human action. |
| `interrupt_requested` | Runtime asked SDK to stop the current turn. |
| `interrupted` | Abort/idle/process evidence says the turn stopped. |
| `canceled` | Builder intentionally stopped the managed run. |
| `failed` | Runtime, SDK, tool, trust, launch, or binding failure prevents safe continuation. |
| `pr_ready` | PR URL/number or equivalent branch PR evidence is linked to the node. |
| `review_ready` | Managed reviewer output is ready, when the actor is a reviewer. |
| `completed` | Worker completed its node contract; graph promotion is still separate. |
| `cleanup_ready` | Linked PR is merged/accepted and cleanup checks can run. |
| `cleaning_up` | Backend cleanup action is running. |
| `cleaned_up` | Deterministic cleanup completed. |
| `terminal_takeover` | Ownership transferred one way to visible Copilot CLI. |

## Trust and binding

Managed workers use explicit Streamliner runtime writes as their admission and
lifecycle source. Existing Copilot CLI plugin signals may corroborate SDK runs
when they appear, but they are not the only trust path while Streamliner owns the
SDK session.

Managed launch should:

1. Create or reserve the registry row before starting worker execution.
2. Record `runtimeKind: managed-sdk`, `runtimeOwner: streamliner-sdk`, graph
   binding, PAW launch metadata, worktree, branch, and launch nonce.
3. Start an SDK session in a state root compatible with later
   `copilot --resume <sdkSessionId>`.
4. Write lifecycle/progress records through the local API/runtime writer.
5. Fuse or hide any filesystem-only observation of the SDK session behind the
   managed row, rather than creating a duplicate visible observed row.

## Progress projection and console

Browser progress is terminal-like, read-only, allowlisted, and bounded.

Allowed classes include lifecycle changes, short redacted assistant status
messages, tool start/finish metadata, permission decisions, MCP/skill status,
PR/review/cleanup events, and optional usage counters.

Always exclude raw prompts, assistant reasoning, tool arguments/results,
terminal stdout/stderr, hook payload bodies, secrets, tokens, credential data,
and provider telemetry beyond the node context.

Retention must be bounded by count and byte size, support a replay window on
reconnect, preserve a latest summary for list/detail views, and allow normal
runtime-state pruning after terminal outcomes.

The builder-facing monitoring surface should include a read-only managed session
console. This is a browser transcript of sanitized Streamliner activity, not raw
Copilot CLI mirroring and not an interactive terminal. It should look familiar
to Copilot CLI users: chronological rows, current activity emphasis, phase/status
labels, timing, and explicit lifecycle markers. It should be reusable for PAW
launch preparation and SDK-managed background-session progress so the builder can
open a Streamliner dialog/surface and understand the work without taking over.

Terminal takeover remains the interactive boundary. Once takeover occurs, managed
console streaming should close with a takeover marker and point at the
terminal-owned session instead of accepting input in the browser.

The console must render typed `waiting_for_builder` reasons and suggested
builder actions. Cleanup blockers, cancellation timeouts, SDK process loss,
permission failures, and manual takeover requirements must not collapse into a
generic waiting label.

When a managed session reaches `pr_ready`, the console should show the PR URL and
available trust context such as branch name, base branch, branch-to-base diff
link, worktree cleanliness, and deterministic PR/head-state checks. If existing
backend projections are too thin, the console node may add small sanitized
projection fields rather than exposing raw tool output.

## Interruption and takeover

Cancellation is evidence-based:

1. Move to `interrupt_requested`.
2. Call SDK abort.
3. Wait for bounded abort/idle/process evidence.
4. Move to `interrupted` when evidence is sufficient.
5. Move to `waiting_for_builder` on timeout or inconclusive evidence.
6. Move to `failed` only when runtime ownership cannot be safely preserved.

Terminal takeover is one way. Streamliner launches visible Copilot CLI with
`copilot --resume <sdkSessionId>`, binds trusted CLI evidence to the existing
registry row, changes `runtimeOwner` to `terminal`, closes managed progress with
a takeover event, and stops issuing SDK prompts. If terminal spawn/resume fails,
Streamliner preserves the managed row and records `waiting_for_builder` or
`failed`; it does not fork work into a new hidden session.

## PR, completion, and cleanup

`pr_ready`, `review_ready`, `completed`, `cleanup_ready`, and `cleaned_up` are
runtime signals with source evidence. They do not automatically promote the
committed graph node.

Cleanup-after-merge is a backend action. Before removing linked worktrees or
local branches, the backend must verify registry binding, graph binding, repo,
worktree, expected branch, PR/head/merge state, clean working tree, unpushed
commits, and whether another worktree/process still depends on the path or
branch. Guardrail failures move to `waiting_for_builder` with typed reasons.

Managed worktree cleanup should record and use a base commit/ref anchor where
practical. The exact field location can follow the implementation's launch or
registry metadata shape, but cleanup diagnostics should include the base commit
when cleanup is blocked or branch/merge state is ambiguous.

## Downstream worker responsibilities

### Managed execution substrate

Implement the SDK session owner, managed runtime state writer, registry metadata,
progress redaction/retention, `managed-autonomous` permission profile,
cancellation, PR/completion signals, and cleanup guardrails against the
authoritative design.

### Builder-managed runtime UI

Expose runtime selection, managed identity, sanitized progress, My Sessions
status, graph overlay projection, permission/blocker diagnostics, takeover, and
cleanup affordances without exposing raw SDK events.

### Terminal takeover and cleanup actions

Implement one-way resume into visible Copilot CLI, registry rebinding, SDK
teardown/closeout, takeover failure behavior, and deterministic
cleanup-after-merge. Capture base commit/ref context for managed worktrees where
practical and use it with branch, PR/head, clean-worktree, and unpushed-commit
checks before cleanup.

### Managed runtime startup reconciliation

Implement API-startup reconciliation for active SDK-managed runtime rows left by
a prior API process. Rows in active states such as `starting`, `running`, or
`interrupt_requested` must move to a safe diagnostic state unless the SDK
owner/session is verifiably live. My Sessions and graph overlays must not show
stale rows as actively running workers.

### Managed session console

Implement the missing read-only, terminal-looking browser console for PAW launch
preparation and SDK-managed background sessions. The console should live on top
of the sanitized progress projection, support replay of bounded recent events on
reopen, stream live updates while connected, and render failure, interruption,
takeover, PR/completion, cleanup, typed waiting reasons, PR-ready trust markers,
and stale/reconnect states in the same console vocabulary.

### Managed runtime dogfood and hardening

Dogfood hardening should verify `sdkSessionId` resumability after `pr_ready`,
exercise crash/restart reconciliation on a real active managed node, prototype
session-registry-level operational signals such as `managed_session_stalled` and
`sdk_row_orphaned_on_restart`, and evaluate whether Automated PAW Review Loop
needs a distinct `managed-review` permission profile.

### Foundation contract gate

The gate passes with constraints after the permission-posture amendment:
capability evidence and the accepted runtime contract support a constrained-go
path for SDK-managed workers, but Wave 2 must implement `managed-autonomous` as
an explicit node-launch profile with no per-tool approval flow during SDK-owned
execution. Downstream node boundaries remain aligned with the current graph:
managed execution substrate and builder-managed runtime UI can proceed first,
then terminal takeover/cleanup actions, followed by the usability gate.

### Automated PAW Review Loop

Consume managed workers through registry identity, lifecycle events, redacted
progress, PR/review-ready signals, the `managed-autonomous` permission profile,
takeover finality, and cleanup/completion signals. Do not infer live actor state
from PAW artifacts alone, do not expect per-tool approval prompts, and do not
create a separate worker identity/progress store.
