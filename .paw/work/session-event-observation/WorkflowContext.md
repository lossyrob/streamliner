# WorkflowContext

Work Title: Session Event Observation
Work ID: session-event-observation
Workflow Identity: paw-lite
Base Branch: main
Target Branch: feature/session-event-observation
Execution Mode: current-checkout
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: none
Workflow Mode: custom
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
Planning Docs Review: disabled
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
Issue URL: https://github.com/lossyrob/streamliner/issues/49
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: streamliner-context=streamliner/context.md

## Control State

TODO Mirror: active-required-items
Reconciliation: not_run

### Required Workflow Items
- `init` | `resolved` | `activity`
- `planning` | `pending` | `activity`
- `planning-docs-review` | `not_applicable` | `activity`
- `implementation` | `pending` | `activity`
- `final-review` | `pending` | `activity`
- `final-pr` | `pending` | `activity`

### Configured Procedure Items
- `procedure:planning-review` | `not_applicable` | `procedure`
- `procedure:final-review` | `pending` | `procedure`
