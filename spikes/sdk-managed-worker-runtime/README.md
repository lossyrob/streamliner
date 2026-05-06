# SDK-managed worker runtime spikes

Reusable one-off harnesses for answering Copilot SDK managed-worker questions.

Run from the repository root:

```powershell
node .\spikes\sdk-managed-worker-runtime\run.mjs status
node .\spikes\sdk-managed-worker-runtime\run.mjs config-instructions --case auto
node .\spikes\sdk-managed-worker-runtime\run.mjs event-progress
node .\spikes\sdk-managed-worker-runtime\run.mjs cancellation
node .\spikes\sdk-managed-worker-runtime\run.mjs takeover
node .\spikes\sdk-managed-worker-runtime\run.mjs plugin-discovery
node .\spikes\sdk-managed-worker-runtime\run.mjs dogfood-pr
```

The harness writes ignored run artifacts under `spikes/sdk-managed-worker-runtime/.work/runs/<run-id>/`.
Each run records:

- `summary.json` - high-level result and probe-specific observations.
- `events.redacted.jsonl` - redacted SDK event stream for diagnosis.
- `events.projected.jsonl` - browser-safe projection candidate.
- `resume-command.txt` for takeover runs.

See `FINDINGS.md` for the initial local spike results and design implications.

## Commands

| Command | Purpose |
|---|---|
| `status` | Starts the SDK server and records status/auth/session metadata without sending a prompt. |
| `config-instructions` | Creates a disposable repo with `AGENTS.md`, `.github/copilot-instructions.md`, a local skill, and optional appended system message, then asks the model to report which context sources it can see through a custom tool. |
| `event-progress` | Runs a small disposable-repo task and records raw redacted SDK events plus an allowlisted projection. |
| `cancellation` | Starts a long-running shell-oriented turn, calls `abort()`, and records abort/idle/follow-up behavior. |
| `takeover` | Creates a resumable SDK session, writes the exact `copilot --resume <sdk-session-id>` command, and preserves the SDK session for terminal takeover validation. |
| `plugin-discovery` | Starts an SDK session with config discovery enabled and asks the agent to report any observable installed plugin commands/skills/hooks through a custom tool. |
| `dogfood-pr` | Uses a disposable git repo to ask an SDK-managed worker to make a branch, commit a small change, and draft PR text without pushing. |

## Useful flags

| Flag | Default | Notes |
|---|---:|---|
| `--model <name>` | `gpt-5.4-mini` | Override with `COPILOT_SPIKE_MODEL`. |
| `--timeout-ms <n>` | `120000` | Prompt timeout for `sendAndWait` probes. |
| `--keep-session` | false | Preserve SDK session state instead of deleting it. `takeover` always preserves. |
| `--case auto|explicit|both` | `auto` | `config-instructions` only; `auto` uses config discovery, `explicit` passes skill dirs and appends a system message. |
| `--abort-after-ms <n>` | `5000` | `cancellation` only. |

## Interpretation cautions

- `config-instructions` and `plugin-discovery` rely on the model reporting through custom tools, so treat failures as evidence to inspect rather than final proof of absence.
- `takeover` no longer tests whether resume works; that is considered verified. It preserves a session and records the integration data needed to design Streamliner ownership transfer.
- `dogfood-pr` defaults to a local disposable repo. Do not add remote push/PR behavior without an explicit safety gate.
