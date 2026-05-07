# Plan: Managed Worker Runtime Contract

## Problem and approach

Issue #61 is a contract-confidence node for the `sdk-managed-worker-runtime`
workstream. The upstream capability report already recommends a constrained-go
path for SDK-managed graph-node workers, but downstream implementation nodes need
one coherent product/runtime contract rather than another round of capability
research.

The implementation will update the project design layer and add a concise
workstream-local contract summary. The contract will keep terminal-first launch
as the default/supported path while making SDK-managed workers a first-class
builder-selected node runtime option with explicit lifecycle, registry identity,
progress, permission, takeover, PR/completion, cleanup, and review-loop
semantics.

## Work items

1. **Design contract**
   - Update `docs/design/session-system.md` so SDK-managed workers are covered by
     the session system rather than listed as out of scope.
   - Define runtime selection at node launch, registry/runtime-state ownership,
     managed lifecycle states and transitions, browser-safe progress projection,
     permission posture, interruption/cancellation, one-way terminal takeover,
     PR/completion detection, cleanup-after-merge, graph overlay behavior, and
     Automated PAW Review Loop import requirements.
   - Add a decision record under `docs/design/decisions/` if the contract creates
     durable cross-workstream rationale or constraints beyond the living design
     update. Keep `docs/design/index.md` and
     `docs/design/.vitepress/config.ts` synchronized if a decision is added.

2. **Downstream summary**
   - Add
     `.streamliner/workstreams/sdk-managed-worker-runtime/docs/managed-worker-runtime-contract.md`
     as a concise implementation-facing summary.
   - Organize it around the needs of downstream workers: substrate, UI,
     takeover/cleanup, foundation gate, and Automated PAW Review Loop.

3. **Validation, review, and PR**
   - Run the configured PAW Lite planning-docs review before implementation
     because `WorkflowContext.md` has `Planning Docs Review: enabled`.
   - Run relevant repository validation for documentation changes.
   - Commit selectively according to `Artifact Lifecycle: commit-and-clean`.
   - Run the configured final multi-model review before PR creation.
   - Create the final PR with a title that includes `#61` and a description that
     includes the required collapsible `Docs.md` section.

## Key decisions and constraints

- Do not implement production runtime, registry, API, or UI code in this node.
- Do not re-prove SDK/CLI parity unless a contract detail depends on a missing
  fact; inherit PR #63 and the local spike findings.
- Preserve the registry as the canonical session surface with Streamliner-owned
  stable row ids. SDK ids and Copilot session ids remain separate nullable
  identity facts.
- Keep browser progress as an allowlisted projection. Do not expose raw prompts,
  reasoning, tool arguments/results, hook payloads, terminal output, or
  secret-bearing content.
- Treat permission policy as an explicit unattended-worker runtime posture; do
  not inherit launch-preparation `approveAll` as the default.
- Treat terminal takeover as one-way for the first cut. After successful
  `copilot --resume <sdk-session-id>` takeover, ownership transfers to the
  terminal path and SDK management does not resume.
- Treat cleanup-after-merge as a deterministic backend lifecycle action with
  safety checks, not a model prompt.
- Recommend tracker/graph amendments only if the accepted contract changes node
  boundaries, dependencies, gates, or workstream assumptions.
