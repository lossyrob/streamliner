# Workstream Artifact Format Reference

This document defines the two artifacts that comprise a Streamliner workstream: the **brief** (`brief.md`) and the **dependency graph** (`graph.json`). Use this reference to produce valid workstream artifacts.

## Workstream directory structure

Each workstream lives in its own directory within the planning repository:

```
workstreams/
  └── {workstream-id}/
        ├── brief.md       ← Narrative: purpose, approach, boundaries, state
        ├── graph.json      ← Structured: nodes, edges, statuses, issues
        └── docs/           ← Optional supporting documents
```

---

## The brief (`brief.md`)

The brief is the narrative companion to the graph. It captures the intent, approach, and current state of the workstream — everything an orchestrator or worker session needs to understand the *why* and *how* behind the graph's *what*.

### Structure

```markdown
# {Workstream Title}

## Purpose
{2-3 sentences. Why this workstream exists. What the end state looks like.
This almost never changes once established.}

## Approach
{1-3 paragraphs. How we're building this — architecture, technology choices,
key patterns, constraints. This is the shared context that tells agents how
to think about decisions in this workstream. Updated as understanding deepens.}

## Boundaries
- **In scope:** {what's included}
- **Out of scope:** {what's explicitly excluded}
- **Deferred:** {what we'll consider in later waves}

## Current State
{Rewritten each time the workstream state changes. What just happened.
What's in flight. What's blocked. What the current wave is and where it
stands. What the next action should be.

This section is FULLY REWRITTEN on each update — never appended to.
It always reads as the current truth.}

## Decisions
- {Decision}: {rationale}
{Entries are removed when no longer relevant — superseded or now obvious
from the approach section. Keep this list short and current.}

## Open Questions
- {Question}
{Removed when resolved. If the answer was non-obvious, move to Decisions.}
```

### Guidelines

- **Target length:** Under 400 lines total. If longer, push detail down to issue specs.
- **Edit in place, don't append.** The brief reads as a coherent whole at any point. Git history provides the audit trail.
- **Written for a cold reader.** A new session reading just this brief + the graph should be immediately productive.
- **Current State is the most volatile section.** Rewrite it whenever the situation changes.

---

## The dependency graph (`graph.json`)

The graph is the structured, machine-readable representation of the workstream's plan.

### Top-level document

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | `1` | ✓ | Always `1` for this schema version |
| `id` | string | ✓ | Kebab-case identifier for the workstream |
| `title` | string | ✓ | Human-readable workstream title |
| `summary` | string | ✓ | Brief description of the workstream's current focus |
| `status` | enum | ✓ | `"active"`, `"blocked"`, or `"completed"` |
| `attention` | enum | ✓ | `"focus"`, `"watch"`, or `"parked"` |
| `createdAt` | string | ✓ | ISO 8601 timestamp |
| `updatedAt` | string | ✓ | ISO 8601 timestamp (update on every change) |
| `trackingIssue` | object | | GitHub issue anchoring the workstream (see Issue Reference) |
| `repos` | array | ✓ | Repositories involved in this workstream (see Repo) |
| `nodes` | array | ✓ | Work items and gates (see Node) |
| `checkpoints` | array | ✓ | Progress milestones (see Checkpoint) |

### Node

Each node is a unit of work in the dependency graph.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case unique identifier |
| `type` | enum | ✓ | `"task"`, `"research"`, or `"gate"` |
| `title` | string | ✓ | Human-readable title |
| `summary` | string | ✓ | What this node accomplishes (1-2 sentences) |
| `status` | enum | ✓ | `"planned"`, `"ready"`, `"in-progress"`, `"blocked"`, or `"completed"` |
| `attention` | enum | ✓ | `"focus"`, `"watch"`, or `"parked"` |
| `repoIds` | string[] | ✓ | References to declared repos (can be empty) |
| `issue` | object | | Linked GitHub issue (see Issue Reference) |
| `dependsOn` | string[] | ✓ | IDs of nodes that must complete before this one |

**Node types:**
- **task** — Concrete work: implement a feature, write tests, set up infrastructure. Typically backed by a GitHub issue.
- **research** — Investigation or spike: explore an approach, evaluate a library, prototype something. May or may not produce code.
- **gate** — Validation checkpoint where the operator evaluates whether the workstream is on track. Gates block downstream work until passed. Use gates at wave boundaries or major milestones.

**Attention levels (engagement control):**
- **focus** — The operator wants to be involved: review the plan, review the PR, possibly co-pilot.
- **watch** — The operator wants to see the output but trusts autonomous execution.
- **parked** — Fully autonomous. The operator doesn't need to see this unless flagged.

### Repo

Declares a repository involved in the workstream.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case identifier used in node `repoIds` |
| `owner` | string | ✓ | GitHub repository owner |
| `name` | string | ✓ | GitHub repository name |
| `role` | string | | Optional label (e.g., `"primary"`, `"documentation"`) |

### Issue Reference

Links to a GitHub issue.

| Field | Type | Required | Description |
|---|---|---|---|
| `owner` | string | ✓ | Repository owner |
| `repo` | string | ✓ | Repository name |
| `number` | number | ✓ | Issue number (positive integer) |

### Checkpoint

A named progress milestone that groups related nodes.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Kebab-case identifier |
| `title` | string | ✓ | Human-readable title |
| `summary` | string | ✓ | What this checkpoint represents |
| `status` | enum | ✓ | `"planned"` or `"completed"` |
| `nodeIds` | string[] | ✓ | IDs of nodes associated with this checkpoint |

