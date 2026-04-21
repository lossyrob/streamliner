---
kind: decision
number: 4
status: accepted
date: 2026-04-21
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 004. Session registry as the primary session surface

## Context

The original [session system design](../session-system.md) positioned the runtime overlay on the graph as Streamliner's central session-tracking surface. Sessions would become visible to the builder by being launched from a graph node and having their observed state projected onto that node. That framing has two problems that only became acute when Streamliner started being used day-to-day:

1. **Most of a builder's Copilot sessions are not bound to a graph node.** Ad-hoc exploration, side tasks, dotfile edits, and pre-workstream ideation all run as Copilot CLI sessions but never live inside a workstream graph. Overlay-only tracking gives them no surface at all.
2. **Overlay tracking requires the launch pipeline first.** Until launch-from-graph exists, the overlay has no claim-backed bindings to render and nothing productive to show. The near-term builder pain — losing session context across restarts — is unrelated to the launch pipeline and should not be gated on it.

Both problems point to the same gap: the graph overlay is one *projection* of session state onto a specific coordinate system (nodes), not the only place sessions should be visible. A builder needs a flat, graph-independent session surface that can exist before the launch pipeline and that covers sessions launched outside of graph nodes.

Observation-based tracking ([Decision 001](001-observation-based-session-tracking.md)) already gives Streamliner the ingredients — it can discover and read Copilot CLI sessions from their state files regardless of how they were launched. What is missing is a durable, builder-editable record alongside those observations: a "my sessions" list that persists across restarts, carries human-meaningful metadata (title, description, color), and survives the session ending.

## Decision

Treat the **session registry** as Streamliner's primary session surface. The registry is a local, graph-independent collection of tracked sessions, each a durable record under Streamliner's local runtime-state root and keyed independently of any workstream. The registry carries builder-editable metadata (title, description, color, tags), environment anchors (cwd, repo, branch), an optional link to an observed Copilot CLI session, observation-derived freshness, a durable coarse lifecycle status, and an optional binding to a graph node. The concrete field inventory is an evolving concern of the [session system design](../session-system.md), not of this decision; what is durable here is that there is exactly one such record per tracked session.

The registry is the single canonical record for a session. The runtime overlay on the graph becomes a **projection** of the registry filtered to entries whose graph binding resolves to a visible node, joined with that node's committed status. Launched-from-graph sessions create registry entries as part of launch; the launch-claim mechanism writes the graph binding onto an existing or newly created registry row rather than into a parallel store.

The registry imports existing Copilot CLI sessions via the observation hook defined in [Decision 001](001-observation-based-session-tracking.md): when the watcher discovers a session without a corresponding registry entry, it creates one with the metadata it has, which the builder can then edit. Manual entries (for sessions the builder wants to track before Streamliner has observed them, or for sessions in environments not yet observed) are allowed and remain first-class; they become linked when observation later finds a matching Copilot session.

Durable builder-editable fields on the registry row (title, description, color, tags, graph binding, lifecycle status) are orthogonal to observation-derived liveness (launching, discovered, active, idle, ended). The registry row persists the former across session ends and Streamliner restarts; observation is the authoritative source for the latter and is surfaced as a separate view on top of the row rather than mutating it.

## Alternatives considered

**Keep the runtime overlay as the single surface, defer everything until launch-from-graph ships.** Rejected. Delays the highest-value near-term capability (restart-resilient session tracking) by multiple waves and leaves non-graph sessions permanently invisible. The pain driving this decision is that builders lose context *now*, on every Windows update.

**Two parallel stores: a manual registry for ad-hoc sessions and a separate overlay-state store for launched sessions.** Rejected. A session that starts as "ad-hoc" and later gets bound to a graph node (or the reverse) should not move between stores. Two stores duplicate the observation import logic and create drift between metadata the builder edited and metadata the launch pipeline wrote. The registry is one record per session, regardless of how that session entered the system.

**Keep the registry as private tooling outside the product.** Rejected. The cross-session "what was I doing across many workstreams and side tasks?" surface is a core product capability, not a developer convenience. Treating it as tooling would mean re-building it later inside the product once the overlay work exposes the same gap.

**Make the registry a pure view over ephemeral observation state (no persisted row, no builder-editable fields).** Rejected. Observation alone cannot remember a session after it ends, cannot carry a builder-assigned title, and cannot retain a color across restarts. The registry's durable row is the point.

## Consequences

- **The registry can exist and be useful before the launch pipeline does.** The manual-tracking capability is independently shippable: it delivers restart-resilience and cross-session context recovery without any launch plumbing. Subsequent launch and overlay work build on top of the registry rather than alongside it.
- **The session system design doc is the authoritative place for registry specifics.** `session-system.md` owns the registry's field inventory, storage shape, schema versioning, and UI behavior as living design. This decision fixes only the primary-surface framing and the one-record-per-session invariant; it deliberately does not encode mutable spec.
- **Observation drives observation-derived fields; it never fabricates durable state.** Decision 001's observation model remains authoritative for session liveness, turn boundaries, and pending-input detection. The registry row carries durable and builder-editable fields; observation updates observation-derived fields. The registry never fabricates liveness state that observation has not confirmed, and observation never mutates builder-editable fields.
- **Launch claims bind onto registry rows.** When launch-claim binding resolves a discovered session, it writes the graph binding onto the relevant registry entry. There is no separate "launched sessions" table; a launched session is a registry entry with a graph binding populated. The launch claim itself remains ephemeral; the durable binding lives on the registry row.
- **Color is a registry concern, not a terminal concern.** The builder assigns a color per registry entry. Platform color bridges (Windows Terminal tab, future VS Code integrated terminal, etc.) read from the registry. This keeps a single source of truth for color and lets future bridges be added without redesigning color ownership.
- **Relaunch is a registry operation.** "Reopen this session" targets a registry entry: open a terminal at the recorded `cwd` with the recorded color, and — when the linked Copilot CLI session is still resolvable — resume that session. The registry row outlives the Copilot session, so a relaunch after Copilot state has been cleaned up degrades gracefully to "new session at the same cwd."
- **Manual entries are a permanent feature.** Manual tracking of sessions that have not yet been observed (or that run in environments Streamliner does not yet watch, such as devbox) is first-class. Manual entries become linked when observation later finds a matching Copilot session; before that, they still appear in the registry UI and can be relaunched.
- **The registry is local-first.** Storage lives under Streamliner's local runtime-state root, not under Git. Multi-machine sync of the registry is explicitly deferred.

## Open questions

- **Scope of manual entries**: whether the registry should track non-Copilot terminals (plain shells, editor sessions) or remain Copilot-scoped. Default is Copilot-scoped to keep the observation-merge logic tractable; revisit if builder usage pushes against that boundary.
- **Tagging and grouping**: whether tags should include workstream association, project association, or a dedicated grouping field, deferred until there is enough registry usage to see the real grouping needs.
- **Graph projection details**: how the overlay disambiguates multiple registry entries bound to the same graph node (sequential launches, reruns) is an overlay-rendering concern; the registry shape allows it but the UI policy is not yet chosen.
