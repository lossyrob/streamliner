# Devbox security and credential spike

## Outcome

The workstream has a security and credential boundary for devbox support. It is
clear what Streamliner may persist, what must remain in OS or external
credential storage, how host trust is established, and how failures should be
surfaced without leaking secrets into committed artifacts, logs, or runtime
files.

## Design References

- `docs/design/product.md` - local-first architecture direction.
- `docs/design/workstream-format.md` - committed artifacts versus local runtime
  state.
- `docs/design/session-system.md` - session registry and runtime-state storage
  expectations.

## Exports

- A security boundary for devbox registration and observation.
- A credential-handling recommendation for the first implementation slice.
- Logging, diagnostics, and redaction expectations for downstream nodes.

## Boundaries

### In scope

- Secret and credential ownership.
- Trusted host registration and verification.
- Runtime-state redaction expectations.
- Failure reporting for denied access or expired credentials.

### Out of scope

- Implementing a credential manager.
- Multi-user access control.
- Cloud-hosted Streamliner service design.

## Inherited decisions

- Workstream artifacts are committed files and must not contain secrets. Runtime
  state is local-first but still should not persist credentials unless a later
  accepted design explicitly says so.

## Design-impact expectation

Expect `updated-docs` on `docs/design/session-system.md` if devbox support adds
new registration or runtime-state security requirements. Open an ADR only if the
credential model constrains future remote/launch workstreams.

## Success criteria

- No proposed contract requires credentials or tokens in `brief.md`,
  `graph.json`, task specs, or design docs.
- Downstream implementation knows where to get credentials and how to report
  failures.
- The finding identifies what diagnostic information is safe to display or log.

## Engagement

Operator review is expected if the spike recommends adding a devbox-side helper,
credential cache, or persistent host trust store.
