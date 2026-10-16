# Map the App-native boundary

## Outcome

Document a narrow ownership boundary where Streamliner supplies durable
workstream intent and Copilot App owns local session lifecycle.

## Success criteria

- No dependency on App SQLite, Rust internals, Zustand state, or private
  WebSocket protocols.
- Artifact and volatile runtime state are separated.
