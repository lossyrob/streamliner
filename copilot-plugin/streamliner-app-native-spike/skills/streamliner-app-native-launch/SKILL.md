---
name: streamliner-app-native-launch
description: Claims and executes one Streamliner App-native launch in the same App-created session.
---

# Streamliner App-native launch

Use this skill only when the user provides a Streamliner App-native binding token.

## Required sequence

1. Call `streamliner_spike_claim_launch` with the exact token as the first action.
2. Call `streamliner_spike_initialize_paw` with the returned launch ID as the second action. Accept an idempotently reused initialization.
3. Read the generated `WorkflowContext.md`, `context.md`, and `claim.json`; the claimed Layer 0-3 context is the source of truth.
4. Perform the complete bounded node in the current App-created session, worktree, and branch. Do not create or switch branches, create another session or worktree, delegate the node, open a terminal session, push, or create a pull request.
5. Use `streamliner_app_native_spike_inspect_compatibility` after initialization when the node depends on package or schema compatibility.
6. Run the node's focused checks, commit the implementation and App-aware PAW artifacts with the required Copilot trailer, and collect exact evidence.
7. Use native `send_session_message` to report to the creator project-session ID supplied by the launch prompt. Include the App project-session ID and branch, SDK session ID from the claim, launch ID, artifact revision and digest, PAW initialization result, commit SHA, compatibility versions, checks, documentation impact, and residual uncertainty.

Do not call `streamliner_spike_complete_launch` unless the orchestrator explicitly provides the independent review, integration, and draft pull request evidence required for completion.
