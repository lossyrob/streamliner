# Git-backed Artifact Sync

## Status

Seeded

## Summary

Let Streamliner artifacts live on a dedicated Git branch in the project repository and keep them synchronized across machines and teammates with a deterministic loop-based sentry.

This candidate is a near-term bridge between local-only artifact storage and the longer-term distributed control plane vision. It uses GitHub as the shared ledger and transport without requiring a new Streamliner service, hosted UI, or remote database.

The source branch stays clean. Streamliner artifacts become shareable. Local sentries keep artifact worktrees warm and surface conflicts, new messages, and sync attention states back into Streamliner.

## Problem

Streamliner artifacts currently tend to live in one of two places:

- under `.streamliner` in the same repository as source code;
- in a separate repository used as a planning/artifact store.

Both work, but both have friction.

When artifacts live on the source branch, they can pollute the main codebase and create noise for teammates who are not participating in Streamliner work.

When artifacts live in a separate repository, discovery, permissions, onboarding, and day-to-day sync become clumsy. Teammates may not know where the workstreams live, and laptop/devbox workflows require constant commit/push/pull choreography.

In practice, Streamliner artifacts are also beginning to carry live coordination state:

- workstream briefs and graphs;
- shaping candidates;
- cross-workstream messages;
- field reports;
- reconciliation notes;
- orchestration handoffs;
- closeout observations.

Git is useful for auditability and sharing, but painful as a manual live database.

## Thesis

Use a dedicated artifact branch in the project repository as a shared Streamliner ledger.

Use deterministic loop scripts to keep local artifact worktrees synchronized.

Use Copilot CLI supervision only when an actionable event needs reasoning.

This gives Streamliner a low-effort shared coordination layer without building the eventual remote service yet.

## Branch model

A project repository may have a dedicated branch, for example:

```text
streamliner-artifacts
```

The branch should contain Streamliner coordination artifacts and little else:

```text
.streamliner/
  shaping/
  workstreams/
  messages/
  reports/
  sync/
```

Each environment should check out the artifact branch separately from the source checkout, ideally as a Git worktree:

```text
project/
project.streamliner-artifacts/
```

Streamliner would be configured with both paths:

```text
sourceRepoPath = ~/code/project
artifactRepoPath = ~/code/project.streamliner-artifacts/.streamliner
artifactBranch = streamliner-artifacts
```

This keeps source branches clean while making artifacts visible under the same GitHub repository and permission model.

## Sentry model

The sentry should follow the same broad pattern as existing `lossyrob/skills` loop-based lifecycle skills:

- deterministic check scripts perform polling and classification;
- long watches run through detached loop workers;
- durable loop state records events and heartbeats;
- Copilot supervision wakes only for actionable events;
- stateful checks peek first, act next, and acknowledge only after the action succeeds.

The sentry is not primarily an LLM doing `git status` in a loop. It is a deterministic sync loop with a Copilot CLI session supervising meaningful events.

The deterministic layer should detect:

- remote artifact-branch changes;
- local artifact changes;
- clean sync states;
- new messages;
- message status changes;
- merge conflicts;
- script or Git errors.

The Copilot-supervised layer should reason about:

- whether conflicts are mechanical or semantic;
- whether incoming messages need an orchestrator;
- whether changed artifacts imply workstream alignment work;
- whether Streamliner should surface an attention event;
- whether the loop should restart, pause, or hand off to the builder.

## Event classes

Initial sentry event classes might include:

```text
remote_changed
local_changed
sync_clean
push_succeeded
new_message
message_status_changed
conflict_detected
semantic_attention_needed
script_or_git_error
```

A sync wakeup is not a conclusion. It is an event requiring classification.

The sentry should not silently resolve semantic conflicts.

Conflicts in source-of-truth workstream artifacts such as `brief.md`, `graph.json`, checkpoint definitions, gate criteria, or candidate notes should become attention events.

## Message convention

This candidate should define a minimal file-backed message convention, without trying to build the full session-actor mailbox protocol.

Messages should be easy for agents and humans to write, read, and diff.

A message might be a Markdown file with frontmatter:

```markdown
---
id: msg-2026-05-18-013400-z7k2
to: workstream/sdk-managed-worker-runtime/orchestrator
from: workstream/project-surface/shaping
status: open
createdAt: 2026-05-18T01:34:00Z
priority: normal
---

# Message

Candidate shaping discovered a dependency that may affect Wave 2 closeout.

## Requested action

- Assess whether this changes current Wave 2 scope.
- If yes, comment on the gate issue.
- If no, mark handled with a short explanation.
```

Prefer append-only files and sidecar status records where practical, so senders and receivers do not mutate the same file.

Example shapes to consider during formation:

