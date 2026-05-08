# Plan: Show Live GitHub Status

## Problem and approach

Streamliner already stores durable GitHub references for workstream nodes and derives GitHub issue/PR refs from session activity, but the dashboard only renders those refs as static links. Add live, runtime-only GitHub status snapshots by batching refs through the local API, normalizing the results into shared client/server contract types, and decorating the existing graph, inspector, runtime overlay, session row, and session detail surfaces.

Use a server-side GitHub status service instead of browser-direct GitHub calls so status fetching can be cached, deduplicated, auth-aware through local environment variables, and tested without live network access. Keep graph JSON and session registry schemas unchanged.

## Work items

### 1. GitHub status API and normalization

- Add shared status contract types for issue/PR refs and normalized results.
- Add a server status service that:
  - canonicalizes and dedupes refs by `(type, owner, repo, number)` before fetching,
  - fetches current GitHub REST status with optional `GITHUB_TOKEN`/`GH_TOKEN`,
  - caches positive results for an initial short TTL around one minute and caches negative/rate-limit results briefly so polling does not hammer GitHub,
  - detects rate-limit responses (`429` or `403` with exhausted GitHub rate-limit headers) and returns normalized degraded/rate-limited status without failing the whole batch,
  - returns per-ref success/error metadata without failing the whole batch,
  - logs batch size, cache-hit count, and rate-limit/error responses under a `github-status` API log scope.
- Add a GET route under `/api/github/status` with repeated `ref` query params so readonly previews can fetch status.
- Mount the route in `createStreamlinerApiApp`.

### 2. Client status loading and workstream integration

- Add a client helper/hook that extracts refs, builds the status URL, fetches status, and exposes a lookup map.
- In `App.tsx`, extract GitHub tracker refs from the active workstream and fetch live issue status.
- Convert issue results into `WorkstreamGithubSnapshot` and pass it to `buildWorkstreamViewModel(workstream, githubSnapshot)`.
- Preserve current behavior when status loading fails by showing existing static links and letting runtime overlay report missing/degraded status.
- For browser-sourced workstreams, use client-extracted refs against the status endpoint when available; if the local API is unavailable, omit live status and keep static links.
- Tie status refresh to existing workstream reload/focus polling triggers rather than adding an independent high-frequency timer.

### 3. Session GitHub status cues

- Extract refs from visible/session-loaded `derivedGithubRefs` and fetch their live status in `SessionsPage`.
- Decorate `GithubRefChip` labels/titles/classes with concise runtime status cues (`issue open`, `issue closed`, `PR draft`, `PR merged`, `PR checks pending`, etc.).
- Show enriched refs consistently in session rows and the session detail sheet, while preserving existing links and fallbacks.
- Rerun status loading when the session list updates through existing polling/SSE refresh paths.

### 4. Tests and UI verification

- Add unit tests for server ref parsing, fetch normalization, cache/error behavior, and route responses.
- Add UI tests for:
  - a workstream node showing live issue status in graph/inspector surfaces,
  - a session row/detail sheet showing live PR status cues,
  - graceful fallback when status fetch fails.
- Run targeted tests plus repo build/lint as appropriate.
- Capture at least one representative before/after screenshot using `scripts/screenshot.mjs` because dashboard rendering changes.

## Key decisions

- GitHub status is runtime-only and never written into graph JSON or session registry files.
- REST is the v1 answer to the WorkShaping REST-vs-GraphQL question. It is sufficient for issue state, PR state/draft/merged status, and stable URLs; server-side dedupe, caching, and rate-limit handling mitigate the per-ref request cost, and richer review/check semantics can be improved later.
- Use short-lived server caching and request dedupe to keep polling lightweight.
- Use GET rather than POST for the batch endpoint so readonly preview mode can still show live status.
- Use compact v1 UI labels: `issue open`, `issue closed`, `issue unknown`, `PR draft`, `PR open`, `PR merged`, `PR closed`, `PR checks pending`, `PR checks failing`, and `PR checks passing`.

## Considerations

- Unknown refs without an owner/repo are not fetched; their existing static chip behavior remains unchanged.
- Refs with owner/repo but `unknown` type are not double-fetched in v1; keep their existing link behavior and show status unknown unless later extraction resolves the type.
- Fetch errors should be visible as muted/degraded status on the affected refs, not as fatal page errors.
- If a GitHub issue API response is actually a PR, normalize it as PR status for PR refs and as issue status for issue refs only when the caller requested issue status.
- Keep UI labels compact to avoid overcrowding graph node cards and session rows.
- Before implementing normalization, verify the exact field compatibility of `WorkstreamGithubSnapshot`, `WorkstreamGithubIssueSnapshot`, `WorkstreamGithubPullRequestSnapshot`, `buildWorkstreamViewModel(workstream, githubSnapshot)`, runtime overlay tracker fields, and `SessionsPage` GitHub chip props.
