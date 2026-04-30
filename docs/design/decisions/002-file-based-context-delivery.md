---
kind: decision
number: 2
status: accepted
date: 2026-04-14
update_semantics: append-only
superseded_by: null
supersedes: null
---

# 002. File-based context delivery

## Context

When Streamliner launches a session to execute a node, the worker needs the Layer 0–3 context package: project design docs, workstream intent, operational state, and node-specific context. The delivery mechanism must work with any Copilot CLI session, survive session restarts, and avoid coupling the worker to a running Streamliner backend.

## Decision

Assemble context as files in the PAW work directory. During the SDK preparation phase, Streamliner writes context layers to `.paw/work/<work-id>/context/` — the work directory that `paw-init` created. The kickoff prompt points the Copilot CLI worker session at these files during initialization, and the PAW workflow skill reads them from there.

```
.paw/work/<work-id>/
  context/
    layer-0-design.md
    layer-1-intent.md
    layer-2-state.md
    layer-3-node.md
```

The context directory is excluded from Git (via `.gitignore`) and regenerated on each launch. Context files are generated artifacts, not manually authored.

## Alternatives considered

**Skill context injection** — pass context through PAW skill configuration or environment variables. Rejected: context packages are too large for environment variables, and skill configuration is not designed for multi-kilobyte payloads.

**API callback** — the worker calls back to a running Streamliner API to fetch its context. Rejected: introduces a runtime dependency on the Streamliner backend being available. If Streamliner restarts during a session, the worker would lose access to its context. File-based delivery is resilient to backend lifecycle.

**Direct file references** — instead of assembling context into new files, point the worker at the original files (design docs in the repo, brief in the workstream directory). Rejected as the sole mechanism: the worker needs the originals for source-of-truth access, but the assembled context files provide a curated, bounded view that respects progressive disclosure. The worker should have both: assembled context for initialization, plus access to the original files for deeper investigation.

## Consequences

- Context assembly becomes a backend responsibility. The backend must know how to extract brief sections, use design references as prioritization hints into the design layer, and read node specs from trackers.
- Context files are snapshots at launch time. If the workstream state changes after launch, the session works from its original context. This is intentional: sessions should not silently drift as upstream state changes. This trade-off becomes sharper as session duration grows; multi-day PAW workflows need an explicit freshness story (see open questions).
- **Each launch's assembled context is archived to runtime state** at `~/.streamliner/state/{projectKey}/{workstream-id}/launches/{launchNonce}/context/` alongside a manifest recording the brief commit SHA, each source file's commit SHA or hash, the design-layer commit SHA, the Layer 0 selection the assembler made, and the launch timestamp. Archives are retained by policy (see open questions) so a post-incident builder can reconstruct exactly what a session saw.
- **The generated context files in `.paw/work/<work-id>/context/` carry a generation header** naming the work ID, launch nonce, brief commit SHA, and "do not edit — regenerated on each launch" marker, so the worker and later reviewers can distinguish them from manually authored artifacts at a glance.
- The PAW workflow skill needs to recognize and load the `context/` directory. This is a coordination point between Streamliner and the PAW skill system.
- Generated context files should be clearly marked as generated (e.g., with a header comment) to prevent confusion with manually authored artifacts.

### 2026-04-29 update: pre-claim context packages

Backend context preparation can run before a launch claim exists, especially for
prompt preview and non-PAW launch profiles. In that pre-claim state, Streamliner
writes generated packages to
`~/.streamliner/state/{projectKey}/{workstream-id}/launch-contexts/{contextId}/`
with a manifest containing `launchNonce: null`. Launch-claim binding may later
associate the returned `contextId` with a nonce-scoped launch archive or copy the
package into `launches/{launchNonce}/context/`; context assembly itself does not
require a nonce to produce a stable package reference.

## Open questions

- **Archive retention policy**: How long are launch context archives kept? Options: last N launches per workstream, last N days, unbounded until manual clean. Resolve before launching multi-day PAW workflows routinely, because that is where forensic replay matters most.
- **Brief drift during long sessions**: Should Streamliner compare the brief's current commit SHA against the launched snapshot and warn the worker or the builder when they diverge mid-session? A passive staleness banner is the near-term minimum; active notification is deferred. This open question must be resolved before multi-day PAW workflows are considered supported.
- **LLM-chosen Layer 0 selection logging**: The Layer 0 assembler picks which design docs to front-load based on designRefs hints plus its own judgment. That selection is captured in the launch manifest so a later reviewer can see what was chosen and why.