```text
.streamliner/messages/open/{messageId}.md
.streamliner/messages/status/{messageId}.handled.md
```

or scoped per workstream:

```text
.streamliner/workstreams/{workstreamId}/messages/
```

The exact layout should be decided during formation.

## Local Streamliner integration

A small local Streamliner API can let the sentry report sync events without requiring a remote service.

Possible endpoint:

```text
POST /api/artifact-sync/events
```

Example payload:

```json
{
  "projectKey": "main-project",
  "artifactBranch": "streamliner-artifacts",
  "eventType": "new_message",
  "commit": "abc123",
  "changedPaths": [
    ".streamliner/workstreams/sdk-managed-worker-runtime/messages/msg-001.md"
  ]
}
```

Streamliner can then surface:

- artifact sync status;
- new-message badges;
- workstream attention states;
- conflict banners;
- local notifications or toasts;
- sentry health/status.

## Scope

In scope:

- artifact branch policy;
- same-repo dedicated artifact branch layout;
- separate artifact worktree setup;
- external artifact-root configuration;
- deterministic sentry scripts/playbook;
- loop-skill-driven watch flow;
- event classification and durable event output;
- local Streamliner sync-event notification;
- minimal message convention;
- conflict detection and attention surfacing;
- teammate/shared-repo visibility.

Out of scope:

- remote Streamliner service;
- hosted UI;
- remote active-state database;
- multi-user auth model beyond GitHub repository permissions;
- automatic semantic conflict resolution;
- replacing GitHub Issues;
- full actor mailbox protocol;
- distributed actor relay;
- moving all Streamliner state out of Git.

## Wave intent

Actual wave formation should determine final wave boundaries and node definitions.

A likely progression is:

### Wave 1 intent: artifact branch policy and artifact-root configuration

Prove that Streamliner can read and write artifacts from a dedicated artifact worktree associated with a source repository.

Likely areas:

- artifact branch policy document;
- branch/worktree setup guidance;
- project configuration for external artifact roots;
- initial manual sync expectations;
- relationship to same-repo source branches.

### Wave 2 intent: deterministic sentry loop

Build the first artifact sync sentry using deterministic scripts and existing loop-skill patterns.

Likely areas:

- check script for Git artifact branch state;
- detached loop usage guidance;
- event schema;
- dry-run mode;
- conflict classification;
- canonical observed-watch flow;
- ack/restart guidance for Copilot supervision.

### Wave 3 intent: Streamliner notifications and message surfacing

Make sync events visible inside Streamliner.

Likely areas:

- local sync-event API;
- artifact sync status projection;
- workstream message badges;
- conflict/attention notifications;
- minimal message discovery;
- sentry health visibility.

### Wave 4 intent: dogfood shared artifact workflow

Use the artifact branch across laptop/devbox and at least one teammate clone.

This wave should answer whether the model meaningfully reduces manual push/pull choreography while preserving the benefits of Git auditability.

## Expected exports

Potential exports include:

- artifact branch policy;
- project artifact-root configuration model;
- artifact worktree setup flow;
- sentry loop skill/playbook;
- sync event schema;
- local sync event API;
- message file convention;
- Streamliner UI sync/message attention surfaces.

## Review criteria

This workstream should be considered valuable if:

- Streamliner artifacts can live in the same GitHub repository without polluting source branches;
- multiple environments can keep artifact state mostly synchronized with little manual ceremony;
- teammates can load the artifact branch and understand workstream state;
- new messages become visible to the relevant workstream/orchestrator;
- conflicts are surfaced as coordination signals;
- the sentry is mostly deterministic, with Copilot reasoning only for actionable states;
- no remote service is required.

## Risks

- Git conflict noise if artifacts mutate shared files too often.
- The sentry becomes too smart too early.
- Notifications become a product rabbit hole.
- The artifact branch becomes an unstructured junk drawer.
- Direct commits hide durable decisions that should be promoted elsewhere.
- The dedicated branch starts acting like a remote service without service semantics.

Mitigations:

- prefer append-only files where practical;
- use sidecar status records instead of editing sender-owned files;
- keep artifact branch policy explicit;
- treat semantic conflicts as attention events;
- use local API events instead of a sync database;
- preserve promotion paths to durable design docs or source-branch PRs when appropriate.

## Relationship to other work

This candidate is related to, but distinct from:

- `DISTRIBUTED-CONTROL-PLANE.md`, which describes the longer-term relay/API vision;
- Session Actor Control Plane, which focuses on messageable sessions and actor semantics;
- Project Surface and Issue Launches, which may eventually surface artifact sync and messages;
- future cross-environment relay work, which should not be required for this near-term Git-backed bridge.

This candidate should remain grounded in the immediate workflow friction: sharing Streamliner artifacts and coordination messages across teammates and environments without building a service yet.
