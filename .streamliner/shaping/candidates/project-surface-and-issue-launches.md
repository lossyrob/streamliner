# Project Surface and Issue Launches

## Stage

Seeded; shaped enough for candidate discussion.

## Seed Idea

Streamliner currently has Sessions and Workstreams as primary surfaces, but no first-class Project surface. As the builder uses Streamliner for more daily work, there is a missing middle layer between an unattached ad-hoc session and a fully shaped workstream node.

Some GitHub issues are scoped enough that they do not deserve a workstream. They may be follow-up work, smaller fixes, polish, or project-local tasks. But they still belong to a project, and they would benefit from Streamliner's PAW launch integration: prompt profiles, worktree/branch setup, context assembly, session registry binding, runtime tracking, and PR linkage.

The product idea:

> Not every issue deserves a workstream. It may still deserve a Streamliner launch.

Add a first-class Project surface that groups a registered project's design docs, workstreams, sessions, and GitHub issue list. From that surface, the builder can launch PAW sessions directly from project issues without forming a workstream, while still getting Streamliner context, launch, tracking, and promotion paths.

## Why It Matters

The workstream model is intentionally heavier than a single issue. That is good. A workstream has boundaries, waves, nodes, checkpoints, gates, and reconciliation. Forcing every useful PAW launch through that model would recreate ceremony and make Streamliner feel like something the builder has to marry before getting everyday value.

At the same time, project-scoped issue work should not be treated as anonymous ad-hoc execution. If the issue belongs to a registered project, Streamliner already knows useful context:

- participating repositories;
- design docs and design catalog;
- launch defaults and prompt profiles;
- session registry and runtime state;
- existing workstreams;
- issue and PR relationships;
- local worktree/branch conventions.

A Project surface gives Streamliner a home for that context boundary. It lets the builder operate on project issues without pretending they have workstream geometry.

The distinction:

> A project is the context boundary. A workstream is the geometry boundary.

Project issue launches make Streamliner useful for daily scoped repo work while preserving the stronger workstream model for shaped bodies of work.

## Candidate Scope

### In Scope

- Define project registration and config initialization as the first project-surface deliverable: choose a source-repo-local or planning/orchestration root layout, create `.streamliner\config.json` or `streamliner.json`, configure `workstreamsDir`, and map repo IDs to local repo roots.
- Define Project as a first-class UI/runtime surface above workstreams and sessions.
- Show a registered project's repositories, design docs or design catalog entry point, active workstreams, active/recent sessions, and configured GitHub issue list.
- Let the builder configure one or more GitHub issue queries for a project, such as label-based, assignee-based, or open-follow-up filters.
- Render a lightweight project issue list with status, labels, issue links, workstream association state when known, active/recent Streamliner sessions, and PR linkage when available.
- Add a `Launch PAW` action for project issues that are not associated with a workstream node.
- Bind launched sessions to project + repo + issue rather than workstream + node.
- Reuse existing PAW launch affordances where possible: prompt profiles, launch instructions, worktree/branch setup, terminal or managed runtime selection, and launch operation state.
- Assemble a project issue context package that includes project design navigation plus the GitHub issue mission without requiring a workstream brief or graph.
- Show project issue sessions in Sessions and Project surfaces as attached project sessions, not unattached ad-hoc sessions.
- Define promotion paths when issue-scoped work grows into a workstream candidate, existing workstream node, or closeout observation.

### Out of Scope

- Replacing GitHub Issues or building a full issue tracker.
- Backlog management, triage boards, story points, sprints, or project-management workflows.
- Multi-issue work planning inside the issue launch surface.
- Treating issue-scoped launches as mini-workstreams.
- Requiring every project issue to appear in Streamliner.
- Automatically creating workstreams from issues without builder intent.
- Auto-progressing standalone issues through waves or gates.
- Remote/devbox-specific issue launch behavior in the first cut.

### Deferred

- Multiple saved issue views per project with rich filtering UI.
- Issue-to-candidate promotion automation.
- Automatic detection that a standalone issue should become a workstream.
- Bulk launch or queue execution for issue lists.
- Portfolio-level issue views across multiple projects.
- Deep GitHub Projects integration.
- Non-GitHub tracker support.

## Core Model

Add a launch target type distinction:

```text
workstream-node
project-issue
ad-hoc-session
```

Current graph launches are `workstream-node` launches.

This candidate adds `project-issue` launches:

```json
{
  "projectKey": "streamliner",
  "repo": "lossyrob/streamliner",
  "issue": 69,
  "launchKind": "project-issue"
}
```

A project issue launch has:

- `projectKey`;
- repository identity;
- GitHub issue identity;
- launch/runtime identity;
- optional PR linkage;
- optional design/context metadata;
- no `workstreamId`;
- no `nodeId`;
- no graph dependency;
- no checkpoint or gate.

The issue remains the task-level source of truth. Streamliner owns the execution support around it.

