# Workstream Format & Coverage Substrate

## Stage

Shaped; foundational candidate.

## Seed Idea

Make the workstream document format able to represent everything the operating model and the
work-geometry model now assume — and reject documents that do not conform. Today `graph.json` is
described by TypeScript interfaces (`src/workstream-schema.ts`) that only exist at compile time,
there is no canonical JSON Schema, waves are derived from checkpoints rather than first-class,
nodes have no kind/size, and there is nowhere durable to record uncovered work (debt) or attach
node artifacts.

This candidate owns the **format and coverage substrate**: the schema and the lifecycle
primitives every other workstream builds on.

## Why It Matters

Several settled directions all bottom out in the same place — the workstream document shape:

- invalid graphs fail to load with no actionable error (see #125);
- waves are a load-bearing design concept across the portfolio but are only derived;
- node-type (design / implementation / validation) and size (S/M/L) want to drive review and
  launch routing, but there is no field for them;
- the work-loss problem (#124) needs a place to record **debt / deferral** as first-class state;
- field reports and visual briefings need an **artifact-attachment slot** on a node.

If each consuming workstream extends the schema independently, the format contract splits and the
exact conflicting-assumptions failure the product thesis warns about reappears. One owner keeps the
substrate coherent and lets the others consume a stable, versioned shape.

## Candidate Scope

### In Scope

- A canonical, versioned **JSON Schema** for the workstream document, derived from
  `WorkstreamDocument`, referenced as canonical by `WORKSTREAM-FORMAT.md`.
- **Validate-on-load** with clear, path + reason errors, plus an authoring-time validator command
  (seeded by #125).
- **Waves as first-class objects** (not only derived from checkpoints), with the wave =
  confidence-transition semantics from the canvas common-shape hypothesis.
- **Node kind** (design / implementation / validation) and **size** (S/M/L) fields.
- **Debt / deferral** state so uncovered or deferred obligation is representable, not silently lost.
- **Artifact-attachment slots** on nodes (where a field report / visual briefing / demo playbook
  reference lives), so node field reports and the visual-briefing feature have a home.
- Schema **versioning + migration** guidance for the existing deprecated-field cleanup (#7) and
  artifact-placement conventions (#120).

### Out of Scope

- The field-report **content / lifecycle / reconciliation** behavior (the reconciliation candidate).
- The gate/closeout builder **interaction** (the checkpoint/closeout candidate).
- Cross-workstream import/export **semantics** (the cross-workstream dependencies candidate) — though
  the schema must provide the fields those semantics attach to.
- Runtime/registry state shape beyond the committed document.

### Deferred

- Rich schema-driven editing UI.
- Automated migration tooling beyond a documented path.

## Dependencies

### Depends On

- None (foundational). Coordinates with the existing `WORKSTREAM-FORMAT.md` doctrine.

### Enables

- The reconciliation, project-surface, checkpoint/closeout, and cross-workstream-dependency
  candidates (each consumes schema fields, debt state, or artifact slots), and the node
  visual-briefing feature.

### Related Candidates

- The role/context packages candidate (the other foundational substrate).

## Workstream Shape

Likely waves: (1) JSON Schema + validate-on-load (#125) as the first usable slice; (2) waves as
first-class objects; (3) node kind/size + artifact-attachment slots; (4) debt/deferral state +
deprecated-field cleanup (#7) and migration. Each wave is a confidence transition that exports a
stable schema increment downstream workstreams can consume.

## Open Questions

- How much of the existing derived-wave logic migrates to first-class wave objects vs. stays derived?
- Should debt be a node-level field, a separate collection, or both?
- What is the minimal artifact-slot shape that serves field reports, visual briefings, and demo
  playbooks without overfitting one?

## Handoff Brief

Create a Workstream Format & Coverage Substrate workstream that makes the workstream document able
to represent waves, node kind/size, debt/deferral, and attached artifacts, and that validates
documents against a canonical JSON Schema with actionable errors. Land the schema + validate-on-load
slice first (it absorbs filed issue #125), then extend with waves-as-objects, node fields and
artifact slots, and debt state plus deprecated-field cleanup (#7) and a migration path. Keep the
schema the single source of truth referenced by `WORKSTREAM-FORMAT.md`. This workstream exports a
stable, versioned document shape consumed by the downstream reconciliation, project-surface,
checkpoint/closeout, and cross-workstream-dependency workstreams, and the visual-briefing feature.
