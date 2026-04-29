# Agent Guidance

This file points autonomous coding agents (Copilot CLI, Claude Code,
PAW workers) at the conventions and tooling that matter most for working
in this repo. Keep it short and link out for depth.

## Diagnostics & Logs

The local API server writes JSON-lines logs to:

```
~/.streamliner/state/logs/api-YYYY-MM-DD.log
```

Use these when diagnosing relaunch failures, missing hook signals,
observation lag, or any "what happened?" investigation. The live `npm run
dev` terminal output is a mirror of the same content but is not durable —
the file is.

Quick recipes:

```bash
# Tail the current day
tail -f ~/.streamliner/state/logs/api-$(date -u +%Y-%m-%d).log

# Filter relaunch events for a specific session id
jq --arg id "<session-uuid>" 'select(.scope == "relaunch" and .sessionId == $id)' \
  ~/.streamliner/state/logs/api-*.log

# Find any errors today
jq 'select(.level == "error")' ~/.streamliner/state/logs/api-$(date -u +%Y-%m-%d).log
```

Set `STREAMLINER_LOG_LEVEL=debug` before starting the API to capture
verbose traces. Full reference: [`docs/operations/logging.md`](docs/operations/logging.md).

## Local Development

- `npm run dev` — starts the API (`tsx watch`) and Vite together
- `npm run dev:api` / `npm run dev:web` — start them independently
- `npm test` — run the Vitest suite (use `--pool=forks` if you see worker errors)
- `npm run lint` — ESLint
- `npm run build` — `tsc -b && vite build`

The API binds to `127.0.0.1:4319` by default. See
[`DEVELOPING.md`](DEVELOPING.md) for the full env-var matrix and the
Copilot CLI plugin install path.

## Repo Conventions

- TypeScript with `erasableSyntaxOnly` — **do not** use constructor
  parameter properties (`constructor(private foo: Bar)`); declare fields
  explicitly.
- Tests live next to source as `*.test.ts(x)` and use Vitest. Long-running
  tests should run with `--pool=forks` to avoid worker isolation issues.
- Server modules sit under `src/server/`; session registry logic is in
  `src/session-registry/`; React UI in `src/components/`.
- File-store internals at `~/.streamliner/state/session-registry/entries/`
  use one JSON file per session keyed by Streamliner-owned UUID (not the
  Copilot session id).

## Design Documentation

Project design lives under [`docs/design/`](docs/design/). Decision records
are at `docs/design/decisions/NNN-*.md`. Read the relevant design doc
before changing the registry schema, the session lifecycle, the local API
contract, or the launch/relaunch behavior.

## Workflow

- PAW (Plan → Activity → Work) workflow artifacts live in `.paw/work/<id>/`.
- For most non-trivial changes, run a planning pass before editing code.
- Commits should include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
  when authored by an AI agent.
