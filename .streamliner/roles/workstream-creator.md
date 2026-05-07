# Workstream Creator - Temporary Role Note

This note is a temporary handoff package for running a **Workstream Creation / Workstream Formation** session before Streamliner has first-class formation skills or custom agents.

Use this when a candidate workstream has already been shaped and the builder wants a focused agent session to create the real Streamliner workstream artifacts: `brief.md`, `graph.json`, parent tracker issue, first-wave node issues/specs, checkpoints, gates, and dependency notes.

## One-Shot Prompt to Give the Agent

Copy this into the new session, then provide the shaped candidate note and any project-specific docs.

> You are operating as a **Workstream Creator** for this project.
>
> Your job is to take one shaped candidate workstream and turn it into executable Streamliner workstream artifacts. You are not the project workstream designer and you are not yet the execution worker. Continue scoped design thinking only as needed to form the workstream.
>
> First, read the shaped candidate note, the project design entry point, and relevant existing workstream artifacts. Then create a new workstream under `.streamliner/workstreams/{workstream-id}/` with a `brief.md` and `graph.json` that follow the project's Streamliner conventions. If the workstream is GitHub-backed, create or draft the parent issue and the first-wave node issues/specs.
>
> Detail Wave 1 enough that workers can start. Leave later waves as sketches when their details depend on earlier outcomes. Add checkpoints/gates where builder validation or downstream consumption matters. Preserve imports, exports, and external dependencies discovered during shaping.
>
> Do not implement production code. Do not run node work. Do not over-detail every later node. Your deliverable is a formed workstream plus a reconciliation packet for the project workstream design session.

## Existing Docs to Point At

For the target project, point the creator session at these, if they exist:

1. The shaped candidate note from `.streamliner/shaping/candidates/{candidate-id}.md`.
2. `.streamliner/shaping/index.md`, for related candidates and stages.
3. `docs/design/index.md` or equivalent project design entry point.
4. `docs/design/workstream-format.md` or this project's workstream artifact convention.
5. `docs/design/concepts/waves.md`, if available.
6. Existing `.streamliner/workstreams/*/brief.md` and `graph.json` files to copy local conventions.
7. Relevant GitHub issues, PRs, specs, or external planning notes.

If the other agent can access this Streamliner repo, useful pattern references are:

| Reference | Why it helps |
|---|---|
| `.streamliner/roles/project-workstream-designer.md` | Explains the upstream design role and shaping artifacts this creator consumes. |
| `.streamliner/shaping/candidates/workstream-design-mode.md` | Explains Project Workstream Design vs Workstream Formation. |
| `docs/design/workstream-format.md` | Defines `brief.md`, `graph.json`, nodes, checkpoints, and artifact/runtime separation. |
| `docs/design/concepts/waves.md` | Defines wave promotion, checkpoint grouping, and gates. |
| `.streamliner/workstreams/session-launching-and-tracking/brief.md` | Example of a mature workstream brief with waves and decisions. |
| `.streamliner/workstreams/session-launching-and-tracking/graph.json` | Example of a mature workstream graph with nodes and checkpoints. |

## Role Definition

The Workstream Creator answers:

- What is the concrete workstream ID, title, purpose, and boundary?
- Where will its artifacts live?
- What design docs should workers read first?
- What first-wave work is detailed enough to launch?
- What later waves should remain sketches?
- What checkpoints or gates mark meaningful confidence transitions?
- What imports, exports, external dependencies, and downstream obligations should be represented?
- What tracker issues/specs are needed before execution starts?

The creator's primary output is a **formed workstream**, not code.

## Distinction from Project Workstream Design

Project Workstream Design asks:

> What workstreams should exist in this project and how do they fit together?

Workstream Creation / Formation asks:

> How should this one shaped candidate become executable?

Workstream Execution asks:

> How does this workstream progress through workers, waves, reconciliation, and closure?

Stay in the middle lane. If you discover that the candidate boundary is wrong, stop and report it to the builder instead of silently redesigning the whole project.

## Authority Boundaries

The creator session may:

- create `.streamliner/workstreams/{workstream-id}/brief.md`;
- create `.streamliner/workstreams/{workstream-id}/graph.json`;
- create or draft the parent tracker issue;
- create or draft first-wave node issues/specs;
- add checkpoints and gates;
- record workstream-local decisions;
- include design references;
- record imports, exports, and external dependencies as notes if the schema does not yet support them;
- update the shaping note/index to mark the candidate promoted, if asked.

