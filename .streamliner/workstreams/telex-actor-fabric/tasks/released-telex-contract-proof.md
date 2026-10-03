# Released Telex Contract Proof

## Node

- Workstream: `telex-actor-fabric`
- Node ID: `released-telex-contract-proof`
- Type: research
- Wave: 1 / `actor-contract-proven`
- Status: ready

## Purpose

Establish the exact released Telex surface Streamliner can depend on before any
adapter or actor state is implemented. This node should use the installed binary
and release-tag documentation as authority and should identify capability gaps
rather than filling them with Streamliner-owned transport behavior.

## Inputs

- `.streamliner/workstreams/telex-actor-fabric/brief.md`
- `.streamliner/shaping/candidates/session-actor-control-plane.md`
- `ORCHESTRATION.md`
- `docs/design/session-system.md`
- Released `telex copilot skill`
- Released help for attach, resume, detach, send, status, station, address, ack,
  disposition, and backend commands
- Telex release-tag design and decision documents

## Scope

### In scope

- Verify explicit backend, address, and session identity requirements.
- Verify Copilot attach/resume bridge provisioning and extension reload
  responsibilities.
- Verify address/station status, exclusive occupancy, lease epochs, local
  station stop, retirement, acknowledgement, and terminal disposition.
- Verify JSON outputs, exit/error behavior, compatibility/version checks, and
  bounded command invocation expectations.
- Verify queued delivery while an address is unoccupied and at-least-once
  message handling.
- Determine what released capability, if any, safely hands off or takes over an
  unknown remote station.
- Define the thin adapter boundary and the separate in-session attachment path.

### Out of scope

- Implementing a Streamliner adapter.
- Implementing waiting, polling, heartbeats, queues, leases, history, or a
  Copilot bridge.
- Proposing a Streamliner workaround for unsupported remote takeover.
- Defining Streamliner role IDs, field-report schemas, or lifecycle policy.

## Expected Output

- A released-capability matrix with exact command/version references.
- A typed adapter-operation and error inventory.
- A clear local-known-station fencing path.
- An explicit remote-takeover dependency or supported contract.
- Recommended graph/brief corrections if released behavior differs from the
  formation assumptions.

## Success Criteria

- Every planned Streamliner Telex operation maps to a released command or is
  marked unsupported.
- No proposed behavior requires Streamliner-owned message transport.
- Copilot push delivery and re-provisioning responsibilities are unambiguous.
- Lease-epoch and station-stop evidence is sufficient for later actor operation
  design.
- Unknown remote occupancy remains blocked unless safe released fencing is
  proven.
