# Distributed Control Plane North Star

## Status

This document is north-star product context for Streamliner.

It is not an accepted implementation design, not a committed roadmap, and not a
backlog item by itself. Use it to evaluate future candidates and workstreams,
especially when they touch sessions, environments, remote coordination, project
state, Git synchronization, or agent messaging.

Candidates and workstreams do not need to implement this north star. They should
align with it where practical, remain neutral when the slice is smaller, or
explicitly explain why they diverge.

## The fault line

Streamliner began as a local-first cockpit for work geometry: shape the work,
launch sessions, observe runtime state, reconcile what happened, and use the
result to shape the next wave.

Real use is now exposing a second geometry: work happens across environments.

A builder may shape a candidate on a laptop while formed workstreams are already
active on a dev box. A terminal orchestrator on that dev box may be watching PRs,
launching workers, responding to reviews, or waiting for a wave gate. Another
session may create a GitHub issue that should be handled by a new worker. A
shaping session may discover context that affects several active workstreams
running elsewhere.

Today, the practical cross-environment protocol is often Git:

1. Write a note or artifact into the repository.
2. Commit and push from one environment.
3. Pull from another environment.
4. Ask a running orchestrator to read the note and act.

That works because Git is durable, reviewable, and already trusted. It is also
awkward because Git is being used as both a durable artifact ledger and a live
coordination database.

The friction shows up as commit/push/pull ceremony, stale workstream state across
machines, merge conflicts in shifting Streamliner artifacts, and awkward delivery
of messages to running sessions. Git is an excellent ledger. It is a poor live
cursor.

## North star

Streamliner should become a distributed control plane for agentic work.

The remote service should own shared coordination state, messages, audit events,
and eventually active Streamliner data. Local agents should own execution in each
environment: terminals, SDK workers, worktrees, filesystem paths, Copilot CLI,
Copilot SDK, Git credentials, GitHub CLI auth, and machine-specific integration.
Git should remain the durable ledger for promoted design, decisions, gate
snapshots, and exported workstream state, not the only live database for every
active coordination change.

In short:

> Streamliner data should be live in Streamliner, exportable to Git when it
> becomes worth preserving.

And:

> Git is the ledger, not the live cursor.

## Architecture sketch

The long-term architecture has three layers.

```text
Remote Streamliner API / Relay
  shared project and workstream coordination
  environment and actor registration
  message delivery and acknowledgement
  audit events
  optional active Streamliner state store
  hosted UI eventually

Local Streamliner Agent
  runs on each participating machine
  launches terminals
  manages SDK workers
  manages local worktrees
  uses local credentials
  delivers actor messages
  reports progress and heartbeats

Git repositories
  source code
  project design docs
  promoted Streamliner snapshots
  gate and reconciliation exports
  durable audit checkpoints
```

The remote API coordinates. The local agent executes. Git records what has become
worth preserving.

## Core concepts

### Environment

An environment is a place where work can happen: laptop, dev box, Codespace,
remote workstation, or future hosted runner.

An environment may report:

```json
{
  "environmentId": "devbox-main",
  "projectKeys": ["streamliner"],
  "capabilities": ["terminal-cli", "managed-sdk", "git", "gh"],
  "status": "online",
  "lastHeartbeatAt": "..."
}
```

The first design bias should be outbound communication from the local agent to
the remote service. Do not require inbound network access to a dev box for the
first cut. NAT, firewalls, and machine sleep are operational swamps; avoid them
until the product earns the trouble.

### Actor

An actor is a running or resumable session attached to a role in the work
geometry.

```json
{
  "actorId": "actor-wave2-orchestrator",
  "environmentId": "devbox-main",
  "projectKey": "streamliner",
  "workstreamId": "sdk-managed-worker-runtime",
  "role": "workstream-orchestrator",
  "runtimeKind": "terminal-cli",
  "status": "watching",
  "lastHeartbeatAt": "..."
}
```

Actors are not synthetic teammates and not durable sources of truth. They are
runtime processes or sessions that can be launched, observed, messaged,
interrupted, and replaced.

A useful rule:

> A session actor is a visible runtime attached to durable work geometry.

### Message

A message is a structured instruction, note, or attention request delivered to an
actor or environment.

```json
{
  "messageId": "msg-001",
  "target": {
    "actorId": "actor-wave2-orchestrator"
  },
  "type": "workstream.note",
  "createdBy": "laptop",
  "createdAt": "...",
  "body": {
    "summary": "Candidate shaping discovered a dependency that affects Wave 2.",
    "artifactRefs": [
      {
        "repo": "lossyrob/streamliner",
        "path": ".streamliner/shaping/candidates/...",
        "commit": "abc123"
      }
    ],
    "requestedAction": "Read the note, reconcile the current plan, and report whether this changes the gate."
  },
  "ackRequired": true
}
```

Messages should be typed and bounded. They should not be raw remote shell
commands.

### Acknowledgement

Acks make cross-environment coordination reliable enough to trust.

```json
{
  "messageId": "msg-001",
  "actorId": "actor-wave2-orchestrator",
  "status": "acknowledged",
  "ackAt": "...",
  "summary": "Read note, updated closeout punch list, commented on the gate issue."
}
```

The expected actor loop is peek, act, ack. A check can report actionable work
without consuming it. The actor handles the work, then acknowledges only after the
action succeeds.

## Principles

### Artifacts stay authoritative when promoted

Design docs, decision records, gate snapshots, reconciliation notes, and exported
workstream artifacts may still live in Git. Git remains the trusted ledger for
state that has crossed from active coordination into durable project memory.

