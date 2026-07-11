# Streamliner Roadmap

> The current campaigns — the workstreams committed to (or proposed) next, the
> standalone work, and the loose issues around them. This is the single document
> to work through.

This is the **instance** layer. The campaign *concept* — what a campaign is, how
it relates to releases, the main effort, the lens-over-the-backlog principle — is
defined in [CAMPAIGNS.md](../../CAMPAIGNS.md). This document applies that concept to the
work in front of us right now. It is a point-in-time view and is expected to be
revised as campaigns progress.

It was first produced by consolidating the backlog that accumulated during the DB
Agent private-preview push (voice notes, deferred problems, observations). It has
since been revised as work shipped and priorities changed. The current main effort
now combines three closely related needs: plugin-delivered role context, Telex
coordination, and shared Git-backed Streamliner artifacts.

## How to read this

- **Campaigns** group workstreams toward one declared intent. One is the **main
  effort** (priority of attention); the others are **proposed** until they become
  the main effort.
- Each **workstream** maps to a durable candidate under
  [`.streamliner/shaping/candidates/`](index.md). The
  candidates are the backlog; this roadmap *selects and shapes* a subset of them
  into campaigns. It does not modify the candidates.
- **Seams** are the contracts a workstream or campaign exports for others to
  consume. Cross-campaign seams are listed once, below.

## Current main effort

**Campaign 1 — Shared Project Operations.** Make a Streamliner project usable by
multiple builders and agent sessions without personal setup knowledge, manual
message relay, or artifact-sync choreography.

---

## Campaign 1 — Shared Project Operations *(main effort)*

**Declared intent.** A project can be operated by multiple builders and agent
sessions: the Streamliner plugin loads the right role context, Telex carries live
coordination between durable responsibility addresses, and a dedicated
`streamliner-artifacts` branch carries shared workstream artifacts without
polluting source branches.

**Review question.** Can a second builder enter a project, load the correct
Streamliner role, find the shared workstreams, and coordinate through Telex
without learning another builder's private instructions or manual Git routine?

**Theater.** Shared project operations: role/context delivery, live session
coordination, and the durable artifact ledger.

**Covering workstreams.**

| Workstream | Candidate | Notes |
|---|---|---|
| Streamliner Plugin Role Skills | `streamliner-agent-skill-context` | **Formed:** `.streamliner/workstreams/plugin-role-skills/`. Starts with stable role IDs, `launch-policy-v1`, and the repository-installable role-skills slice. Exports `role-context-v1` early and `orchestrator-launch-context-v1` before Actor Fabric's bound-orchestrator UI can complete. |
| Telex-backed Actor Fabric & Bound Orchestrator | `session-actor-control-plane` | **Formed:** `.streamliner/workstreams/telex-actor-fabric/`. Two Wave 1 contract nodes are ready; address and event-envelope contracts consume Plugin Role Skills targets. The first usable product slice is the bound-orchestrator UI with reboot/resume/replacement behavior. |
| Git-backed Artifact Ledger & Sync | `git-backed-artifact-sync` | **Formed:** `.streamliner/workstreams/git-backed-artifact-sync/`. `artifact-root-v1` is the first ready node. Later waves add safe synchronization, policy provenance, Telex attention, and the single campaign integration gate. |

**Ownership boundary.**

| Concern | Owner |
|---|---|
| How a session operates as a Streamliner role | Plugin Role Skills |
| Message delivery, liveness, acknowledgement, and history | Telex |
| Mapping Streamliner roles/scopes onto Telex addresses | Telex-backed Actor Fabric |
| Briefs, graphs, shaping notes, reports, and reconciliation artifacts | `streamliner-artifacts` branch |
| Source code and durable product/design documentation | Normal source branches |
| Local runtime and session projections | Streamliner local state |

Messages carry pointers to artifacts, commits, issues, nodes, or PRs; they do not
become a second artifact store. A durable decision made through Telex is promoted
into the appropriate artifact or design record.

**Shared seams.** All three workstreams consume the existing Streamliner project
key. Plugin Role Skills exports stable role identifiers and context-selection
rules. The actor workstream maps those roles onto Telex addresses. Artifact Sync
exports project artifact-root discovery so role skills and later project surfaces
can load the same workstream state on every machine.

**Sequencing inside the campaign.**

1. Plugin Role Skills establishes `role-context-v1` and the first useful plugin
   experience.
2. Telex integration consumes the role identifiers. Artifact Sync can begin its
   branch/root work in parallel without waiting for either role or Telex
   integration.
3. The Telex-backed actor workstream routes artifact-sync attention and lifecycle
   events to the appropriate role addresses; Plugin Role Skills adopts
   `artifact-root-v1` once the resolver is available.
