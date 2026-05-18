# Validation Loops

> Operating guidance for validation-loop waves. This document assumes capable
> agents and developers. It describes the intent, authority shape, and acceptance
> signal of the loop; it is not a rigid issue taxonomy or defensive prompt
> scaffold.

## Purpose

A validation loop is a wave pattern for earning confidence through realistic use.

The loop exercises the workstream's intended capability, notices gaps, turns
useful discoveries into bounded repair work, drives those repairs, reruns the
scenario, and produces evidence for the gate. Its purpose is not to prove that a
command ran once. Its purpose is to help the workstream earn the confidence it
claims.

## Core shape

The loop is simple:

1. Exercise the capability in a realistic scenario.
2. Notice failures, ambiguity, missing confidence, or boundary pressure.
3. Convert actionable gaps into bounded repair work when doing so improves
   clarity, parallelism, review, or auditability.
4. Drive repair through worker/reviewer sessions, normal project process, or a
   workstream-specific playbook.
5. Rerun after repairs land.
6. Repeat until the workstream has earned its gate or should escalate.

The mechanism can be manual, agent-operated, or eventually managed directly by
Streamliner. Today it may use terminal sessions, loop scripts, GitHub issues,
reviewer sessions, and merge loops. The doctrine is the same either way:
realistic exercise, discovered gaps, bounded repairs, rerun, and evidence.

## Judgment over taxonomy

The validation actor is expected to use judgment. It should not create issues
merely because something could be improved. It should create issues when an
observation threatens the workstream's intended confidence transition or when a
separate issue is the clearest way to bound, review, parallelize, or audit the
repair.

The important question is:

> Does this observation change whether the workstream has earned the confidence
> it is about to claim?

If yes, the loop should either drive repair, escalate, or make the remaining risk
explicit. If no, the observation may be ignored, noted, deferred, or promoted to
future work without blocking the gate.

## Repair and rerun

The power of a validation loop is closure. Finding issues once is useful;
repairing them and rerunning the scenario is what proves the system got stronger.
A loop that only reports defects is a diagnostic pass. A validation loop should
try to close the loop when the repair is inside the workstream's scope and
authority.

The loop should be alert for map corrections as well as defects. A run may show
that the design, boundary, validation criterion, or gate expectation is wrong.
Those discoveries should update the workstream plan or escalate to the developer
rather than being forced into ordinary implementation issues.

## Exit by earned confidence

A validation loop exits when it can make a credible gate report:

- what scenario was exercised;
- what evidence was produced;
- what gaps were found;
- what was repaired and rerun;
- what remains deferred, accepted, or outside scope;
- why the workstream is ready for demonstration or acceptance.

"No issues produced" can be a useful signal, especially for a narrow loop. It is
not the doctrine. The doctrine is earned confidence.

Good exit conditions are explicit enough for the gate to trust. Examples include:

- the declared scenario completed with no blocking in-scope issues;
- all generated blocking issues were closed and the scenario passed on rerun;
- remaining issues were explicitly deferred or accepted and do not undermine the
  claimed confidence transition;
- the loop escalated because the workstream map needs to change before the gate
  can be trusted.

## Relationship to demonstration gates

The gate consumes the validation report, not just the final code. A final
walkthrough should be able to lean on the loop's evidence: the scenario that was
run, the repairs it caused, the reruns that followed, and the remaining risks.

A validation loop does not replace developer judgment. It prepares the ground for
that judgment so the final demonstration is about the capability and its risks,
not about reconstructing what happened from scattered sessions and pull requests.

## Relationship to future Streamliner automation

Autonomous wave progression may eventually make validation loops a first-class
Streamliner capability. Workstreams should not wait for that framework support.
A validation-loop wave can be manually assembled today from prompts, playbooks,
loop scripts, GitHub issues, terminal sessions, reviewers, and merge policy.

As patterns stabilize across projects, they can be promoted into Streamliner
features. Until then, keep each validation loop shaped by the workstream's own
scenario, risks, and acceptance signal.
