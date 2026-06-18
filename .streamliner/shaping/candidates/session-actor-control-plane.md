# Session Actor Control Plane

## Status

Seeded

## Summary

Treat selected Copilot sessions as ephemeral, role-bound runtime actors attached to Streamliner work geometry.

This candidate explores a local-first actor substrate where terminal and SDK sessions can operate with scoped autonomy inside a defined mission boundary, receive structured messages, produce field reports, and report status/evidence back to Streamliner without becoming the source of truth.

The goal is not to turn Streamliner into a generalized actor framework or anthropomorphized agent-team simulator. The goal is to make long-running orchestration and worker sessions visible, interruptible, addressable, and operationally useful while keeping workstreams, artifacts, and registry state authoritative.

Actors are ephemeral field roles, not persistent teammates.

A node worker, issue worker, wave orchestrator, or workstream orchestrator may exist only for the duration of its assigned mission. Actor identity is a responsibility handle attached to a scope and role, not a durable personality.

## Problem

Current Streamliner orchestration assumptions lean toward backend-managed flows or isolated launch-and-wait session execution.

In practice, real workflows increasingly involve:

- long-running terminal sessions;
- loop-based waiting on PRs, reviews, CI, and follow-up issues;
- launching child sessions from other sessions;
- coordinating active workstreams through visible orchestrators;
- recovering and continuing interrupted orchestration;
- shaping on one machine while execution runs elsewhere;
- workers discovering that the workstream map is incomplete or stale.

The current system has no explicit model for:

- session roles;
- session authority boundaries;
- structured messaging into running sessions;
- field reports and map corrections;
- orchestration ownership and reporting;
- parent/child session relationships;
- session heartbeat/watch states.

Git commits and notes are currently serving as an improvised runtime coordination layer.

## Thesis

Streamliner should treat selected sessions as addressable runtime actors attached to work geometry.

Workstreams, nodes, gates, artifacts, and graph state remain authoritative.

Actors operate within scoped authority boundaries and report back from the field.

The actor closest to the work is often the first to know the map is wrong.

This model intentionally borrows from mission-oriented command doctrine:

- builder intent defines mission and boundaries;
- actors operate autonomously inside those bounds;
- actors report evidence, blockers, and map corrections;
- orchestrators maintain situational awareness and revise plans;
- gates and escalations remain explicit builder decision points.

The backend/control plane should maintain the common operating picture rather than dictating every action.

## Scope

In scope:

- actor vocabulary and doctrine;
- actor taxonomy and authority boundaries;
- ephemeral actor identity model;
- local actor registry metadata;
- local mailbox/message protocol;
- heartbeat/watch states;
- structured message lifecycle;
- field report formats;
- parent/child session relationships;
- terminal workstream orchestrator dogfood;
- loop-compatible message handling flows.

Out of scope:

- remote relay services;
- distributed actor routing;
- remote active workstream storage;
- hosted Streamliner control plane;
- multi-user coordination;
- replacing workstream artifacts with session memory;
- turning every session into an actor;
- fully autonomous wave progression.

Those are future candidate/workstream concerns.

## Actor model

### Principles

- Actors are runtime execution contexts, not durable sources of truth.
- Actor identity is role-bound and mission-bound.
- Sessions become actors only when attached to scoped authority and reporting obligations.
- Not all sessions need mailbox semantics.
- Workstreams and artifacts remain authoritative.
- Actor autonomy must stay bounded and reviewable.
- Locality matters: actors run in explicit environments.

### Actor levels

The system should support progressively stronger actor semantics.

Examples:

- observed session;
- attached session;
- mission session;
- reporting actor;
- messageable actor;
- orchestrator actor.

This prevents lightweight issue or node work from requiring heavyweight orchestration semantics.

### Field reports

Actors should report:

- outcome;
- evidence;
- blockers;
- downstream impacts;
- map corrections;
- follow-up recommendations;
- escalation conditions.

Field reports are intended to update the common operating picture without relying on transcript archaeology.

## Wave intent

Actual wave formation should determine final wave boundaries and node grouping.

The expected progression is approximately:

### Wave 1 intent: actor doctrine and contracts

Establish the conceptual and architectural contract for session actors.

Likely areas:

- actor terminology;
- authority boundaries;
- actor identity semantics;
- field-report model;
- relationship to workstreams and orchestration;
- alignment updates to top-level doctrine/orchestration docs.

This wave should answer:

- what is and is not an actor;
- how actors differ from persistent teammates;
- how actor autonomy is bounded;
- how actors relate to artifact authority.

### Wave 2 intent: local mailbox and actor substrate

Implement the first local actor substrate.

Likely areas:

- actor registry/runtime metadata;
- mailbox/message lifecycle;
- loop-compatible CLI/API commands;
- heartbeat/watch states;
- parent/child actor relationships;
- minimal UI projection.

This wave should prove that a local terminal session can:

- attach to an actor role;
- receive structured messages;
- acknowledge/fail messages;
- report state;
- remain visible and interruptible.

### Wave 3 intent: workstream orchestrator dogfood

Use the actor substrate against a real workstream orchestration loop.

Likely areas:

- workstream orchestrator role/playbook;
- actor-driven orchestration flows;
- field-report ingestion;
- session-to-session coordination;
- parent/child launch tracking;
- reconciliation and map-correction flows.

This wave should answer whether actor-operated orchestration materially improves:

- situational awareness;
- orchestration visibility;
- interruption/recovery;
- cross-session coordination;
- builder leverage.

## Expected exports

Potential exports from this workstream include:

- actor doctrine/design docs;
- actor role definitions;
- mailbox/message protocol;
- field-report formats;
- actor runtime metadata;
- orchestration playbooks;
- actor-aware session projections;
- loop-compatible CLI/API commands.

## Relationship to other candidates

This candidate intentionally precedes:

- Autonomous Wave Progression;
- Cross-environment relay/messaging concepts described in `DISTRIBUTED-CONTROL-PLANE.md`;
- remote active-state storage;
- hosted coordination surfaces.

Those future capabilities should consume a proven local actor substrate rather than inventing distributed behavior before the local operational loop is validated.

## Open questions

- Which sessions should naturally graduate into actors?
- What is the minimal actor registry shape?
- Which message types should exist initially?
- How should actors checkpoint or compact state?
- How should field reports materialize into durable artifacts?
- Which actions should require explicit builder escalation?
- How much orchestration state belongs in Streamliner vs actor runtime memory?
- How should terminal takeover interact with actor ownership?
- Which actor capabilities belong only to orchestrators?