## Project Registration and Config Initialization

The Project surface depends on an explicit project boundary. Today Streamliner can register source directories and discover workstream graphs, but that is not the same as helping a builder initialize a project, decide where artifacts live, or configure the repo IDs that launches should target.

The first implementation slice should make that boundary visible and durable:

- let the builder initialize either a source-repo-local layout or a planning/orchestration root layout;
- create the committed project config file: `.streamliner\config.json` for source-repo-local projects, or `streamliner.json` / `.streamliner\config.json` for planning roots;
- configure `workstreamsDir` and create the directory when needed;
- detect the current Git repo and remote, then propose a repo ID and local path mapping;
- support additional repo mappings for multi-repo planning roots;
- register the initialized project root as a Streamliner source;
- show where new `graph.json` artifacts will be created before the first workstream is created;
- validate that graph repo IDs and node `repoIds` resolve through the project config before launches.

The local source registry should remember which project roots this machine tracks. The project config should describe the shareable project/planning boundary: artifact layout, repo mappings, design-doc entry points, and eventually issue-view defaults.

## Project Surface

The Project surface is the missing middle layer between Home/Sessions and a specific Workstream graph.

A first Project page could show:

- project name and registered repositories;
- design docs entry point and design catalog health;
- active workstreams for the project;
- active and recent sessions attached to the project;
- unattached sessions that may belong to the project;
- configured GitHub issue list;
- recent project issue launches;
- launch defaults and prompt-profile affordances, if appropriate.

A possible hierarchy:

```text
Home
  -> Projects
      -> Project
          -> Workstreams
          -> Issues
          -> Sessions
          -> Design docs
```

This surface should remain an operating surface, not a project-management surface. It answers: what work and sessions are active in this project, what issues can I launch from here, and what context does Streamliner know?

## Project Issue List

The issue list should be intentionally narrow and configured by query rather than trying to model a backlog.

Examples:

```text
repo:lossyrob/streamliner is:open label:follow-up
repo:lossyrob/streamliner is:open -label:workstream
repo:lossyrob/streamliner is:open assignee:@me
repo:lossyrob/streamliner is:open label:streamliner-ready
```

Each issue row might show:

- issue number and title;
- labels and state;
- whether the issue is already attached to a workstream node;
- whether the issue has an active/recent Streamliner session;
- open PR linkage when known;
- `Launch PAW` action;
- later, `Promote to candidate` or `Attach to workstream` actions.

The first cut should prefer a simple configured query over building rich GitHub issue management.

## Project Issue Context Package

Project issue launch should use a lighter context model than workstream node launch.

It does not have Layer 1-3 workstream/node context. Instead, it should assemble:

- project design navigation, starting from the design index when configured;
- relevant design docs or decisions when obvious from project config or issue metadata;
- the GitHub issue mission and comments if available;
- repository identity, branch/worktree metadata, and launch defaults;
- prompt profile text and PAW launch configuration;
- nearby issue/PR context only when useful and bounded.

The context should be reference-first. It should point the worker at authoritative project design docs and the GitHub issue rather than paste a giant bundle. A project issue launch is still a cold-start agent session; it just has project context instead of workstream geometry.

## Session Binding and Tracking

Project issue sessions should appear as attached sessions:

```text
Project: streamliner
Issue: #69 Show live GitHub issue and PR status
Runtime: terminal-cli / managed-sdk
Branch: streamliner/issue-69-github-status
PR: #...
Status: running / PR ready / merged / needs attention
```

They should not appear as unattached ad-hoc sessions. They are attached to project + issue, just not to workstream + node.

Expected surfaces:

- Sessions view can group/filter by project issue launch.
- Project page can show active/recent issue sessions.
- GitHub issue rows can show launch/session/PR state.
- Workstream graphs remain unaffected unless the issue is explicitly attached or promoted.

## Promotion Paths

If issue-scoped work grows, Streamliner should provide promotion paths rather than forcing the builder to decide upfront.

Possible outcomes:

- Leave as project issue work when the issue stays scoped.
- Attach to an existing workstream node if it clearly belongs to shaped work.
- Convert to a closeout observation if it is bounded polish for an active workstream.
- Promote to a candidate workstream when it reveals a larger body of work.
- Create follow-up issues without forming a workstream when the work remains small.

This keeps the adoption ladder clean:

```text
ad-hoc session
  -> project issue launch
      -> workstream node launch
          -> autonomous wave progression
```

Project issue launches are the missing middle rung.

## Candidate Workstream Shape

A future formed workstream might use this shape:

### Wave 1 — Project registration and config initialization

Define the project boundary and make onboarding explicit before building higher-level project operations:

- initialize a source-repo-local or planning/orchestration root layout;
- create `.streamliner\config.json` or `streamliner.json`;
- configure `workstreamsDir` and graph artifact placement;
- detect/propose repo IDs from local Git remotes;
- allow additional local repo path mappings;
- register the project root as a Streamliner source;
- surface config health and missing repo mapping diagnostics.

