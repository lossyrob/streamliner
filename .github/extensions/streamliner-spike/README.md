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
| Projection | Read-only extension tools and loopback Canvas | App-hosted Streamliner extension surface |

The extension does not read Copilot App SQLite, Rust internals, Zustand state, or
private WebSocket traffic. It does not launch terminals or create worktrees.

## Files

- `extension.mjs` wires globally unique tools and the Canvas.
- `lib/git-artifact-provider.mjs` reads one exact Git revision without checkout.
- `lib/runtime-store.mjs` persists hashed binding tokens and launch state outside
  the repository.
- `lib/orchestration.mjs` prepares and claims bounded Layer 0-3 context.
- `lib/projection.mjs` overlays volatile App bindings on the durable graph.
- `fixtures/artifact-tree/` is the dedicated artifact-ref tree.
- `seed-toy-artifacts.mjs` creates a deterministic local artifact commit/ref
  without changing the source checkout.

## Reproduce

From this repository worktree:

```powershell
node .github\extensions\streamliner-spike\seed-toy-artifacts.mjs refs/heads/streamliner-artifacts-spike
node --test .github\extensions\streamliner-spike\spike.test.mjs
```

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
only to `127.0.0.1` and uses the documented App theme variables.

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
- Canvas verification proves RPC routing and loopback rendering, not pixel-level
  host behavior.

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

Five focused Node tests passed for exact-revision isolation, hashed/idempotent
claims, projection transitions, deterministic LF-canonical artifact seeding,
and fail-closed locking. The repository lint and production build also passed.

## Recommendation

The spike removes the core feasibility uncertainty for local App-owned
worktrees and sessions. Continue the pivot behind a narrow production adapter,
while retaining the documented residual risks as explicit follow-up gates. Do
not migrate remote artifact-branch policy or delete the existing runtime until
session-identity correlation, abandoned-launch recovery, and shared-ref
concurrency have production contracts.
