# WorkflowContext

Work Title: Streamliner Desktop MVP
Work ID: streamliner-desktop-mvp
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/streamliner-desktop-mvp
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:streamliner-desktop-mvp:feature/streamliner-desktop-mvp
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: smart
Final Review Models: claude-opus-4.7-xhigh, claude-opus-4.8, gpt-5.5
Final Review Specialists: all
Final Review Interaction Mode: parallel
Final Review Specialist Models: none
Final Review Perspectives: auto
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: none
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: smart
Planning Review Models: gpt-5.5
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: auto
Planning Review Perspective Cap: 2
Custom Workflow Instructions: Work shaping first (artifact in this work dir), then single-model plan generation. Before completing the plan, enumerate failure modes of the designed fix and the situations where this class of problem recurs, then run several rounds of rubber-ducking with a claude-opus-4.7-xhigh subagent and improve the plan. Then single-model planning-docs review with gpt-5.5. Implementation via fleet, then multi-model final review (claude-opus-4.7-xhigh, claude-opus-4.8, gpt-5.5), then final PR. MVP must supplant the toasty.exe usage in the dbagent orchestrator prompt.
Initial Prompt: Implement a ruthlessly scoped MVP "Streamliner Desktop" notification companion (Tauri-style) that turns Streamliner events/orchestrator pings into Windows toasts plus a durable, linkable feed, and can supplant the toasty.exe usage in C:\Users\robemanuele\proj\planning\planning\streamliner\dbagent\prompt-drafts\orchestrator-initial-prompt-v1.md.
Issue URL: none
Remote: origin
Artifact Lifecycle: commit-and-persist
Artifact Paths: auto-derived
Additional Inputs: none

## Control State

TODO Mirror: active-required-items
Reconciliation: not_run

### Required Workflow Items
- `init` | `resolved` | `activity`
- `work-shaping` | `done` | `activity`
- `planning` | `pending` | `activity`
- `planning-docs-review` | `pending` | `activity`
- `implementation` | `pending` | `activity`
- `final-review` | `pending` | `activity`
- `final-pr` | `pending` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `pending` | `procedure`
- `procedure:final-review` | `pending` | `procedure`
