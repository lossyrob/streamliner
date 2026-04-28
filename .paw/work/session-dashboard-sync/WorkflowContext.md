# WorkflowContext

Work Title: Session Dashboard Sync
Work ID: session-dashboard-sync
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/issue-17-session-dashboard-sync
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:session-dashboard-sync:feature/issue-17-session-dashboard-sync
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
Implementation Model: claude-opus-4.7
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
Custom Workflow Instructions: Implement issue #17 as a standalone Express-based local Streamliner API process. Vite should become frontend-only with API proxying. The API process owns session registry mutation, background observation/indexing, trusted signal ingestion, and live sync events. Use non-interactive PAW-lite flow through final PR.
Initial Prompt: Work on issue #17 for the session-launching-and-tracking workstream. Use a linked worktree. Update design docs for the standalone local API/service direction, implement the API/frontend split and session dashboard synchronization, run planning and final reviews with multi-model pre/post-mortem perspectives using Opus 4.7, and create a PR whose title includes issue #17.
Issue URL: https://github.com/lossyrob/streamliner/issues/17
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: .streamliner\workstreams\session-launching-and-tracking\brief.md; .streamliner\workstreams\session-launching-and-tracking\graph.json; docs\design\session-system.md; docs\design\decisions\004-session-registry-primary-surface.md; docs\design\decisions\005-session-registry-storage-and-identity.md; ORCHESTRATION.md

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
