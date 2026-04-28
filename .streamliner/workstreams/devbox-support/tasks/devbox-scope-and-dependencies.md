# Devbox scope and dependency map

## Outcome

The workstream has a clear, reviewable boundary for "devbox support" and a
small list of external checkpoints it must consume from
`session-launching-and-tracking` before implementation can safely begin. A
reviewer can tell which questions this workstream owns, which are explicitly
owned by another workstream, and which implementation nodes remain blocked on
external contracts.

## Design References

- `docs/design/index.md` - entry point for the project design set.
- `docs/design/session-system.md` - current session registry, launch, tracking,
  and runtime overlay design.
- `docs/design/workstream-format.md` - artifact/runtime separation and graph
  dependency conventions.
- `.streamliner/workstreams/session-launching-and-tracking/brief.md` - current
  state and exported checkpoint expectations for the upstream workstream.
- `.streamliner/workstreams/session-launching-and-tracking/graph.json` - concrete
  upstream node and checkpoint shape.

## Exports

- A workstream-local dependency map that names the external checkpoints this
  workstream consumes and the first devbox implementation nodes each checkpoint
  unblocks.
- Any necessary brief or graph refinements if the current workstream boundary is
  too broad, too narrow, or missing a critical spike.

## Boundaries

### In scope

- Devbox observability scope and non-goals.
- Cross-workstream dependency mapping.
- Gate criteria for moving from spikes to implementation.

### Out of scope

- Choosing the remote observation transport; owned by
  `remote-observation-transport-spike`.
- Defining registry identity changes; owned by `environment-identity-spike`.
- Implementing devbox support; owned by downstream task nodes after the gates.

## Inherited decisions

- The upstream workstream owns local session registry/runtime/node-binding
  contracts. This node may name what devbox support needs from those contracts,
  but it must not redefine them locally.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md` only if the dependency
map exposes a missing devbox-related contract that should be documented before
the implementation tail starts.

## Success criteria

- The workstream boundary is stated in terms of observability and normalization,
  not general remote execution.
- External dependencies are checkpoint-sized, not arbitrary references to whole
  upstream implementation areas.
- The graph still allows independent research progress while implementation
  remains blocked on upstream contracts.

## Engagement

Operator review is expected before the research contract gate, especially on the
external checkpoint names and whether any dependency should move to a different
workstream.
