# SDK Capability Parity Research

## Executive Recommendation

**Recommendation: constrained-go for a first SDK-managed graph-node worker runtime.**

A managed Copilot SDK worker can plausibly run Streamliner's graph-node PAW work with near-CLI authority: the locked SDK package exposes Copilot CLI control over sessions, tools, permissions, config discovery, MCP servers, skills, custom agents, event streams, persistent session workspaces, resume APIs, and abort APIs. Streamliner already uses those capabilities for PAW launch initialization with repository, shell, GitHub, configured MCP, and skill access.

We assess that an SDK-managed worker can plausibly produce a PR for a graph node with near-CLI authority and context, contingent on a first dogfood PR before SDK-managed runtime is defaulted.

The constraints are material but tractable:

- The current Streamliner trusted session-binding path is Copilot CLI hook based and does not automatically carry over to SDK-managed sessions.
- Browser progress must be an allowlisted SDK event projection, not a raw event or terminal stream.
- Cancellation can be modeled with SDK abort/server stop APIs, but it is not yet proven equivalent to pressing cancel in interactive Copilot CLI.
- Visible terminal takeover from SDK-created session state is verified via `copilot --resume <sdk-session-id>`; the runtime contract still needs explicit ownership-transfer and registry-rebinding semantics.
- Cleanup-after-merge should be a deterministic managed lifecycle action, not a best-effort model prompt.

This is not a clean "go" because hook substitution, cancellation semantics, and SDK-to-terminal ownership transfer still need an explicit contract/prototype. It is not a no-go because the SDK already provides the core worker execution substrate and Streamliner is successfully using it for the riskiest launch-preparation step.

## Evidence Basis and Confidence

### Durable sources inspected

- Issue #60 and local task spec require coverage of tools, skills, plugin behavior, hooks, instructions, configured MCP context, auth/GitHub behavior, session persistence, PAW execution, progress, cancellation, takeover, and cleanup.
- The locked dependency is `@github/copilot-sdk` `0.3.0`, backed by `@github/copilot` `^1.0.36-0` in `package-lock.json` (`package-lock.json:1625-1633`).
- The installed SDK package identifies itself as a public-preview TypeScript SDK for programmatic control of GitHub Copilot CLI over JSON-RPC (`node_modules/@github/copilot-sdk/README.md:1-5`) and exposes `CopilotClient`, `CopilotSession`, tools, permissions, session events, and session filesystem types (`node_modules/@github/copilot-sdk/dist/index.d.ts:1-9`).
- Current Streamliner design intentionally uses SDK for PAW launch preparation but launches the actual worker as visible Copilot CLI (`docs/design/session-system.md:38-40`, `docs/design/session-system.md:66-82`).
- Current observation and graph overlay behavior is registry-first and file/hook-observation based (`docs/design/decisions/001-observation-based-session-tracking.md:21-34`, `docs/design/decisions/004-session-registry-primary-surface.md:24-32`).
- A related local PAL SDK implementation was inspected as a historical comparison. It uses older SDK versions (`@github/copilot-sdk` `0.2.0` in its production Donna package and `0.1.29` in its SDK POC), manually appends `AGENTS.md` to the session system message, and explicitly passes skill directories, MCP servers, custom tools, permission handlers, and user-input callbacks. Treat that as useful prior art for runtime design, not as proof that current SDK `0.3.0` still requires manual instruction loading.
- User-provided verification confirms that a visible Copilot CLI can take over an SDK-created session with `copilot --resume <sdk-session-id>`. This upgrades takeover from an SDK unknown to a contract-integration task.
- Follow-up spikes under `spikes/sdk-managed-worker-runtime/` created a reusable SDK harness and locally exercised context loading, progress events, cancellation, takeover metadata, plugin discovery, and disposable-repo PR production. Detailed findings are recorded in `spikes/sdk-managed-worker-runtime/FINDINGS.md`.
- All `node_modules/@github/copilot-sdk/**` line citations refer to `@github/copilot-sdk` `0.3.0`; re-verify them after any SDK upgrade.

### Lightweight local verification

After installing dependencies from the lockfile, a no-prompt SDK smoke probe:

- Started the SDK-managed Copilot CLI server.
- Reported Copilot server version `1.0.36` and protocol version `3`.
- Created a session without sending a model prompt.
- Returned a session id and default workspace path under `C:\Users\robemanuele\.copilot\session-state\<session-id>`.
- Reported UI elicitation capability as unavailable for that headless SDK session.

