# Workflow Context: Issue 100 PAW Review Companion Launch

## Work ID
issue-100-review-companion

## GitHub Issue
lossyrob/streamliner#100

## Workflow Configuration
- Workflow Mode: paw-lite
- Review Strategy: local
- Review Policy: final-pr-only
- Human Review Policy: final-pr-only
- Planning Docs Review: enabled
- Planning Review Mode: single-model
- Planning Review Models: Claude Opus 4.7
- Implementation Model: none
- Final Agent Review: enabled
- Final Review Mode: multi-model
- Final Review Models: Claude Opus 4.7, Claude Opus 4.6, GPT 5.5
- Final Review Interactive: false
- Artifact Lifecycle: commit-and-clean

## Scope
Implement a quick prototype that lets a terminal node launch optionally open a second PAW Review companion terminal. The companion terminal uses a separately saved prompt template, substitutes `{{githubIssue}}` from the selected node's GitHub tracker number, uses the same working directory, terminal preference, and tab color as the main launch, and appends ` REVIEW` to the terminal title.

## Stop Conditions
Stop and discuss if implementation requires product decisions beyond the confirmed scope, if the generic companion endpoint cannot be made loopback-only, or if the feature requires changing launch-claim/session binding semantics.
