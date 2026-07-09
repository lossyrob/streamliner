# Workstream Change Events

Workstream pages subscribe to `/api/workstreams/events` while visible. The stream uses server-sent events (SSE) so graph refreshes are driven by API-side file change detection instead of each tab polling `/api/workstreams/<projectKey>/<workstreamId>/graph` every few seconds.

## Event stream

The stream sends:

| Event | Meaning |
| --- | --- |
| `snapshot` | Initial or replay-fallback registry snapshot. Clients should refresh registry state if they were already loaded. |
| `workstream.graph.changed` | A known graph file changed. Payload includes `projectKey`, `workstreamId`, `path`, and when available `lastModified` and `mtimeMs`. |
| `workstream.registry.changed` | The tracked workstream registry changed. Clients should refetch `/api/workstreams`. |
| `workstream.source.changed` | The source registry or a watched source root changed. Clients should refetch `/api/workstreams`. |
| `heartbeat` | Connection liveness event, emitted without an SSE id. |

The API keeps a small replay buffer and honors `Last-Event-ID`. If replay is not possible, it sends a fresh `snapshot`.

## Client fallback behavior

Visible workstream pages keep one EventSource open. Hidden tabs close the EventSource and do not poll. When a tab becomes visible again, it reconnects and performs a focused refresh to cover missed events.

If EventSource is unavailable, disconnected, or stale, the client uses a slow fallback poll with jitter. The fallback cadence is intentionally much slower than the former 15 second graph poll and only runs while the document is visible.

Browser-directory workstreams are local browser files and cannot be watched by the API. They still use browser-side file handling, but hidden tabs remain paused and idle browser-directory pages do not generate API graph requests.

## Verifying graph request volume

Use the API access log to compare graph requests before and after changes:

```powershell
$log = "$env:USERPROFILE\.streamliner\state\logs\api-$(Get-Date -Format 'yyyy-MM-dd').log"
Get-Content $log |
  Select-String '"path":"\/api\/workstreams\/[^"]+\/graph"' |
  Measure-Object
```

For a quick smoke check, keep one visible workstream tab idle for at least one minute and confirm no repeated graph requests appear. Repeat with two visible tabs. A real graph edit should produce a bounded burst as visible affected tabs refetch once, but idle tabs should not emit steady-state graph polling traffic.
