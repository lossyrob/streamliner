# Workstream Artifact Format Reference

This document defines the two committed artifacts that comprise a Streamliner workstream: the **brief** (`brief.md`) and the **dependency graph** (`graph.json`). It also covers where artifacts live, how local runtime state stays separate from those artifacts, how to onboard a project, and the relationship between design docs and workstreams.

A workstream executes against a project's **design layer**: design docs and decision records that describe the intended system. The workstream does not duplicate that design layer. It references the parts it depends on. See [DESIGN-DOCS.md](DESIGN-DOCS.md) for the full design layer specification.

## Where artifacts live

Streamliner manages two kinds of artifacts — **design docs** and **workstream artifacts** — and is deliberately flexible about where each lives. The right layout depends on the project.

### Design docs

Design docs typically live under `docs/design/` in the repository they describe:

```text
{repo}/
  docs/
    design/
      index.md
      {domain-or-concern}.md
      decisions/
        001-{slug}.md
```

But they don't have to live in the source repo. Common alternatives:

- **Separate design repo** — useful when the source repo is open source or shared and you don't want to push private design docs into it. Declare the design repo in the workstream's `repos` array and reference it by its `repoId`.
- **Planning repo** — for personal projects where keeping everything in one place is simpler. The design docs live alongside the workstream artifacts.
- **Source repo** — the default and most common case. Design authority lives next to the code it describes.

Streamliner resolves design docs through repo registration and path configuration. It does not assume a fixed location.

### Workstream artifacts

Each workstream lives in its own directory:

```text
workstreams/
  {workstream-id}/
    brief.md
    graph.json
    docs/
```

Where that `workstreams/` directory lives is up to the operator:

- **Dedicated planning repo** — a personal repo that holds workstream artifacts for all projects. This is the cleanest separation when managing many projects.
- **Source repo subdirectory** — e.g. `.streamliner/workstreams/` in the project repo itself. Simpler for single-repo projects. Can be `.gitignore`d if the workstream data shouldn't be shared.
- **Separate workstream repo** — similar to a planning repo but scoped to one project.

The graph's `repos` array and `designRefs` use repo IDs to link across these boundaries, so the physical layout doesn't constrain the logical references.

### Local runtime state

Fast-changing operational data is **not** part of the committed workstream artifact set. Streamliner keeps that in a machine-local runtime store, namespaced by `projectKey` and workstream:

```text
~/.streamliner/state/
  {projectKey}/
    {workstream-id}/
      runtime.json
      sessions.json
      tracker-cache.json
```

`projectKey` comes from the workstream's `graph.json`. If `projectKey` is omitted, derive it from the repo marked `role: "primary"`, or from the sole repo ID when only one repo is declared. This is intentionally workstream-scoped rather than config-scoped, because one planning repo config can host workstreams for multiple projects.

This state is for things like:

- active Copilot session IDs
- heartbeats and last-seen timestamps
- tracker snapshots (GitHub issue / PR state, or future ADO / local-task snapshots)
- transient node claims or launch metadata

The filenames shown above are illustrative. The stable contract is:

- runtime state is a cache/overlay, not a committed artifact
- each materialized runtime file has a single logical writer
- writers update files atomically (write temp file in the same directory, then rename)
- readers tolerate missing or stale files
- runtime entries record originating cwd or worktree path so overlays can be reconciled when multiple worktrees share a `projectKey`

It is intentionally **not committed by default**. It changes too quickly, is machine-local by nature, and should not create merge pressure on `graph.json`. Runtime state is shared across worktrees that use the same `projectKey` by design.

### The principle

**Design docs, committed workstream artifacts, and local runtime state are separate layers.** The graph schema uses `repoId` + `path` references precisely so the operator can put shared artifacts where they make sense for each project, while fast-moving operational state stays out of Git. Streamliner should never require a specific filesystem layout beyond "a directory with `brief.md` and `graph.json`" for the committed artifact layer.

### The config file (`config.json`)

Every Streamliner project needs a config file that tells Streamliner where to find things. The config lives alongside the workstreams directory — typically `.streamliner/config.json` when workstreams are in the source repo, or `streamliner.json` at the root of a planning repo.

