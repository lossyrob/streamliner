# Devbox access spike

## Outcome

The workstream knows which concrete devbox access model the first devbox
observability slice should target, and which host-registration facts Streamliner
can safely persist without storing secrets. The finding should make it clear
whether the local Streamliner process can reach devbox session state directly or
whether a devbox-side helper is required.

## Design References

- `docs/design/product.md` - local-first web app direction and registered repo
  model.
- `docs/design/session-system.md` - current launch inputs and explicit deferral
  of remote environments.
- `docs/design/decisions/001-observation-based-session-tracking.md` - accepted
  observation strategy for local session state.

## Exports

- A recommended first devbox access path, including what the builder must
  configure and what Streamliner can verify automatically.
- A minimal devbox host-registration field list, split into committed artifact
  fields, local runtime/config fields, and external credential-manager state.
- A list of access models rejected for the first slice and why.

## Boundaries

### In scope

- Existing devbox connection mechanisms available to the builder.
- Host registration identity, reachability, and verification needs.
- Whether direct remote filesystem observation is plausible.

### Out of scope

- Remote session event parsing; owned by `remote-session-state-spike`.
- Scan/watch mechanics and latency; owned by
  `remote-observation-transport-spike`.
- Credential storage implementation; owned by downstream implementation after
  `devbox-security-spike`.

## Inherited decisions

- Streamliner remains local-first for this workstream. Devbox support should
  extend the local app's observability surface, not introduce a hosted
  multi-user control plane.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md` if the accepted access
model changes the launch/environment vocabulary that document currently treats
as deferred.

## Success criteria

- The first implementation target is concrete enough for a worker to build
  against without choosing between unrelated remote access architectures.
- The registration model does not require secrets in committed workstream
  artifacts or design docs.
- The finding identifies at least one way to test reachability against a real
  devbox before implementation begins.

## Engagement

Operator review is expected on the selected first access path because that
choice constrains every downstream implementation node.
