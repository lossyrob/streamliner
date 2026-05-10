---
kind: design-doc
status: current
last_updated: 2026-05-10
update_semantics: rewrite-in-place
authoritative_for: "Workstream artifact format, documentation references, and runtime-state boundaries"
scope_tags:
  - workstreams
  - runtime-state
  - artifacts
code_paths:
  - src/workstream-schema.ts
  - src/workstream-view-model.ts
  - src/session-registry*.ts
references_decisions:
  - 5
  - 11
---

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
~/.streamliner/state/
  session-registry/
    index.json
    entries/
      {registry-id}.json
    quarantine/
    registry.lock
  {projectKey}/{workstream-id}/
    runtime.json
    sessions.json
    tracker-cache.json
```

The global `session-registry/` subtree is graph-independent and persists the builder's tracked-session catalog. Its authoritative file rules, merge behavior, and API contract live in [session-system.md](session-system.md).

`projectKey` comes from `graph.json`. If omitted, it derives from the primary repo ID or the sole repo ID. The per-workstream subtree holds runtime overlay data such as active session IDs, observed session state, tracker snapshots, and transient node claims.

Runtime state contracts:

- It is a cache/overlay, not a committed artifact
- Each materialized file has a single logical writer
- Writers update files atomically (write-then-rename)
- Readers tolerate missing or stale files
- Entries record originating cwd/worktree path for multi-worktree reconciliation
- **Every materialized runtime-state file carries a top-level `schemaVersion` integer.** Readers that encounter an unknown `schemaVersion` treat the file as opaque and ignore it rather than partially parsing it. Writers only mutate files whose `schemaVersion` matches the writer's expected version; a mismatch triggers a quarantine-and-recreate path, never an in-place merge of incompatible shapes.
- Runtime consumers may define subtree-specific authoritative-file rules (for example, record-authoritative registry entries plus a derived index) so long as those rules are explicit in the owning design doc.

### Runtime-state open questions

- **Multi-process coordination beyond the session registry**: The session registry now uses a registry-level advisory lock plus record-authoritative rebuilds. Should other runtime-state writers standardize on the same lock/election pattern, or keep file-specific coordination rules?
- **Schema migration beyond the session registry**: Registry files quarantine-and-recreate on schema mismatch. Should other runtime-state files follow the same approach, or adopt a shared lazy/eager migration policy before the first broader `schemaVersion: 2` rollout?

### The separation principle

**Design docs, committed workstream artifacts, and local runtime state are separate layers.** The graph uses `repoId` + `path` references so the builder can place shared artifacts wherever they make sense, while fast-moving operational state stays out of Git.

## Unified docs-site implementation contract

Streamliner's own documentation should publish as one VitePress site rooted at
`docs/`, not as separate sites per audience. The unified site preserves
`docs/design/` as the Design section and adds peer sections for User Guide and
Architecture.

The intended source layout is:

```text
docs/
  index.md                 ← site landing page and audience router
  guide/
    index.md               ← User Guide starter page
  architecture/
    index.md               ← Architecture starter map
  design/
    index.md               ← existing Design entry point
    product.md
    operating-model.md
    design-layer.md
    workstream-format.md
    concepts/
    decisions/
  .vitepress/
    config.ts              ← unified site config
