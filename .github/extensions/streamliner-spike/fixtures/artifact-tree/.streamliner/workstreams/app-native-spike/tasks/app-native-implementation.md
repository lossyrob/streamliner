# Exercise an App-created worker

## Outcome

Prove that a cold App-created child worktree session can claim a prepared launch,
identify the exact artifact revision, use its bounded Layer 0-3 context, and
report completion to its creator.

## Success criteria

- Claim the binding token with `streamliner_spike_claim_launch`.
- Report the exact revision and source manifest returned by the claim.
- Create `spike-proof/app-native-child.md` in the child worktree with the launch
  id, artifact revision, context digest, and a short note confirming no nested
  worktree or terminal was created.
- Commit the proof file on the child branch with the Copilot co-author trailer.
- Call `streamliner_spike_complete_launch`.
- Send the creator a concise native `send_session_message` report.

## Constraints

Do not create a pull request, another session, another worktree, or a terminal.
Do not alter the local artifact ref.