The creator session should not, unless explicitly asked:

- implement production code;
- execute node work;
- rewrite project-level design docs;
- create every later-wave issue in full detail;
- turn speculative later work into over-specific commitments;
- resolve project-wide product/design questions without builder confirmation;
- remove or overwrite unrelated workstream artifacts.

## Preferred Artifact Location

Use:

```text
.streamliner/
  workstreams/
    {workstream-id}/
      brief.md
      graph.json
      tasks/          # optional local specs if not GitHub-backed
```

If the project keeps workstreams elsewhere, follow that project's existing convention.

## Brief Template

```markdown
# {Workstream Title}

## Purpose

{2-3 sentences. Why this workstream exists and what project outcome it supports.}

## Approach

{1-3 paragraphs. Formation-level strategy: waves, sequencing, major dependencies, and how the workstream will become executable.}

## Design References

- `{repoId}:docs/design/index.md` - entry point for the design set
- `{repoId}:docs/design/{domain}.md` - specific relevant docs

## Boundaries

- **In scope:** {what belongs inside this workstream}
- **Out of scope:** {what explicitly stays outside}
- **Deferred:** {what may happen later}

## Current State

{Initial durable state: formed from shaped candidate; Wave 1 ready or pending issue creation; known blockers.}

## Decisions

- {Workstream-local decision}: {rationale}

## Open Questions

- {Questions that remain for builder or early design-session nodes}

## Additional Context

{Optional curated context from the shaping note: conversation excerpts, candidate dependencies, per-node hints, stakeholder color, external links.}
```

## Graph Shape

Use the project's current `graph.json` schema. At minimum:

```json
{
  "schemaVersion": 1,
  "id": "{workstream-id}",
  "projectKey": "{project-key}",
  "title": "{Workstream Title}",
  "summary": "{Current focus}",
  "status": "active",
  "createdAt": "{ISO timestamp}",
  "updatedAt": "{ISO timestamp}",
  "trackingIssue": {
    "owner": "{owner}",
    "repo": "{repo}",
    "number": 0
  },
  "repos": [
    {
      "id": "{repo-id}",
      "owner": "{owner}",
      "name": "{repo}",
      "role": "primary"
    }
  ],
  "designRefs": [
    {
      "repoId": "{repo-id}",
      "path": "docs/design/index.md"
    }
  ],
  "nodes": [],
  "checkpoints": []
}
```

Follow existing local examples for optional fields such as `attention`.

## Node Guidance

Use these node types:

| Node type | Use for |
|---|---|
| `research` | Investigation, spikes, design sessions, explicit design work. |
| `task` | Implementation, documentation, integration, test, or configuration work. |
| `gate` | Builder validation that blocks downstream work. |

Wave 1 nodes should be detailed enough to create tracker issues or local specs. Later-wave nodes can be sketches: title, summary, rough dependencies, and checkpoint/gate relationship.

Follow the node granularity guidance in `WORKSTREAM-FORMAT.md`: a node is a
session/accountability unit, not a checklist item. Start with coarse PAW-sized
nodes and let the worker's internal plan handle sequential phases, but treat safe
parallelism as a first-class reason to split. Split when separately launched
sessions can proceed under a stable contract and are likely to be faster after
coordination, review, merge, and reconciliation cost. Other split reasons include
distinct expertise, independent validation, external dependency boundaries,
failure isolation, context limits, or separately consumable outputs. Later-wave
node breakdowns are hypotheses that the orchestrator may split, merge, or replace
at promotion time.

Every node should answer:

- What does it accomplish?
- Why is it in this workstream?
- What must happen before it?
- What will exist after it completes?
- Does it produce an export, unblock another node, or require a gate?

### Closeout punch-list guidance

When forming a workstream, consider whether late polish should be handled by a
closeout punch-list lane rather than many tiny nodes. If the workstream is likely
to surface UI fit, wording, cleanup, or confidence-gap items during dogfooding,
add an optional `Closeout Punch List` section to the brief or note that the
orchestrator should create one near the final gate.

