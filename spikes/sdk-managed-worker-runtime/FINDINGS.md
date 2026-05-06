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
| `takeover` | The harness created and preserved a resumable SDK session, recorded its workspace path, and wrote `copilot --resume <sdk-session-id>` to `resume-command.txt`. The user has separately verified that this command takes over SDK-created sessions. |
| `plugin-discovery` | The SDK-created session exposed plugin-provided Donna and WorkIQ tool names, plugin MCP servers, personal/plugin skills, and hook start/end events. Streamliner plugin-specific claim-binding behavior still needs verification with the Streamliner plugin installed/refreshed in the target environment. |
| `dogfood-pr` | In a disposable git repo, an SDK-managed worker created branch `spike/sdk-managed-worker-dogfood`, edited `README.md`, committed the change, wrote `PR_DRAFT.md`, and reported completion through a custom tool without pushing. |

## Design implications

- Treat SDK-managed workers as capable of branch/commit/draft-PR production in a disposable repo. A real remote PR dogfood is still useful, but the local substrate is proven.
- Use explicit `skillDirectories` for Streamliner-owned skills unless/until repo-local skill auto-discovery is separately proven.
- Preserve SDK auto-loading of `AGENTS.md` and `.github/copilot-instructions.md`; append Streamliner launch guidance rather than replacing or duplicating repository instructions.
- Build browser progress from an allowlisted projection, not raw SDK events. Hook/MCP/skill/tool event metadata is useful, but raw prompts, tool arguments/results, reasoning, and terminal output should remain excluded by default.
- Treat SDK `abort()` as a usable session interruption mechanism with follow-up recovery. Keep subprocess termination as a contract caveat until a process-level check proves whether in-flight shell children are killed.
- Installed plugin surfaces can be visible in SDK sessions, but Streamliner should still write managed lifecycle records itself and verify Streamliner plugin claim-binding separately.