### Wave 2 — Project surface model

Define Project as a first-class Streamliner surface and data/runtime concept:

- project identity and display model;
- registered repo mapping;
- design-doc entry point;
- active workstream list;
- attached sessions summary;
- issue-view configuration shape.

### Wave 3 — GitHub issue list and status

Add the configured issue list for a project:

- query-backed issue fetch;
- issue row rendering;
- workstream association state when known;
- session/PR linkage when known;
- lightweight refresh behavior that does not become a full tracker clone.

### Wave 4 — Project issue launch

Add `Launch PAW` from a project issue:

- launch target type `project-issue`;
- project issue context assembly;
- worktree/branch setup;
- prompt profile reuse;
- terminal-first launch path;
- session registry binding to project + issue;
- runtime tracking and PR linkage.

### Wave 5 — Promotion and attachment paths

Support explicit builder actions for issue-scoped work that grows:

- attach issue/session/PR to an existing workstream node;
- convert issue finding into closeout observation;
- promote issue into candidate workstream seed;
- leave issue launch archived as project issue work.

### Gate — Project issue launch usability

Validate that the builder can use Streamliner for scoped GitHub issue work without creating a workstream, while still benefiting from project context, launch profiles, worktree setup, tracking, and PR/session visibility.

## Dependencies

### Depends On

- Session launching/tracking substrate, because project issue launch should reuse the existing launch pipeline, worktree/branch setup, PAW launch preparation, registry binding, and runtime state rather than inventing a second path.
- GitHub issue/PR status work, or an equivalent lightweight issue/PR enrichment seam, because the Project issue list and issue launch state need live tracker context.

### Enables

- Streamliner use for daily scoped issue work without full workstream ceremony.
- Cleaner ad-hoc session attachment by giving sessions a project-level destination.
- Future `streamliner launch-issue` CLI or agent helper entrypoint.
- Promotion from issue-scoped work into candidate/workstream artifacts when the work grows.
- A more useful Home/Portfolio surface where projects become real operating units, not just config hidden behind workstreams.

### Related Candidates

- [Workstream Design Mode](workstream-design-mode.md), because project issue launches may promote into candidate workstreams.
- [Streamliner Agent and Skill Context](streamliner-agent-skill-context.md), because project issue workers need reusable role/context guidance distinct from workstream node workers.
- [Automated PAW Review Loop](automated-paw-review-loop.md), because issue-scoped launches may eventually reuse the same PAW review automation.
- [Autonomous Wave Progression](autonomous-wave-progression.md), because the adoption ladder should distinguish single issue launches from wave-level autonomy.
- [Multi-Workstream Dependencies](multi-workstream-dependencies.md), because promoted issue work may become candidate/workstream dependency edges.
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md), because issue launches may turn into closeout observations or follow-up work.

## Open Questions

- Is Project fully derived from committed project config, or does it need a separate committed artifact beyond `.streamliner\config.json` / `streamliner.json`?
- Where should project issue query configuration live: app config, planning repo config, project config, or local user state?
- What should the onboarding flow do when a graph already exists under a root that lacks repo mappings?
- Should a project support multiple issue views in the first cut, or only one configured issue query?
- How should Streamliner detect that a GitHub issue is already associated with a workstream node?
- Should issue launch support terminal-first only at first, or also SDK-managed when the runtime is ready?
- What is the branch naming convention for project issue launches?
- How much project design context should be included automatically without overloading small issue work?
- Should the issue launch context include issue comments, linked PRs, or related issues?
- What is the minimal session-registry schema extension for project + issue binding?
- How should archived project issue sessions appear after the issue or PR is closed?
- What is the right path from an issue launch to a candidate workstream seed?

## Handoff Brief

Create a Project Surface and Issue Launches workstream.

The workstream should first define and implement project registration/config initialization so a builder can create or repair the project boundary Streamliner depends on: artifact location, repo ID mappings, design-doc entry points, and source registration. It should then define and implement the missing Project surface in Streamliner: a project-scoped operating page that groups registered repositories, design docs, active workstreams, project sessions, and a configured GitHub issue list. From that issue list, the builder should be able to launch PAW sessions directly from project issues without creating a workstream.

The issue remains the task-level source of truth. Streamliner should own the execution support around it: project issue context assembly, prompt profile reuse, worktree/branch setup, terminal or managed launch path, session registry binding, runtime tracking, and PR/session linkage. Sessions launched this way should attach to project + repo + issue rather than workstream + node, and should show up as project-attached sessions rather than ad-hoc sessions.

The workstream should preserve the core doctrine distinction: a project is the context boundary; a workstream is the geometry boundary. Do not create mini-workstreams for scoped issue work. Provide promotion paths when the issue grows into a candidate, existing workstream node, or closeout observation.