The probe used `CopilotClient.start()`, `client.getStatus()`, `client.getAuthStatus()`, `client.createSession({ model: "gpt-5.4-mini", onPermissionRequest: approveAll })`, and then inspected `session.sessionId`, `session.workspacePath`, and `session.capabilities` without sending a prompt. A reusable transcript and script are captured in `sdk-smoke-probe.md`.

This verified local SDK startup and session metadata only. It did **not** validate model/tool execution, plugin hook emission, cancellation of an active turn, or CLI takeover. The throwaway session directory was removed after the probe.

### Confidence levels

| Area | Confidence | Reason |
|---|---:|---|
| SDK can create/resume/control sessions | High | SDK README/types plus local no-prompt smoke probe. |
| SDK can expose tools, skills, MCP/config discovery, custom agents, and permissions | High | SDK types and existing Streamliner PAW launch use. |
| SDK can power PAW launch initialization | High | Existing production code path. |
| SDK can run full graph-node PAW implementation work | Medium-high | Local dogfood spike proved branch/commit/draft-PR production in a disposable repo; real Streamliner PAW PR dogfood remains. |
| Browser-safe progress projection is feasible | High | SDK event schema, existing Streamliner sanitized progress sink, and local progress spike. |
| Installed plugin/hook surfaces can load in SDK sessions | Medium | Local plugin-discovery spike observed plugin MCP servers, Donna/WorkIQ tools, skills, and hook events; Streamliner claim-binding semantics still need plugin-specific verification. |
| One-way terminal takeover from SDK session state | High | User-provided verification confirms `copilot --resume <sdk-session-id>` can take over an SDK-created session; registry/ownership handoff remains design work. |
| Cancellation equivalence with interactive CLI cancel | Medium | Local cancellation spike observed `abort`, idle-with-aborted, and successful follow-up after an in-flight PowerShell tool start; OS-level child process termination still needs process-level verification. |

## Capability Matrix

