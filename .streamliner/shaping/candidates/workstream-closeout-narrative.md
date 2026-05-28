# Workstream Closeout Narrative

## Stage

Seeded.

## Seed Idea

After a workstream closes, an orchestrator session generates a long-form
chronological narrative — `docs/closeout-narrative.md` inside the workstream
directory — that retells how the workstream actually unfolded. The narrative is
then hand-fed to a GenAI podcast generator (NotebookLM-class) so the operator
can listen to a discussion of the workstream away from in-the-moment work.

The narrative is distinct from the always-on `reconciliation-note.md`
(see [WORKSTREAM-FORMAT.md](../../../WORKSTREAM-FORMAT.md#the-reconciliation-note-reconciliation-notemd)
and [ORCHESTRATION.md](../../../ORCHESTRATION.md#reconciliation-notes-and-promotion)):
the reconciliation note is a compact, required, structured learning artifact;
the narrative is an optional, long-form, story-shaped artifact for reflective
consumption.

## Why It Matters

The operator runs many workstreams in parallel and constantly switches context.
There is no time during execution to be slow, zoomed-out, and reflective. Two
benefits the narrative chases:

- **Memory consolidation.** Hearing the workstream retold — its pivots,
  inflection points, recoveries, surprises — reinforces what the operator
  actually learned and prevents loss of the work-design intuition that came out
  of doing the work.
- **Reflection in commute time.** A podcast-shaped consumption channel makes
  reflection feasible outside the workstation, where most of the operator's
  zoomed-out thinking actually happens.

The reconciliation note already produces the structured lessons. The narrative
is the *experience* of the workstream, with the lessons embedded in story so
they land differently than they do on a page.

## Candidate Scope

### In Scope

- Define the `closeout-narrative.md` artifact: location, structure, expected
  voice, sources of truth.
- Provide a POC runbook that an orchestrator session can follow today, against
  any closed or near-closed workstream, to produce a first narrative.
- Define the relationship to the reconciliation note and to the brief/graph.
- Define what makes a *good* narrative: chronological, pivot-aware,
  self-contained for a cold listener, named-example-driven without opaque ID
  soup, honest about design insights and recovery moments, and able to surface
  work-design lessons in story form without duplicating the reconciliation
  note's structured classifications.

### Out of Scope

- Audio generation pipeline. The MVP relies on the operator hand-feeding the
  markdown to an external podcast generator (NotebookLM or equivalent).
- Replacing the reconciliation note. The narrative does not satisfy the
  closure-gate rule and is never required.
- Becoming a deliverable for downstream workstreams. The narrative is for the
  operator; it is not a doctrine surface.
- Automatic regeneration on every commit or PR. Narratives are produced on
  request, at or after workstream closeout.

### Deferred

- Streamliner UI surface for triggering narrative generation, viewing it, and
  attaching generated audio.
- Local audio storage convention (e.g. `~/.streamliner/state/closeout-podcasts/`).
- Integration with a configured podcast-generation provider.
- Cross-workstream narrative threading (a portfolio-level "season summary").
- Generated voice/tone tuning beyond what the consumer (NotebookLM) provides.

## Product Model

The narrative is a **committed workstream artifact** under the workstream's
`docs/` directory:

```text
workstreams/
  {workstream-id}/
    docs/
      closeout-narrative.md
```

It is committed because:

- Markdown is small and useful as an input to other things (search, future
  learning passes, regeneration with a different angle, future Streamliner
  surfaces).
- It is regeneratable, but the curation effort that went into producing a good
  narrative is worth preserving.
- It lives next to other workstream support docs already covered by the
  support-doc semantics in
  [WORKSTREAM-FORMAT.md](../../../WORKSTREAM-FORMAT.md#workstream-support-docs).

Generated audio is **not committed**. It is local-only by nature, regeneratable
from the markdown, and large enough to bloat the repo without value to anyone
but the producing operator.

The narrative is **never gating**. The closure gate depends on the
reconciliation note (always-on, structured). The narrative is opt-in and
post-hoc.

## POC Execution Guide

This section is written so an orchestrator session can be pointed at this
candidate and produce a real `closeout-narrative.md` for an existing workstream
without further specification. Treat the guide as guardrails and intent, not as
a worksheet: preserve the forcing functions, but let the story choose the
section breaks.

### Preconditions

- The target workstream has closed or is at its closure gate.
- A `reconciliation-note.md` exists for the workstream (per the closure-gate
  rule). If it does not, produce the reconciliation note first via the normal
  reconcile prompt; the narrative draws on it.
- The orchestrator session has access to the streamliner repo, the workstream's
  planning repo (if separate), and any source repos the workstream touched.

### Inputs to gather

Pull the following before drafting:

Scale the gather pass to the workstream's size. Small workstreams can skip
cross-workstream signal and design-layer diffs when neither materially shaped
the story; medium or large workstreams should gather enough evidence that the
narrative can explain every major pivot without link-chasing.

1. **Workstream artifacts**
   - `<workstream>/brief.md` (current state).
   - `<workstream>/graph.json` (current state).
   - `<workstream>/reconciliation-note.md` (current state).
   - All node specs under `<workstream>/tasks/` or referenced GitHub issues.
   - All files under `<workstream>/docs/`.

2. **Plan evolution (the pivot tape)**
   - Full git log for `<workstream>/brief.md`:
     `git log --follow --patch -- <path-to-brief.md>`.
     Pay particular attention to rewrites of `Current State` — those are the
     heartbeat of pivots.
   - Full git log for `<workstream>/graph.json` with diffs:
     `git log --follow --patch -- <path-to-graph.json>`.
     Note when nodes were added, removed, retitled, or had dependencies
     changed.

3. **Tracker history**
   - For each node tracker issue, fetch the issue body, comments, close
     reason, and any `### Field report` comment. Use
     `gh issue view <number> --comments --json title,body,comments,state,closedAt`.
     If exact field reports are missing or non-standard, use equivalent
     evidence such as PR bodies, changed files, issue comments, close reasons,
     or reconciliation evidence notes.
   - For each merged PR linked from those issues, fetch title, description,
     review comment threads, and merge timestamp.
   - Treat issue, PR, branch, and commit identifiers as **source references**,
     not as narrative vocabulary. Before drafting, translate each important ID
     into the plain-language event it represents, for example "the guardrail PR
     that made Launcher mode reject pod-level database URLs" rather than
     "#492".

4. **Design impact**
   - Determine the window from workstream artifacts: use `createdAt` from
     `graph.json` for `<workstream-start>`; use the closure-gate completed
     timestamp for `<workstream-close>`, or today's date if the gate is not yet
     completed.
   - For each file in `designRefs`, run
     `git log --since=<workstream-start> --until=<workstream-close> --patch -- <path>`
     to capture what changed in the design layer during the workstream's
     window.
   - List any new files under `docs/design/decisions/` created in that window.

5. **Closeout signal**
   - The brief's `Closeout Observations` section history (resolved / deferred /
     promoted / dropped).
   - The reconciliation note's promotion candidates and their dispositions.

6. **Cross-workstream signal (optional)**
   - Any messages or coordination notes referencing this workstream from
     adjacent workstreams.
   - Any export consumers that depended on this workstream's contracts.

### Audience and self-containment pass

Before drafting, assume the markdown will be handed to a podcast generator with
no GitHub access, no access to private repos, and no memory of the operator's
workstream shorthand. Translate identifiers inline as they enter the story by
default. For ID-heavy workstreams, build a small scratch glossary as an optional
pre-pass; it does not need to become part of the committed narrative.

- expand design decision IDs into their meaning ("the design decision that made
  Launcher the production dispatch boundary" instead of "D-100");
- expand issue and PR numbers into human-readable events ("the production
  direct-receive guardrail change" instead of "#492");
- introduce components and workstreams before relying on their names;
- explain why each important artifact mattered, not just that it existed.

The final narrative may include issue/PR/design IDs in parentheses for later
traceability, but the sentence must still make sense if every ID is deleted.

### Narrative structure to produce

Write `docs/closeout-narrative.md` in the workstream directory as a
chronological retelling with section breaks where the story actually turns. The
section names are not a contract, but a good narrative normally has these
anchors:

- **Origin.** Why the workstream existed, what the world looked like when it
  was shaped, and what it was trying to make possible.
- **Chronological acts.** The major waves, pivots, hot-work bursts, and
  recovery moments in the order the operator experienced them. Introduce
  components, workstreams, repos, design decisions, issues, and PRs inline as
  they enter the story rather than pre-loading a cast list the listener must
  remember. Wave or act openings may include one sentence about what that wave
  was supposed to produce; the rest of the section should then tell what
  actually happened.
- **Inflection points in context.** Surface the moments where the workstream's
  shape changed inside the chronological arc. A short separate section naming
  the top 2-3 pivots is the common case when it keeps the listener oriented;
  roughly 200-400 words is normal for a three-pivot roll-up. Keep pivots inline
  only for very small stories where a roll-up would repeat the same prose. If
  compactness and self-containment conflict, self-containment wins.
- **Lessons in story form.** Boundary, contract, design-layer, attention,
  autonomy, validation, and gate-placement lessons should normally land in two
  short sections: what the work taught about the work, and what it taught about
  how the work was run. Combine them only when the split would be artificial.
  Some lessons legitimately appear in both sections from different angles; make
  the cross-reference in prose rather than forcing a single home.
  The reconciliation note remains the structured version; the narrative makes
  those lessons memorable.
- **Open threads.** What is leaving the workstream alive: follow-on
  workstreams, promoted candidates, deferred items, or external dependencies.
  Point at where each thread continues so the listener knows the story is not
  over for those.

Use the reconciliation note as the canonical home for structured promotion
candidate dispositions and inspired-vs.-recovery classification. In the
narrative, preserve that distinction as a writing lens: make it clear when a
moment was design insight versus work-design recovery, but do not add a
duplicated classification section unless the specific story demands it.

The narrative must not introduce new authoritative facts or lessons that the
reconciliation note does not also reflect. Before the closure gate passes, update
reconciliation first or route a new candidate-worthy observation through the
reconciliation note's promotion-candidate process. After closure, do not reopen a
settled reconciliation note just to capture small narrative framings; leave them
clearly as narrative reflection and flag them for the next adjacent workstream's
reconciliation or doctrine backlog if they need authority.

### Voice and constraints

- **Chronological by default.** Story-shaped, not analytical. The
  reconciliation note already carries the analytical version. A wave opening may
  briefly name what the wave hoped to produce before the section returns to what
  actually happened.
- **Self-contained for a cold listener.** The narrative must be understandable
  to a podcast generator that cannot open GitHub, inspect design docs, or know
  local shorthand. Every important component, workstream, design decision, and
  acronym gets enough context to stand alone.
- **Named examples, not ID soup.** Every inflection moment names specific
  nodes, decisions, or moments, but opaque identifiers are secondary. Write
  "the guardrail change that made Launcher mode reject `TARGET_DATABASE_URL`"
  before optionally adding "(#492)".
- **IDs are traceability, not prose.** GitHub issue numbers, PR numbers,
  commit hashes, branch names, and design IDs may appear in parentheses or
  footnote-like clauses, but they should not be the subject of the story. Avoid
  paragraphs whose meaning depends on "D-100", "#478", or "PR #631" unless the
  artifact has already been introduced in plain language.
- **Honest about recovery.** Do not narrate around the moments where the
  workstream needed steering. Those are the most valuable parts for the
  operator to hear.
- **Operator-second-person where it helps.** "You pulled focus into the
  registry rebuild after the third worker missed the contract" is more
  consolidating than "the operator did X."
- **No status reporting.** The narrative is past tense and reflective. Avoid
  "next steps" language; open threads live in their own section and only
  point outward.
- **Context before reference.** If the narrative mentions an adjacent
  workstream, design doc, or external system, first explain what role it played
  in this story. Do not assume the listener knows the portfolio.
- **Orchestrator vocabulary is allowed when the work requires it.** Terms such
  as node, gate, candidate, reconciliation, or subagent may be unavoidable in
  orchestrator-heavy workstreams. Use them sparingly and make sure surrounding
  prose carries the meaning; self-containment is about avoiding opaque
  identifiers and link-dependent explanations, not banning all local vocabulary.
- **Listenability target:** Long enough to be a real retelling, short enough to
  listen to in a single sitting once the podcast generator chews it. As a
  calibration anchor, roughly 1,500-4,000 words is normal depending on
  workstream size, with substrate or policy workstreams often at the lower end
  and product-feature workstreams often at the upper end. Coordination-heavy or
  pivot-heavy workstreams trend longer regardless of category. Do not pad a
  tight story to satisfy the range, and do not cut a large workstream so
  aggressively that its pivots stop making sense.

### What not to do

- Do not modify `reconciliation-note.md` to replace or refresh structured
  learning. The narrative depends on the note; it does not revise the note's
  lessons as a side effect.
- Do not modify the brief, graph, or design docs based on the narrative
  alone. Lessons promote through the reconciliation note's candidates, not
  through narrative prose.
- Do not introduce new authoritative facts, lessons, or promotion candidates
  that exist only in the narrative. Reconcile or route them before closure; after
  closure, keep newly surfaced framings explicitly non-authoritative and flag
  them for the next appropriate reconciliation or doctrine backlog.
- Do not generate or attempt to attach audio. The MVP hands the markdown to
  the operator; audio generation is deferred.
- Do not make the narrative a closure-gate dependency. Closure depends on
  the reconciliation note, not on this.
- Do not narrate active workstreams; the genre needs the work to be done.
- Do not duplicate reconciliation-note taxonomy as a second worksheet. Use the
  narrative to make structured lessons memorable, not to re-file them.
- Do not use GitHub or design identifiers as shorthand for meaning. A draft
  that says "then #501 happened" has not yet become a narrative.
- Do not depend on links as explanation. Links are useful for the operator, but
  external podcast tools may not be able to access them.

### After producing the narrative

- Commit `docs/closeout-narrative.md` in the workstream directory with a
  message like `Add closeout narrative for <workstream-id>`. In a busy
  operator-owned planning repo with unrelated uncommitted work, stage and commit
  the narrative selectively rather than sweeping in other workstreams' changes.
- Do a final "opaque reference" pass before reporting completion. Search for
  issue/PR/design-ID-heavy sentences and rewrite them so the surrounding prose
  explains the event without requiring the ID.
- Run a short self-check: every closed wave is named in the story; every landed
  promotion candidate from the reconciliation note appears in the lessons or
  open threads; a podcast listener with no GitHub access could follow each
  inflection moment from prose alone.
- No linking is required. The narrative is operator-facing and produced on
  demand. If discoverability matters, a one-line pointer from the reconciliation
  note or brief is acceptable, but only as a pointer, not as a lesson change.
- Report the path back to the operator.
- If new candidate-worthy observations surfaced while writing (unusual but
  possible), raise them as reconciliation-note promotion candidates before
  closure. After closure, do not rewrite the note only for small narrative
  framings; report them as non-authoritative reflections and route anything that
  needs authority to the next adjacent workstream or doctrine backlog.

## Dependencies

### Depends On

- The reconciliation note rule shipped in
  [WORKSTREAM-FORMAT.md](../../../WORKSTREAM-FORMAT.md#the-reconciliation-note-reconciliation-notemd)
  and [ORCHESTRATION.md](../../../ORCHESTRATION.md#reconciliation-notes-and-promotion).
  The narrative draws on the reconciliation note as its lessons substrate.
- Workstream artifact and git history access for the orchestrator session.

### Enables

- A future Streamliner UI affordance to trigger narrative generation, view
  the narrative, and play generated audio.
- A future portfolio-level "season summary" narrative across multiple closed
  workstreams.

### Related Candidates

- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md) —
  owns the *executing well* side of closeout (punch lists, batches, gates).
  This candidate owns the *learning from* side via the narrative.
- [Worker Hot Work and Reconciliation](worker-hot-work-reconciliation.md) —
  hot-work bursts are some of the most narratively rich moments and rely on
  the same field-report substrate the narrative reads.
- [Documentation System](documentation-system.md) — if Streamliner grows a
  unified docs site, generated narratives may eventually surface there.

## Workstream Shape

Lightweight when scoped to the markdown artifact and the POC runbook:

- Define artifact, location, and structure (this candidate already does).
- Run the POC against two or three recently closed workstreams.
- Iterate on structure based on what produced a podcast worth listening to.

Larger if and when:

- A Streamliner UI surface is added.
- An audio-generation pipeline is integrated.
- Cross-workstream or portfolio-level narratives are introduced.

## Exported Interfaces and Dependencies

Potential exports:

- `docs/closeout-narrative.md` artifact convention, narrative anchors, and
  voice constraints.
- POC runbook that any orchestrator session can follow.
- Voice and content constraints distinguishing narrative from reconciliation
  note.

Potential imports:

- Brief, graph, reconciliation note, node specs, and tracker history from
  the target workstream.
- Git history for plan evolution.
- Design-layer diffs during the workstream's window.
- Human-readable summaries of opaque identifiers encountered during research:
  issue numbers, PR numbers, commit hashes, branch names, design IDs, and
  internal shorthand.

## Open Questions

- How much cross-workstream context is enough before the narrative becomes a
  portfolio story rather than a workstream story?
- Should the narrative ever be regenerated after additional closeout
  reconciliation, or is one shot enough?
- How should the operator capture *audio*-shaped feedback after listening
  ("the podcast missed X")? Back into the narrative? Into the reconciliation
  note? A new feedback file?
- Is there value in a structured "podcast brief" file that the operator can
  hand to the generator alongside the narrative to steer angle and tone?
- When the audio pipeline lands, where should audio files live and how should
  they be discovered?

## Handoff Brief

Not yet ready to promote as a workstream. The intended POC path is:

1. Land the reconciliation-note doctrine PR.
2. Land this candidate.
3. Point an orchestrator session at this candidate and at one closed
   workstream; ask it to produce that workstream's
   `docs/closeout-narrative.md` per the POC Execution Guide above.
4. Feed the result to NotebookLM (or equivalent), listen, decide whether the
   experience is worth investing further.
5. If yes, run the POC against one or two more workstreams, then decide
   whether to promote this candidate into a workstream that builds the UI
   and audio pipeline pieces.
