# WorkShaping: Show Live GitHub Status

## Problem statement

Streamliner already links workstream nodes to GitHub issues and derives GitHub issue/PR references from session activity, but those links are mostly static labels. Builders managing several nodes and Copilot sessions need lightweight current status cues so they can see which linked issue or PR needs attention without opening every GitHub tab.

## Core value

- Workstream graph users can see whether a node's GitHub issue is open, closed, or has an associated PR needing review/validation.
- Session users can see whether a derived PR is draft/open/merged/closed and can distinguish issue refs from PR refs at a glance.
- GitHub data remains runtime/external information; graph JSON and session registry records keep durable references only.

## Work breakdown

1. Add a small server-side GitHub status snapshot endpoint that accepts issue/PR refs and returns normalized status summaries with bounded caching/error metadata.
2. Feed workstream node GitHub tracker refs into that endpoint and pass the returned issue snapshot into the existing `buildWorkstreamViewModel(workstream, githubSnapshot)` path.
3. Feed session `derivedGithubRefs` into the same status snapshot path and enrich existing GitHub chips in session rows and the session detail sheet.
4. Add tests for snapshot normalization, endpoint behavior, and UI rendering of status cues.

## Scope boundaries

In scope:
- GitHub issues and pull requests on github.com.
- Current state, draft/merged flags, review decision and basic check/validation state when available.
- Lightweight polling/refresh tied to existing graph/session refresh intervals.
- Clear degraded/unknown status when GitHub status cannot be fetched.

Out of scope:
- General tracker abstraction beyond the existing `github` tracker type.
- GitHub project management, review automation, merge actions, or write operations.
- Persisting fetched state into graph JSON or session registry files.
- Redesigning node/session status models.

## Edge cases and expected handling

- Missing GitHub auth or rate limiting: keep links visible and show a muted/unknown/degraded cue rather than blocking graph or session rendering.
- Browser-only graph source: still show static tracker links; live status can be omitted if the backend cannot resolve the graph source.
- Unknown repo for a session ref: do not call GitHub for that ref; keep the existing link fallback behavior when possible.
- Duplicate refs across nodes/sessions: dedupe before fetching so normal polling is responsive.
- PR refs discovered as issue-like URLs or unknown `owner/repo#N`: prefer explicit PR/issue type when known; unknown refs can be status-unknown until resolved.
- Closed issues with non-completed reasons: show closed state but do not treat them as durable completed artifacts beyond existing view-model rules.

## Rough architecture

- Server: add a GitHub status service and route under `/api/github/status` (or equivalent) that batches refs, calls GitHub REST/GraphQL with optional auth from the local environment, normalizes status, and caches short-lived results.
- Client: add a small hook/client module that extracts refs from the current workstream or session list, calls the endpoint, and exposes a lookup map.
- Workstream graph: convert returned issue summaries into the existing `WorkstreamGithubSnapshot` shape so current `WorkstreamDerivedNode.githubIssue`, `activePullRequest`, runtime overlay tracker summary, and PR-count badge can be reused.
- Sessions: keep existing derived refs as durable references and decorate `GithubRefChip` with live status labels/classes from the lookup map.

## Codebase fit

- `workstream-schema.ts` already defines `WorkstreamGithubIssueSnapshot` and `WorkstreamGithubPullRequestSnapshot`.
- `workstream-view-model.ts` already derives operational status from a GitHub snapshot, but `App.tsx` currently calls `buildWorkstreamViewModel(workstream)` without one.
- `workstream-runtime-overlay.ts`, `WorkstreamGraphNode.tsx`, and `NodeInspector.tsx` already have tracker snapshot display paths that can become more useful once live snapshots are supplied.
- `SessionsPage.tsx` already derives GitHub ref chips from `SessionRegistryListItem.derivedGithubRefs`; those chips are the natural surface for PR/issue status labels.
- `session-context-indexer.ts` already extracts GitHub refs from session events, so this work should not change registry schema or indexing semantics.

## Risks and gotchas

- GitHub rate limits: batch and cache refs; never fetch per chip or per render.
- Type ambiguity: issue and PR numbers share namespaces in GitHub, so explicit PR refs should query PR fields; issue refs should query issue fields and optionally linked PRs where feasible.
- UI density: node cards and session rows are already chip-heavy; prefer short labels like `issue open`, `PR draft`, `PR merged`, `checks pending`.
- Failure mode: status fetching must not make dashboard loads fail; surface fetch errors as status metadata while preserving current static links.
- Test stability: avoid live GitHub calls in tests; inject/mock fetch behavior at the service boundary.

## Open questions for downstream planning

- Use REST endpoints with multiple per-ref requests behind a server-side cache, or a single GraphQL batch query per request.
- Whether session unknown refs should be resolved by querying GitHub issue first and PR second, or left unknown to avoid extra calls.
- Exact UI label taxonomy for review decision and validation state.

## Session notes

- User explicitly requested PAW Lite with work shaping first, worktree execution, `final-pr-only` human review policy, single-model Opus 4.7 planning review, multi-model GPT 5.5 + Opus 4.7 final review, and `commit-and-clean`.
- No additional user Q&A was needed because issue #69 defines desired behavior and non-goals clearly enough for an issue-sized implementation.
