# WorkflowContext

Work Title: Runtime Overlay Polish
Work ID: terminal-launch-portability-seam
Base Branch: main
Target Branch: feature/runtime-overlay-polish
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:terminal-launch-portability-seam:feature/runtime-overlay-polish
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: false
Final Review Models: gpt-5.5, claude-opus-4.7
Final Review Specialists: all
Final Review Interaction Mode: parallel
Final Review Specialist Models: none
Final Review Perspectives: auto
Final Review Perspective Cap: 2
Implementation Model: none
Plan Generation Mode: single-model
Plan Generation Models: gpt-5.5
Planning Docs Review: enabled
Planning Review Mode: single-model
Planning Review Interactive: false
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: auto
Planning Review Perspective Cap: 2
Custom Workflow Instructions: PAW-lite execution for PR #71. Run work shaping first, use final-pr-only human review, run planning review as single-model claude-opus-4.7, run final review as multi-model gpt-5.5 and claude-opus-4.7, use the dedicated worktree, and use commit-and-clean artifact lifecycle.
Initial Prompt: Work on #71. Do a paw-lite process. First do paw-workshaping to get the shape. Then move through using final-pr-only human review mode, plan review single model Opus 4.7, final review multi-model GPT 5.5 and Opus 4.7. Use a worktree. commit-and-clean.
Issue URL: https://github.com/lossyrob/streamliner/pull/71
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: GitHub issue #56 terminal launch portability seam; open PR #71 on feature/runtime-overlay-polish.