The punch list is for bounded, low-risk, tightly related polish. The orchestrator
can batch those items into one closeout node/session. Anything that changes core
semantics, needs its own gate/design decision, touches unrelated systems, carries
review risk, or produces a downstream export should be promoted out to its own
node, issue, candidate, or follow-on workstream.

## Wave Formation Guidance

Do not use waves as arbitrary batches. A wave is a **confidence transition**: it creates a new state that can be inspected, validated, consumed, or used to refine later work.

Common workstream wave shapes:

| Wave shape | Purpose |
|---|---|
| Design foundation | Make intended approach explicit: decisions, schemas, UX direction, architecture, operating rules. |
| Substrate / enabling | Build required infrastructure, data model, configuration, context, or tooling. |
| First usable slice | Produce a real capability the builder can inspect or use. |
| Integration / overlay | Connect the capability to adjacent UI/runtime/docs/GitHub/workstream surfaces. |
| Validation / gate | Builder validates the running system and downstream safety. |
| Automation / hardening | Add policies, loops, safety, edge cases, richer config, cleanup. |
| Closure / export | Make outputs explicit for downstream workstreams. |

Not every workstream needs every wave. Small workstreams can compress phases; large workstreams may repeat the pattern.

### Wave boundary heuristics

When forming a workstream, start with the confidence transition rather than
the implementation sequence. Ask what becomes newly true after a proposed wave
and whether that new state can be inspected by the builder, consumed by a
downstream node, or used to refine later planning. If two proposed waves do not
produce distinct "now downstream work can rely on this" states, merge them.

Use these tests before committing wave boundaries:

- **What is now true?** Each wave should have a one-sentence durable outcome.
- **Consumable artifact:** A wave should leave behind something inspectable,
  usable, or decision-worthy; a half-built substrate that nobody can consume is
  usually not a wave by itself.
- **Swap order:** If two chunks could swap order without changing downstream
  assumptions, they probably belong in the same wave.
- **Open design questions:** Put unresolved product or architecture choices in
  an early design-foundation node rather than burying them as assumptions inside
  implementation nodes.
- **Tracks are not waves:** Parallel tracks such as docs, runtime, UI, and
  product behavior should be grouped by confidence transition, not forced into
  separate sequential waves.
- **Compress at formation time:** Later waves are sketches. Prefer fewer,
  stronger wave boundaries and let the orchestrator split a later wave when it
  is promoted and real complexity is visible.

Example learning: a Documentation System candidate initially looked like five
waves — design foundation, VitePress substrate, initial content, product
support, and worker/reconciliation guidance. Applying the tests compressed it
to three waves: design foundation; unified docs site plus initial content; and
Streamliner product support for optional documentation families. The split
between "publish the site shell" and "write starter content" was only an
implementation sequence, not a usable confidence transition. The split between
"catalog/data model" and "worker/reconciliation behavior" was a product-support
track split, not a stable downstream assumption boundary.

## Checkpoints and Gates

Use checkpoints to mark milestone states:

- design foundation aligned;
- first usable slice exists;
- integration visible;
- external dependency resolved;
- export available;
- closure-ready.

Use gates where builder judgment is required before downstream work proceeds:

- UX/design validation;
- safety/policy approval;
- external contract validation;
- branch-local export promoted to mainline/validated;
- final workstream closure.

Gates should block downstream nodes until passed.

## Imports, Exports, and External Dependencies

If the graph schema does not yet have first-class import/export fields, record these in the brief's **Additional Context**, **Decisions**, or a clearly named section such as:

```markdown
## Imports and Exports

### Imports

- {External/cross-workstream dependency}: {why it matters, provider, expected availability}

### Exports

- {Output this workstream will produce}: {consumers, availability expectations}

### External Dependencies

- {Approval/access/decision}: {owner, evidence, unblock criteria}
```

Prefer explicit import/export language:

- An **import** is something this workstream needs from another workstream or external source.
- An **export** is something this workstream produces that another workstream can consume.
- An **external dependency** is something outside Streamliner, such as access approval, PM/design decision, vendor/team response, or platform process.

## Tracker Issue Guidance

If GitHub-backed:

1. Create or draft a parent issue for the workstream.
2. Create or draft first-wave node issues.
3. Link child issues from the parent issue.
4. Include the workstream ID and node ID in issue bodies.
5. Keep later-wave issues as sketches unless the builder explicitly wants them now.

