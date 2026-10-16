# Developing Streamliner

## Prerequisites

- **Node.js 24 LTS (24.x)** is the documented development baseline.
- **npm 11**, bundled with Node 24.

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/lossyrob/streamliner.git
cd streamliner
npm ci
```

For a first run focused on viewing graphs, follow the
[README quick start](README.md#quick-start-explore-the-example-workstreams).
It disables the automatic session worker and explains source registration.

## Development servers

Start the local API and Vite dev server together:

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173). Vite binds to `127.0.0.1` and proxies `/api/*` to the standalone local API at [http://127.0.0.1:4319](http://127.0.0.1:4319). `npm run dev` waits for the API health endpoint before starting Vite so initial dashboard requests do not race the API process. Frontend changes hot-reload through Vite without restarting the API worker.

Run the processes separately when you only need to restart one side:

```bash
npm run dev:api
npm run dev:web
```

Use `npm run api` for a non-watch API process. The API serves `GET /api/health`, graph loading, the session registry, trusted session signals, and `GET /api/sessions/events` for live session updates. Configure it with:

| Variable | Default | Description |
|----------|---------|-------------|
| `STREAMLINER_API_HOST` | `127.0.0.1` | API bind host |
| `STREAMLINER_API_PORT` | `4319` | API port used by direct callers and the Vite proxy |
| `STREAMLINER_PROTO_CANVAS_PROJECT_ROOT` | unset | Local project directory for the [portfolio prototype](_proto/canvas/README.md). Its API returns HTTP 503 until configured; other APIs are unaffected. |
| `STREAMLINER_GRAPH` | unset | Optional graph file path served by `GET /api/graph.json` |
| `STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER` | unset | Set to `1` to disable automatic local session discovery/summarization, for example during graph-only exploration. |
| `STREAMLINER_PAW_SKILL_DIR` | auto-discovered | Optional PAW skills directory containing `paw-init/SKILL.md`; multiple directories may be separated by semicolons. |
| `STREAMLINER_LOG_LEVEL` | `info` | Minimum log level (`debug`/`info`/`warn`/`error`) |
| `STREAMLINER_LOG_DIR` | `~/.streamliner/state/logs` | Override the log file directory |
| `STREAMLINER_LOG_CONSOLE` | `1` | Set to `0` to suppress console mirroring of log entries |
| `STREAMLINER_STATE_ROOT` | `~/.streamliner/state` | Base directory for session launch settings and other APIs that do not have a more specific path override |
| `STREAMLINER_WORKSTREAM_REGISTRY` | `~/.streamliner/state/workstream-registry/workstreams.json` | Override the tracked workstream registry path |
| `STREAMLINER_WORKSTREAM_SOURCE_REGISTRY` | `~/.streamliner/state/workstream-registry/sources.json` | Override the workstream source registry path |
| `STREAMLINER_RECENTS_PATH` | `~/.streamliner/recent-graphs.json` | Override the legacy recents path |
| `STREAMLINER_PREVIEW_READONLY` | unset | Set to `1` for read-only preview API mode |
| `STREAMLINER_LAUNCH_CLAIMS_ROOT` | `~/.streamliner/state/launch-claims` | Override the launch-claim store root used by `createLaunchClaim` and the binding pass (see `docs/design/session-system.md` Launch Claim Lifecycle) |
| `GITHUB_TOKEN` / `GH_TOKEN` | unset | Optional token for live GitHub issue/PR status. If unset, the API resolves a repo-specific `gh auth token` profile and then falls back to anonymous GitHub REST. |
| `STREAMLINER_GITHUB_AUTH_CONFIG` | `~/.streamliner/state/github-auth.json` | Optional local config file that maps GitHub repositories to `gh` auth profiles for live issue/PR status. |

When no `STREAMLINER_GRAPH` is set and no recent graph is available,
`GET /api/graph.json` returns a 404. The dashboard uses the workstream registry:
on fresh state, open **Workstreams**, choose **Project root** under
**Add source**, enter this clone's absolute path, and add it. The source scanner
discovers `.streamliner\workstreams` and makes those graphs available to open.

The API process writes structured JSON-lines logs to `~/.streamliner/state/logs/api-YYYY-MM-DD.log`. See [`docs/operations/logging.md`](docs/operations/logging.md) for the format, scope reference, and grep/jq recipes.

## Optional agent workflows

Graph viewing can be used independently of agent execution. Before using
PAW-backed launches:

- Install Copilot CLI and authenticate with an account that can use Copilot.
- Install [PAW](https://github.com/lossyrob/phased-agent-workflow) skills.
  Streamliner looks for `paw-init/SKILL.md` in its supported local skill
  locations; set `STREAMLINER_PAW_SKILL_DIR` explicitly if needed.
- Follow the [Streamliner plugin setup](#copilot-cli-streamliner-plugin) for
  trusted session signals.
- Check that the models named in your local configuration and launch
  instructions are available to your account. The environment template uses
  `STREAMLINER_CONTEXT_MODEL=claude-sonnet-4.6` for standalone/legacy
  launch-context synthesis. Combined launch preparation uses the separate
  [preparation profile](#paw-preparation-profile).

Normal API startup enables the session worker unless
`STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER=1` is set. It discovers local
Copilot sessions and can send eligible recent user-message excerpts and
session context to Copilot for summaries. Remove that first-run opt-out and
restart the API when you want session observation and summarization.

API health becomes available without waiting for session-registry recovery.
The registry is loaded asynchronously in bounded batches, and startup
reconciliation yields between records that may need recovery. Other API
requests wait for recovery so new launches cannot be mistaken for abandoned
runs. Normal observation begins after recovery and the worker's initial delay.
Recovery failures are logged and returned to waiting requests; they do not
silently enable launches against an unrecovered registry.

Use agent features only with trusted local projects. Launch, relaunch, and
cleanup actions can execute commands or modify repositories, and model-backed
features use your configured Copilot account.

### PAW preparation profile

`POST /api/launch-preparations` uses one internal SDK session for context
assembly and PAW initialization, including for `target: "external-session"`.
Configure that helper in the **API server's environment** or checkout `.env`,
not in the request's `configuration.environment` or worker CLI arguments.
Those request fields configure the later worker, not the preparation helper.

| Variable | Unset behavior | Supported configuration |
|----------|----------------|-------------------------|
| `STREAMLINER_PAW_INIT_MODEL` | `gpt-5.5` | Exact model ID available in the selected CLI's authenticated model catalog |
| `STREAMLINER_PAW_INIT_REASONING_EFFORT` | Omit SDK reasoning override | `low`, `medium`, `high`, `xhigh`; the selected model must advertise the value |
| `STREAMLINER_PAW_INIT_CONTEXT` | Omit session context override | `default` or `long_context`; either requires an explicit preparation CLI path |
| `STREAMLINER_PAW_INIT_CLI_PATH` | Existing SDK CLI resolution | Absolute path to a native executable or `.js` entry point; shell shims (`.cmd`, `.bat`, `.ps1`) are not supported |

For an Astra/high/long-context preparation helper, set all four:

```powershell
$env:STREAMLINER_PAW_INIT_MODEL = "gpt-6-astra"
$env:STREAMLINER_PAW_INIT_REASONING_EFFORT = "high"
$env:STREAMLINER_PAW_INIT_CONTEXT = "long_context"
$env:STREAMLINER_PAW_INIT_CLI_PATH = "C:\tools\copilot.exe" # Replace with the verified installed path.
```

Restart the API in that environment after changing the settings or CLI
installation. Editing `.env` does not update a running API's environment;
inherited environment variables also take precedence over `.env`.
An existing preparation session is not reconfigured. No plugin refresh,
worker relaunch, or UI change is required.

With an explicit preparation CLI path, the preparation-only
`@github/copilot-sdk-preparation` alias pins SDK **1.0.18**. Its adapter uses
`RuntimeConnection.forStdio({ path })` and forwards `model`, `reasoningEffort`,
and `contextTier` at the **session level** on both create and resume. It does
not pass `--context` at process startup: that flag did not propagate into the
SDK 0.3.0 session. Both the combined preparation and legacy PAW initializer
use the adapter; neither currently resumes a previous helper session.
The adapter translates the newer SDK's `workingDirectory` client option and
`configDirectory` session option, and builds tools with the selected SDK's
types. No model-capability overrides are used.

Configured values fail closed before session creation: blank/invalid values,
unusable CLI paths, CLI help without the selected context option, unavailable
or non-enabled models, unsupported reasoning, and missing long-context catalog
metadata produce actionable preparation errors. When model policy is present,
it must be `enabled`; `disabled` and `unconfigured` are rejected. Catalogs that
omit policy remain supported. Long-context availability is
read from CLI 1.0.87's `billing.tokenPrices.longContext.contextMax` metadata.
Missing metadata is an error, not permission to guess or fall back.

**Version boundary:** without a preparation CLI path, the adapter retains SDK
**0.3.0**, its existing CLI resolution (including its bundled CLI **1.0.36**),
and its model/reasoning configuration. With all four variables absent, the
model remains `gpt-5.5` and no new capability probes or overrides are added.
Standalone context synthesis, summarization, managed workers, and session
filesystem integration retain their existing SDK 0.3.0 imports. Do not replace
the old SDK globally or override its bundled CLI dependency: its old `index.js`
resolver is incompatible with the 1.0.87 npm loader layout. Operators own
installation/version pinning of the explicit CLI; the repository does not
upgrade the user's installation. SDK 1.0.18 requires Node `^20.19.0 || >=22.12.0`
and supports the protocol-3 transport reported by CLI 1.0.87-0.

Before deployment, inspect the chosen executable without starting a session:

```powershell
& $env:STREAMLINER_PAW_INIT_CLI_PATH --version
& $env:STREAMLINER_PAW_INIT_CLI_PATH --help
```

For a `.js` loader, prefix those commands with `node`. Confirm `--context`
advertises `default, long_context`. A no-session SDK `start` / `listModels` /
`stop` probe using `RuntimeConnection.forStdio({ path })` can check
account-specific availability; do not call `createSession` for a capability
probe. The verified
Astra catalog reported **1,050,000 tokens**, including its long-context tier,
not the requested **1.2M**. That is catalog evidence, not a measured live
session budget or a guarantee for another account. The installed 1.0.87-0
executable's RPC `getStatus` reported `0.0.1`/protocol 3; use executable
`--version`, feature help, and the catalog rather than treating that RPC
version as the installation version.

**Effective verification oracle:** mocked protocol tests prove the actual
`session.create` and `session.resume` payloads contain the requested profile;
they do not prove live long-context execution. After reviewed deployment, an
authorized initializer must also persist `session.start` with
`gpt-6-astra` / `high` / `long_context`, and its runtime request usage must show
a prompt budget materially above **272,000**, consistent with the enabled long
tier. Do not infer an exact reserve-adjusted budget from the **1,050,000**
catalog capacity. Require exactly one successful `save_streamliner_context`
and `complete_paw_init`, readiness, and routine shutdown. Preserve the old
default-tier evidence; do not relabel it as long-context execution.

## GitHub status authentication

Live GitHub issue/PR status does not require storing tokens in Streamliner. The API resolves authentication in this order:

1. `GH_TOKEN` / `GITHUB_TOKEN` for github.com and `*.ghe.com`, or `GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN` for GitHub Enterprise Server (first variable takes precedence).
2. A local repo-specific `gh` profile from `~/.streamliner/state/github-auth.json` or `STREAMLINER_GITHUB_AUTH_CONFIG`.
3. The active `gh` account for the reference's hostname.
4. Anonymous GitHub REST, which may be rate-limited.

Use the local auth config when different repositories need different GitHub accounts:

```json
{
  "profiles": {
    "personal": {
      "ghConfigDir": "C:\\Users\\robemanuele\\AppData\\Roaming\\gh-pub",
      "user": "lossyrob"
    },
    "work": {
      "user": "work-user"
    },
    "enterprise": {
      "hostname": "msft.ghe.com",
      "user": "enterprise-user"
    }
  },
  "repositories": {
    "github.com/lossyrob/streamliner": "personal",
    "github.com/work-org/*": "work",
    "msft.ghe.com/*": "enterprise"
  }
}
```

`ghConfigDir` sets `GH_CONFIG_DIR` only for that status lookup. `user` is passed
to `gh auth token --hostname <reference-host> --user <user>`, so Streamliner does
not need to run `gh auth switch` or persist credentials. A profile's optional
`hostname` must match the reference host; it does not redirect API requests.
Repository mappings are host-scoped, with exact repo, owner wildcard, then
host wildcard precedence.

Set `githubHost` in `graph.json` to select the workstream's enterprise host,
or use repo/tracker `host` overrides. REST requests use `https://api.github.com`
for public GitHub, `https://api.<tenant>.ghe.com` for enterprise cloud, and
`https://<host>/api/v3` for Enterprise Server. Launch issue reads and managed
cleanup pass the host-qualified repository to `gh`; those commands use the
CLI's configured credentials for that host. No tokens belong in workstream
artifacts.

## Session launch defaults

Streamliner stores default Copilot CLI option tokens for terminal launches in
`~/.streamliner/state/session-launch-settings.json`. Configure them from
**Settings -> Session launch**. Fresh state defaults to `--yolo`; clearing the
editor and saving records an intentional empty default list.

Terminal PAW launches record the resolved args on the session. Relaunch and
restart command previews use recorded args first, including recorded empty args,
then current configured defaults for historical sessions without recorded args.
Streamliner appends its own `--resume=<session>` argument during relaunch, so do
not include `--resume` in the defaults.

Visible worker terminal launches use platform adapters. Terminal preferences are
`default`, `windows-terminal`, `powershell`, `mac-terminal`, and `iterm2`: on
Windows, `default` prefers Windows Terminal and falls back to PowerShell; on
macOS, `default` and `mac-terminal` use Apple Terminal.app, while `iterm2`
explicitly selects iTerm2. Terminal titles and colors are best-effort and depend
on the host adapter.

## Worktree preview instances

Use a worktree preview when you want to inspect a PR without stopping the main
Streamliner instance running from your primary checkout:

```powershell
npm run preview:worktree -- --name pr-41 --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
```

The command starts background API and Vite processes, seeds an isolated
workstream registry from the graph, disables the session background worker, and
writes runtime state under `.streamliner-preview\<name>\`. Ports are persisted
in `.streamliner-preview\<name>\ports.json`, so restarting the same preview name
reuses the same URL when those ports are available. The default `readonly` mode
blocks mutating API requests so accidental clicks do not create launch artifacts
or edit preview registries. Use `--mode sandbox` only when you intentionally
want to exercise mutating flows against the isolated preview state.

When an agent starts a preview, it should add `--attached` and run the command
in a Copilot-managed background shell instead of detaching the server processes:

```powershell
npm run preview:worktree:attached -- --name pr-41 --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
```

Attached previews keep API/Vite as children of the launcher process, so Copilot
can track the background task and stop it when the task or session ends.

Check or stop a preview with:

```powershell
npm run preview:status -- --name pr-41
npm run preview:stop -- --name pr-41
```

## Copilot CLI Streamliner plugin

The Streamliner Copilot CLI plugin marks real Copilot CLI and Agency sessions as
trusted local sessions. It is installed through a local Copilot plugin
marketplace so normal `copilot` launches load the hook plugin from Copilot CLI's
plugin cache.

### Install from this checkout

Use the main checkout for the local marketplace registration. The Copilot CLI
stores the marketplace as an absolute path in its own config, so registering
from a temporary worktree will leave Copilot pointing at that worktree even
after the PR is merged. Set `$repo` below to the absolute path of your
persistent Streamliner clone.

```powershell
$repo = "C:\work\streamliner"

git -C $repo switch main
git -C $repo pull --ff-only

copilot plugin marketplace add $repo
copilot plugin install streamliner@streamliner-local
copilot plugin marketplace list
copilot plugin list
```

`copilot plugin marketplace list` should show `streamliner-local` pointing at
the main checkout, and `copilot plugin list` should include
`streamliner@streamliner-local`.

Streamliner also runs a Copilot plugin preflight before Streamliner-owned
visible Copilot terminal launches. The preflight reads enabled plugins from
`~/.copilot/settings.json`, resolves their installed cache directories, and
passes them to Copilot with `--plugin-dir` for that launch. It does not run
`copilot plugin install` on the launch path, so running sessions that are using
plugin scripts do not block new launches with cache-update `EBUSY` errors. Set
`STREAMLINER_COPILOT_PLUGIN_PREFLIGHT=false` to disable the preflight, or
`STREAMLINER_COPILOT_REQUIRED_PLUGINS=plugin@marketplace,...` to override the
plugin sources checked before launch.

If `streamliner-local` is already registered to an old worktree, remove and
re-add it from the main checkout:

```powershell
$repo = "C:\work\streamliner"

copilot plugin uninstall streamliner
copilot plugin marketplace remove streamliner-local
copilot plugin marketplace add $repo
copilot plugin install streamliner@streamliner-local
copilot plugin marketplace list
copilot plugin list
```

### Refresh after editing the plugin

Copilot CLI caches installed plugin files. Reinstall the plugin after changing
files under `copilot-plugin\streamliner`:

```powershell
copilot plugin marketplace update streamliner-local
copilot plugin install streamliner@streamliner-local
```

For one-off development runs that should bypass the cache, launch Copilot with
the plugin directory directly:

```powershell
$repo = "C:\Users\robemanuele\proj\streamliner\streamliner"

copilot --plugin-dir (Join-Path $repo "copilot-plugin\streamliner")
```

Direct path installs with `copilot plugin install <absolute-path>` work today,
but Copilot CLI warns that direct installs are deprecated in favor of
`plugin@marketplace` installs.

### Remove or switch checkouts

The marketplace registration is stored in the Copilot CLI config, not in this
repository. Remove it before deleting the checkout it points to or switching the
`streamliner-local` marketplace to another checkout:

```powershell
copilot plugin uninstall streamliner
copilot plugin marketplace remove streamliner-local
```

Then register and install from the new checkout:

```powershell
$repo = "C:\path\to\other\streamliner-worktree"

copilot plugin marketplace add $repo
copilot plugin install streamliner@streamliner-local
```

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the local API and Vite dev server together |
| `npm run dev:api` | Start the local API in watch mode |
| `npm run dev:web` | Wait for the local API, then start only the Vite dev server with HMR |
| `npm run api` | Start the local API without watch mode |
| `npm run build` | Type-check with `tsc` and build for production |
| `npm run preview` | Preview the production build locally with the API running |
| `npm test` | Run tests once with Vitest |
| `npm run lint` | Run ESLint across the project |

## Project structure

```
src/
├── main.tsx                              # React entry point
├── App.tsx                               # Root component — state, data pipeline, layout
├── workstream-schema.ts                  # TypeScript types/enums for workstream JSON
├── workstream-view-model.ts              # Parser, validator, view-model builder
├── workstream-graph.ts                   # Dagre layout, transitive reduction, highlights
├── workstream-graph.test.ts              # Vitest tests for graph logic
├── streamliner-theme.css                 # Light Deep Ocean theme (all sl-* classes)
├── server/                               # Express local API, routes, and SSE event stream
├── session-registry/                     # File-backed session registry and observation worker
└── components/
    ├── WorkstreamCanvas.tsx              # React Flow graph wrapper
    ├── WorkstreamGraphNode.tsx           # Custom node renderers (task + gate)
    ├── NodeInspector.tsx                 # Selected node detail sidebar
    ├── OperationalStatusStrip.tsx        # Ready/in-flight/blocked/review counts
    └── WorkstreamHeader.tsx              # Title, badges, freshness, file loader
```

### Key directories

- **`src/`** — all application source code (flat layout for minimal import paths)
- **`public/`** — static assets served as-is (example workstream fixture, favicon)
- **`prototype/`** — original prototype code these modules were ported from (reference only)
- **`docs/`** — documentation assets (images, etc.)

## Data pipeline

The app transforms workstream data through a clean pipeline:

```
JSON string
  → parseWorkstreamDocument()    # strict validation, returns WorkstreamDocument
  → buildWorkstreamViewModel()   # derives operational queues and signals
  → buildWorkstreamGraphLayout() # dagre positions + highlight states
  → React Flow rendering         # interactive graph in the browser
```

Each layer is a pure function that can be tested independently.

## Testing

Tests use [Vitest](https://vitest.dev/) and cover the graph layout logic (transitive edge reduction, ancestor/descendant highlighting):

```bash
# Run once
npm test

# Watch mode
npx vitest
```

Test files live next to their source files (e.g., `workstream-graph.test.ts`).

## Building for production

```bash
npm run build
```

This runs `tsc -b` for type checking followed by `vite build`. Output goes to `dist/`.

To preview the production build:

```bash
npm run preview
```

## Workstream JSON format

Streamliner consumes workstream JSON documents conforming to `workstream-schema.ts`. Key structure:

```jsonc
{
  "schemaVersion": 1,
  "id": "my-workstream",
  "title": "...",
  "status": "active",           // active | blocked | completed
  "nodes": [
    {
      "id": "node-id",
      "type": "task",           // task | research | gate
      "status": "in-progress",  // planned | ready | in-progress | blocked | completed
      "attention": "focus",     // focus | watch | parked
      "dependsOn": ["other-node-id"],
      // ...
    }
  ],
  "repos": [...],
  "checkpoints": [...]
}
```

See `public/example-project.json` for a complete example and `src/workstream-schema.ts` for the full type definitions.