| Capability expected from CLI worker | SDK-managed evidence | Parity verdict | Contract implication |
|---|---|---|---|
| Repository context and working directory | SDK `SessionConfig` supports `workingDirectory`; custom instruction files are loaded from the working directory even when config discovery is off (`node_modules/@github/copilot-sdk/dist/types.d.ts:958-968`, `node_modules/@github/copilot-sdk/dist/types.d.ts:1021-1024`). Streamliner sets the SDK session cwd for launch context and PAW init (`src/server/launch-context.ts:630-648`, `src/server/launch-preparation.ts:1366-1392`). | Near parity | Runtime must set cwd/branch/worktree explicitly and record it in registry metadata. |
| Shell/file/Git tools | SDK session config exposes tool allow/exclude lists and permission handling (`node_modules/@github/copilot-sdk/dist/types.d.ts:970-1003`). Streamliner launch prep tells PAW init it has CLI-style repository, shell, GitHub, and MCP access (`src/server/launch-preparation.ts:936-942`, `src/server/launch-preparation.ts:1383-1390`). | Practical parity, subject to permissions | Runtime contract must define default permission policy and UI/auto-approval behavior per node launch. |
| GitHub operations/auth | SDK client/session config supports logged-in-user auth, client-level tokens, and per-session `gitHubToken` identity (`node_modules/@github/copilot-sdk/dist/types.d.ts:100-115`, `node_modules/@github/copilot-sdk/dist/types.d.ts:1072-1082`). Existing PAW init path can use GitHub context. | Practical parity likely; verify with end-to-end PR dogfood | Runtime must inherit the same GitHub auth context as CLI or explicitly set per-session identity. |
| Custom Streamliner tools | SDK supports custom tools (`node_modules/@github/copilot-sdk/README.md:428-453`) and Streamliner already registers `save_streamliner_context` and `complete_paw_init` in the launch SDK session (`src/server/launch-preparation.ts:1370-1377`). | Parity plus improved control | Managed runtime should add Streamliner-owned lifecycle/progress tools sparingly; deterministic API actions should not depend on model calls. |
| Skills | SDK supports `skillDirectories`, disabled skills, custom agents, and skill events (`node_modules/@github/copilot-sdk/dist/types.d.ts:1042-1065`, `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:2444-2499`). Streamliner launch prep preloads `paw-init` in a custom agent (`src/server/launch-preparation.ts:1377-1387`). | Near parity | Runtime must pass the same skill dirs as CLI and record loaded/disabled skill assumptions. |
| Configured MCP/plugin context | SDK supports config discovery and explicit MCP server config (`node_modules/@github/copilot-sdk/dist/types.d.ts:958-968`, `node_modules/@github/copilot-sdk/dist/types.d.ts:1036-1040`). Event schema reports MCP server statuses (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:4507-4548`). | Near parity for MCP; plugin claim binding remains Streamliner-specific | Runtime should use SDK config discovery or explicit config and surface MCP status in progress/diagnostics. |
| Copilot instructions/system prompt | SDK supports append/customize/replace system message modes (`node_modules/@github/copilot-sdk/README.md:551-623`) and Streamliner launch context treats source docs as untrusted data (`src/server/launch-context.ts:560-589`). | Better control than CLI prompt-only launch | Runtime contract must preserve existing Copilot instructions and append Streamliner launch guidance without replacing guardrails. |
| PAW workflow execution | Streamliner already drives PAW init through SDK with `paw-init`, custom tools, `approveAll`, progress events, and artifact verification (`src/server/launch-preparation.ts:1370-1451`). PAW workflow status is artifact-derived, not control-state-derived (`docs/design/decisions/008-paw-artifacts-for-workflow-status.md:21-43`). | Strong evidence for PAW init; likely for PAW implementation | First managed runtime should dogfood a real PAW node before defaulting broadly. |
| Session persistence | SDK exposes persistent `workspacePath`, `resumeSession`, `listSessions`, and `deleteSession` (`node_modules/@github/copilot-sdk/README.md:126-160`, `node_modules/@github/copilot-sdk/README.md:625-652`). Streamliner also has custom SDK session FS plumbing (`src/session-registry/copilot-sdk-session-fs.ts:97-184`). | SDK-native persistence exists | Contract must decide whether managed workers use default `.copilot` session-state, Streamliner-owned SDK state, or a hybrid. |
| PR production | Local dogfood spike produced a disposable-repo branch, commit, and PR draft through an SDK-managed worker. The SDK can expose tools/GitHub auth and current PAW init can prepare a CLI worker. | Local substrate proven; remote Streamliner PR still to dogfood | Gate implementation behind first real Streamliner PR before defaulting SDK-managed runtime. |

## Related PAL SDK Prior Art

The PAL Donna runner provides useful comparative evidence because it is another SDK-managed coding/work-session host. It does not change the recommendation, but it sharpens the risks to verify in Streamliner's first managed worker prototype.

- **Instruction loading:** PAL's production SDK runner manually reads `AGENTS.md` from the worker cwd and appends it through `systemMessage`, with a size cap. That workaround was implemented against SDK `0.2.0`. Current Streamliner's SDK `0.3.0` type docs state that `.github/copilot-instructions.md`, `AGENTS.md`, and related custom instruction files are always loaded from `workingDirectory` regardless of `enableConfigDiscovery` (`node_modules/@github/copilot-sdk/dist/types.d.ts:958-968`). Therefore #61 should verify effective instruction loading in the current SDK and avoid double-injecting instructions if the runtime also appends Streamliner launch guidance.
- **Explicit context wiring:** PAL still explicitly passes `skillDirectories`, custom tools, MCP servers, `onPermissionRequest`, and `onUserInputRequest` instead of relying only on ambient CLI behavior. This supports making Streamliner's managed-worker contract explicit about every context source it expects rather than assuming visible CLI parity.
- **Progress and tools:** PAL projects SDK session events into bounded activity state and uses custom completion/blocker/update tools for managed work sessions. That reinforces Streamliner's recommendation to build an allowlisted progress projection and deterministic lifecycle actions rather than showing raw SDK events or relying on model prose.
- **Terminal resume:** PAL treats `resumeSession` and `copilot --resume <session-id>` as useful session-continuation mechanisms. Combined with user-provided verification that `copilot --resume <sdk-session-id>` can take over an SDK-created session, this makes terminal takeover a supported path rather than an unknown. The remaining Streamliner work is lifecycle integration: opening the terminal, transferring runtime ownership, and rebinding registry observation.

## Plugin and Hook Parity

### Current CLI hook path

Streamliner's installed Copilot CLI plugin declares `sessionStart`, `userPromptSubmitted`, and `sessionEnd` hooks (`copilot-plugin/streamliner/hooks.json:1-29`). The hook script normalizes those into Streamliner signals (`copilot-plugin/streamliner/scripts/streamliner-signal.mjs:8-18`), posts them to the local API or spools them to disk (`copilot-plugin/streamliner/scripts/streamliner-signal.mjs:169-203`, `copilot-plugin/streamliner/scripts/streamliner-signal.mjs:240-260`), and forwards `STREAMLINER_LAUNCH_CLAIM_ID` only on `session.started` for Tier 2 claim binding (`copilot-plugin/streamliner/scripts/streamliner-signal.mjs:150-164`).

The background worker drains those trusted signals before file discovery and can bind launch claims directly from a trusted `session.started` signal (`src/session-registry/background-worker.ts:235-360`).

### What carries over

The SDK itself has session hook callbacks (`node_modules/@github/copilot-sdk/dist/types.d.ts:630-760`) and session events for hook start/end (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:2734-2777`). That is enough for an SDK-managed runtime to build an in-process trusted-signal substitute.