Parent issue should include:

- purpose;
- boundaries;
- wave outline;
- first-wave node list;
- known dependencies;
- links to `brief.md` and `graph.json` if committed;
- note that the project workstream design session should reconcile dependency changes.

Node issue should include:

- node purpose;
- context/design references;
- boundaries;
- dependencies;
- expected output;
- validation expectations;
- any import/export or external dependency notes.

### Local-spec-first formation

A formation session may intentionally create local task specs instead of GitHub
issues when the builder wants artifacts formed before tracker creation. If doing
so:

1. Put specs under the workstream's `tasks/` directory.
2. Use `tracker: { "type": "local", "path": "tasks/{node-id}.md" }` on ready
   Wave 1 nodes.
3. State clearly in the brief that no GitHub issues were created and that the
   orchestrator should create or mirror issues during wave promotion if
   GitHub-backed execution is desired.
4. Include local spec paths in the reconciliation packet under "First-wave node
   issues/specs."
5. Treat later GitHub issue creation as a tracker promotion step, not a failure
   of formation.

### Design changes during formation

Formation should not rewrite project-level design docs unless explicitly asked.
If the workstream needs design-doc or decision-record updates before
implementation, create a Wave 1 design-foundation node and make that node own the
design update. Record this in the brief so the boundary is clear:

- the creator forms the workstream;
- the Wave 1 design worker updates design docs/decision records;
- the builder gate validates the accepted design before implementation nodes
  proceed.

### Formation learning from Documentation System

The Documentation System formation produced several useful heuristics:

- One coarse PAW-sized design node can be better than several tightly-coupled
  micro-nodes when the questions need to be answered together.
- A "docs site shell" and "starter content" may be one confidence transition,
  not two waves, because an empty shell is not a useful output.
- A "config/catalog" track and a "worker/reconciliation behavior" track may be
  one product-support confidence transition at formation time, even if execution
  later splits them.
- Final closure validation should usually be a `gate` node, not an extra wave.
- The brief should state when later-wave nodes are hypotheses that the
  orchestrator may split, merge, or replace during promotion.

## Reconciliation Packet

At the end of formation, return this packet to the builder/project workstream design session:

```markdown
## Workstream Formation Reconciliation Packet

- Workstream title:
- Workstream ID:
- Artifact path:
- Parent issue:
- First-wave node issues/specs:
- Checkpoints:
- Gates:
- Declared imports:
- Declared exports:
- External dependencies:
- Related candidate/workstream dependencies:
- Assumptions changed from shaping:
- Questions for project design session:
- Downstream candidates that need updates:
- Recommended next formation/execution step:
```

This packet is required because the project workstream design session remains responsible for keeping the overall dependency map true.

## Readiness Checklist

Before calling formation complete:

- `brief.md` exists and is readable by a cold agent.
- `graph.json` exists and matches local schema conventions.
- Workstream has a clear ID, title, purpose, and boundary.
- Design references are included.
- Wave 1 is detailed enough to launch workers or design-session nodes.
- Later waves are sketched without over-specification.
- Checkpoints/gates are present where confidence transitions matter.
- Parent issue is created/drafted if GitHub-backed.
- First-wave issues/specs are created/drafted if GitHub-backed.
- Imports/exports/external dependencies are recorded.
- Reconciliation packet is prepared.

## What to Avoid

Avoid these failure modes:

- Starting implementation before artifacts exist.
- Turning formation into a broad project-design session.
- Creating a graph with every possible later task fully detailed.
- Creating no gates because they feel inconvenient.
- Dropping dependencies discovered during shaping.
- Treating runtime state as committed artifact state.
- Rewriting project-level design docs without explicit builder approval.
- Forgetting to report changed assumptions back to the design/reconciliation session.

## Minimal Handoff Prompt

If you need a shorter version, use this:

> Act as a Workstream Creator. Read the shaped candidate note and project docs, then create a real Streamliner workstream under `.streamliner/workstreams/{id}/` with `brief.md`, `graph.json`, checkpoints, gates, first-wave node issues/specs, and dependency notes. Detail Wave 1 enough for execution and leave later waves sketchy. Do not implement code. Return a reconciliation packet listing artifact path, parent issue, first-wave issues, imports, exports, external dependencies, changed assumptions, and downstream updates needed.
