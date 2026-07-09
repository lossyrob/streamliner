# Streamliner Roadmap

> The current campaigns — the workstreams committed to (or proposed) next, the
> standalone work, and the loose issues around them. This is the single document
> to work through.

This is the **instance** layer. The campaign *concept* — what a campaign is, how
it relates to releases, the main effort, the lens-over-the-backlog principle — is
defined in [CAMPAIGNS.md](../../CAMPAIGNS.md). This document applies that concept to the
work in front of us right now. It is a point-in-time view and is expected to be
revised as campaigns progress.

It was produced by consolidating the backlog that accumulated during the DB Agent
private-preview push (voice notes, deferred problems, observations). That
consolidation declared the intent below and partitioned it into three campaigns,
one standalone workstream, and a set of side issues.

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

**Campaign 1 — Session Coordination.** Highest validated pain (manual
session-to-session coordination), and Telex is already built for it.

---

## Campaign 1 — Session Coordination *(main effort)*

**Declared intent.** Sessions become addressable, role-bound, message-passing
actors with a bound orchestrator, so coordination stops being a manual
messages-folder relay.

**Review question.** Can the builder coordinate sessions through the fabric
instead of by hand?

**Theater.** The coordination/runtime layer: actors, mailboxes, the bound
orchestrator.

**Covering workstreams.**

| Workstream | Candidate | Notes |
|---|---|---|
| Local Actor Fabric & Bound Orchestrator | `session-actor-control-plane` | **Adopts Telex** as transport (cross-project import). Bound orchestrator launch, window binding, lifecycle notifications (#121). |
| Role & Context Packages | `streamliner-agent-skill-context` | Foundational role/context packages an actor binds at launch. Exports `role-context-v1`. |

**Related (downstream).** `session-attention-widget` — consumes actor
attention/lifecycle signals (#122).

**Exports.** `role-context-v1`; the actor/mailbox + field-report **transport**
(consumed by Campaign 2).

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
| Project Surface & Orientation | `project-surface-and-issue-launches` | **Owns the Project boundary.** Orientation view (ready/working/blocked/needs-launch) as an early wave; issue launches as a later wave. Absorbs per-repo group collapse. |
| Cross-Workstream Dependencies & Geometry | `multi-workstream-dependencies` | Import/export/availability + external blockers (folds in `external-dependency-tracking`). Consumes the Project boundary. |

**Related (downstream).** `work-geometry-canvas` — renders the dependency model.

**Side issues.** #128 (session-group collapse).

**Imports.** `schema-v2` (C2), orientation signals (C1).

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
| `role-context-v1` | C1 Role & Context Packages | C2 (worker guidance), C3 (issue-worker role) |
| `schema-v2` | C2 Format & Coverage Substrate | C3 (fields its surfaces read) |
| field-report transport | C1 Actor Fabric | C2 Node Handoff (its content/reconciliation) |
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
- **#121** worker lifecycle notifications → C1.
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

- **C1 (main effort) → C2 → C3.** C2 imports `role-context-v1` from C1; C3 imports
  `schema-v2` from C2 and orientation signals from C1.
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
