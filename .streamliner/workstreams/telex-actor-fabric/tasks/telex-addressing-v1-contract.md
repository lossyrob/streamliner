# Telex Addressing V1 Contract

## Node

- Workstream: `telex-actor-fabric`
- Node ID: `telex-addressing-v1-contract`
- Type: research
- Wave: 1 / `actor-contract-proven`
- Status: planned

## External Dependency

This node cannot freeze until Plugin Role Skills Wave 1 exports the stable
`role-context-v1` role/subrole identifiers and contract version.

## Purpose

Define the canonical mapping from explicit Streamliner project, workstream,
node, role, and subrole identity to durable Telex responsibility addresses.

## Inputs

- `.streamliner/workstreams/telex-actor-fabric/brief.md`
- Stable `role-context-v1` identifiers and contract version
- Logical backend mapping contract
- Released Telex address, directory, occupancy, lease, and retirement behavior
- Existing Streamliner project/workstream/node identifier contracts

## Scope

### In scope

- Address categories for project roles, workstream orchestrators, and node
  implementer/reviewer subroles.
- Canonical segment grammar, escaping, normalization, and collision rules.
- Stable derivation independent of session, process, machine, and backend
  profile names.
- Exactly one primary Telex responsibility address per V1 actor session.
- Address scope, description, and tags for directory discovery.
- Active/unoccupied/retired interpretation and retirement preconditions.
- Attachment inputs and deterministic test vectors.
- Compatibility with local and shared Telex backend profiles.

### Out of scope

- Role inference or selection.
- Multiple primary responsibility addresses per actor session.
- Broadcast, capability bidding, or dispatch markets.
- Remote takeover policy beyond consuming released Telex behavior.
- Message payload or lifecycle policy.

## Expected Output

- Versioned `telex-addressing-v1` specification.
- Canonical examples and invalid/collision cases.
- Address derivation test-vector set.
- Attachment metadata contract consumed by role helpers and actor operations.

## Success Criteria

- Independent callers derive byte-identical addresses for the same explicit
  inputs.
- Role and subrole IDs come directly from `role-context-v1`.
- No durable address contains a Copilot session ID, registry ID, process ID,
  machine name, or local Telex profile name.
- Sender inference is unambiguous for a V1 actor session.
- Closed responsibilities have an explicit retirement path that cannot strand
  actionable messages silently.
