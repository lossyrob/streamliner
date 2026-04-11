# Streamliner Product Thesis

## The shift

AI coding agents are compressing execution time. A body of work that would take
a team of engineers several weeks can now be executed in days by one developer
directing autonomous agents. The code gets written. The PRs appear. Tests pass.

This compression does not eliminate the human role. It relocates it.

When execution was slow, the developer's time split across implementation,
planning, and review in roughly that order. Planning could be loose because
there was always time to course-correct during the long execution phase. You
would get to a milestone, reflect on what happened, and figure out what to do
next. The pace of execution gave you room to think.

When execution is fast, that room disappears. Three parallel workstreams can
produce real output in days. If the boundaries between them were wrong — if they
make conflicting assumptions, duplicate decisions, or integrate poorly — you
find out quickly, but you've also wasted quickly. The cost of sloppy work design
becomes immediate rather than diffuse.

The bottleneck moves from execution to design — not the design of the system
being built, but the design of the work itself.

## What goes wrong

When a developer runs parallel agent workstreams without designing the work
well, specific failure modes appear:

- **Conflicting assumptions.** Two workstreams both define the same runtime
  contract or data model differently. Each one works in isolation. Integration
  produces subtle bugs or requires one side to be reworked.

- **Duplicated decisions.** Without a shared design layer, parallel workstreams
  independently make the same architectural choice — sometimes differently.
  Neither knows about the other's decision until review.

- **Hidden dependencies.** Work that looked independent turns out to share a
  critical integration point that neither workstream made explicit. One blocks
  the other late, when the cost of redesign is highest.

- **False completion.** A workstream finishes and passes its own tests, but its
  output is not dependable enough for downstream workstreams to consume. The
  checkpoint was implicit, so nobody verified it.

- **Human overload.** The developer becomes a manual router — triaging agent
  output, resolving conflicts, reconstructing context across sessions. The
  speed of execution creates more decisions per hour, not fewer.

These are not hypothetical. They are what happens when execution outruns the
developer's ability to design the work that feeds it.

## The new skill

There is a cognitive transition underway for developers who use agents
seriously. It moves through recognizable stages:

**Stage 1: Task conductor.** The developer writes prompts, monitors sessions,
decides what to do next after each one finishes. Planning happens in the gaps
between executions. The developer is still close to every piece of work. This
is where most agent-assisted development sits today.

**Stage 2: Workstream architect.** The developer designs large autonomous chunks
of work — workstreams — with explicit boundaries, exported contracts, and
defined gates where human judgment matters. Execution runs without the developer
in the loop. The developer's attention goes to shaping the next wave, reviewing
gates, and resolving design mismatches. The unit of thought is the workstream,
not the task.

**Stage 3: Portfolio operator.** The developer runs multiple concurrent
workstreams across projects, coordinating them through public checkpoints and
shared design layers. The cognitive load is almost entirely about boundary
design, sequencing, and cross-workstream integration.

The jump from stage 1 to stage 2 is where the most leverage sits right now.

## What the skill actually is

Workstream-level thinking is a design discipline. It requires:

**Boundary design.** What does this workstream own? What is explicitly outside
its scope? Where does it stop? This is closer to API design or team chartering
than to software architecture. A good boundary means the workstream can execute
autonomously. A bad boundary means constant intervention.

**Contract design.** What does this workstream export for others to depend on?
A public checkpoint — a named milestone with a defined shape — is how one
workstream unblocks another without requiring full completion. The quality of
these contracts determines how much parallelism is actually achievable.

**Attention allocation.** Where in the workstream does human judgment create
irreplaceable value? Gates, wave transitions, design mismatches, and scope
decisions are high-leverage moments. Everything else should run without the
developer in the loop. The skill is knowing which is which before execution
starts.

**Pattern recognition.** An experienced workstream architect sees a new body of
work and recognizes its shape: "this is a three-workstream problem with a shared
contract in the middle" or "this needs a spike workstream before the real
execution can begin." That recognition comes from feedback loops — shaping work,
watching it execute, seeing where the boundaries were wrong, and doing it again.

Parts of this skill exist in engineering management, production coordination,
and systems design. What is new is the feedback loop speed. An engineering
manager learns workstream design over years because execution takes quarters.
A developer directing autonomous agents can shape a wave, watch it execute in
days, see where the boundaries failed, and reshape. The skill develops faster
because the consequences of good and bad design are visible faster.

## What Streamliner is for

Streamliner exists to make workstream-level thinking the natural operating mode
for a developer directing autonomous agents.

That means three things:

1. **The workstream is the primary unit of work.** Not the task, not the session,
   not the issue. The workstream — with its brief, dependency graph, design
   references, and wave structure — is what the developer designs, monitors, and
   reviews. The tool is organized around that unit.

2. **Work design quality is visible.** When boundaries are wrong, the developer
   should see it: too many cross-workstream blockers, unclear contracts, sessions
   that don't fit the structure, outputs that can't be consumed downstream. Each
   wave teaches the developer what makes a good workstream boundary and what
   does not.

3. **Attention goes to high-leverage moments by default.** Gates, wave
   transitions, design mismatches, and scope decisions surface for review.
   Everything else runs autonomously. The developer's presence is a deliberate
   choice, not the normal mode.

As the developer moves toward stage 3 — running concurrent workstreams across
projects — Streamliner should grow with them. Cross-workstream coordination,
cross-project navigation, environment-aware session visibility, and handling of
sessions that exist outside any formal workstream all serve that transition.

## The bet

Streamliner bets that the developer who learns to think at the workstream level
will be significantly more effective than the developer who stays in
task-conductor mode — not by working harder, but by designing work that executes
well autonomously.

The tool's job is to make that transition learnable and the resulting operating
mode sustainable. Every surface in Streamliner — the dependency graph, the
artifact system, the design layer, the session views — serves the same purpose:
give the developer a place to think about work at the right level of
abstraction, and fast feedback on whether the design of that work was good.
