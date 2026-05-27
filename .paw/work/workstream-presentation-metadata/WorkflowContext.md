# WorkflowContext

Work Title: Workstream Presentation Metadata
Work ID: workstream-presentation-metadata
Workflow Identity: paw-lite
Base Branch: main
Target Branch: issue-116-workstream-presentation
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:workstream-presentation-metadata:issue-116-workstream-presentation
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: single-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7-high
Final Review Specialists: not_applicable
Final Review Interaction Mode: not_applicable
Final Review Specialist Models: not_applicable
Final Review Perspectives: none
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: claude-opus-4.7-high
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7-high
Planning Review Specialists: not_applicable
Planning Review Interaction Mode: not_applicable
Planning Review Specialist Models: not_applicable
Planning Review Perspectives: none
Planning Review Perspective Cap: 2
Custom Workflow Instructions: Use PAW Lite for issue #116. Run work shaping only if necessary. Use a dedicated worktree. Keep human review to the final PR only. Use commit-and-clean artifact lifecycle.
Initial Prompt: Work on issue #116. Use paw-lite workflow. Single model review for plan and final, use opus 4.7 high reasoning. Run work shaping if necessary. Final pr only human review. commi-and-clean artifacts. use a worktree.
Issue URL: https://github.com/lossyrob/streamliner/issues/116
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: none

## Control State

TODO Mirror: active-required-items
Reconciliation: not_run

### Required Workflow Items
- `init` | `resolved` | `activity`
- `planning` | `resolved` | `activity`
- `planning-docs-review` | `resolved` | `activity`
- `implementation` | `pending` | `activity`
- `final-review` | `pending` | `activity`
- `final-pr` | `pending` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `resolved` | `procedure`
- `procedure:final-review` | `pending` | `procedure`
