# Streamliner App-native spike

This project-scoped Copilot extension is a vertical slice for evaluating an
App-native Streamliner runtime. Copilot App owns local worktrees, sessions,
parent/child relationships, resume, and messaging. Streamliner owns committed
workstream artifacts, exact-revision context preparation, and a replaceable
runtime binding projection.

This is spike evidence, not a settled design decision.

## Boundary

| Boundary | Spike implementation | Production direction |
|---|---|---|
| Durable workstream | Git `graph.json`, `brief.md`, and local task specs | Dedicated shared `streamliner-artifacts` ref/branch |
| Artifact read | `git rev-parse` once, then `git cat-file` by commit | Narrow `ArtifactRevisionProvider` interface |
| Runtime binding | Locked atomic JSON under the user's Copilot home | Versioned Streamliner-owned local provider |
| Session lifecycle | Native App `create_session` and `send_session_message` | App API only |
| Projection | Read-only extension tools and bundled React Flow loopback Canvas | App-hosted Streamliner extension surface |

The extension does not read Copilot App SQLite, Rust internals, Zustand state, or
private WebSocket traffic. It does not launch terminals or create worktrees.

## Files

- `extension.mjs` wires globally unique tools and the Canvas.
- `lib/git-artifact-provider.mjs` reads one exact Git revision without checkout.
- `lib/runtime-store.mjs` persists hashed binding tokens and launch state outside
  the repository.
- `lib/orchestration.mjs` prepares and claims bounded Layer 0-3 context.
- `lib/projection.mjs` overlays volatile App bindings on the durable graph.
- `ui/src/projection-adapter.mjs` converts that projection to read-only React
  Flow nodes, dependency edges, and deterministic Dagre positions.
- `ui/src/main.jsx` and `ui/src/styles.css` own the responsive Canvas UI and
  selected-node inspector.
- `lib/portfolio-projection.mjs` resolves one portfolio manifest and every
  referenced workstream graph from the same Git commit before applying local
  launch overlays.
- `portfolio-ui/` adapts the semantic-zoom portfolio prototype into the second
  bundled Canvas.
- `build-ui.mjs` reproducibly bundles the browser UI into versioned
  `assets/react-flow-v1/` files served by `lib/renderer.mjs`.
- `fixtures/artifact-tree/` is the dedicated artifact-ref tree.
- `seed-toy-artifacts.mjs` creates a deterministic local artifact commit/ref
  without changing the source checkout.

## Reproduce

From this repository worktree:

```powershell
npm ci
npm run build:streamliner-spike
node .github\extensions\streamliner-spike\seed-toy-artifacts.mjs refs/heads/streamliner-artifacts-spike
node --test .github\extensions\streamliner-spike\spike.node-test.mjs
```

The generated browser bundle is committed so a fresh checkout can load the
project extension immediately. Run `npm run build:streamliner-spike` after any
UI-source change; the build empties and recreates only the versioned asset
directory. Two consecutive builds must produce identical files and hashes.

Reload project extensions, then call
`streamliner_spike_prepare_launch` with:

```json
{
  "revision": "refs/heads/streamliner-artifacts-spike",
  "nodeId": "app-native-implementation",
  "workstreamPath": ".streamliner/workstreams/app-native-spike"
}
```

The orchestrator passes the returned token to native `create_session`. The child
must call `streamliner_spike_claim_launch` in that same App-created session,
perform the bounded task, call `streamliner_spike_complete_launch`, and report
with native `send_session_message`.

Open canvas `streamliner-spike-workstream` with the resolved artifact commit (or
the local ref) and invoke `get_projection` or `refresh`. The iframe server binds
only to `127.0.0.1`, serves no CDN content, and uses the documented App theme
variables and attributes.

Open `streamliner-spike-portfolio` with the same `repoPath` and revision plus
`"portfolioPath": ".streamliner/portfolio.json"`. Its actions are
`get_portfolio_projection` and `refresh_portfolio`; the equivalent extension
tool is `streamliner_spike_inspect_portfolio`.

## Portfolio Canvas

The deterministic artifact tree now includes `.streamliner/portfolio.json` and
three workstreams: Artifact foundation, App-native Streamliner spike, and
Portfolio experience. Seven waves export seven public checkpoints. Three
cross-workstream dependencies use validated, branch-local, and proposed
availability states with explicit risk and operator action. Portfolio artifacts
are read from one exact commit; completed and prepared launch records remain in
the local runtime store.

