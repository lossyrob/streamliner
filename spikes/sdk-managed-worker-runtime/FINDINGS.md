# SDK-managed worker runtime spike findings

These findings come from local runs of `spikes/sdk-managed-worker-runtime/run.mjs`.
Run artifacts are intentionally ignored under `.work/`; rerun the commands to refresh evidence.

## Initial local results

| Spike | Result |
|---|---|
| `status` | SDK server started successfully with Copilot server `1.0.36`, protocol `3`, authenticated as the local GitHub user, and created a session under `~/.copilot/session-state/<session-id>`. |
| `config-instructions --case auto` | With `enableConfigDiscovery: true`, the SDK session saw disposable-repo `AGENTS.md` and `.github/copilot-instructions.md` tokens. It also emitted plugin/builtin MCP status for `github-mcp-server`, `donna`, and `workiq`, hook events, and loaded personal/plugin skills. The disposable repo-local `.copilot/skills` skill was not observed in the auto case. |
| `config-instructions --case explicit` | Passing `skillDirectories` explicitly loaded the custom spike skill, and `systemMessage: { mode: "append" }` loaded the appended system token. This verifies the explicit wiring path for local/custom skills and Streamliner guidance. |
| `event-progress` | A managed SDK worker in a disposable git repo called custom progress tools, created `spike-output.txt`, inspected git status, and produced a usable redacted/projection event stream. The projection captured hook types, MCP servers, skills, tool starts/completions, and assistant messages without needing raw terminal output. |
| `cancellation --abort-after-ms 30000` | The model started a PowerShell `Start-Sleep` shell tool, `session.abort()` emitted an `abort` event, `session.idle` reported `aborted: true`, and a follow-up prompt returned `FOLLOWUP_OK`. The redacted event stream did not show a `tool.execution_complete` for the in-flight PowerShell call after abort; separate OS-level subprocess termination still needs a process-level check if the contract requires it. |
| `process-cancellation --abort-after-ms 30000` | The marker/PID probe wrote child PID `4648`, called `session.abort()`, then found `processAliveAfterAbort: false`, no completion marker, an abort event, idle-after-abort, and successful follow-up `PROCESS_CANCEL_FOLLOWUP_OK`. This supports copy like "SDK turn interrupted and observed child process stopped" for the tested PowerShell path, while still keeping timeout/failure states for platform/tool variance. |
| `takeover` | The harness created and preserved a resumable SDK session, recorded its workspace path, and wrote `copilot --resume <sdk-session-id>` to `resume-command.txt`. The user has separately verified that this command takes over SDK-created sessions. |
| `plugin-discovery` | The SDK-created session exposed plugin-provided Donna and WorkIQ tool names, plugin MCP servers, personal/plugin skills, and hook start/end events. Streamliner plugin-specific claim-binding behavior still needs verification with the Streamliner plugin installed/refreshed in the target environment. |
| `permission-policy` | A custom permission handler approved a safe shell write with SDK decision `approve-once`, rejected a marker shell write and `gh api rate_limit` with SDK decision `reject`, left the denied marker file absent, and accepted a follow-up turn. This gives #61 concrete behavior for approved execution, policy denial, no-mutation verification, and post-denial usability. |
| `streamliner-claim-binding` | After `npm run refresh-copilot-plugin`, an SDK-created session with `STREAMLINER_LAUNCH_CLAIM_ID` emitted isolated Streamliner hook spool/debug files for `prompt.submitted`, `session.started`, and `session.ended`; only `session.started` carried the launch claim, matching the plugin contract. This proves local SDK sessions can trigger the refreshed Streamliner plugin, but the managed runtime should still write explicit lifecycle records for deterministic ownership and fallback handling. |
| `dogfood-pr` | In a disposable git repo, an SDK-managed worker created branch `spike/sdk-managed-worker-dogfood`, edited `README.md`, committed the change, wrote `PR_DRAFT.md`, and reported completion through a custom tool without pushing. |

## Design implications

- Treat SDK-managed workers as capable of branch/commit/draft-PR production in a disposable repo. A real remote PR dogfood is still useful, but the local substrate is proven.
- Use explicit `skillDirectories` for Streamliner-owned skills unless/until repo-local skill auto-discovery is separately proven.
- Preserve SDK auto-loading of `AGENTS.md` and `.github/copilot-instructions.md`; append Streamliner launch guidance rather than replacing or duplicating repository instructions.
- Build browser progress from an allowlisted projection, not raw SDK events. Hook/MCP/skill/tool event metadata is useful, but raw prompts, tool arguments/results, reasoning, and terminal output should remain excluded by default.
- Use the SDK permission handler as the first runtime safety boundary. Prefer explicit policy decisions (`approve-once` / `reject`) and surface denied-tool state to the UI rather than inheriting launch-prep `approveAll`.
- Treat SDK `abort()` as a usable session interruption mechanism with follow-up recovery. The PowerShell marker/PID probe observed child termination, but the runtime should still model bounded timeout, cleanup, and manual-takeover paths.
- Installed plugin surfaces and Streamliner launch-claim spooling can be visible in SDK sessions after plugin refresh and env setup. Streamliner should still write managed lifecycle records itself so SDK-owned work does not depend solely on CLI hook delivery.