Checkpoints are optional organizational markers. They're useful for tracking progress through waves but are not required for the graph to function.

---

## Validation rules

These constraints are enforced at parse time. Violations will cause errors:

1. **All IDs are kebab-case** — lowercase letters, digits, and hyphens only: `[a-z0-9]+(-[a-z0-9]+)*`
2. **No duplicate IDs** — node IDs, repo IDs, and checkpoint IDs must each be unique within their array
3. **`dependsOn` references must exist** — every ID in a node's `dependsOn` must match an existing node ID
4. **No self-dependencies** — a node cannot list its own ID in `dependsOn`
5. **`repoIds` reference declared repos** — every ID in a node's `repoIds` must match a declared repo ID
6. **Issue repos must be declared** — if a node or the workstream has an `issue`, its `owner/repo` must match a declared repo
7. **Timestamps are ISO 8601** — e.g., `"2026-04-01T18:22:14.400Z"`
8. **`schemaVersion` must equal `1`**

---

## Example: minimal workstream

A small workstream with 4 nodes across 2 waves:

### `brief.md`

```markdown
# Robin Text Editor

## Purpose
Build a lightweight file browser, editor, and markdown viewer for Windows
using Python + tkinter, targeting < 50 MB memory at steady state.

## Approach
Python 3.12+ with tkinter/ttk for the UI, ttkbootstrap for theming,
mistune for markdown parsing, and Pygments for syntax highlighting. The
app shells out to git for status/branch info rather than using a git
library. Each window is a separate OS process for memory isolation.

## Boundaries
- **In scope:** File tree, tabbed editor, markdown rendering, light git
  integration, dark/light theming, in-file search
- **Out of scope:** LSP, autocomplete, extensions, integrated terminal,
  diff viewer, remote files, collaborative editing
- **Deferred:** Find-in-files, tab reorder by drag

## Current State
Wave 1 (project scaffold + core editor) is starting. No work has been
completed yet. The first node to execute is `project-scaffold`.

## Decisions
- Separate OS process per window: gives memory isolation and crash
  containment without IPC complexity in V1.
- ttkbootstrap over manual ttk styling: faster to get a modern look,
  acceptable memory overhead.

## Open Questions
- What's the right markdown rendering pipeline for tkinter Text widgets?
  Need to evaluate mistune → tag-based formatting vs. alternatives.
```

### `graph.json`

```json
{
  "schemaVersion": 1,
  "id": "robin-editor",
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
  "nodes": [
    {
      "id": "project-scaffold",
      "type": "task",
      "title": "Project scaffold",
      "summary": "Set up pyproject.toml, script/*, src/robin/__main__.py, empty app window, CI pipeline, and test fixtures.",
      "status": "ready",
      "attention": "watch",
      "repoIds": ["robin"],
      "issue": {
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
      "summary": "Lazy-loaded recursive directory tree with expand/collapse, .gitignore filtering, and hidden files toggle.",
      "status": "planned",
      "attention": "watch",
      "repoIds": ["robin"],
      "dependsOn": ["project-scaffold"]
    },
    {
      "id": "editor-core",
      "type": "task",
      "title": "Core text editor",
      "summary": "Tabbed text editor with line numbers, syntax highlighting via Pygments, save/undo/redo, and dirty indicators.",
      "status": "planned",
      "attention": "watch",
      "repoIds": ["robin"],
      "dependsOn": ["project-scaffold"]
    },
    {
      "id": "wave-1-gate",
      "type": "gate",
      "title": "Wave 1: basic app works",
      "summary": "The app launches, shows a file tree, opens files in tabbed editor with syntax highlighting. Operator validates before proceeding to markdown rendering, git integration, and theming.",
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
      "summary": "Build tools, test infrastructure, and empty app window are in place.",
      "status": "planned",
      "nodeIds": ["project-scaffold"]
    },
    {
      "id": "wave-1-complete",
      "title": "Wave 1 complete",
      "summary": "File tree + editor working together in a usable app shell.",
      "status": "planned",
      "nodeIds": ["file-tree-widget", "editor-core", "wave-1-gate"]
    }
  ]
}
```

---

## Notes for agents producing workstream artifacts

- **The brief and graph are a pair.** Always produce both. The brief explains the *why* and *how*; the graph captures the *what* and *when*.
- **Nodes should be outcome-oriented.** The title and summary describe what the node accomplishes, not the implementation steps. Implementation details go in the issue spec (on GitHub), not in the graph.
- **Use gates at wave boundaries.** A gate marks where the operator evaluates the workstream before the next wave proceeds. Downstream nodes of a gate don't get detailed specs until the gate passes.
- **Later-wave nodes are sketches.** They need a title, summary, and rough dependencies, but no issue link or detailed spec. They'll be fleshed out during wave transitions.
- **Keep dependencies minimal.** Only add an edge if the upstream node's output is genuinely required by the downstream node. Don't create dependencies based on "nice to have" ordering. The graph engine applies transitive reduction for display, but the stored graph should still be lean.
- **Don't include GitHub snapshot data.** The `WorkstreamGithubIssueSnapshot` and `WorkstreamGithubPullRequestSnapshot` types are runtime enrichment data fetched by the viewer. They are never authored into the graph.
- **Set attention levels thoughtfully.** Most nodes are `"watch"`. Use `"focus"` for nodes where the operator has explicitly asked to be involved or where the node is architecturally critical. Use `"parked"` for completed work or future-wave nodes that don't need attention yet.
