# Runtime Overlay Polish Plan

## Approach Summary

Complete PR #71 as a compatibility-preserving closeout for the terminal launch portability seam and related launch/runtime polish. The implementation should keep existing Windows launch contracts stable, isolate Windows-specific terminal behavior behind an adapter boundary, demote missing tracker snapshots to informational metadata, and make PAW prompt profiles available before the launch dialog is blocked by slower launch-state lookups.

The branch already contains the main implementation. This PAW-lite pass will validate that implementation against the shaped scope, fill missing workflow artifacts, run the configured planning and final reviews, address any findings, and hand the existing PR through the final PR process using commit-and-clean artifact handling.

## Work Items

- `lite:terminal-launch-portability-seam:work:terminal-adapter-seam` - Validate the terminal launch adapter seam, request normalization, Windows adapter behavior, PowerShell fallback, and tests.
- `lite:terminal-launch-portability-seam:work:shared-resume-command` - Validate shared Copilot resume command construction and its relaunch / `session-policies` restart/copy call sites.
- `lite:terminal-launch-portability-seam:work:tracker-linked-metadata` - Validate runtime overlay and inspector behavior for GitHub tracker references without loaded snapshots, with `src\workstream-runtime-overlay.test.ts` as the primary regression target.
- `lite:terminal-launch-portability-seam:work:prompt-profile-prefetch` - Validate launch prompt profile prefetching, cache merge behavior, dialog prop wiring, and regression coverage.
- `lite:terminal-launch-portability-seam:work:docs-and-verification` - Validate design documentation updates and run the focused tests, lint, build, docs build, diff check, and screenshot capture expected for this UI/design-touching PR.

## Key Decisions

- Keep public compatibility values unchanged. Internal names can clarify host preference and adapter request responsibilities, but API/config/persisted values remain stable.
- Keep Windows as the only implemented terminal adapter. Do not claim macOS/Linux support in UI or contracts.
- Treat launch claims, node launch records, registry binding, graph handoff parsing, and relaunch validation as Streamliner product responsibilities outside the terminal adapter.
- Treat terminal host selection, shell command quoting, script generation, and spawn method mapping as adapter responsibilities.
- Move PAW prompt profile fetch/cache ownership to `App`, while keeping `PawLaunchDialog` focused on editing, applying, saving, and rendering profile state.
- Record missing GitHub tracker snapshots as informational issues with no readiness impact.

## Verification Plan

Run focused regression tests for the touched areas:

```powershell
npm test -- src\App.test.tsx src\workstream-runtime-overlay.test.ts src\server\terminal-launch.test.ts src\session-registry\relaunch.test.ts src\components\session-policies.test.ts src\server\node-launch.test.ts src\server\launch-preparation.test.ts src\server\app.test.ts
```

Run repository-wide quality gates:

```powershell
npm run lint
npm run build
npm run docs:build
git diff --check
```

Because the implementation touches rendered UI, capture a representative dashboard screenshot with:

```powershell
node scripts\screenshot.mjs --graph C:\Users\robemanuele\proj\streamliner\streamliner-runtime-overlay-polish\.streamliner\workstreams\session-launching-and-tracking\graph.json --out .screenshots\after-runtime-overlay-polish.png --viewport 1800x1200
```

The screenshot capture is a repository UI quality gate from the iterative-ui workflow rather than a separate shaped product requirement.

## Notes and Considerations

- The main checkout is dirty and behind origin/main; all workflow mutations must stay in the dedicated PR worktree.
- PR #71 already exists from `feature/runtime-overlay-polish` to `main`; final PR handling should update that PR rather than creating a duplicate.
- Artifact lifecycle is `commit-and-clean`, so PAW artifacts can be committed during the workflow and cleaned by the final PR stage if required.
- `CodeResearch.md` was created for the original terminal-launch portability seam and is intentionally deepest on that surface. This PAW-lite validation pass treats the existing PR diff on `feature/runtime-overlay-polish` as the de facto baseline for the related shared-resume-command, tracker-linked-metadata, and prompt-profile-prefetch polish items.
