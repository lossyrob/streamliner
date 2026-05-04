# WorkflowContext

Work Title: Terminal Launch Integration
Work ID: terminal-launch-integration
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/terminal-launch-integration-2
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:terminal-launch-integration:feature/terminal-launch-integration-2
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7
Final Review Specialists: all
Final Review Interaction Mode: parallel
Final Review Specialist Models: none
Final Review Perspectives: pre-mortem, post-mortem
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: claude-opus-4.7
Planning Docs Review: enabled
Planning Review Mode: multi-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: pre-mortem, post-mortem
Planning Review Perspective Cap: 2
Custom Workflow Instructions: I will only review the final PR, so continue working - but if there are serious blockers, stop and ask. If there are updates that need to be made to the issue, pause and suggest a set of amendments we can discuss. The final PR should have the issue number in the title. PR description has a collapsable "Docs.md" section that contains a paw-docs-guidance Docs.md style guide.
Initial Prompt: Execute Streamliner graph node terminal-launch-integration for issue #44: integrate context assembly, PAW launch preparation handoff, launch-claim binding, and terminal spawning into one API-callable graph launch action.
Issue URL: https://github.com/lossyrob/streamliner/issues/44
Remote: origin
Artifact Lifecycle: commit-and-persist
Artifact Paths: auto-derived
Additional Inputs: streamliner-context=C:/Users/robemanuele/proj/streamliner/streamliner-terminal-launch-integration/.paw/work/terminal-launch-integration/streamliner/context.md; streamliner-staged-context=C:/Users/robemanuele/.streamliner/state/streamliner/session-launching-and-tracking/launch-contexts/ctx-20260504021505-bffec5ec/context.md; streamliner-context-id=ctx-20260504021505-bffec5ec; node=terminal-launch-integration; graph=C:/Users/robemanuele/proj/streamliner/streamliner/.streamliner/workstreams/session-launching-and-tracking/graph.json; launch-nonce=477a53d7-034a-4e7c-9f27-b51c035b83e8

## Control State

TODO Mirror: active-required-items
Reconciliation: not_run

### Required Workflow Items
- `init` | `resolved` | `activity`
- `planning` | `pending` | `activity`
- `planning-docs-review` | `pending` | `activity`
- `implementation` | `pending` | `activity`
- `final-review` | `pending` | `activity`
- `final-pr` | `pending` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `pending` | `procedure`
- `procedure:final-review` | `pending` | `procedure`