```json
{
  "version": 1,
  "workstreamsDir": "workstreams",
  "repos": {
    "{repo-id}": {
      "path": "{relative-path-to-repo-root}",
      "designDocsPath": "docs/design"
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | `1` | ✓ | Config schema version |
| `workstreamsDir` | string | ✓ | Path to the workstreams directory, relative to the config file |
| `repos` | object | ✓ | Map of repo IDs to local filesystem locations |

Each repo entry:

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Path to the repo root, relative to the config file |
| `designDocsPath` | string | | Path to design docs within the repo root for design-catalog scanning. Default: `"docs/design"` |

Repo IDs in the config must match the repo IDs used in `graph.json` `repos` arrays and `designRefs`. This is how Streamliner resolves a `designRef` like `{"repoId": "robin", "path": "docs/design/index.md"}` to a local file: it looks up `robin` in the config, finds the repo's local path, and reads from there.

The config file describes the **shareable artifact layout**. It does not point at the fast-moving runtime store. Streamliner creates runtime state under its local state root (`~/.streamliner/state/...`) as needed. `designRefs.path` is always repo-root-relative; it is not relative to `designDocsPath`.

#### Example: both in the source repo

When workstreams and design docs both live in the project repo (e.g. Robin):

```text
robin/
  .streamliner/
    config.json        ← the config file
    workstreams/
      robin-v1/
        brief.md
        graph.json
  docs/
    design/
      index.md
      ...
  src/
    ...
```

```json
{
  "version": 1,
  "workstreamsDir": "workstreams",
  "repos": {
    "robin": {
      "path": ".."
    }
  }
}
```

`workstreamsDir: "workstreams"` resolves to `.streamliner/workstreams/` (relative to the config file). `repos.robin.path: ".."` resolves to the repo root (one level up from `.streamliner/`). Design docs default to `docs/design/` within the repo root.

#### Example: separate planning repo

When workstreams live in a personal planning repo and source repos are siblings on disk:

```text
~/proj/
  planning/
    streamliner.json   ← the config file
    workstreams/
      robin-v1/
        brief.md
        graph.json
      streamliner-v1/
        brief.md
        graph.json
  robin/
    docs/design/
      ...
    src/
      ...
  streamliner/
    docs/design/
      ...
    src/
      ...
```

```json
{
  "version": 1,
  "workstreamsDir": "workstreams",
  "repos": {
    "robin": {
      "path": "../robin"
    },
    "streamliner": {
      "path": "../streamliner"
    }
  }
}
```

#### Example: design docs in a separate repo

When contributing to an open source project where you can't push design docs upstream:

```json
{
  "version": 1,
  "workstreamsDir": "workstreams",
  "repos": {
    "upstream-project": {
      "path": "../upstream-project"
    },
    "my-design": {
      "path": "../my-upstream-design",
      "designDocsPath": "docs/design"
    }
  }
}
```

The workstream's `designRefs` would use `repoId: "my-design"` to reference design docs in the private repo, and `repoId: "upstream-project"` for code-level references.

---

## The brief (`brief.md`)

The brief is the narrative companion to the graph. It captures the workstream's intent, boundaries, durable current state, and relationship to the project-level design layer.

### Structure

```markdown
# {Workstream Title}

## Purpose
{2-3 sentences. Why this workstream exists. What end state it is serving.}

## Approach
{1-3 paragraphs. How this workstream is approaching the problem. Focus on
execution strategy, decomposition choices, and constraints specific to this
effort. Do not restate the whole project architecture here.}

## Design References
- `repoId:docs/design/index.md` - entry point for the relevant project design set
- `repoId:docs/design/{domain}.md` - authoritative design for a domain this
  workstream touches
- `repoId:docs/design/decisions/00x-{slug}.md` - important rationale this
  workstream must honor

## Boundaries
- **In scope:** {what is included}
- **Out of scope:** {what is explicitly excluded}
- **Deferred:** {what may happen in later waves}

## Current State
{Rewritten each time the workstream state changes. What just happened. What
is active. What is blocked. What the current wave is trying to accomplish.
What the next action should be.}

## Decisions
- {Workstream-local execution decision}: {rationale}
{This section is for workstream-local choices only. Project-level design
decisions belong in the referenced design docs and decision records.}