### Active state should not require Git sync

Candidate shaping, workstream operational state, actor messages, attention
states, runtime status, and cross-environment coordination should not require a
commit/push/pull cycle.

### Local execution stays local

Remote services should not directly launch terminals, run shell commands, mutate
worktrees, or own local credentials. They should send structured messages or
commands to local agents. Local agents decide what can be done in that
environment and perform the machine-specific work.

### Sessions become actors

Terminal and SDK sessions can be launched with roles and playbooks, receive
messages, acknowledge work, and report status. They are runtime actors attached
to work geometry, not durable project memory.

### Relay first, database later

The first remote slice should be message relay and environment/actor
registration. Moving active workstream data into a remote store is a later,
separate decision.

### Export over lock-in

Remote Streamliner state should be exportable to `.streamliner` artifacts. A
builder should be able to snapshot, promote, or archive meaningful state into Git
when it deserves a durable ledger entry.

### UI can be remote; execution remains placed

A hosted UI can eventually show projects, environments, actors, sessions,
messages, issues, PRs, and workstreams. But actions that require local context
should route through an environment agent. The question is not only what work
should run, but where it should run.

## Storage authority ladder

The north star implies a clearer ladder of authority.

| Layer | Likely home | Purpose |
|---|---|---|
| Runtime state | local agent and/or remote API | live session, actor, progress, and attention state |
| Active coordination | remote API | current candidate/workstream operational state, messages, acks, assignments |
| Durable design | Git/docs repo | intended system design and decision records |
| Gate snapshots | Git export or remote audit event | reviewable confidence transitions |
| Historical audit | remote event log, optionally exported to Git | who/what changed active state and why |

This does not require abandoning current `.streamliner` artifacts. It reframes
them as one storage/export mode rather than the only possible source of active
truth.

## Git modes

Projects may eventually choose different Git policies.

### Live-only

Active Streamliner state lives in the remote API. Git contains source code and
project design docs, but not every active workstream mutation.

### Snapshot-to-Git

At gates or on demand, Streamliner exports selected active state into
`.streamliner` artifacts: brief, graph, reconciliation notes, closeout summaries,
or candidate snapshots.

### Git-authoritative design, API-authoritative runtime

Design docs and decisions stay in Git. Active workstream/session/message state
lives in the API. Gate snapshots export to Git when useful.

### Git-mirrored

The API is primary, but meaningful state changes are mirrored into Git. This is
useful for conservative or audit-heavy projects, but it should be an explicit
policy because it can become noisy.

## Message types to prefer

Start with narrow message types that express work intent without becoming remote
shell execution:

```text
note.read
workstream.reconcile
wave.progress
gate.review
issue.launch
session.summarize
attention.request
artifact.changed
```

Avoid raw remote commands such as:

```text
run_shell_command
merge_any_pr
delete_branch
rewrite_history
```

Those actions may still happen locally through an actor playbook or local agent
command, but the remote message should stay structured and policy-aware.

## Candidate seeds, not backlog

The ideas below are not backlog items. They are possible candidates to mint when
current workflow friction justifies them.

### Session Actor Control Plane

Local messageable sessions with inbox, ack/fail, heartbeat, playbook identity,
and loop-compatible commands.

### Streamliner Relay

Remote message delivery between environments and actors.

### Environment Agents

Local agents that register machine capabilities, receive relay messages, launch
terminals or SDK workers, and report status.

### Remote Active State Store

Shared API-backed storage for candidates, workstreams, and runtime coordination,
with explicit Git snapshot/export policy.

### Hosted Project Surface

Remote UI showing projects, environments, actors, messages, sessions, issues,
PRs, and workstreams.

### Git Snapshot and Audit Export

Explicit promotion/export of remote Streamliner state into Git at gates,
reconciliations, or builder-chosen checkpoints.

### GitHub App and Webhooks

GitHub issue, PR, review, check, and merge events delivered to Streamliner as
messages or state updates, reducing polling while keeping loop-based polling as a
fallback.

## How to use this document

When shaping candidates or workstreams, consider whether the work:

- reduces Git-as-live-database friction;
- preserves Git as durable ledger/export;
- improves coordination across laptop, dev box, and other environments;
- keeps terminal and SDK actors visible, interruptible, and attached to work
  geometry;
- avoids putting local execution or credentials into the remote service;
- makes future relay, environment-agent, or remote-state evolution easier;
- avoids coupling too early to one storage authority;
- supports explicit export or snapshot when active state becomes durable project
  memory.

A candidate may be much smaller than this north star. That is expected. The goal
is to chip away at current workflow friction in a direction that compounds.

## First slice bias

If this direction becomes actionable, the first useful slice should probably be
Streamliner Relay plus local actor mailboxes, not remote workstream storage.

A minimal first slice could include:

- environment registration;
- actor registration;
- message send;
- message poll;
- ack/fail;
- local agent delivery into an actor mailbox;
- UI or CLI action to send a message to an actor.

That slice proves cross-environment coordination without changing storage
authority for workstream artifacts. Only after the message path is useful should
Streamliner consider moving active candidate or workstream state into a remote
shared store.

## Directional summary

Streamliner should remain artifact-first and work-geometry-centered. The pivot is
not to make sessions the source of truth or to hide orchestration inside a
cloud service. The pivot is to let visible terminal and SDK sessions operate the
work geometry across environments while Streamliner owns the shared coordination
plane.

The durable statement:

> Streamliner's backend should own the work geometry. Local terminal and SDK
> actors should be allowed to operate it. A relay can connect those actors across
> environments. Git records the parts that become durable enough to keep.
