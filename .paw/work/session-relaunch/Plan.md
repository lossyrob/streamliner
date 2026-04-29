# Plan

## Approach Summary

Issue #29 delivers **session relaunch** — the ability to reopen a tracked session from the Sessions surface after a restart or interruption. The minimum viable outcome restores the builder to the recorded working directory via the local Streamliner API. Copilot CLI resume and Windows Terminal tab color are best-effort enhancements.

**Architecture**: Three new modules plus UI and API wiring:
1. **Terminal launch module** (`src/server/terminal-launch.ts`) — detects Windows Terminal availability, builds spawn arguments, executes child processes. Pure infrastructure, no session awareness.
2. **Relaunch service** (`src/session-registry/relaunch.ts`) — validates a session record for relaunch eligibility, builds relaunch parameters from registry fields, orchestrates the terminal launch, and returns a structured result. Testable without Express or real process spawning.
3. **API route extension** — adds `POST /api/sessions/:id/relaunch` to the sessions router. Loopback-only. Delegates to relaunch service.
4. **UI enhancement** — adds a "Relaunch" button to session rows and detail sheet, calls the API, shows feedback.
5. **session-policies update** — enhance `buildRestartCommand` to support cwd-only relaunch (no copilotSessionId required), add relaunch eligibility helper.

**Degradation rules** (from issue spec):
- No `copilotSessionId` → open terminal at cwd without Copilot resume (still a successful relaunch)
- No Windows Terminal → spawn PowerShell directly
- No `color` or WT unavailable → continue without color
- `cwd` directory missing → fail with clear error
- Session archived → fail with clear error

## Work Items

- [ ] `terminal-launch` — Create `src/server/terminal-launch.ts`: Windows Terminal detection (`wt.exe` in PATH, cached per server lifetime), command argument builder for WT new-tab and PowerShell fallback, async process spawner returning pid/method. Must use `spawn()` with argv array (no `shell: true`), `{ detached: true, stdio: 'ignore' }` + `child.unref()` so terminal outlives server. Validate `color` is valid hex before passing as `--tabColor`, fall back silently on invalid color. Create `src/server/terminal-launch.test.ts` with unit tests for argument building, detection logic, and spawn option assertions.
- [ ] `relaunch-service` — Create `src/session-registry/relaunch.ts`: `validateSessionForRelaunch()` (checks session exists, cwd directory exists, not archived; eligible statuses: active/paused/ended — block only archived; block live sessions with `copilotProcessState === 'live'` to prevent duplicate spawns), `buildRelaunchParams()` (path precedence: `derivedWorktreePath ?? cwd`, plus copilotSessionId, color, title from record), `relaunchSession()` orchestrator with injected terminal-launch dependency. Types: `RelaunchResult` (`{ sessionId, cwd, method, copilotResumed, colorApplied, pid? }`), `RelaunchError` with enumerated codes: `session_not_found | session_archived | session_live | no_cwd | cwd_not_found | spawn_failed`. Relaunch is non-mutating — no registry write, no SSE emission. Create `src/session-registry/relaunch.test.ts`.
- [ ] `api-endpoint` — Extend `src/server/routes/sessions.ts`: register `router.post("/:id/relaunch", ...)` BEFORE the existing `router.use(...)` catch-all middleware. Extend loopback enforcement to cover `/relaunch` (not just `/signals`). Returns structured JSON with `RelaunchResult` on success, `RelaunchError` on failure. Add tests to `src/server/app.test.ts` including loopback rejection test.
- [ ] `session-policies-update` — Update `src/components/session-policies.ts`: keep `buildRestartCommand()` unchanged (still returns null without copilotSessionId — preserves existing copy-to-clipboard UX). Add new `buildRelaunchCommand()` that returns a command for any session with a cwd (cwd-only fallback, no copilotSessionId required). Add `canRelaunch()` eligibility check (mirrors server-side validation: has cwd, not archived, not live). Update `src/components/session-policies.test.ts`.
- [ ] `ui-relaunch-button` — Update `src/components/SessionsPage.tsx`: add "Relaunch" button alongside "Copy restart" in both session row and detail sheet. Call `POST /api/sessions/:id/relaunch`. Button disabled for ineligible sessions (archived/no-cwd/live). In-flight spinner state to prevent double-clicks. Show success feedback distinguishing WT vs PowerShell fallback. Show error feedback with human-readable message from error code. "WT unavailable, opened in PowerShell" is a success with informational note, not a failure.
- [ ] `design-doc-update` — Update `docs/design/session-system.md` with: relaunch API contract (`POST /api/sessions/:id/relaunch`, request/response shapes, enumerated error codes), terminal launch behavior and degradation rules, relaunch as a non-mutating registry operation consuming `derivedWorktreePath ?? cwd`, `copilotSessionId`, `color`, and `title`. Note that Wave 3 launch-from-graph will use a separate `POST /api/sessions/launch` endpoint sharing the `terminal-launch` primitive.

## Key Decisions

1. **Relaunch goes through the local API** (per #17 decision) — the Express server spawns the terminal process, not the browser.
2. **`POST /api/sessions/:id/relaunch`** is the API shape — action-on-resource pattern, consistent with `POST /:id/archive`.
3. **Terminal spawning is a separate module** from relaunch logic — keeps the orchestration testable with injected dependencies. Wave 3 launch-from-graph reuses the same `terminal-launch` primitive via a separate `POST /api/sessions/launch` endpoint.
4. **`buildRestartCommand()` unchanged; new `buildRelaunchCommand()`** — preserves existing copy-to-clipboard UX (null without copilotSessionId). New function supports cwd-only relaunch per issue spec ("correct cwd beats full resume").
5. **Loopback-only enforcement** for relaunch — extends the existing `/signals` guard to also cover `/relaunch`, since both spawn local processes.
6. **Windows Terminal detection via `where wt`, cached per server lifetime** — simple PATH check, avoids per-request latency.
7. **Detached process spawning** — `spawn()` with argv array (no `shell: true`), `{ detached: true, stdio: 'ignore' }` + `child.unref()` so terminals outlive the server process.
8. **Path precedence: `derivedWorktreePath ?? cwd`** — matches existing `buildRestartCommand` behavior.
9. **Relaunch is non-mutating** — no registry write, no SSE emission. Future `lastRelaunchedAt` is a separate concern.
10. **Relaunch eligibility: block archived and live sessions** — archived can't be relaunched (must unarchive first); live sessions block to prevent duplicate spawns. Ended/paused/active are all eligible.

## Open Questions

None
