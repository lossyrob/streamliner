# Define launch contract

## Outcome
Specify the contract for launching a PAW session from a graph node so backend
implementation can proceed without inventing behavior ad hoc.

## Success criteria
- The graph-side launch interaction is defined: what the operator can configure,
  what defaults apply, and what launch action means.
- The backend-side artifact contract is defined: what context is assembled, what
  gets written into the PAW work directory, and how design references are passed
  through.
- The terminal-launch contract is defined: what must be visible to the
  operator, how intervention works, and what counts as a successful launch.
- The boundary between committed artifacts and local runtime state is explicit
  for launch metadata, session IDs, and status overlays.
- Open questions that block implementation are called out explicitly.

## Relevant context
- Copilot SDK should run `paw-init` on the backend.
- Design docs should be referenced, not inlined into a giant static context
  bundle.
- Session tracking is a separate but adjacent concern and should inform the
  launch contract where identifiers or metadata need to line up.

## Notes
- Prefer a contract that works for the manual-session phase now while setting up
  the plumbing needed for direct launch from the graph later.