### What does not carry over automatically

The current Streamliner plugin hook script is explicitly oriented around Copilot CLI/Agency execution. It classifies execution kind as `copilot_cli` or `agency` (`copilot-plugin/streamliner/scripts/streamliner-signal.mjs:82-86`) and ignores cwd values under Streamliner's SDK session-FS root (`copilot-plugin/streamliner/scripts/streamliner-signal.mjs:88-120`). Filesystem discovery is also intentionally weak without trusted hook evidence because it can see helper SDK sessions as well as builder-visible terminal sessions (`docs/design/session-system.md:536-555`).

**Constraint:** SDK-managed workers should not rely on the existing Copilot CLI plugin hook as their trust/admission layer. The managed runtime should write explicit SDK lifecycle/progress records itself and only use CLI hooks after terminal takeover transfers ownership to a visible CLI process.

**What still needs Streamliner-specific verification:** The original research did not prove whether the installed Streamliner Copilot CLI plugin is discovered and loaded for SDK-created sessions in the same way it is for visible CLI worker sessions. The SDK confirms hook callbacks, skill directories, config discovery, and MCP configuration, but the downstream prototype must verify Streamliner plugin discovery and plugin-provided claim-binding behavior for SDK-managed workers.

**Follow-up spike evidence:** A local `plugin-discovery` run created an SDK session and observed plugin MCP servers (`donna`, `workiq`), plugin-provided Donna/WorkIQ tool names, loaded skills, and hook start/end events for `sessionStart`, `userPromptSubmitted`, `postToolUse`, `agentStop`, and `sessionEnd`. This reduces plugin discovery risk, but it does not replace Streamliner-specific verification of launch claim binding, installed Streamliner plugin behavior, and any environment variables/hooks the existing Streamliner plugin expects.

**Permission risk:** Do not inherit launch preparation's broad `approveAll` permission handler as the unattended worker-runtime default. The runtime contract should make permission policy an explicit node-launch choice and distinguish launch-prep trust from autonomous implementation trust.

## Session-State Persistence and One-Way Terminal Takeover

### Confirmed

The SDK supports creating sessions, resuming sessions by id, listing session metadata, and disconnecting while preserving session data (`node_modules/@github/copilot-sdk/README.md:126-160`, `node_modules/@github/copilot-sdk/dist/session.d.ts:366-386`). Infinite sessions are default and expose a workspace path under `~/.copilot/session-state/{sessionId}` in the SDK README (`node_modules/@github/copilot-sdk/README.md:625-652`); the local no-prompt smoke probe observed the same default path shape.

Streamliner currently separates internal SDK helper sessions from observed builder sessions. The session-system design says internal launch SDK sessions persist under Streamliner's local state and are not intended to appear in the observed Sessions view (`docs/design/session-system.md:277-281`). The code has a custom SDK session filesystem rooted under `~/.streamliner/state/copilot-sdk-session-fs` with cleanup for residual default Copilot state (`src/session-registry/copilot-sdk-session-fs.ts:19-29`, `src/session-registry/copilot-sdk-session-fs.ts:97-184`).

### Terminal takeover confirmation

User-provided verification confirms that a standalone visible Copilot CLI terminal can take over an SDK-created session by running `copilot --resume <sdk-session-id>`. The SDK also exposes `getForegroundSessionId` and `setForegroundSessionId`, but those APIs are only for a TUI+server mode connection and are not required as proof of terminal takeover (`node_modules/@github/copilot-sdk/README.md:162-168`, `node_modules/@github/copilot-sdk/dist/client.d.ts:345-378`).

