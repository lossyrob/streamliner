# Environment identity spike

## Outcome

The workstream has a concrete identity and normalization model for devbox
sessions that can merge with the primary session registry without colliding with
local sessions. A reviewer can tell which fields identify the host/environment,
which fields identify the Copilot session, and which fields are only derived
runtime overlay state.

## Design References

- `docs/design/session-system.md` - registry record shape, observation import,
  graph binding, and lifecycle semantics.
- `docs/design/decisions/004-session-registry-primary-surface.md` - one canonical
  registry row per tracked session.
- `docs/design/decisions/005-session-registry-storage-and-identity.md` - stable
  registry ids and file-backed storage model.

## Inputs

- Devbox scope/dependency map from `devbox-scope-and-dependencies`.
- Remote session-state facts from `remote-session-state-spike`.

## Exports

- A proposed environment identity model for devbox-observed sessions.
- Merge rules for local versus devbox sessions when `cwd`, repo, branch, or
  Copilot session ids overlap.
- A design-impact recommendation: update the living session-system design, open
  a decision record, or keep the rule workstream-local until implementation
  proves it more widely consequential.

## Boundaries

### In scope

- Host id, environment id, remote cwd, repo, branch, session-state root, and
  Copilot session id normalization.
- Registry merge and graph-binding implications.
- Collision and ambiguity behavior.

### Out of scope

- Multi-machine registry sync; deferred by Decision 004.
- Non-Copilot terminal identity.
- Devbox launch identity; deferred until a launch/recovery workstream.

## Inherited decisions

- The registry id remains Streamliner-owned and must not become the Copilot
  session id, host id, or any remote filesystem path.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md`. Flag
`decision-needed` if the proposed identity model changes the accepted invariant
of one canonical registry row per tracked session.

## Success criteria

- Ambiguous local/devbox matches do not auto-merge silently.
- Builder-owned fields remain preserved across remote observation refreshes.
- The model explains how the UI can distinguish local and devbox sessions without
  requiring portfolio-shell work.

## Engagement

Operator review is expected on the identity model before implementation nodes are
promoted.
