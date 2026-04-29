# API Server Logging

The Streamliner local API process writes structured JSON-lines logs that
persist across restarts. Use these when diagnosing session relaunch, hook
signal delivery, observation pipeline behavior, or any "what happened a few
minutes ago?" question that the live terminal output can't answer.

## Where the logs live

```
~/.streamliner/state/logs/api-YYYY-MM-DD.log
```

A new file is started each UTC day (the date in the filename rolls at UTC
midnight). On startup the API server prunes any `api-*.log` file with an
mtime older than 14 days. There is no size cap — long-running daily files
just keep appending.

The exact file path for the current process is also printed at info level
during startup; look for the `listening` event.

## Format

Every line is a self-contained JSON object:

```json
{"ts":"2026-04-29T15:50:34.332Z","level":"info","scope":"signals","msg":"received","event":"session.started","sessionId":"8088f527-...","hookSource":"resume"}
```

Standard fields:

| Field | Meaning |
|-------|---------|
| `ts` | ISO 8601 timestamp (UTC) |
| `level` | `debug` \| `info` \| `warn` \| `error` |
| `scope` | Dotted scope name (e.g. `api`, `signals`, `relaunch`, `http`, `worker`) |
| `msg` | Short human-readable event name |

Anything beyond those four keys is event-specific structured context
(`sessionId`, `method`, `pid`, `durationMs`, etc.). Errors are normalized to
`{name, message, stack}` objects.

## Scopes

| Scope | What's logged |
|-------|---------------|
| `api` | Server startup, port-in-use, shutdown |
| `http` | One entry per request: method, path, status, durationMs (skips SSE) |
| `signals` | Trusted hook signals received (`session.started`, `userPromptSubmitted`, `session.ended`) |
| `relaunch` | Each `POST /api/sessions/:id/relaunch` attempt, success, or failure |
| `worker` | Background worker errors (signal drain, discovery, summarization, indexing) |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `STREAMLINER_LOG_LEVEL` | `info` | Minimum level to emit (`debug`/`info`/`warn`/`error`) |
| `STREAMLINER_LOG_DIR` | `~/.streamliner/state/logs` | Override the log directory |
| `STREAMLINER_LOG_CONSOLE` | `1` | Set to `0` or `false` to suppress console mirroring |

## Reading the logs

Tail the current day's file:

```powershell
Get-Content "$env:USERPROFILE\.streamliner\state\logs\api-$(Get-Date -Format 'yyyy-MM-dd').log" -Wait
```

Filter to just relaunch events:

```bash
jq 'select(.scope == "relaunch")' ~/.streamliner/state/logs/api-2026-04-29.log
```

Trace a specific session:

```bash
jq --arg id "8088f527-de7b-49d0-9c37-4e8eb683ae6b" 'select(.sessionId == $id)' \
  ~/.streamliner/state/logs/api-*.log
```

Find slow requests:

```bash
jq 'select(.scope == "http" and .durationMs > 1000)' ~/.streamliner/state/logs/api-*.log
```
