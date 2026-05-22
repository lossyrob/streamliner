# WorkflowContext

Work Title: Serialize Streamliner-owned Copilot terminal launches
Work ID: issue-109-serialize-copilot-launches
Workflow Identity: paw-lite
Base Branch: origin/main
Target Branch: feature/issue-109-serialize-copilot-launches
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@079f738bf75340f1cc9bc4394f97616e5f8aa9da
Execution Binding: worktree:issue-109-serialize-copilot-launches:feature/issue-109-serialize-copilot-launches
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continue-current-session
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7, claude-opus-4.6, gpt-5.5
Final Review Specialists: all
Final Review Interaction Mode: parallel
Final Review Specialist Models: none
Final Review Perspectives: none
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: session
Plan Generation Models: none
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: none
Planning Review Perspective Cap: 2
Custom Workflow Instructions: Use paw-lite. Planning review single model Opus 4.7. Final review multi-model Opus 4.7, Opus 4.6, GPT 5.5. All AI reviews non-interactive. Human review policy final-pr-only. Stop for serious blockers, decisions, or needed clarification. Do work in this worktree. Final PR title must include issue number #109.
Initial Prompt: Work on https://github.com/lossyrob/streamliner/issues/109
Issue URL: https://github.com/lossyrob/streamliner/issues/109
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
