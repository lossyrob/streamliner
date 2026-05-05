# PAW Artifact Status Observation Plan

## Approach Summary

Add `pawWorkflow` as a registry workflow-enrichment field that is separate from Copilot liveness and attention. A bounded PAW artifact indexer will discover a likely `.paw/work/<work-id>` directory from launch metadata or local worktree conventions, derive a coarse artifact status from durable files/directories, and report unavailable/ambiguous/unknown-layout diagnostics instead of guessing progress. Freshness will be represented explicitly with a scan timestamp and latest artifact mtime/path summary. The background worker will persist this projection through the existing derived-state patch path, and the Sessions UI/API will expose it so runtime overlay consumers can distinguish workflow enrichment from general session state.

## Work Items

- [x] Define `pawWorkflow` schema, defaults, validation, list/read contracts, and derived-state patch support in the session registry. Treat existing registry entries without the field as backward-compatible `null`/unavailable on read, and carry the field through `session-registry-contract.ts`, `http-api.ts`, and the Express sessions route without changing trusted-signal or builder mutation semantics.
- [x] Implement a bounded PAW artifact indexer with tests for available, unavailable, ambiguous, unknown-layout, and stale-`Control State`-ignored artifact sets. Start with a coarse stage ordering of finalization/review > implementation > planning/research/spec > init, then refine against actual PAW-lite artifacts discovered in this repo.
- [x] Wire PAW artifact indexing into the background worker using launch-claim lineage metadata when available and `.paw/work` discovery as a fallback. For manually tracked rows, walk from `derivedWorktreePath ?? cwd` toward the repo root and inspect `.paw/work/*` candidates, using a single match as linkage and reporting ambiguity instead of choosing between multiple candidates.
- [x] Surface PAW workflow enrichment in My Sessions without changing activity/liveness labels or mutation behavior.
- [x] Supplement existing design documentation with the artifact categories, derived statuses, diagnostic codes, and degraded-state semantics used by the implementation.
- [ ] Run final verification, prepare Docs.md content for the PR description, and create the issue #51 PR through the PAW final-PR path.

## Key Decisions

- `WorkflowContext.md` and `ReviewContext.md` may provide identity hints, but their `## Control State` sections will not drive status.
- Artifact status will be coarse and evidence-oriented: unavailable/ambiguous/unknown-layout states remain explicit diagnostics, not inferred progress.
- The registry stores the latest PAW artifact projection as local runtime state; no telemetry is written back into committed workstream graph files.
- Implementation will be single-threaded because schema, validation, worker wiring, and UI contracts share the same types and tests. The schema and indexer output shape may be iterated together before finalizing validation.

## Open Questions

None.