```

Wave 2 should move VitePress configuration from the Design section to the
unified `docs/` root, update `npm run docs:*` scripts to run against `docs`, and
publish the built site artifact through GitHub Pages. The published navigation
should make the three audience sections visible at the top level:

| Section | Navigation expectation |
|---|---|
| User Guide | User-facing entry in top nav and sidebar, starting at `/guide/` |
| Architecture | Contributor/agent orientation entry in top nav and sidebar, starting at `/architecture/` |
| Design | Intended-system authority entry in top nav and sidebar, starting at `/design/` |

Design content should remain source-compatible under `docs/design/`; Wave 2 may
update VitePress links and sidebar paths, but should not weaken Design authority
or publish `.streamliner/shaping/` material.

Minimum starter content means the unified site is inspectable and honest, not
complete:

| Section | Starter minimum |
|---|---|
| Site root | A landing page that identifies the three documentation families, states their authority boundaries, and routes readers to Guide, Architecture, and Design. |
| User Guide | `docs/guide/index.md` with at least installation/startup pointers, the primary user workflows Streamliner supports today, and a clear note that the section is a starter guide. |
| Architecture | `docs/architecture/index.md` with a current high-level codebase map: major runtime processes, important source directories, state/storage locations, and where agents should look first. |
| Design | Existing `docs/design/` content preserved as the normative intended-system section, with decision records still discoverable. |

GitHub Pages publishability is part of the contract: the docs build must produce
a static artifact suitable for Pages, and any CI or repository Pages settings
needed to publish that artifact belong to the Wave 2 implementation.

## Config file (`config.json`)

Every Streamliner project has a config file that tells Streamliner where to find things. It lives alongside the workstreams directory — typically `.streamliner/config.json` in a source repo or `streamliner.json` at the root of a planning repo.

```json
{
  "version": 1,
  "workstreamsDir": "workstreams",
  "repos": {
    "{repo-id}": {
      "path": "{relative-path-to-repo-root}",
      "docs": {
        "design": {
          "path": "docs/design",
          "required": true
        },
        "architecture": {
          "path": "docs/architecture",
          "required": false
        },
        "userGuide": {
          "path": "docs/guide",
          "required": false
        }
      }
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
| `docs` | object | | Documentation-family catalog for the repo. If omitted, Streamliner uses conventional defaults and compatibility fields. |
| `designDocsPath` | string | | Compatibility alias for `docs.design.path`. Default: `"docs/design"` |

Documentation-family entries use this shape:

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Path to the documentation-family root, relative to the repo root |
| `required` | boolean | | Whether missing docs in this family should block normal Streamliner context expectations. Default: `true` for Design, `false` for Architecture and User Guide. |

Conventional defaults are:

| Family | Config key | Default path | Required default |
|---|---|---|---|
| Design | `design` | `docs/design` | `true` |
| Architecture | `architecture` | `docs/architecture` | `false` |
| User Guide | `userGuide` | `docs/guide` | `false` |

`docs/user-guide` is an accepted discovery fallback for User Guide when no
explicit config exists, but new Streamliner docs should use `docs/guide`.

Wave 3 should treat `docs.design.path` as the canonical target shape while
preserving `designDocsPath` as a backward-compatible read alias. If both are
present, `docs.design.path` wins. Wave 3 implementation planning must confirm
all current `designDocsPath` consumers before changing parser or context-package
code.

Repo IDs in the config must match the repo IDs in `graph.json` `repos` arrays,
`designRefs`, and `docRefs`. The config describes the shareable artifact layout
— it does not point at the runtime store. Reference paths are always
repo-root-relative, not relative to the configured documentation-family root.

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
- `repoId:docs/design/{domain}.md` - high-priority starting point for this workstream

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

## Additional Context
{Optional. Unstructured supplementary context the workstream-shaping agent has gathered: conversation excerpts worth preserving, prior-art links, per-node hints, stakeholder color, exploratory threads, references the structured sections deliberately leave out.}
```

### Brief guidelines

- **Target length:** Structured sections (Purpose through Open Questions) target under 400 lines so a cold reader can absorb the workstream quickly. Push detail to node specs.
- **Edit in place.** The brief reads as a coherent whole at any point; Git provides history.
- **Written for a cold reader.** A new session reading the brief, graph, and design layer — starting with the referenced docs — is immediately productive.
- **Decisions are workstream-local only.** Project-wide architectural choices belong in design docs or decision records.
- **Current State is a durable summary, not a runtime telemetry log.** Rewrite it on meaningful direction changes, not every session pulse.
- **Runtime telemetry stays outside the brief.** Session IDs, observed session state, launch claims, and tracker caches belong in the local runtime store.
- **Additional Context is optional and supplementary.** It is the place for material the launch SDK can mine for node-relevant orientation — conversation excerpts, prior-art links, per-node hints, stakeholder color, exploratory threads. It is **not** a second home for Boundaries, Decisions, or Current State; those keep their dedicated sections so the structured part of the brief stays clean. Additional Context may extend the brief beyond the structured-section length target, but stays curated: stale items get pruned in the same rewrite-in-place spirit, not append-only. Per-node hints can use a `### Node hints: <node-id>` subsection convention so the launch SDK can preferentially extract material for the selected node.

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
| `launchPolicy` | object | | Optional launch preconditions for this workstream (see Launch Policy). If omitted, graph launches keep the default allow behavior for ready nodes regardless of tracker type. |
| `launchDefaults` | object | | Optional launch defaults for this workstream (see Launch Defaults). These pre-fill launch UI/API configuration without changing per-launch override behavior. |
| `repos` | array | ✓ | Repositories involved (see Repo) |
| `designRefs` | array | | Optional. Project-level design docs relevant to this workstream (see Design Reference). Workers retain access to the full design set; this field is a hint about what to surface first during context assembly and UI navigation. |
| `docRefs` | array | | Optional. Typed hints to optional documentation families such as Architecture and User Guide (see Documentation Reference). These are surfaced as context and maintenance hints, not required inputs. |
| `nodes` | array | ✓ | Work items and gates (see Node) |
| `checkpoints` | array | ✓ | Progress milestones (see Checkpoint) |

### Design Reference

Each design reference points to a project-level design artifact in a declared repository that should be surfaced early for this workstream.

| Field | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | ✓ | Declared repository ID that owns the design doc |
| `path` | string | ✓ | Path to the design doc, relative to the repo root |

Include the repo's design index when it has a design set, plus the specific docs that are likely to matter first. Do not list every document in the design corpus, and do not treat this field as an allowlist over what a worker may read.

### Documentation Reference

`docRefs` are optional typed documentation hints. They keep `designRefs` focused
on normative Design authority while allowing workstreams to surface Architecture
and User Guide pages that may help a worker orient or update user-facing docs.

```json
{
  "docRefs": [
    {
      "kind": "architecture",
      "repoId": "streamliner",
      "path": "docs/architecture/session-system.md",
      "purpose": "Current code map for launch context and registry modules"
    },
    {
      "kind": "userGuide",
      "repoId": "streamliner",
      "path": "docs/guide/sessions.md",
      "purpose": "User-facing behavior affected by this workstream"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `"architecture"` or `"userGuide"` | ✓ | Documentation family for the hint |
| `repoId` | string | ✓ | Declared repository ID that owns the document |
| `path` | string | ✓ | Path to the document, relative to the repo root |
| `purpose` | string | | Why this reference matters to the workstream or selected nodes |

Missing optional documentation families or paths do not block graph parsing or
worker launch. Context assembly surfaces them as unavailable optional hints, and
workers report the impact in their final summary so reconciliation can decide
whether to add docs, update downstream nodes, or leave the absence intentional.

### Worker documentation impact

Worker final summaries should include a documentation-impact block when a task
touches behavior, implementation shape, or user-facing workflows:

```markdown
## Documentation impact

- Design: changed | no change | follow-up needed — rationale
- Architecture: changed | no change | absent | follow-up needed — rationale
- User Guide: changed | no change | absent | follow-up needed — rationale
```

Workers update a documentation family when their task changes the thing that
family owns:

| Change type | Expected documentation behavior |
|---|---|
| Intended behavior, invariant, or architectural constraint changes | Update Design and/or add a decision record. |
| Code organization, subsystem responsibilities, runtime flow, storage, or operational sharp edge changes | Update Architecture if that family exists; otherwise report follow-up impact. |
| User-visible workflow, setup, command, UI behavior, or troubleshooting path changes | Update User Guide if that family exists; otherwise report follow-up impact. |

Workers should not create optional documentation families opportunistically unless
their node explicitly includes documentation structure. Reconciliation treats
absent optional docs as follow-up context, not a failed launch or failed node.

### Launch Policy

`launchPolicy` is an optional top-level graph configuration object for durable project/workstream launch preconditions. It is committed with the graph because it governs every launch caller consistently; local runtime state is not authoritative for launch policy.

The first supported field is:

| Field | Type | Required | Description |
|---|---|---|---|
| `requiredTracker` | `"github-issue"` | | Requires selected nodes to be backed by a GitHub issue before launch. A node satisfies this requirement only when `tracker.type` is `"github"` and the tracker has a valid `owner`, `repo`, and positive issue `number`. Missing trackers and local trackers do not satisfy the requirement. |

If `launchPolicy` or `requiredTracker` is absent, Streamliner preserves the historical behavior: ready nodes may launch whether they use GitHub, local, or no tracker. Unknown `requiredTracker` values are invalid for schema version 1 and are rejected when the graph is parsed rather than ignored.

### Launch Defaults

`launchDefaults` is an optional top-level graph configuration object for durable defaults that should apply to every launch prepared from the workstream. Defaults are intentionally limited to values a builder can still override per launch.

Supported fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `promptProfileId` | string | | Local PAW launch prompt profile id to preselect when the launch dialog opens. This is a best-effort local hint, not a portable committed dependency: renamed profiles keep resolving by id, but missing or deleted profiles fall back to custom launch instructions and do not block parsing or launch. |
| `terminal` | object | | Default terminal presentation settings for launches from this workstream. |

The supported `terminal` fields are:

| Field | Type | Required | Description |
|---|---|---|---|
| `preferredTerminal` | `"default"`, `"windows-terminal"`, or `"powershell"` | | Preferred local terminal host for worker launches. If omitted or `"default"`, Streamliner uses its normal terminal selection. |
| `titleTemplate` | string | | Default terminal tab title template. Supported variables are `{githubIssue}` (`#number` for GitHub-tracked nodes), `{nodeId}`, and `{nodeTitle}`. If omitted, launches use the selected node title unless the builder overrides the title per launch. |
| `tabColor` | `"#RRGGBB"` | | Default terminal tab/session color for workstream launches. If omitted, launches use the existing uncolored default unless the builder chooses a color per launch. |

Unknown terminal preference values, non-string title templates, invalid tab colors, and non-kebab-case `promptProfileId` values are rejected when the graph is parsed. Omitting `launchDefaults` preserves existing launch dialog defaults.

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
| 14 | `docRefs.kind` is one of the supported documentation-reference kinds |
| 15 | `docRefs.repoId` must match a declared repo |
| 16 | `docRefs.path` is repo-root-relative |

Runtime validation (tracker-cache freshness, cross-reference checks) is separate from parse-time schema validation.