The Canvas reuses the strongest concepts from
`.streamliner/shaping/spikes/work-geometry-canvas/semantic-zoom-flow/` and
`PORTFOLIO-LAYER.md`:

- project overview above autonomous workstream columns
- waves as the public checkpoint boundary
- summary/detail semantic zoom
- checkpoint-to-checkpoint cross-workstream edges
- selection-driven risk and action inspection

The production extension adapts those concepts rather than copying the
prototype. It reads the committed manifest instead of static TypeScript data,
uses only documented App theme tokens, overlays real local launch records, and
shares the extension's versioned loopback asset server. The UI adds selectable
workstreams, waves, tasks, and dependency edges; dependency-path focus;
summary/detail controls; fit/reset controls; focus-only and dependency-state
filters; and risk, action, availability, completion, and runtime inspection.

Panels at 760 pixels or narrower deliberately switch from full React Flow
geometry to a scrollable workstream/checkpoint/task list with the same
selection, filters, semantic detail, dependency contracts, and inspector. This
avoids reducing the portfolio to unreadable miniature text.

## Durable portfolio positions

Wide Portfolio Canvas waves are draggable, including Shift multi-selection
drag. Routine layout is local operator state, stored outside the repository at:

```text
~/.copilot/extensions/streamliner-spike/artifacts/portfolio-positions/
  {repositoryKey}/{projectId}--{portfolioId}--{domainHash}.json
```

The schema-versioned document is keyed by stable repository/project/portfolio
identity and deliberately excludes artifact revision and Canvas `instanceId`.
It also carries a monotonic `revision` plus a reset `generation`. Every partial
PATCH includes its generation. Reset atomically replaces the overlay with an
empty document and increments generation; queued pre-reset saves receive HTTP
409 with the current snapshot instead of resurrecting old pins.
Its `positions` map accepts only:

- `wave:<workstreamId>:<waveId>` exact checkpoint pins
- `ws:<workstreamId>` workstream top-left anchors

Layout applies in three stages: compute current auto-layout, translate every
workstream to its saved anchor, then apply exact wave pins. A newly reconciled
wave therefore remains near its workstream even when it has no exact pin.
Header/decorative nodes are never persisted independently.

The loopback server exposes domain-scoped `GET`, partial `PATCH { upsert,
remove }`, and sendBeacon-compatible `POST ...?method=patch` routes at
`/api/portfolio/positions`. IDs and finite coordinates are validated. Each
partial update takes the extracted extension file lock, reads current state,
merges only touched IDs, and atomically renames a temporary file. The browser
debounces and serializes routine saves, preserves unacknowledged FIFO
operations, retries failed diffs with bounded backoff, flushes their merged
latest-state diff on unload best-effort, resynchronizes when SSE connects, and
ignores stale snapshots by revision/generation. It displays
pending/saving/saved/error state with exact pin count.

`get_portfolio_positions` and `reset_portfolio_positions` are safe Canvas
actions scoped to the already-open portfolio. The UI can unpin selected waves
or reset the entire local layout. Narrow mode is read-only and explains that
saved wide geometry will return when the panel widens.

Routine drag state never writes to `streamliner-artifacts`. A future explicit
**publish layout** operation could review selected local pins and promote a
shared baseline; implicit drag saves must remain local.

## React Flow Canvas boundary

The Canvas reuses the repository's installed React, `@xyflow/react`, and Dagre
packages. It adapts the dashboard's proven UX concepts: top-to-bottom dependency
flow, status-bearing cards, fit-to-view, pan/zoom controls, minimap, and a
persistent selected-node inspector.

The extension does not import `WorkstreamCanvas`, `WorkstreamGraphNode`, the
dashboard theme sheet, router, registry clients, or dashboard view models. Its
browser bundle is a new narrow adapter over `/api/projection`, because those
dashboard components depend on richer application-only state. Current parity is
therefore limited to the small toy graph and runtime-binding fields exposed by
the spike projection.

The graph is intentionally read-only: node dragging, edge creation, graph
editing, and artifact writes are disabled. The layout refits when the Canvas
panel is resized; narrow panels move selected-node detail below the graph and
hide the minimap.

## Visual verification

Use the repository screenshot harness as the dashboard reference:

```powershell
node scripts\screenshot.mjs `
  --graph .streamliner\workstreams\session-launching-and-tracking\graph.json `
  --out .screenshots\after-app-native-react-flow.png `
  --viewport 1600x1000
