# WorkflowContext

Work Title: Session Registry Model
Work ID: session-registry-model
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/session-registry-model
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:session-registry-model:feature/session-registry-model
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: false
Final Review Models: claude-opus-4.7, claude-opus-4.7
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
Planning Review Models: claude-opus-4.7, claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: pre-mortem, post-mortem
Planning Review Perspective Cap: 2
Custom Workflow Instructions: PAW Lite workflow. Skip work shaping unless the issue proves ambiguous. Continue autonomously through planning, implementation, final review, and PR creation; stop only for serious blockers. Final PR title must include issue number (#11).
Initial Prompt: Design the local-first session registry model for Wave 2 (Issue #11).
Issue URL: https://github.com/lossyrob/streamliner/issues/11
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
- `final-pr` | `in_progress` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `resolved` | `procedure`
- `procedure:final-review` | `resolved` | `procedure`
