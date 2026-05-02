# WorkflowContext

Work Title: PAW Launch Configuration and Prompt Defaults
Work ID: issue-33-launch-prompt-profiles
Workflow Identity: paw
Base Branch: main
Target Branch: feature/issue-33-launch-prompt-profiles
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:issue-33-launch-prompt-profiles:feature/issue-33-launch-prompt-profiles
Workflow Mode: full
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: smart
Final Review Models: gpt-5.2, gemini-3-pro-preview, claude-opus-4.6
Final Review Specialists: all
Final Review Interaction Mode: parallel
Final Review Specialist Models: none
Final Review Perspectives: auto
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: gpt-5.2, gemini-3-pro-preview, claude-opus-4.6
Planning Docs Review: enabled
Planning Review Mode: multi-model
Planning Review Interactive: smart
Planning Review Models: gpt-5.2, gemini-3-pro-preview, claude-opus-4.6
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: auto
Planning Review Perspective Cap: 2
Custom Workflow Instructions: none
Initial Prompt: none
Issue URL: https://github.com/lossyrob/streamliner/issues/33
Remote: origin
Artifact Lifecycle: commit-and-persist
Artifact Paths: auto-derived
Additional Inputs: none

## Control State

TODO Mirror: active-required-items
Reconciliation: not_run

### Required Workflow Items
- `init` | `resolved` | `activity`
- `spec` | `pending` | `activity`
- `spec-review` | `pending` | `activity`
- `code-research` | `pending` | `activity`
- `planning` | `pending` | `activity`
- `plan-review` | `pending` | `activity`
- `planning-docs-review` | `pending` | `activity`
- `final-review` | `pending` | `activity`
- `final-pr` | `pending` | `activity`

### Gate Items
- `transition:after-spec-review` | `pending` | `transition`
- `transition:after-plan-review` | `pending` | `transition`
- `transition:after-planning-docs-review` | `pending` | `transition`
- `transition:after-phase:<n>` | `pending` | `transition`
- `transition:after-final-review` | `pending` | `transition`

### Configured Procedure Items
- `procedure:planning-review` | `pending` | `procedure`
- `procedure:final-review` | `pending` | `procedure`