```

After opening the extension Canvas, use Playwright against its returned
`http://127.0.0.1:<port>/` URL. Wait for `.react-flow__node`, capture a wide
unselected state, click
`[data-id="builder-acceptance-gate"]` for selected-node detail, then repeat at a
`520x900` viewport. Screenshots are local evidence under `.screenshots/` and are
never committed.

## State and security properties

- Graph, brief, task, and launch provenance carry the same resolved 40-character
  artifact commit and source hashes.
- Context markdown is capped at 12,000 characters with per-source truncation
  evidence.
- The raw binding token is returned once and never written to disk; only its
  SHA-256 hash is stored.
- Claims are atomic, one-child-only, and idempotent for the claiming SDK session.
- Runtime records are keyed by repository, workstream, revision, node, and launch;
  canvas `instanceId` owns only an ephemeral renderer server.
- Runtime state defaults to
  `~/.copilot/extensions/streamliner-spike/artifacts/runtime-v1.json`.

## Limits

- The extension SDK exposes the claiming Copilot runtime session id, but this
  spike has no documented field that proves its mapping to the App
  project-session id.
- Prepared-launch expiry, cancellation, garbage collection, token rotation,
  schema migration, and recovery UI are intentionally omitted. The state writer
  fails closed on an abandoned lock; cleanup requires confirming no extension
  process still owns the exact `.lock` file before removing it.
- Git artifact commits are local-only for the exercise; remote branch policy,
  synchronization, authorization, and concurrent artifact writers remain open.
- The graph is read-only and supports only local task trackers in prepared
  context.
- The Canvas does not yet reproduce checkpoint swimlanes, external dependency
  ghosts, rich tracker/session status, dashboard navigation, saved node
  positions, or editable graph operations.
- Direct Playwright capture verifies the loopback document at representative
  panel sizes. It does not prove pixel identity inside every App host theme.
- Portfolio geometry is a project view, not a full startup Home: environment
  sessions, ad-hoc session attachment, campaigns, cross-project aggregation,
  persisted operator layout, and mutation/control flows remain out of scope.
- Repeated provider reloads exposed a host/runtime rehydration uncertainty: the
  chat's Canvas context continued to list old loopback ports after those servers
  had stopped. Provider discovery, Canvas actions, and explicit re-open of the
  same instance remained healthy and immediately returned new reachable ports.
  Production should add a rehydration watchdog/health signal so stale renderer
  URL metadata cannot look like a hanging agent task.

## Evidence

Exercised on 2026-08-20:

| Check | Result |
|---|---|
| Extension commit | `0450d4b6c9c86326192686b602c80707a41d5601` |
| Local artifact ref | `refs/heads/streamliner-artifacts-spike` |
| Exact artifact revision | `fefc3cf54f142054c1ec4c95080bb425d301f415` |
| Prepared launch | `launch-74469c66-61c0-4e2d-8a9f-77c3b0fbaf60` |
| Context digest | `d8d0c54e447c905c57561b1d83b5769a8b576a357a9dd791a058bb64bcd1a4ff` |
| App child project-session | `a40e7eeb-dddf-4930-b1fd-f7719496c4e3` |
| Child SDK session | `db5b4225-672c-48da-8723-5321fc4392e8` |
| Child branch | `lossyrob-app-native-claim-proof` |
| Child proof commit | `e66c029393b84dd1e890bf38722eababe35e19d5` |

The orchestrator prepared a 3,691-character Layer 0-3 context with no
truncation, then called native App `create_session` with only the capability
token. The cold child loaded the project extension, claimed the token on its
first task action, received the exact graph/brief/task source manifest, committed
`spike-proof/app-native-child.md`, called the completion tool, and reported back
through native `send_session_message`. The persisted projection moved
`app-native-implementation` from `launch-prepared` through `session-claimed` to
`runtime-completed`, which made `builder-acceptance-gate` operationally
`gate-ready`. A native follow-up message confirmed child HEAD
`e66c029393b84dd1e890bf38722eababe35e19d5` on
`lossyrob-app-native-claim-proof` with a clean worktree.

Canvas discovery returned both `get_projection` and `refresh`. The first open of
instance `streamliner-spike-proof` served a themed page from
`http://127.0.0.1:56038/`; `/health`, `/`, and `/api/projection` returned
success, and the document used the App theme contract. Input-schema and reserved
action validation rejected the expected invalid calls. After
`extensions_reload`, the same instance rehydrated at
`http://127.0.0.1:54344/`; the old server was unreachable, the new server was
healthy, and refresh showed the completed binding and ready gate.