### Takeover contract requirements for `managed-worker-runtime-contract`

The contract can treat true CLI takeover by session id as available, but it still needs to define and verify these integration details:

1. A managed SDK session can be created with the intended state root and worktree.
2. A visible Copilot CLI terminal is launched with `copilot --resume <sdk-session-id>` for the exact managed session.
3. After takeover, Streamliner can mark SDK ownership as transferred and stop issuing SDK prompts.
4. Registry observation can bind the visible CLI session either through trusted hook signal or through nonce/session-state evidence.
5. If terminal launch or resume fails in a specific environment, the runtime transitions to a blocked / needs-builder state rather than silently forking context into a new session.

## Browser-Facing Progress Stream

### Safe event taxonomy

Streamliner should project SDK events through an allowlist and redact before persistence or browser display. Current launch prep already emits sanitized progress rather than raw SDK events: session id/workspace path, compact assistant message text, tool name/call id, tool success, and typed failures (`src/server/launch-preparation.ts:855-897`, `src/server/launch-preparation.ts:1393-1451`).

The local `event-progress` spike confirmed this projection is practical during real SDK work: it captured custom progress tools, file/shell/Git activity, plugin MCP status, loaded skills, hook start/end metadata, tool starts/completions, and final assistant messages while excluding raw reasoning, full prompts, tool arguments/results, and terminal output from the browser-facing projection.

| SDK/source event | Browser-facing shape | Safe fields | Explicit exclusions |
|---|---|---|---|
| `session.start` | `session.started` | session id, cwd/repo/branch when needed, SDK/CLI version | raw prompt, token/auth data |
| `assistant.intent` | `agent.intent` | short intent text | hidden prompt context |
| `assistant.message` | `agent.message` | compact/truncated status-like text | full content when it may contain secrets, raw code dumps, reasoning fields |
| `tool.execution_start` | `tool.started` | tool name, call id, MCP server/tool name | `arguments` because the SDK schema may include full tool args (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:2067-2121`) |
| `tool.execution_complete` | `tool.completed` | call id, success boolean, coarse error kind | full result content, terminal output, error text that may contain secrets (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:2191-2252`) |
| `permission.requested` / completed | `permission.requested` / `permission.completed` | permission kind, resolved/denied status | shell command text, paths, URLs, MCP args unless separately redacted (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:3006-3041`) |
| `skill.invoked` | `skill.invoked` | skill name, plugin name/version | full skill content (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:2444-2499`) |
| `session.mcp_servers_loaded` / status changed | `mcp.status` | server name/source/status | raw error text unless sanitized (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:4507-4548`) |
| `session.idle` | `session.idle` | idle state, aborted boolean | none beyond event metadata (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:363-392`) |
| `abort` | `session.aborted` | generic reason/category | internal stack or raw model/tool data (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:1991-2023`) |
| `session.usage_info` | `usage` | token counts/limits if the builder opts in | prompt/message content (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:970-1023`) |

### Always exclude

- Raw `user.message` content, transformed prompt content, and full attachment paths unless explicitly needed for debugging and permissioned (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:1280-1305`).
- `assistant.reasoning`, `assistant.reasoning_delta`, and any reasoning fields on assistant messages. The SDK event schema can include complete reasoning text and reasoning deltas (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:1550-1585`), and the SDK README says streaming can emit reasoning deltas/final reasoning (`node_modules/@github/copilot-sdk/README.md:359-410`).
- Full tool arguments, results, terminal output, MCP payloads, hook inputs, prompt bodies, secrets, tokens, and model-provider telemetry that may identify users or repositories beyond what the node launch already shows.

## Cancellation and Interruption Semantics

The SDK provides three relevant controls:

- `session.abort()` aborts the currently processing message while keeping the session usable (`node_modules/@github/copilot-sdk/dist/session.d.ts:399-419`).
- `session.disconnect()` releases in-memory SDK resources while preserving session state for resume (`node_modules/@github/copilot-sdk/dist/session.d.ts:366-386`).
- `client.stop()` / `forceStop()` stop the SDK-managed CLI server process (`node_modules/@github/copilot-sdk/dist/client.d.ts:112-162`).

