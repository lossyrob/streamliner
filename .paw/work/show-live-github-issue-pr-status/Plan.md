# Plan: Show Live GitHub Status

## Problem and approach

Streamliner already stores durable GitHub references for workstream nodes and derives GitHub issue/PR refs from session activity, but the dashboard only renders those refs as static links. Add live, runtime-only GitHub status snapshots by batching refs through the local API, normalizing the results into shared client/server contract types, and decorating the existing graph, inspector, runtime overlay, session row, and session detail surfaces.

Use a server-side GitHub status service instead of browser-direct GitHub calls so status fetching can be cached, deduplicated, auth-aware through local environment variables, and tested without live network access. Keep graph JSON and session registry schemas unchanged.

## Work items

### 1. GitHub status API and normalization

- Add shared status contract types for issue/PR refs and normalized results.
- Add a server status service that:
  - accepts deduped issue/PR refs,
  - fetches current GitHub REST status with optional `GITHUB_TOKEN`/`GH_TOKEN`,
  - caches results for a short TTL,
  - returns per-ref success/error metadata without failing the whole batch.
- Add a GET route under `/api/github/status` with repeated `ref` query params so readonly previews can fetch status.
- Mount the route in `createStreamlinerApiApp`.

### 2. Client status loading and workstream integration

- Add a client helper/hook that extracts refs, builds the status URL, fetches status, and exposes a lookup map.
- In `App.tsx`, extract GitHub tracker refs from the active workstream and fetch live issue status.
- Convert issue results into `WorkstreamGithubSnapshot` and pass it to `buildWorkstreamViewModel(workstream, githubSnapshot)`.
- Preserve current behavior when status loading fails by showing existing static links and letting runtime overlay report missing/degraded status.

### 3. Session GitHub status cues

- Extract refs from visible/session-loaded `derivedGithubRefs` and fetch their live status in `SessionsPage`.
- Decorate `GithubRefChip` labels/titles/classes with concise runtime status cues (`issue open`, `issue closed`, `PR draft`, `PR merged`, `PR checks pending`, etc.).
- Show enriched refs consistently in session rows and the session detail sheet, while preserving existing links and fallbacks.

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
- REST is sufficient for the first issue-sized pass. It provides issue state, PR state/draft/merged status, and stable URLs; richer review/check semantics can be improved later.
- Use short-lived server caching and request dedupe to keep polling lightweight.
- Use GET rather than POST for the batch endpoint so readonly preview mode can still show live status.

## Considerations

- Unknown refs without an owner/repo are not fetched; their existing static chip behavior remains unchanged.
- Fetch errors should be visible as muted/degraded status on the affected refs, not as fatal page errors.
- If a GitHub issue API response is actually a PR, normalize it as PR status for PR refs and as issue status for issue refs only when the caller requested issue status.
- Keep UI labels compact to avoid overcrowding graph node cards and session rows.
