# Plan

## Approach Summary

Add a process-wide Streamliner coordinator for visible Copilot CLI terminal launches. Keep the existing synchronous `launchTerminal` path for normal terminal starts, and add an async queued launch path that only throttles Streamliner-owned Copilot commands through an explicit opt-in helper rather than command-string sniffing. Route graph node launches, companion/review launches, session relaunch/resume, and managed SDK terminal takeover through that queued path so Copilot process startups cannot overlap. Make the inter-launch cooldown configurable, treat it as a heuristic delay between terminal spawn attempts rather than proof that Copilot is ready, isolate queue failures so one failed launch cannot poison later launches, and test the queue directly plus each affected launch path.

## Work Items

- [x] Add a shared Copilot terminal launch queue in `src/server/terminal-launch.ts` with a small configurable cooldown, per-launch error isolation, and direct pass-through for non-Copilot commands.
- [x] Route Streamliner-owned Copilot launch paths through an explicit queued helper: graph node terminal launch, companion/review launch, session relaunch/resume, and managed SDK terminal takeover.
- [x] Update async caller signatures and test doubles for the queued Copilot helper without changing the synchronous generic terminal adapter API.
- [x] Update and add tests covering queue serialization/cooldown, queue failure recovery, non-Copilot pass-through, affected launch paths, and test isolation/reset behavior.
- [x] Run targeted verification plus repository lint/build checks, then commit the implementation with selective staging.

## Key Decisions

- Preserve `launchTerminal` as a synchronous low-level adapter API so generic non-Copilot terminal launches and existing adapter tests remain simple.
- Treat commands built by Streamliner for `copilot`, including interactive prompt launches and `copilot --resume`, as the serialized surface, and make call sites opt into queueing through a dedicated helper so non-Copilot launches are never delayed by detection heuristics.
- Use a process-wide Promise chain for serialization; wait for the configured cooldown after each terminal spawn attempt returns before allowing the next queued spawn. This is a pragmatic delay between `wt.exe`/PowerShell launches, not a readiness proof that the nested Copilot process has finished initializing shared cache state.
- Contain per-launch errors inside each queued task so a failed spawn rejects only that caller and does not leave the global queue in a permanently rejected state.
- Expose test-only queue reset/configuration seams or injectable queue state so Vitest workers do not inherit pending cooldowns across tests.
- Do not mutate Copilot global configuration or plugin state. The fix is coordination only.

## Open Questions

None.
