# WorkflowContext

Work Title: Preserve and repair graph bindings after launch claim pruning
Work ID: issue-111-graph-binding-repair
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/issue-111-graph-binding-repair
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@93344a8f52b49b089a7583dd5c31941686ef2fb7
Execution Binding: worktree:issue-111-graph-binding-repair:feature/issue-111-graph-binding-repair
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
Final Review Perspectives: pre-mortem, post-mortem
Final Review Perspective Cap: 3
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: none
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: pre-mortem
Planning Review Perspective Cap: 1
Custom Workflow Instructions: Serious blockers, implementation decisions, or clarification needs must stop for operator discussion. Final PR title must include issue number #111.
Initial Prompt: Work on issue 111. Use the paw-lite workflow. planning review single model Opus 4.7. Then for final review, multi-model, Opus 4.7 Opus 4.6 GPT 5.5. all ai reviews non-interactive. final-pr-only human review. If there are serious blockers, stop and ask. If there are decisions to be made or clarification that is needed, stop and lets discuss. Do your work in a worktree. The final PR should have the issue number in the title.
Issue URL: https://github.com/lossyrob/streamliner/issues/111
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
