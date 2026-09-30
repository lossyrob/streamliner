# App-native Streamliner spike

## Purpose

Test whether Copilot App can own local projects, worktrees, sessions, resume,
parent/child coordination, and messaging while Streamliner retains durable
workstream intent and context assembly.

## Approach

Read committed artifacts from one exact Git revision without checking out the
artifact branch. Prepare a bounded context bundle and capability token, then let
the orchestrator create the worker through the native App session API. The child
claims the token in that same App-created worktree.

## Design References

- `streamliner:docs/design/index.md` - design entry point
- `streamliner:docs/design/workstream-format.md` - durable/runtime separation
- `streamliner:docs/design/concepts/context-package.md` - Layer 0-3 context model

## Boundaries

- **In scope:** local App worktree sessions, exact-revision artifact reads,
  persistent launch binding, native parent/child messaging, and a read-only
  loopback Canvas.
- **Out of scope:** cloud sessions, terminal launch, Telex, a standalone
  dashboard, production migration, and writes to App internal stores.
- **Deferred:** shared remote artifact-ref policy, authorization hardening,
  garbage collection, and production graph editing.

## Current State

The architecture research node is complete. The original App-created worker
proof is preserved. Plugin distribution validation is now ready and gates the
remaining fresh-repository installation evidence.

## Decisions

- Copilot App owns session and worktree creation.
- Streamliner resolves a Git ref once and binds graph, brief, task, and launch
  provenance to the resulting commit.
- Runtime binding data stays in local user state and never enters the artifact
  ref.

## Open Questions

- Can the extension reliably correlate its SDK invocation session id with the
  App project-session id?
- What lifecycle signal should production use for abandoned prepared launches?

## Additional Context

### Node hints: app-native-implementation

Create only a harmless proof artifact. Do not launch a terminal, create another
worktree, or mutate the artifact ref.
