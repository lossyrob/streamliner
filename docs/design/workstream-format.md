# Workstream Artifact Format

A workstream consists of two committed artifacts — a **brief** (`brief.md`) and a **dependency graph** (`graph.json`) — stored together in a workstream directory. These artifacts describe durable plan and progress. Fast-moving operational state lives separately in a local runtime store.

## Artifact Layers

Streamliner manages three distinct layers of state. Each has its own storage contract and change cadence.

### Design docs

Design docs describe the intended system. They typically live under `docs/design/` in the repository they describe but can also live in a separate design repo or a personal planning repo. Streamliner resolves design docs through repo registration and path configuration — it does not assume a fixed filesystem location.

### Workstream artifacts

Each workstream lives in its own directory containing `brief.md` and `graph.json`:

```text
workstreams/{workstream-id}/
  brief.md
  graph.json
  tasks/          ← optional, for local spec files
```

The `workstreams/` directory can live in the source repo (e.g. `.streamliner/workstreams/`), a dedicated planning repo, or a separate workstream repo. The graph's `repos` array and `designRefs` use repo IDs to link across these boundaries.

### Local runtime state

Fast-changing operational data is not part of the committed artifact set. Streamliner stores it in a machine-local runtime store:

```text
~/.streamliner/state/{projectKey}/{workstream-id}/
  runtime.json
  sessions.json
  tracker-cache.json
```

`projectKey` comes from `graph.json`. If omitted, it derives from the primary repo ID or the sole repo ID. Runtime state includes active session IDs, heartbeats, tracker snapshots, and transient node claims.

Runtime state contracts:

- It is a cache/overlay, not a committed artifact
- Each materialized file has a single logical writer
- Writers update files atomically (write-then-rename)
- Readers tolerate missing or stale files
- Entries record originating cwd/worktree path for multi-worktree reconciliation

### The separation principle

**Design docs, committed workstream artifacts, and local runtime state are separate layers.** The graph uses `repoId` + `path` references so the builder can place shared artifacts wherever they make sense, while fast-moving operational state stays out of Git.

## Config file (`config.json`)

Every Streamliner project has a config file that tells Streamliner where to find things. It lives alongside the workstreams directory — typically `.streamliner/config.json` in a source repo or `streamliner.json` at the root of a planning repo.

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

### Config fields

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | `1` | ✓ | Config schema version |
| `workstreamsDir` | string | ✓ | Path to the workstreams directory, relative to the config file |
| `repos` | object | ✓ | Map of repo IDs to local filesystem locations |

### Repo entry fields

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Path to the repo root, relative to the config file |
| `designDocsPath` | string | | Path to design docs within the repo root. Default: `"docs/design"` |

Repo IDs in the config must match the repo IDs in `graph.json` `repos` arrays and `designRefs`. The config describes the shareable artifact layout — it does not point at the runtime store. `designRefs.path` values are always repo-root-relative, not relative to `designDocsPath`.

## The Brief (`brief.md`)

The brief is the narrative companion to the graph. It captures intent, boundaries, durable current state, and the relationship to the project-level design layer.

### Structure

```markdown
# {Workstream Title}

## Purpose
{2-3 sentences. Why this workstream exists.}

## Approach
{1-3 paragraphs. Execution strategy and decomposition choices.}

## Design References
- `repoId:docs/design/index.md` - entry point for the design set
- `repoId:docs/design/{domain}.md` - authoritative design for a domain

## Boundaries
- **In scope:** {what is included}
- **Out of scope:** {what is explicitly excluded}
- **Deferred:** {what may happen in later waves}

## Current State
{Rewritten each time the workstream state meaningfully changes.}

## Decisions
- {Workstream-local execution decision}: {rationale}

## Open Questions
- {Question — removed when resolved}
```

### Brief guidelines

- **Target length:** Under 400 lines. Push detail to node specs.
- **Edit in place.** The brief reads as a coherent whole at any point; Git provides history.
- **Written for a cold reader.** A new session reading the brief, graph, and referenced design docs is immediately productive.
- **Decisions are workstream-local only.** Project-wide architectural choices belong in design docs or decision records.
- **Current State is a durable summary, not a heartbeat log.** Rewrite it on meaningful direction changes, not every session pulse.
- **Runtime telemetry stays outside the brief.** Session IDs, heartbeats, and tracker caches belong in the local runtime store.

## The Dependency Graph (`graph.json`)

The graph is the structured, machine-readable representation of the workstream's durable plan and latest promoted progress.

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | `1` | ✓ | Always `1` for this schema version |
| `id` | string | ✓ | Kebab-case workstream identifier |
| `projectKey` | string | | Stable project namespace for local runtime state. If omitted, derived from the primary or sole repo ID. |
| `title` | string | ✓ | Human-readable workstream title |
| `summary` | string | ✓ | Brief description of the workstream's current focus |
| `status` | enum | ✓ | `"active"`, `"blocked"`, or `"completed"` |
| `createdAt` | string | ✓ | ISO 8601 timestamp |
| `updatedAt` | string | ✓ | ISO 8601 timestamp of the last committed edit. Bump on intentional committed changes only. |
| `trackingIssue` | object | | Tracker reference anchoring the workstream (see Tracker Reference) |
| `repos` | array | ✓ | Repositories involved (see Repo) |
| `designRefs` | array | | Optional. Project-level design docs relevant to this workstream (see Design Reference). Agents read the full design set by default; this field is a hint for targeted context assembly. |
| `nodes` | array | ✓ | Work items and gates (see Node) |
| `checkpoints` | array | ✓ | Progress milestones (see Checkpoint) |

