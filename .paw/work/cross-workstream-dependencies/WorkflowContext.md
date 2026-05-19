# WorkflowContext

Work Title: Cross Workstream Dependencies
Work ID: cross-workstream-dependencies
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/cross-workstream-dependencies
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:cross-workstream-dependencies:feature/cross-workstream-dependencies
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7, claude-opus-4.6, gpt-5.5
Final Review Specialists: all
Final Review Interaction Mode: parallel
Final Review Specialist Models: none
Final Review Perspectives: auto
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: gpt-5.5, gemini-3-pro-preview, claude-opus-4.7
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: auto
Planning Review Perspective Cap: 2
Custom Workflow Instructions: Serious blockers, implementation decisions, or needed clarification require stopping to ask. Run work shaping after initialization before planning. The final PR title must include issue number #107.
Initial Prompt: Work on GitHub issue #107, "Represent cross-workstream dependencies in workstream graphs."
Issue URL: https://github.com/lossyrob/streamliner/issues/107
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: none

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
