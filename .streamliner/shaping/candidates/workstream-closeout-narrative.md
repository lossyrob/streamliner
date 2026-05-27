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
  named-example-driven, distinguishes inspired vs. recovery interventions,
  surfaces work-design lessons in story form.

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
without further specification. Follow it verbatim for the first few narratives;
iterate on the structure once we have lived experience.

### Preconditions

- The target workstream has closed or is at its closure gate.
- A `reconciliation-note.md` exists for the workstream (per the closure-gate
  rule). If it does not, produce the reconciliation note first via the normal
  reconcile prompt; the narrative draws on it.
- The orchestrator session has access to the streamliner repo, the workstream's
  planning repo (if separate), and any source repos the workstream touched.

### Inputs to gather

Pull the following before drafting:

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
   - For each merged PR linked from those issues, fetch title, description,
     review comment threads, and merge timestamp.

4. **Design impact**
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

### Narrative structure to produce

Write `docs/closeout-narrative.md` in the workstream directory with the
following arc. Use the section names as headings.

```markdown
# {Workstream Title} — Closeout Narrative

## Origin
Why this workstream existed. What the world looked like when it was shaped.
What it was trying to make possible. 2-4 paragraphs.

## Cast
The workstreams, repos, design docs, and recurring node/session/PR names that
the story will reference. Light, list-shaped. Give every recurring named
entity a one-line introduction so the listener can follow.

## Acts
One section per wave or major pivot point. For each act:
- What the operator hoped the wave would produce.
- What actually happened, told chronologically with specific node/PR names.
- The inflection moment(s) that defined the act.
- What the act handed forward.

## Inflection moments
A focused section that pulls the key pivot points together. Hot-work bursts,
boundary changes, mid-stream re-scoping, recovery interventions, surprises
that came from real usage. Name each one and locate it in time.

## What we learned about the work
Boundary, contract, and design-layer lessons. Refer to the reconciliation
note for the structured version; expand them here into story.

## What we learned about how we worked
Attention allocation, autonomy bandwidth, validation timing, gate placement,
how PAW or other workflows performed, where the operator should have been
more or less present.

## Inspired vs. recovery interventions
For each named intervention earlier in the narrative, classify it. Make the
distinction vivid — inspired interventions are the system working as
intended; recovery interventions are work-design feedback for future shaping.

## If we did it again
Alternate shapings. Dropped scope worth keeping dropped. Sequencing changes.
Things that should have been a different workstream entirely. Things that
should have been folded in earlier.

## Open threads
What is leaving the workstream alive: follow-on workstreams, promoted
candidates, deferred items, external dependencies still owed. Point at where
each thread continues so the listener knows the story is not over for those.
```

### Voice and constraints

- **Chronological by default.** Story-shaped, not analytical. The
  reconciliation note already carries the analytical version.
- **Named examples.** Every inflection moment names specific nodes, PRs,
  decisions, or moments. Abstraction without examples is for the
  reconciliation note, not here.
- **Honest about recovery.** Do not narrate around the moments where the
  workstream needed steering. Those are the most valuable parts for the
  operator to hear.
- **Operator-second-person where it helps.** "You pulled focus into the
  registry rebuild after the third worker missed the contract" is more
  consolidating than "the operator did X."
- **No status reporting.** The narrative is past tense and reflective. Avoid
  "next steps" language; open threads live in their own section and only
  point outward.
- **Target length:** 800-2000 lines is normal. Long enough to be a real
  retelling, short enough to listen to in a single sitting once the podcast
  generator chews it.

### What not to do

- Do not modify `reconciliation-note.md`. The narrative does not replace or
  refresh structured learning.
- Do not modify the brief, graph, or design docs based on the narrative
  alone. Lessons promote through the reconciliation note's candidates, not
  through narrative prose.
- Do not generate or attempt to attach audio. The MVP hands the markdown to
  the operator; audio generation is deferred.
- Do not make the narrative a closure-gate dependency. Closure depends on
  the reconciliation note, not on this.
- Do not narrate active workstreams; the genre needs the work to be done.

### After producing the narrative

- Commit `docs/closeout-narrative.md` in the workstream directory with a
  message like `Add closeout narrative for <workstream-id>`.
- Report the path back to the operator.
- If new candidate-worthy observations surfaced while writing (unusual but
  possible), raise them as reconciliation-note promotion candidates rather
  than burying them in the narrative.

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

- `docs/closeout-narrative.md` artifact convention and section structure.
- POC runbook that any orchestrator session can follow.
- Voice and content constraints distinguishing narrative from reconciliation
  note.

Potential imports:

- Brief, graph, reconciliation note, node specs, and tracker history from
  the target workstream.
- Git history for plan evolution.
- Design-layer diffs during the workstream's window.

## Open Questions

- Should narratives include cross-workstream context (other active or
  recently-closed workstreams) when relevant, or stay strictly within the
  target workstream's boundary?
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