4. A multi-builder dogfood gate exercises the whole seam: two environments, one
   repository, one artifact branch, one shared Telex backend, and no private
   briefing or manual relay.

**External inputs.** Released Telex is a product dependency, not code copied into
Streamliner. Namra's `streamliner-skills` repository is an explicit role-skills
input; its useful behavior should be reconciled into the canonical plugin skills
rather than maintained as a permanent parallel workaround.

**Related (downstream).** `session-attention-widget` consumes Telex and lifecycle
attention signals (#122). The existing SDK-managed runtime remains an enabling
execution track and should consume the same role/address contracts where useful.

**Exports.** `role-context-v1`; `telex-addressing-v1`; `artifact-root-v1`; Telex
field-report transport (consumed by Campaign 2).

## Campaign 2 — Coverage & Execution Integrity *(proposed)*

**Declared intent.** Make the workstream document represent waves, node kind/size,
debt, and attached artifacts; make node discoveries legible; and validate coverage
at close — so no intent-covering work is silently lost.

**Review question.** Is intent-covering work ever silently lost?

**Theater.** The execution-integrity layer: document format, node handoff,
reconciliation, closeout.

**Covering workstreams.**

| Workstream | Candidate | Notes |
|---|---|---|
| Workstream Format & Coverage Substrate | `workstream-format-coverage-substrate` | Exports `schema-v2` **early** (contract-first): JSON Schema + validate-on-load, waves-as-objects, node kind/size, debt state, artifact slots. |
| Node Handoff, Boundary Pressure & Reconciliation | `worker-hot-work-reconciliation` | Field reports, boundary pressure/split requests, node-level deferral→debt. Imports field-report transport from C1; builds on the shipped `reconciliation-note.md` (#114). |
| Checkpoint & Closeout Experience | `checkpoint-closeout-experience` | Gate validation, closeout batch node, no-open-debt gate. Folds in `convergent-validation-playbooks`; operationalizes the #114 closure-gate rule. Associates `workstream-closeout-narrative` (optional). |
| Operating Point & Attention | `operating-point-attention` | Foundational values & attention layer: care knob, posture, sizing routing, preference-debt, encoded beliefs, human-floor surfacing. Exports `operating-point-v1`; consumed by WS-D/WS-F surfacing here and by C4's merge gate. |

**Side issues.** #125 (schema validation — filed, the substrate's first node),
#127 (visual briefing — needs the artifact slot), #129 (closeout animation).
Coordinate #7 and #120 here.

**Imports.** `role-context-v1` (C1), field-report transport (C1).

## Campaign 3 — Portfolio Surface *(proposed)*

**Declared intent.** The builder can see and navigate multi-workstream work —
orient across workstreams, see cross-workstream dependencies, and launch scoped
work.

**Review question.** Can the builder orient and navigate the portfolio?

**Theater.** The portfolio surface: Project boundary, orientation, dependencies.

**Covering workstreams.**

| Workstream | Candidate | Notes |
|---|---|---|
| Project Surface & Orientation | `project-surface-and-issue-launches` | **Owns the full Project surface.** Orientation view (ready/working/blocked/needs-launch) as an early wave; issue launches as a later wave. Absorbs per-repo group collapse. C1 only pulls forward the minimal existing project key/configuration needed to bind roles, Telex, and artifact roots. |
| Cross-Workstream Dependencies & Geometry | `multi-workstream-dependencies` | Import/export/availability + external blockers (folds in `external-dependency-tracking`). The first implementation slice shipped in #108; rebaseline the remaining work at formation. |

**Related (downstream).** `work-geometry-canvas` — renders the dependency model.

**Side issues.** #128 (session-group collapse).

**Imports.** `schema-v2` (C2), orientation signals (C1), and
`artifact-root-v1` (C1).

## Campaign 4 — Autonomous Execution *(proposed, later)*

**Declared intent.** Streamliner drives sets of work items to merged PRs
autonomously — both a workstream's wave of nodes and the loose backlog — spending
builder attention only at the human floor.

**Review question.** Can the builder run work hands-off, with attention spent only
where it matters?

**Theater.** The autonomous execution engine and the Backlog.

**One engine, two sources.** The orchestration loop (orchestrator actor → PAW
workers over telex → human-floor merge gate → deferred-work disposition → advance)
is source-agnostic. Build it once with **source adapters**: a workstream wave
(committed geometry) or the backlog (out-of-geometry). The backlog-orchestrator
skill in `lossyrob/skills` is the reference implementation, shipped natively.

**Covering workstreams.**

| Workstream | Candidate | Notes |
|---|---|---|
| Backlog Orchestration | `backlog-orchestration` | The Backlog as a first-class surface for out-of-geometry work + backlog runs (the engine's backlog source adapter). |
| Autonomous Wave Progression | `autonomous-wave-progression` | The workstream-source face of the same engine. |
| Automated PAW Review (reviewer mode) | `automated-paw-review-loop` | The optional reviewer inside a run; live thread is automatic review between background/SDK sessions. |

**Imports.** Actor fabric + telex (C1), `operating-point-v1` (C2), deferred capture
+ field reports (C2), the gate (C2), the project issue list (C3).

---

## Standalone workstream — Workstream Design Altitude

Not part of a campaign this round; low-dependency, can run independently.

| Workstream | Candidate | Notes |
|---|---|---|
| Workstream Design Altitude | `workstream-design-mode` | The design layer above the brief: a workstream-level design doc that carries decisions across waves, a top-level shareable workstream GitHub issue, and project = repos + portfolio language. |

## Cross-campaign seams (the coverage receipt)

| Seam / export | Produced by | Consumed by |
|---|---|---|
| `role-context-v1` | C1 Plugin Role Skills | C1 Telex Actor Fabric, C2 (worker guidance), C3 (issue-worker role) |
| `telex-addressing-v1` + field-report transport | C1 Telex Actor Fabric | C2 Node Handoff, C4 orchestration |
| `artifact-root-v1` | C1 Artifact Ledger & Sync | C1 Plugin Role Skills, C3 Project Surface |
| `schema-v2` | C2 Format & Coverage Substrate | C3 (fields its surfaces read) |
| Project boundary | C3 Project Surface | C3 Cross-Workstream Dependencies |
| #124 deferral→debt | C2 reconciliation (creates) | C2 closeout (validates no open debt) |
| `operating-point-v1` (care/posture/preference/human-floor) | C2 Operating Point & Attention | C2 (WS-D/WS-F surfacing), C4 (merge gate) |
| `filed` deferrals → the Backlog | C2 reconciliation | C4 Backlog (drains or promotes them) |

## Loose issues

Filed and mapped to campaigns:

- **#125** graph.json JSON Schema + validate-on-load → C2 (substrate first node).
- **#127** visual builder briefing node artifact → C2 (needs the artifact slot).
- **#128** collapse/minimize session groups → C3 (or standalone).
- **#129** closeout celebration animation → C2 (closeout polish, low priority).

Already open, mapped:

- **#7** remove deprecated schema fields, **#120** artifact-placement guidance → C2.
- **#121** worker lifecycle notifications → C1 (route through Telex-backed actor addresses).
- **#122** desktop toast/notification companion → C1 (attention widget).

## Not in a campaign this round

These remain durable candidates with unchanged stages — not selected for the
campaigns above:

- `documentation-system`, `sdk-managed-worker-runtime` (both promoted/in-flight),
  and `streamliner-performance-robustness` — tracked on their own.

Also tracked elsewhere, not in these campaigns: managed-runtime issues
(#85/#95/#98), devbox spikes (#15/#23/#24/#27/#28/#26), and the distributed
control-plane north star (#102/#123).

## Sequencing

- **C1 (main effort) → C2 → C3.** Inside C1, Plugin Role Skills exports
  `role-context-v1` first. Telex integration consumes it; Artifact Sync's
  branch/root work can run in parallel and later exports `artifact-root-v1` back
  to the plugin. The campaign converges at the multi-builder dogfood gate. C2
  imports role context and field-report transport from C1; C3 imports
  `schema-v2`, orientation signals, and artifact-root discovery.
- **Inside C2:** the Format & Coverage Substrate workstream goes first and exports
  `schema-v2` early (contract-first), so the other two can build against a stable
  shape.
- **C4 (Autonomous Execution)** sequences last: it needs the actor fabric (C1), the
  deferred-capture + Operating Point layer (C2), and the project issue surface (C3).
  The backlog-orchestrator skill is its reference implementation.
- **Design Altitude** can run at any time.

## Workstream boundary rules of thumb

Evergreen guidance for shaping the workstreams above (see
[PRODUCT-THESIS.md](../../PRODUCT-THESIS.md) and [WORKSTREAM-DESIGN.md](../../WORKSTREAM-DESIGN.md)
for depth):

- A good workstream has **one outcome, one review question, one owner** of its core
  contract.
- Prefer **checkpoint-based parallelism**: a workstream unblocks others by exporting
  a stable checkpoint, not by fully finishing.
- **Let nodes absorb local blockage** — a workstream keeps moving until a node truly
  depends on an external checkpoint.
- **Do not split ownership of a shared contract.** If two workstreams both still
  define the same shape, the split happened too early.