### Design Reference

Each design reference points to a project-level design artifact in a declared repository.

| Field | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | ✓ | Declared repository ID that owns the design doc |
| `path` | string | ✓ | Path to the design doc, relative to the repo root |

Include the repo's design index when it has a design set, plus the specific docs that materially constrain the workstream. Do not list every document in the design corpus.

### Node

Each node is a unit of work in the dependency graph.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case unique identifier |
| `type` | enum | ✓ | `"task"`, `"research"`, or `"gate"` |
| `title` | string | ✓ | Human-readable title |
| `summary` | string | ✓ | What this node accomplishes (1-2 sentences) |
| `status` | enum | ✓ | `"planned"`, `"ready"`, `"in-progress"`, `"blocked"`, or `"completed"` |
| `repoIds` | string[] | ✓ | References to declared repos (can be empty) |
| `tracker` | object | | Where the node's spec lives (see Tracker Reference) |
| `dependsOn` | string[] | ✓ | IDs of nodes that must complete before this one |

### Node types

- **task** — concrete work: implement a feature, write tests, set up infrastructure. Typically backed by a tracker.
- **research** — investigation or spike: explore an approach, evaluate a library, prototype. May or may not produce code.
- **gate** — validation checkpoint where the builder evaluates whether the workstream is on track. Gates block downstream work until passed.

Research nodes include **design sessions** — nodes whose purpose is to make implicit design explicit before downstream implementation begins. A design-session node is a valid early-wave node when the workstream's design is still implicit in the brief and graph. Its output is design documents and decision records, not code. After a design session completes, the downstream implementation graph can be refined because the intended design is now written down.

### Artifact state vs. operational state

The `status` field on workstreams, nodes, and checkpoints is the **durable artifact view** — the latest committed understanding. Streamliner also derives a fresher **operational view** at runtime by combining the committed graph with local runtime state, tracker snapshots, and session activity.

The rule:

1. **Commit artifact changes** when the plan changes or durable progress should be promoted.
2. **Update runtime state** for fast-moving operational facts.
3. **Render the UI from both** — the graph is the committed base layer; runtime/tracker data is the overlay.

### Repo

Declares a repository involved in the workstream.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case identifier used in node `repoIds` and `designRefs.repoId` |
| `owner` | string | ✓ | GitHub repository owner |
| `name` | string | ✓ | GitHub repository name |
| `role` | string | | Optional label (e.g. `"primary"`, `"secondary"`, `"documentation"`) |

### Tracker Reference

Each node can have a **tracker** pointing to the node's detailed spec. There is exactly one spec per node, in one place — either on an external platform or as a local file. The tracker is a discriminated union keyed on `type`.

#### GitHub tracker

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"github"` | ✓ | Tracker type |
| `owner` | string | ✓ | Repository owner |
| `repo` | string | ✓ | Repository name |
| `number` | number | ✓ | Issue number (positive integer) |

The issue body on GitHub is the spec. When a workstream uses GitHub-backed trackers, create a parent issue for the workstream and record it in `trackingIssue`.

#### Local tracker

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"local"` | ✓ | Tracker type |
| `path` | string | ✓ | Path to a markdown spec file, relative to the workstream directory |

Local spec files live in the workstream directory, typically under `tasks/`. They follow the same format as a GitHub issue body — outcome-oriented description, success criteria, and relevant context.

#### No tracker

When a node has no `tracker` field, its `title` and `summary` are all the spec it has. This is normal for later-wave sketch nodes and for gates.

#### When to use which

- **GitHub** — the default for projects hosted on GitHub. Issues are created during shaping for the current wave's nodes.
- **Local** — when there is no external tracker, for offline work, or when the builder wants specs version-controlled alongside workstream artifacts.
- **No tracker** — for sketch nodes in later waves and for gates. Specs are added when the node is promoted to a detailed wave.

Future tracker types (e.g. `"azure-devops"`, `"linear"`) can be added without changing the node schema — they are new `type` values with their own fields.

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

## Validation Rules

These constraints are enforced at parse time. Violations cause errors.

| # | Rule |
|---|---|
| 1 | All IDs are kebab-case: `[a-z0-9]+(-[a-z0-9]+)*` |
| 2 | No duplicate IDs within node, repo, or checkpoint arrays |
| 3 | `dependsOn` references must match existing node IDs |
| 4 | No self-dependencies |
| 5 | `repoIds` entries must match declared repo IDs |
| 6 | GitHub tracker `owner/repo` must match a declared repo |
| 7 | Local tracker paths are relative to the workstream directory |
| 8 | `designRefs.repoId` must match a declared repo |
| 9 | `designRefs.path` is repo-root-relative (not absolute) |
| 10 | No duplicate design references (same `repoId` + `path` pair) |
| 11 | Timestamps are ISO 8601 |
| 12 | `schemaVersion` must equal `1` |
| 13 | `projectKey` is kebab-case when present |

Runtime validation (tracker-cache freshness, cross-reference checks) is separate from parse-time schema validation.