The React Flow enhancement was then exercised on the same Canvas instance. It
opened at `http://127.0.0.1:60459/` and rehydrated after provider reload at
`http://127.0.0.1:62512/`; the old server stopped, `/health` reported
`react-flow-v1`, and both Canvas actions retained the completed binding.
Playwright captures at `1320x860` and `520x900` confirmed fit-to-view, dependency
edges, controls, minimap behavior, selected gate detail, and resize refitting.
The narrow unselected state gives the full height to the graph, while selection
moves detail below it. Before/after `scripts/screenshot.mjs` captures of the
representative dashboard graph showed no dashboard visual change.

Seven focused Node tests cover exact-revision isolation, hashed/idempotent
claims, projection transitions, deterministic LF-canonical artifact seeding,
fail-closed locking, projection-to-React-Flow adaptation, and versioned renderer
asset/API behavior. The repository lint and production build also pass.
The targeted existing `WorkstreamCanvas` suite passes (3 tests). A repository
wide run reached 847 passing tests; 12 unrelated Windows Git/registry tests
timed out or hit an advisory-lock `EPERM`, so full-suite baseline stability
remains outside this UI spike.

The portfolio artifact ref resolves to
`3fb5fa4e7258250a06a958656f1e420b135a7275`. Its projection contains three
workstreams, seven waves/checkpoints, three dependency states, and three runtime
bindings (one completed and two prepared). Summary/detail, workstream, wave,
task, dependency-focus, focus-only, dependency-state filter, and deliberate
narrow-list states were captured with Playwright and inspected. After reload,
portfolio instance `streamliner-portfolio-proof` rehydrated from port 57620 to
63439 while the old server stopped; the existing workstream Canvas opened
independently on port 63464 at the same exact revision. Both action pairs
returned the expected runtime overlays, and portfolio input/reserved-action
validation failed closed.

Durable positioning was exercised on the real Canvas. A single App-native wave
drag and a Shift multi-drag of two Artifact foundation waves produced three
exact pins and two `ws:` anchors in the local positions file. The same pins
survived page reload, extension process reload, the same Canvas instance,
different instance IDs, and artifact advancement from `3fb5fa4e...` through
`a6e8c037...` to `dbfa5d24...`. The final revision added new checkpoint waves
without changing existing stable IDs; the unpinned
`wave:artifact-foundation:layout-reconciliation` inherited x `224.674` from
`ws:artifact-foundation`, while exact pins retained precedence. UI unpin removed
the App-native exact pin and its now-unused anchor; the reset Canvas action then
removed the remaining three entries atomically.

The session task tracker briefly showed `Capturing position baseline` as
`in_progress` long after the screenshot command had completed. No PowerShell or
background process was running; the SQL todo status simply had not been advanced
during implementation. That bookkeeping error was corrected separately from the
Canvas diagnosis. At the same time, six loopback URLs supplied by stale Canvas
context all timed out, while the extension provider was ready and RPC actions
worked. Explicitly re-opening the same portfolio instances returned healthy
`portfolio-v1` URLs on ports 55730 and 63109. This distinguishes stale host URL
metadata from extension/session RPC connectivity.

The reset race was exercised with two independent portfolio servers. Instance A
read generation 0, instance B reset to revision 1 / generation 1, and instance A
then submitted its queued generation-0 PATCH. The server returned HTTP 409 with
the current empty snapshot; both instances reported generation 1 with zero
pins. Same-process instances receive immediate position/reset SSE broadcasts.
Separate extension processes do not share an SSE bus; their next
generation-guarded PATCH or reconnect GET performs reconciliation.

The final live concurrency pass added conditional base revisions and durable
mutation IDs. Instance A committed revision 2; instance B's stale base revision
received 409, rebased, and committed revision 3. Retrying A's mutation returned
`duplicate: true` and preserved B's newer coordinate. Reset advanced generation
to 2, and B's queued generation-1 mutation then received a generation conflict;
the final overlay remained empty. This covers lost-response retry, concurrent
rebase, and cross-instance reset without last-writer resurrection.

## Recommendation

The spike removes the core feasibility uncertainty for local App-owned
worktrees and sessions. Continue the pivot behind a narrow production adapter,
while retaining the documented residual risks as explicit follow-up gates. Do
not migrate remote artifact-branch policy or delete the existing runtime until
session-identity correlation, abandoned-launch recovery, and shared-ref
concurrency have production contracts.