The event schema also includes `abort` and `session.idle` with `aborted?: boolean` (`node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:363-392`, `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:1991-2023`).

Whether `abort()` propagates cancellation to spawned shell/tool subprocesses -- the practical behavior builders expect from pressing cancel in an interactive Copilot CLI session -- is unverified by this research. The runtime contract must treat in-flight tool subprocess interruption as an open question and design `cancel_failed` / `needs_manual_takeover` around that uncertainty.

A local cancellation spike started an SDK turn that invoked a PowerShell `Start-Sleep` shell tool, called `session.abort()`, observed an `abort` event and `session.idle` with `aborted: true`, and then successfully sent a follow-up prompt. The redacted event stream did not show a `tool.execution_complete` for the in-flight PowerShell call after abort. That is enough to treat SDK abort as a usable session-level interruption, but not enough to prove OS-level subprocess termination without a process-level check.

**Constraint:** Treat SDK cancellation as a managed-runtime state transition, not as equivalent to interactive CLI cancel until prototyped. The runtime contract should define:

1. `interrupt_requested` when the builder presses cancel/takeover.
2. SDK `abort()` request.
3. `interrupted` when `abort` or idle-with-aborted evidence arrives.
4. `cancel_failed` / `needs_manual_takeover` if the SDK turn/tool does not stop within a bounded timeout.
5. Optional `server_stopped` only as a stronger cleanup action after graceful abort fails.

## Cleanup-After-Merge Classification

Cleanup-after-merge should be a **managed SDK lifecycle action with PAW-aware inputs**, not a pure PAW prompt.

Rationale:

- The SDK worker can use shell/Git/GitHub/file tools, but cleanup after a merged PR is deterministic and safety-critical.
- Streamliner already treats session registry and graph overlay as primary runtime surfaces, so cleanup should update runtime/registry state rather than depend on the model to remember to report completion (`docs/design/decisions/004-session-registry-primary-surface.md:24-32`).
- PAW artifacts should remain the workflow-status source for PAW progress, while cleanup is a post-PR lifecycle action (`docs/design/decisions/008-paw-artifacts-for-workflow-status.md:21-43`).

Recommended contract shape:

1. Managed runtime detects or is told the PR is merged.
2. Backend verifies the linked worktree, branch, remote, clean/merged state, and registry binding.
3. Backend performs branch/worktree cleanup deterministically or asks for builder confirmation.
4. PAW-specific context contributes only the expected work id, target branch, artifact lifecycle, and PR link.
5. Cleanup result is stored on managed-session runtime state and projected to the graph; it is not inferred from a model message.

Cleanup should transition to a blocked / requires-builder state rather than proceed when safety checks find uncommitted work, a branch ahead of its remote, a force-pushed or missing PR head, an unverified squash/merge commit, a dirty linked worktree, or any mismatch between registry binding and local checkout.

## Lifecycle, Registry, and Graph Overlay Implications

Current design says session registry records are canonical and graph overlays are projections (`docs/design/decisions/004-session-registry-primary-surface.md:24-32`). Current observation watches Copilot CLI session-state and uses launch claims with nonce/cwd/branch guardrails (`docs/design/decisions/001-observation-based-session-tracking.md:21-34`, `src/session-registry/launch-claim-binding.ts:103-180`, `src/session-registry/launch-claim-binding.ts:280-400`). PAW status is derived from explicit PAW work directories and artifact patterns (`src/session-registry/paw-artifact-indexer.ts:118-176`, `docs/design/decisions/008-paw-artifacts-for-workflow-status.md:51-56`).

SDK-managed sessions should therefore be first-class registry rows but should not masquerade as observed CLI rows. The following field list is illustrative: the contract should adopt the minimum fields needed to drive registry, UI, takeover, and cleanup behavior. It should also reconcile these fields with existing trusted-signal fields such as `trustedExecutionKind`; `runtimeKind` / `runtimeOwner` describe Streamliner runtime ownership, while `trustedExecutionKind` describes the source of a trusted Copilot CLI/Agency hook signal after a terminal session exists.

- `runtimeKind: terminal-cli | managed-sdk`.
- `runtimeOwner: streamliner-sdk | terminal`.
- `sdkSessionId`, `sdkStateRoot`, and `sdkWorkspacePath`.
- `copilotSessionId` only after/if a visible CLI session is observed.
- `graphBinding`, `pawWorkDir`, and launch metadata as today.
- `managedLifecycleStatus`: preparing, running, idle, needs_input, interrupt_requested, interrupted, takeover_ready, terminal_takeover, failed, pr_ready, completed, cleanup_ready, cleaned_up.
- A bounded progress event log or pointer to runtime event storage.

