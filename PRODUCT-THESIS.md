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

## The new skill

There is a cognitive transition underway for developers who use agents
seriously. It goes through recognizable stages:

**Stage 1: Task conductor.** The developer writes prompts, monitors sessions,
decides what to do next after each one finishes. Planning happens in the gaps
between executions. The developer is still close to every piece of work. This
is where most agent-assisted development lives today.

**Stage 2: Workstream architect.** The developer designs large autonomous chunks
of work — workstreams — with explicit boundaries, exported contracts, and
defined gates where human judgment matters. Execution runs without the developer
in the loop. The developer's attention goes to shaping the next wave, reviewing
gates, and resolving design mismatches. The unit of thought is the workstream,
not the task.

**Stage 3: Portfolio operator.** The developer runs multiple concurrent
workstreams across projects, coordinating them through public checkpoints and
shared design layers. The cognitive load is almost entirely about boundary
design, sequencing, and cross-workstream integration. Execution is autonomous
by default.

The jump from stage 1 to stage 2 is where the most leverage sits right now. Most
developers using agents are stuck in stage 1 because nothing in their tooling
or practice supports the transition.

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
operator in the loop. The skill is knowing which is which before execution
starts.

**Pattern recognition.** An experienced workstream architect sees a new body of
work and recognizes its shape: "this is a three-workstream problem with a shared
contract in the middle" or "this needs a spike workstream before the real
execution can begin." That recognition comes from feedback loops — shaping work,
watching it execute, seeing where the boundaries were wrong, and doing it again.

## Who is already good at this

Nobody, exactly. The specific combination — designing work at high abstraction,
having it executed by capable autonomous agents, at software-development speed,
with artifact-based feedback loops — does not have a clean historical precedent.

The closest analogues each contribute part of the picture:

- **Engineering managers** face similar boundary and sequencing problems, but at
  human pace. The feedback loop on "were my workstream boundaries good?" takes
  a quarter. The skill develops slowly because execution is slow.

- **Algorithmic trading designers** work at machine-speed execution with fast
  feedback on design quality. The skill shape is similar: design the strategy,
  deploy it, monitor at thresholds, intervene only when the strategy needs
  changing. But the work being executed is narrow and quantitative.

- **Film producers** coordinate parallel workstreams — VFX, photography,
  editorial, scoring — with defined handoff points. The skill is exactly
  workstream boundary design. But the pace is months.

- **Startup founders** before they have a team combine architect, PM, and tech
  lead in one person, making large bets about what to build and in what order.
  The cognitive shape is close, but execution is still the founder doing the
  work.

What is genuinely new is the feedback loop speed. An engineering manager learns
workstream design over years. A developer directing autonomous agents can shape
a wave, watch it execute in days, see where the boundaries failed, and reshape.
The skill develops faster because the feedback is faster.

## What Streamliner is for

Streamliner exists to make workstream-level thinking the natural operating mode
for a developer directing autonomous agents.

That means:

1. **Making the workstream the primary unit of work.** Not the task, not the
   session, not the issue. The workstream — with its brief, dependency graph,
   design references, and wave structure — is the thing the developer designs,
   launches, monitors, and reviews.

2. **Making workstream design quality visible.** When boundaries are wrong, the
   operational picture should make that obvious: too many cross-workstream
   blockers, unclear contracts, sessions that don't fit into the structure. The
   developer should learn from each wave what makes a good workstream boundary.

3. **Compressing the feedback loop on work design.** The developer shapes a wave
   of workstreams, watches execution through the operational picture, reviews at
   gates, and shapes the next wave. The tool should make each cycle faster and
   the learning more legible.

4. **Preserving attention for high-leverage moments.** The operational picture
   should make it obvious where the developer's attention creates value and
   where it does not. Autonomous execution is the default. Presence is a
   deliberate choice.

5. **Supporting the portfolio layer.** As the developer moves toward stage 3 —
   running concurrent workstreams across projects — the tool should grow from a
   workstream viewer into an operator cockpit. Navigation, cross-workstream
   coordination, environment-aware session discovery, and ad-hoc session
   handling all serve this transition.

## The bet

Streamliner bets that the developer who learns to think at the workstream level
will dramatically outperform the developer who stays in task-conductor mode —
not by working harder, but by designing work that executes well autonomously.

The tool's job is to make that transition learnable and the resulting operating
mode sustainable. The workstream graph, the artifact system, the design layer,
the session fabric, and the portfolio shell all serve the same purpose: they
give the developer a place to think about work at the right level of
abstraction, and fast feedback on whether their thinking was good.

The scarcest resource is not compute, not agent capability, and not time. It is
the developer's ability to design work well at scale. Streamliner should make
that ability grow with practice.
