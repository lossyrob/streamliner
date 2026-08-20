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

The exercised commit, nested App session, Canvas lifecycle results, and residual
risks are recorded here after the end-to-end run.