## Design Impact and Escalations

No immediate issue/spec amendment is required by these findings. The research supports continuing with a constrained-go managed-runtime contract.

The downstream `managed-worker-runtime-contract` node should update project design, likely `docs/design/session-system.md`, because accepted SDK-managed execution changes current explicit design boundaries. The current session-system scope says SDK worker-session runtime, headless execution, and rich session control are out of scope (`docs/design/session-system.md:991-1012`). If #61 accepts the constrained-go path, it should amend that design with a managed-session section covering:

- SDK-managed runtime selection at node launch.
- Managed SDK registry identity and lifecycle states.
- SDK progress stream/redaction contract.
- SDK-managed interruption/cancellation.
- One-way terminal takeover by session id, ownership transfer, and fallback behavior when terminal launch/resume fails.
- Cleanup-after-merge as managed lifecycle action.

A new decision record is optional but recommended if #61 makes one-way takeover or SDK-managed execution a durable cross-workstream constraint for Automated PAW Review Loop.

## Constraints and Unknowns Inherited by `managed-worker-runtime-contract`

### Lifecycle

- Define managed lifecycle statuses separately from Copilot CLI observed liveness.
- Define timeout/failure states for abort, model/tool hangs, SDK server crash, PR creation failure, and cleanup failure.
- Do not treat PAW `## Control State` as authoritative; keep PAW workflow display artifact-derived.

### Registry metadata

- Add managed SDK identity fields without overloading `copilotSessionId`.
- Keep the registry as the primary session record; graph overlays remain projections.
- Preserve explicit `pawWorkDir` lineage for PAW status.

### Progress

- Use an allowlist/redaction layer. Never stream raw SDK events directly to the browser.
- Exclude raw prompts, reasoning, tool args/results, secrets, sensitive paths, hook input payloads, and full terminal output by default.
- Persist enough summarized progress for refresh/restart without persisting sensitive payloads.

### Takeover

- Treat visible CLI takeover via `copilot --resume <sdk-session-id>` as available and define the UI affordance that launches it.
- Define failure handling for environment-specific terminal launch/resume failures; do not silently fork context into a new session.
- After terminal takeover, SDK ownership should be terminally transferred; do not attempt SDK -> CLI -> SDK round-tripping.

### Launch selection

- Keep runtime selection at node launch, as the workstream brief requires.
- Preserve terminal-first launch as a supported path.
- For first cut, make SDK-managed launch builder-selected rather than default for all nodes.

### Review-loop dependency

- SDK-managed runtime is a strong fit for Automated PAW Review Loop because Streamliner can keep implementer/reviewer actors under programmatic control.
- Review-loop workers should wait for #61's accepted lifecycle/progress/takeover contract rather than invent separate continuation semantics.

### Cleanup

- Model cleanup-after-merge as a managed lifecycle action with PAW-aware metadata and deterministic backend safety checks.
- Do not rely on the SDK agent to clean up worktrees/branches by prompt alone.

## Prototype Checklist for the Contract Node

Before implementation hardens around SDK-managed workers, #61 or the first substrate node should run these probes:

1. Create an SDK-managed PAW-lite worker that performs a small real repository change and opens a PR.
2. Verify configured skills, MCP servers, GitHub auth, and Copilot instructions inside that worker, including whether SDK auto-loaded `.github/copilot-instructions.md` / `AGENTS.md` and whether any runtime `systemMessage` append caused duplicate instructions.
3. Verify Streamliner plugin discovery/loading specifically, including plugin-provided commands, skills, hooks, launch-claim environment handling, or explicit absence thereof under SDK-managed sessions.
4. Verify SDK progress events during real shell/file/Git/GitHub tool use and apply the redaction allowlist.
5. Extend the cancellation spike with process-level observation for an active long-running shell command; record exact SDK events and whether child subprocesses are terminated.
6. Exercise visible Copilot CLI takeover of the SDK-created session id/state root and record the ownership and registry-observation transitions.
7. Verify registry behavior for SDK-managed rows, then terminal-owned rows after takeover.
8. Verify cleanup-after-merge with a disposable branch/worktree after PR merge.