## Open Questions
- {Question}
{Removed when resolved. If the answer becomes a stable execution choice, move
it to Decisions. If it changes project design, promote it into the design
layer.}
```

### Guidelines

- **Target length:** Under 400 lines total. If longer, push detail down to node specs.
- **Edit in place, don't append.** The brief reads as a coherent whole at any point. Git history provides the audit trail.
- **Written for a cold reader.** A new session reading the brief, graph, and referenced design docs should be immediately productive.
- **The `Design References` section is human-readable.** The graph's `designRefs` array is the machine-readable source of truth. Keep them in sync.
- **The brief's `Decisions` section is not a copy of the design docs.** Use it for workstream-local sequencing, decomposition, and execution choices.
- **Current State is a durable summary, not a heartbeat log.** Rewrite it when the workstream meaningfully changes direction, ownership, or progress. Do not churn it for every session pulse, CI update, or tracker refresh.
- **Runtime telemetry lives outside the brief.** Session IDs, heartbeats, node claims, and tracker caches belong in Streamliner's local runtime store.

---

## The dependency graph (`graph.json`)

The graph is the structured, machine-readable representation of the workstream's durable plan and latest promoted progress.

### Top-level document

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | `1` | ✓ | Always `1` for this schema version |
| `id` | string | ✓ | Kebab-case identifier for the workstream |
| `projectKey` | string | | Stable logical project namespace for local runtime state. If omitted, derive it from the primary repo ID or the sole repo ID. |
| `title` | string | ✓ | Human-readable workstream title |
| `summary` | string | ✓ | Brief description of the workstream's current focus |
| `status` | enum | ✓ | `"active"`, `"blocked"`, or `"completed"` |
| `attention` | enum | ✓ | `"focus"`, `"watch"`, or `"parked"` |
| `createdAt` | string | ✓ | ISO 8601 timestamp |
| `updatedAt` | string | ✓ | ISO 8601 timestamp for the last committed edit to this `graph.json`. Bump it on any intentional committed graph change; never bump it for runtime-only overlays that are not written back into the artifact. |
| `trackingIssue` | object | | Tracker reference anchoring the workstream itself (see Tracker Reference) |
| `repos` | array | ✓ | Repositories involved in this workstream (see Repo) |
| `designRefs` | array | ✓ | Project-level design docs and decision records relevant to this workstream (see Design Reference). Use an empty array if none exist yet. |
| `nodes` | array | ✓ | Work items and gates (see Node) |
| `checkpoints` | array | ✓ | Progress milestones (see Checkpoint) |

### Design Reference

Each design reference points to a project-level design artifact in a declared repository.

| Field | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | ✓ | Declared repository ID that owns the design doc |
| `path` | string | ✓ | Path to a design doc or decision record relative to the repo root |

Keep references lean:

- include the repo's `docs/design/index.md` when that repo has a design set
- include the specific living design docs and decision records that materially constrain the workstream
- do not list every document in the design corpus "just in case"

### Node

Each node is a unit of work in the dependency graph.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case unique identifier |
| `type` | enum | ✓ | `"task"`, `"research"`, or `"gate"` |
| `title` | string | ✓ | Human-readable title |
| `summary` | string | ✓ | What this node accomplishes (1-2 sentences) |
| `status` | enum | ✓ | Durable node status: `"planned"`, `"ready"`, `"in-progress"`, `"blocked"`, or `"completed"` |
| `attention` | enum | ✓ | `"focus"`, `"watch"`, or `"parked"` |
| `repoIds` | string[] | ✓ | References to declared repos (can be empty) |
| `tracker` | object | | Where the node's spec lives (see Tracker Reference) |
| `dependsOn` | string[] | ✓ | IDs of nodes that must complete before this one |

**Node types:**

- **task** - concrete work: implement a feature, write tests, set up infrastructure. Typically backed by a GitHub issue.
- **research** - investigation or spike: explore an approach, evaluate a library, prototype something. May or may not produce code.
- **gate** - validation checkpoint where the operator evaluates whether the workstream is on track. Gates block downstream work until passed. Use gates at wave boundaries or major milestones.

**Attention levels (engagement control):**

- **focus** - the operator wants to be involved: review the plan, review the PR, possibly co-pilot.
- **watch** - the operator wants to see the output but trusts autonomous execution.
- **parked** - fully autonomous. The operator does not need to see this unless flagged.

Waves are represented structurally for now through dependencies, checkpoints, and whether a node has been promoted to a tracker-backed detailed spec. There is no explicit `wave` field in the schema yet.

### Artifact state vs. operational state

The current schema stores a single committed `status` field on the workstream, nodes, and checkpoints. Treat that field as the **durable artifact view**: the latest committed understanding of the workstream.

Streamliner may also derive a fresher **operational view** at runtime by combining the committed graph with:

- local runtime state under `~/.streamliner/state/...`
- tracker snapshots (GitHub today; other platforms later)
- session activity and launch metadata

That derived view can show states like "waiting for review", "waiting for validation", or "session running" without rewriting `graph.json` on every pulse.

The rule is:

1. **Commit artifact changes** when the plan changes or when durable progress should be promoted into the shared workstream record.
2. **Update runtime state** for fast-moving operational facts.
3. **Render the UI from both**, with the graph as the committed base layer and runtime/tracker data as the overlay.

Node-specific design narrowing lives in the node's tracker/spec and coordination notes for now. Add a dedicated node-level `designRefs` field only if context assembly later proves that a separate machine-readable field is needed.

When multiple worktrees for the same `projectKey` are active, runtime overlay entries must carry enough source metadata (at minimum cwd/worktree path) for the UI to label or filter them correctly against the artifact view it is rendering.

### Repo

Declares a repository involved in the workstream.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case identifier used in node `repoIds` and `designRefs.repoId` |
| `owner` | string | ✓ | GitHub repository owner |
| `name` | string | ✓ | GitHub repository name |
| `role` | string | | Optional label (e.g. `"primary"`, `"secondary"`, `"documentation"`) |

### Tracker Reference

Each node can have a **tracker** that points to the node's detailed spec. There is exactly one spec per node, and it lives in one place — either on an external platform or as a local file.

The tracker is a discriminated union keyed on `type`:

#### GitHub tracker

```json
{
  "type": "github",
  "owner": "lossyrob",
  "repo": "robin-editor",
  "number": 3
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"github"` | ✓ | Tracker type |
| `owner` | string | ✓ | Repository owner |
| `repo` | string | ✓ | Repository name |
| `number` | number | ✓ | Issue number (positive integer) |

The issue body on GitHub is the spec. Streamliner reads from and writes to it.

#### Local tracker

```json
{
  "type": "local",
  "path": "tasks/project-scaffold.md"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"local"` | ✓ | Tracker type |
| `path` | string | ✓ | Path to a markdown spec file, relative to the workstream directory |

The spec file lives in the workstream directory, typically under `tasks/`:

```text
workstreams/
  robin-v1/
    brief.md
    graph.json
    tasks/
      project-scaffold.md
      ui-test-harness.md
      file-tree-widget.md
```

Local spec files follow the same format as a GitHub issue body — outcome-oriented description of what the node should accomplish, success criteria, and any relevant context. They are the spec that a worker session reads.

#### No tracker

When a node has no `tracker` field, the node's `title` and `summary` are all the spec it has. This is normal for later-wave sketch nodes and for gates.

#### When to use which

- **GitHub** — the default for projects hosted on GitHub. Issues get created during workstream shaping for Wave 1 nodes.
- **Local** — when there's no external tracker (personal projects, non-GitHub platforms not yet supported, offline work, or when the operator wants spec content version-controlled alongside the workstream artifacts).
- **No tracker** — for sketch nodes in later waves and for gates. Specs get added when the node is promoted to a detailed wave.

Future tracker types (e.g. `"azure-devops"`, `"linear"`) can be added without changing the node schema — they are just new `type` values with their own fields.

### Checkpoint

A named progress milestone that groups related nodes.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case identifier |
| `title` | string | ✓ | Human-readable title |
| `summary` | string | ✓ | What this checkpoint represents |
| `status` | enum | ✓ | `"planned"` or `"completed"` |
| `nodeIds` | string[] | ✓ | IDs of nodes associated with this checkpoint |

Checkpoints are optional organizational markers. They are useful for tracking progress through waves but are not required for the graph to function.

---

## Validation rules

These constraints are enforced at parse time. Violations will cause errors:

1. **All IDs are kebab-case** - lowercase letters, digits, and hyphens only: `[a-z0-9]+(-[a-z0-9]+)*`
2. **No duplicate IDs** - node IDs, repo IDs, and checkpoint IDs must each be unique within their array
3. **`dependsOn` references must exist** - every ID in a node's `dependsOn` must match an existing node ID
4. **No self-dependencies** - a node cannot list its own ID in `dependsOn`
5. **`repoIds` reference declared repos** - every ID in a node's `repoIds` must match a declared repo ID
6. **GitHub tracker repos must be declared** - if a node or workstream has a `tracker` of type `"github"`, its `owner/repo` must match a declared repo
7. **Local tracker paths are workstream-relative** - a `tracker` of type `"local"` uses a path relative to the workstream directory (e.g. `tasks/project-scaffold.md`)
8. **`designRefs.repoId` must match a declared repo** - every design reference must point at one of the declared repos
9. **`designRefs.path` is repo-relative** - use a relative path such as `docs/design/index.md`, not an absolute path
10. **No duplicate design references** - the same `repoId + path` pair cannot appear twice
11. **Timestamps are ISO 8601** - e.g. `"2026-04-01T18:22:14.400Z"`
12. **`schemaVersion` must equal `1`**
13. **`projectKey` is kebab-case when present**

Streamliner should also validate `designRefs` against the registered design catalog when one exists, but that is runtime validation rather than parse-time schema validation.

Separately, Streamliner may validate runtime state freshness and tracker-cache freshness, but those checks are outside the committed artifact schema.

---

## Example: minimal workstream

A small workstream with 4 nodes across 2 waves:

### `brief.md`

```markdown
# Robin Text Editor

## Purpose
Build a lightweight file browser, editor, and markdown viewer for Windows
using Python + tkinter, targeting a small memory footprint and fast startup.

## Approach
Start with a thin app shell and core editing path before markdown rendering or
git integration. This workstream is focused on building a stable Wave 1 base
that later waves can safely extend.

## Design References
- `robin:docs/design/index.md` - entry point for Robin's design set
- `robin:docs/design/application-architecture.md` - intended application
  structure, window model, and major UI domains
- `robin:docs/design/decisions/001-window-per-process.md` - rationale for
  per-window process isolation

## Boundaries
- **In scope:** Project scaffold, empty app shell, file tree, tabbed editor
- **Out of scope:** Markdown rendering, git integration, theming polish, LSP
- **Deferred:** In-file search, drag-reorder tabs, find-in-files

## Current State
Wave 1 is starting. No work has completed yet. The first node to execute is
`project-scaffold`, followed by the file tree and editor core in parallel.

## Decisions
- Deliver scaffold plus core editing before markdown or git work so later
  waves land on a stable app frame.

## Open Questions
- Do we want Wave 1 to include hidden-file toggling in the file tree, or leave
  that for the next wave?
```

### `graph.json`

```json
{
  "schemaVersion": 1,
  "id": "robin-editor",
  "projectKey": "robin",
  "title": "Robin Text Editor",
  "summary": "Wave 1: project scaffold and core editing capabilities.",
  "status": "active",
  "attention": "focus",
  "createdAt": "2026-04-08T14:00:00.000Z",
  "updatedAt": "2026-04-08T14:00:00.000Z",
  "repos": [
    {
      "id": "robin",
      "owner": "lossyrob",
      "name": "robin",
      "role": "primary"
    }
  ],
  "designRefs": [
    {
      "repoId": "robin",
      "path": "docs/design/index.md"
    },
    {
      "repoId": "robin",
      "path": "docs/design/application-architecture.md"
    },
    {
      "repoId": "robin",
      "path": "docs/design/decisions/001-window-per-process.md"
    }
  ],
  "nodes": [
    {
      "id": "project-scaffold",
      "type": "task",
      "title": "Project scaffold",
      "summary": "Set up pyproject.toml, src/robin/__main__.py, an empty app window, CI pipeline, and test fixtures.",
      "status": "ready",
      "attention": "watch",
      "repoIds": ["robin"],
      "tracker": {
        "type": "github",
        "owner": "lossyrob",
        "repo": "robin",
        "number": 1
      },
      "dependsOn": []
    },
    {
      "id": "file-tree-widget",
      "type": "task",
      "title": "File tree widget",
      "summary": "Lazy-loaded recursive directory tree with expand/collapse and a usable initial filtering model.",
      "status": "planned",
      "attention": "watch",
      "repoIds": ["robin"],
      "dependsOn": ["project-scaffold"]
    },
    {
      "id": "editor-core",
      "type": "task",
      "title": "Core text editor",
      "summary": "Tabbed text editor with save, undo/redo, dirty indicators, and a minimal highlighting path.",
      "status": "planned",
      "attention": "watch",
      "repoIds": ["robin"],
      "dependsOn": ["project-scaffold"]
    },
    {
      "id": "wave-1-gate",
      "type": "gate",
      "title": "Wave 1: basic app works",
      "summary": "The app launches, shows a file tree, and opens files in a usable tabbed editor. Operator validates before later feature waves proceed.",
      "status": "planned",
      "attention": "focus",
      "repoIds": ["robin"],
      "dependsOn": ["file-tree-widget", "editor-core"]
    }
  ],
  "checkpoints": [
    {
      "id": "scaffold-complete",
      "title": "Project scaffold complete",
      "summary": "Build tools, test infrastructure, and an empty app shell are in place.",
      "status": "planned",
      "nodeIds": ["project-scaffold"]
    },
    {
      "id": "wave-1-complete",
      "title": "Wave 1 complete",
      "summary": "File tree and editor work together inside a usable app shell.",
      "status": "planned",
      "nodeIds": ["file-tree-widget", "editor-core", "wave-1-gate"]
    }
  ]
}
```

---

## Onboarding a project

Design docs and the first workstream are shaped together. There is no separate "write all the design docs first" phase, and there is no skipping design docs entirely.

### Brand new project

The operator has ideas, maybe a spec or notes from conversations. The first shaping session (Phase 1) produces both artifacts at once:

1. Read whatever exists — specs, notes, prior conversation summaries.
2. Distill the key design decisions into an initial `docs/design/index.md` and a small number of satellites. These can start as a single paragraph each. Fuzzy areas stay fuzzy; open questions go in the index.
3. Capture any already-decided architectural choices as decision records.
4. Produce the workstream brief referencing those design docs.
5. Produce the graph with `designRefs` pointing at them.
6. Create specs for Wave 1 nodes — either as GitHub issues (with `tracker.type: "github"`) or as local markdown files in `tasks/` (with `tracker.type: "local"`). Later-wave nodes stay as sketches with no tracker.
7. Commit everything together.

As Wave 1 executes, workers update design docs through the normal design-impact flow. By Wave 2, the design docs are richer because real implementation has refined the intended design.

### Existing project

The design is implicit in the code and possibly scattered across READMEs, specs, and conversation history. The shaping session:

1. Read the code, existing docs, and any available context.
2. Extract the current intended design into design docs — not the whole system, just the design surfaces the workstream will touch.
3. Produce the workstream artifacts referencing those docs.

Later workstreams add more satellites as they touch new areas. The design layer grows organically alongside the work.

### Existing project where you don't control the repo

When contributing to an open source project or a shared codebase where you can't push `docs/design/` into the source repo:

1. Create the design docs in a separate repo (a personal design repo or the planning repo itself).
2. Declare that repo in the workstream's `repos` array.
3. Reference the design docs using that repo's ID in `designRefs`.

The design docs describe the intended system from the operator's perspective. They don't need to live in the upstream repo to be useful.

### The principle

**Write the design docs you need for the work you're about to do, not the whole system.** The design layer starts minimal and grows as workstreams execute, each one contributing to the design docs it touches.

---

## Notes for agents producing workstream artifacts

- **The brief and graph are a pair.** Always produce both.
- **Create specs for Wave 1 nodes during shaping.** Each Wave 1 task or research node should have a `tracker` — either a GitHub issue or a local spec file. Later-wave nodes are sketches with no tracker until promoted.
- **Use `tracker.type: "github"` when creating GitHub issues.** Create the issue, then record the `owner`, `repo`, and `number` in the node's tracker field.
- **Do not write fast-moving session state into the brief or graph.** Session IDs, heartbeats, tracker snapshots, and launch claims belong in the local runtime store.
- **Only update `graph.json` for durable plan or progress changes.** Runtime overlays should be recomputed, not committed.
- **Use `tracker.type: "local"` when working without GitHub Issues.** Write the spec as a markdown file under `tasks/` in the workstream directory (e.g. `tasks/project-scaffold.md`).
- **Workstreams reference design docs; they do not copy them.** Use `Design References` in the brief and `designRefs` in the graph to pull in project-level design authority.
- **Prefer `current` design docs.** Only reference `draft` design docs when the workstream is explicitly shaping or validating that draft.
- **Include the design index plus the specific docs that matter.** Do not dump the whole design corpus into `designRefs`.
- **Keep brief decisions workstream-local.** Project-wide architectural choices belong in design docs or decision records, not in the brief's `Decisions` section.
- **Nodes should be outcome-oriented.** The title and summary describe what the node accomplishes, not the implementation steps. Implementation details go in the spec (issue or local file).
- **Use gates at wave boundaries.** A gate marks where the operator evaluates the workstream before the next wave proceeds.
- **Later-wave nodes are sketches.** They need a title, summary, and rough dependencies, but no tracker or detailed spec.
- **Keep dependencies minimal.** Only add an edge if the upstream node's output is genuinely required by the downstream node.
- **Do not include GitHub snapshot data.** Runtime-enriched issue and PR data are viewer concerns, not authored graph content.
- **Set attention levels thoughtfully.** Most nodes are `"watch"`. Use `"focus"` for architecturally critical or operator-sensitive nodes. Use `"parked"` for later-wave or completed work that does not need attention.
