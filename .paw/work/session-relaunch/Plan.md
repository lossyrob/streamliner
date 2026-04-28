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

- [ ] `terminal-launch` — Create `src/server/terminal-launch.ts`: Windows Terminal detection (`wt.exe` in PATH), command argument builder for WT new-tab and PowerShell fallback, async process spawner returning pid/method. Create `src/server/terminal-launch.test.ts` with unit tests for argument building and detection logic.
- [ ] `relaunch-service` — Create `src/session-registry/relaunch.ts`: `validateSessionForRelaunch()` (checks cwd exists, not archived, has required fields), `buildRelaunchParams()` (extracts cwd/worktree, copilotSessionId, color, title from record), `relaunchSession()` orchestrator. Types: `RelaunchResult`, `RelaunchError`. Create `src/session-registry/relaunch.test.ts` with unit tests using injected terminal-launch dependency.
- [ ] `api-endpoint` — Extend `src/server/routes/sessions.ts` to handle `POST /:id/relaunch` (async handler, loopback-only, delegates to relaunch service, returns structured JSON). Add API tests to `src/session-registry/http-api.test.ts` or `src/server/app.test.ts`.
- [ ] `session-policies-update` — Update `src/components/session-policies.ts`: enhance `buildRestartCommand()` to return a command even without `copilotSessionId` (cwd-only fallback), add `canRelaunch()` eligibility check. Update `src/components/session-policies.test.ts`.
- [ ] `ui-relaunch-button` — Update `src/components/SessionsPage.tsx`: add "Relaunch" button alongside "Copy restart" in both session row and detail sheet, call `POST /api/sessions/:id/relaunch`, show success/failure feedback with toast or inline status. Button disabled for archived/no-cwd sessions.
- [ ] `design-doc-update` — Update `docs/design/session-system.md` with: relaunch API contract (`POST /api/sessions/:id/relaunch`, request/response shapes, error codes), terminal launch behavior and degradation rules, relaunch as a registry operation consuming `cwd`, `copilotSessionId`, `color`, and `title`.

## Key Decisions

1. **Relaunch goes through the local API** (per #17 decision) — the Express server spawns the terminal process, not the browser.
2. **`POST /api/sessions/:id/relaunch`** is the API shape — action-on-resource pattern, consistent with `POST /:id/archive`.
3. **Terminal spawning is a separate module** from relaunch logic — keeps the orchestration testable with injected dependencies.
4. **`buildRestartCommand()` enhanced, not replaced** — cwd-only relaunch is valid (issue spec: "correct cwd beats full resume"). The existing copy-to-clipboard flow also benefits.
5. **Loopback-only enforcement** for relaunch — same as trusted signals, since it spawns local processes.
6. **Windows Terminal detection via `where wt`** — simple PATH check, consistent with local-first philosophy.

## Open Questions

None
