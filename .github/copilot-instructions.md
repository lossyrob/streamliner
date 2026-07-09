# Copilot instructions

## Worktree cleanup

When asked to reconcile, clean up, or remove a completed Streamliner worktree,
run the repository cleanup command from the main checkout instead of manually
typing `git worktree remove` and `git branch -d`:

```powershell
npm run cleanup:worktree -- <path-or-directory-name>
npm run cleanup:worktree:remove -- <path-or-directory-name>
```

`cleanup:worktree` is a dry run. Use `cleanup:worktree:remove` only when the
target is clear and cleanup should actually happen. Use
`npm run cleanup:worktree:force -- <path-or-directory-name>` only after the user
confirms forced worktree removal and branch deletion are intended.
