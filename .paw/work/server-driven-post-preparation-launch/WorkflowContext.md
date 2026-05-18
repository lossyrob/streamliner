# WorkflowContext

Work Title: Server Driven Launch
Work ID: server-driven-post-preparation-launch
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/issue-105-server-driven-post-preparation-launch
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:server-driven-post-preparation-launch:feature/issue-105-server-driven-post-preparation-launch
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
Plan Generation Models: gpt-5.2, gemini-3-pro-preview, claude-opus-4.6
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: auto
Planning Review Perspective Cap: 2
Custom Workflow Instructions: none
Initial Prompt: Issue #105: Server-driven post-preparation terminal and companion launch
Issue URL: https://github.com/lossyrob/streamliner/issues/105
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: none

## Control State

TODO Mirror: active-required-items
Reconciliation: complete

### Required Workflow Items
- `init` | `resolved` | `activity`
- `planning` | `resolved` | `activity`
- `planning-docs-review` | `resolved` | `activity`
- `implementation` | `resolved` | `activity`
- `final-review` | `pending` | `activity`
- `final-pr` | `pending` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `resolved` | `procedure`
- `procedure:final-review` | `pending` | `procedure`
