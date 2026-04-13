# Waves

Streamliner uses wave-based planning to keep later work from going stale. Rather than detailing every node upfront, the builder and orchestrator shape near-term work in full detail and leave later work as sketches that get promoted as reality unfolds.

## How waves work

1. **Wave 1** — near-term nodes get fully detailed specs (created as issues or local spec files)
2. **Later waves** — nodes exist as sketches: title, summary, rough dependencies
3. As earlier waves complete, the orchestrator promotes the next wave — detailing specs, refining dependencies, and creating tracker-backed issues based on what actually shipped

This keeps later work from drifting against a plan that was written before the builder saw real output.

## Wave structure in the graph

Waves are represented structurally rather than through an explicit `wave` field:

- **Dependencies** define sequencing — later-wave nodes depend on earlier-wave gates or tasks
- **Checkpoints** group related nodes into named milestones that correspond to wave boundaries
- **Tracker promotion** marks the transition from sketch to detailed — a node gains a tracker (issue or local spec) when its wave is being shaped

This keeps the schema simple while still making wave boundaries visible in the graph.

## Wave promotion

When the orchestrator promotes the next wave, it:

1. Reviews what the current wave planned vs. what actually shipped
2. Consults the design layer to check whether the intended direction still holds
3. Details the next wave's nodes — writing specs, creating issues, refining dependencies
4. Updates the brief's Current State to reflect the transition
5. Brings the updated plan to the builder for review

Promotion is the orchestrator's primary planning activity between waves.

## Gates as wave boundaries

Gates typically sit at wave boundaries. They are the builder's checkpoint — the moment to evaluate whether the workstream is on track before the next wave begins. Gate review includes hands-on testing of the running system, not just artifact review.

A gate blocks all downstream nodes until the builder passes it. This ensures the next wave doesn't start on assumptions the builder hasn't validated.
