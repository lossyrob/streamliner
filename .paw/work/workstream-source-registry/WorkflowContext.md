# WorkflowContext

Work Title: Server-side Workstream Source Registry
Work ID: workstream-source-registry
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/issue-38-workstream-source-registry
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner
Execution Binding: worktree:workstream-source-registry:feature/issue-38-workstream-source-registry
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: single-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7
Final Review Specialists: pre-mortem, retrospective
Final Review Interaction Mode: smart-resolve
Final Review Perspectives: pre-mortem, retrospective
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: none
Planning Docs Review: enabled
Planning Review Mode: multi-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7, gpt-5.5
Planning Review Specialists: pre-mortem, post-mortem
Planning Review Interaction Mode: auto
Planning Review Specialist Models: none
Planning Review Perspectives: pre-mortem, post-mortem
Planning Review Perspective Cap: 2
Custom Workflow Instructions: Consolidate source registry design choices before planning. Plan review uses claude-opus-4.7 and gpt-5.5, non-interactive auto. Final implementation review uses claude-opus-4.7 with pre-mortem and retrospective perspectives, smart resolve. Final PR title must include issue number #38.
Initial Prompt: Implement issue #38 Add server-side workstream source registry
Issue URL: https://github.com/lossyrob/streamliner/issues/38
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: Prior tracked workstreams/browser-directory discussion from compacted session summary.

## Control State

TODO Mirror: active-required-items
Reconciliation: current

### Required Workflow Items
- `init` | `resolved` | `activity`
- `planning` | `resolved` | `activity`
- `planning-docs-review` | `resolved` | `activity`
- `implementation` | `resolved` | `activity`
- `final-review` | `resolved` | `activity`
- `final-pr` | `in_progress` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `resolved` | `procedure`
- `procedure:final-review` | `resolved` | `procedure`
