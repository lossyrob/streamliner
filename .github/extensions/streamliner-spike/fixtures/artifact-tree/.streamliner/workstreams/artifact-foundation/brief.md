# Artifact foundation

## Purpose

Keep durable portfolio and workstream intent on one exact Git revision while
leaving fast-moving session bindings outside the artifact ref.

## Boundaries

- **In scope:** exact-revision reads and a replaceable writer boundary.
- **Out of scope:** remote synchronization and production merge policy.

## Current State

The read contract is complete. Shared-ref writing remains ready for design.
