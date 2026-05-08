# WorkflowContext

Work Title: Show Live GitHub Status
Work ID: show-live-github-issue-pr-status
Base Branch: main
Target Branch: feature/show-live-github-issue-pr-status
Execution Mode: worktree
Repository Identity: github.com/lossyrob/streamliner@154ce519f66916dfe71f62c49f49f4de6a65a3f7
Execution Binding: worktree:show-live-github-issue-pr-status:feature/show-live-github-issue-pr-status
Workflow Mode: custom
Review Strategy: local
Review Policy: final-pr-only
Session Policy: continuous
Final Agent Review: enabled
Final Review Mode: multi-model
Final Review Interactive: smart
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
Planning Review Interactive: smart
Planning Review Models: claude-opus-4.7
Planning Review Specialists: all
Planning Review Interaction Mode: parallel
Planning Review Specialist Models: none
Planning Review Perspectives: auto
Planning Review Perspective Cap: 2
Custom Workflow Instructions: Use PAW Lite for issue #69. Start with paw-work-shaping, then plan, run planning docs review in single-model claude-opus-4.7 mode, implement in a dedicated worktree, run final review in multi-model mode with gpt-5.5 and claude-opus-4.7, create only the final human PR review gate, and use commit-and-clean artifact lifecycle.
Initial Prompt: Work on #69: Show live GitHub issue and PR status for nodes and sessions.
Issue URL: https://github.com/lossyrob/streamliner/issues/69
Remote: origin
Artifact Lifecycle: commit-and-clean
Artifact Paths: auto-derived
Additional Inputs: none
