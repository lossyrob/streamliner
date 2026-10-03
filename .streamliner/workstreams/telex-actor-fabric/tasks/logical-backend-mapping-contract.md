# Logical Telex Backend Mapping Contract

## Node

- Workstream: `telex-actor-fabric`
- Node ID: `logical-backend-mapping-contract`
- Type: research
- Wave: 1 / `actor-contract-proven`
- Status: ready

## Purpose

Define a portable project-facing Telex backend reference that can be shared
across machines while each environment maps it to its own released Telex profile
and credentials.

## Inputs

- `.streamliner/workstreams/telex-actor-fabric/brief.md`
- `.streamliner/shaping/roadmap.md`
- Existing Streamliner project/config discovery
- Released Telex backend profile commands and configuration behavior
- Git-backed Artifact Ledger & Sync candidate and `artifact-root-v1` boundary

## Scope

### In scope

- Define the logical `telexBackendId` stored in project configuration.
- Define the local mapping from logical ID to Telex profile.
- Keep credentials and machine-local profile names outside shared artifacts.
- Define lookup precedence, missing-mapping errors, mapped-backend health
  diagnostics, and compatibility/version reporting.
- Define how launch, resume, status, send, and attachment operations consume the
  resolved profile explicitly.
- Preserve a path from local same-machine dogfood to later shared-backend use.

### Out of scope

- Provisioning Postgres, Entra, or other backend infrastructure.
- Storing credentials in Streamliner.
- Defining multi-user authorization.
- Owning the campaign-wide two-builder gate.

## Expected Output

- Project configuration shape for logical backend identity.
- Environment-local mapping/storage contract.
- Typed diagnostics for missing, invalid, unreachable, or incompatible mappings.
- Migration/default behavior for current local Telex use.

## Success Criteria

- The same project artifact can resolve to different local Telex profile names
  on two machines.
- No credential or machine-local profile name enters shared workstream
  artifacts.
- Callers never silently fall back to a different configured Telex backend.
- Missing mapping and unhealthy mapped backend are distinguishable.
