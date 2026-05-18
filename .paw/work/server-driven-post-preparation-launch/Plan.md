# Plan

## Approach Summary

Move terminal and PAW Review companion launch intent into the launch-preparation request so the server can run the same launch actions after preparation succeeds, without requiring the browser tab to receive and process the `completed` SSE event. Keep the existing manual launch routes as thin wrappers around reusable internal helpers, preserve managed-SDK behavior, and make the client fall back to existing client-driven launch only when a completed preparation does not already include server-side launch results.

The server-side run should persist launch intent when the run starts, execute post-preparation work after the handoff is persisted, emit terminal/companion SSE events after their corresponding operation-record updates are durable, and emit `completed` last with an additive snapshot of the final post-preparation outcome. Reattaching clients can rely on existing buffered event replay when available, on the completed/record snapshot after refresh, and on the durable node-launch operation record when the in-memory run snapshot is gone after an API restart.

## Work Items

- [x] **Extract launch helpers**: Export typed internal helpers from `src/server/routes/node-launches.ts` and `src/server/routes/companion-terminal-launches.ts` so HTTP routes and launch-preparation orchestration share the same validation, launch, record-store, and error-mapping behavior. Helpers should accept typed launch inputs and return the route response shape; routes remain responsible for HTTP parsing and loopback enforcement.
- [x] **Persist and execute post-preparation intent**: Add strict `postPreparation` request parsing to `src/server/routes/launch-preparations.ts` so malformed intent rejects the submit. Persist intent on the operation when the run starts, run terminal launch after successful preparation when requested, run companion launch only after terminal success, persist operation results/failures before emitting events, and emit `terminal_launched`, `terminal_failed`, `companion_launched`, and `companion_failed` SSE events with route-response-shaped payloads plus the current operation snapshot.
- [x] **Extend launch operation data shape**: Add post-preparation intent/result fields, including companion launch result/error fields, to the node launch operation contract and record store normalization/update paths so historical dialog state can show server-side terminal and companion outcomes after reattach or refresh.
- [x] **Extend run completion payload**: Extend the launch-preparation run event-name union with the four post-preparation event names and make the `completed` SSE event plus `GET /api/launch-preparations/runs/:runId` snapshot include an additive `postPreparation` outcome/operation snapshot instead of overloading the handoff `result`. The snapshot should distinguish terminal success/error and companion success/error.
- [x] **Update client launch flow**: Send resolved `postPreparation` intent from `src/App.tsx` when `launchAfterInit` and/or review companion are selected. Resolve workstream defaults and review prompt templates in the existing dialog path before submit so `launchTerminal` contains kickoff/title/color values and `launchCompanion` contains the rendered kickoff prompt. Consume new SSE events and completed payload results, avoid double-launching when the server already launched, and preserve manual/managed launch behavior.
- [x] **Cover behavior with tests**: Add or update server and client tests for server-driven terminal+companion launch, terminal failure skipping companion, companion failure after terminal success, no post-prep action on preparation failure, SSE event payloads, completed/snapshot reattach behavior, workstream defaults flowing into `postPreparation`, concurrent distinct-node post-prep launches, and existing manual/managed launch paths.
- [x] **Add diagnostic logging**: Log post-preparation terminal/companion launch attempts and outcomes with run id, graph path, node id, and operation status so closed-tab/background failures are diagnosable from API logs.

## Key Decisions

- Server-side post-preparation launch applies only to terminal CLI handoffs. Managed SDK handoffs remain server-driven through the existing managed launch flow and must not be routed through terminal post-preparation intent.
- Companion launch is dependent on terminal launch success. If terminal launch fails, no companion attempt is made.
- If terminal launch succeeds but companion launch fails, the preparation run remains successful and the operation remains terminal-launched with a companion error recorded; the worker terminal must not be treated as failed because the review companion failed.
- Terminal launch failure after preparation success records `terminal_failed`; the run's preparation result remains available in the completed payload together with the terminal error outcome.
- Post-preparation SSE ordering is: persist operation update, emit terminal/companion event, then emit `completed` after all requested post-preparation work has either succeeded or reached its terminal failure outcome.
- The completed run payload should include persisted operation data/results so reattached clients can render final state without issuing launch requests.
- When no `postPreparation` intent is submitted, `completed` keeps its current semantics and fires immediately after preparation succeeds. When post-preparation intent is submitted, `completed` is deliberately delayed until requested post-preparation work settles.
- Prevent double launches by treating prepared operations with pending post-preparation terminal intent as active for duplicate-launch checks, without blocking ordinary prepared/no-intent manual launches. The server-side path should also transition the operation to `launching` before spawning the terminal.
- Failure event payloads should carry the same error envelope the route/helper would return (`code` when available, `error`, optional `details`/claim information) plus the current operation snapshot.
- Existing `/api/node-launches` and `/api/companion-terminal-launches` routes remain available and continue enforcing loopback checks for manual launch requests.

## Open Questions

None.
