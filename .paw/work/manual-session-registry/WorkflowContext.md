# WorkflowContext

Work Title: Manual Session Registry
Work ID: manual-session-registry
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/manual-session-registry
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:manual-session-registry:feature/manual-session-registry
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7, gpt-5.4 xhigh reasoning
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
Planning Review Models: claude-opus-4.7, gpt-5.4 xhigh reasoning
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: pre-mortem, post-mortem
Planning Review Perspective Cap: 2
Custom Workflow Instructions: none
Issue URL: https://github.com/lossyrob/streamliner/issues/13
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: .paw/work/manual-session-registry/context/wave-context.md

## Control State

TODO Mirror: active-required-items
Reconciliation: current

### Required Workflow Items
- `init` | `resolved` | `activity`
- `planning` | `resolved` | `activity`
- `planning-docs-review` | `resolved` | `activity`
- `implementation` | `resolved` | `activity`
- `final-review` | `resolved` | `activity`
- `final-pr` | `pending` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `resolved` | `procedure`
- `procedure:final-review` | `resolved` | `procedure`
