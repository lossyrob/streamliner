---
name: worktree-preview
description: >
  Launches an isolated Streamliner preview instance for the current worktree or
  PR branch without disrupting the user's main Streamliner checkout. Activate
  when the user asks to preview, inspect, smoke-test, or review Streamliner UI
  changes from a worktree/PR in a browser.
---

# Worktree Preview Skill

Use this skill when the user wants to see a branch's Streamliner UI without
switching away from their main running Streamliner instance.

## Default workflow

1. Pick a preview name. Prefer a PR or branch slug, for example `pr-41`.
2. Start the preview in read-only mode from a Copilot-managed background shell:

   ```powershell
   npm run preview:worktree:attached -- --name pr-41 --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
   ```

   Use the Copilot CLI PowerShell tool in async mode. Do not use `detach: true`;
   the attached launcher keeps API/Vite as children of the Copilot-managed
   background task so they stop when that task is stopped or the session exits.

3. Report the `URL:` printed by the command. Reusing the same preview name
   reuses the same URL when its persisted ports are available.
4. Leave the preview running until the user asks for it to stop. The agent owns
   shutdown and should stop the preview itself when requested instead of asking
   the user to run a stop command.

Read-only mode is the default. It disables the session background worker and
blocks mutating API requests, so browsing the preview does not create PAW
launch artifacts, relaunch sessions, or modify the main registries.

## When to use sandbox mode

Use sandbox mode only when the user explicitly wants to test a mutating flow,
such as launching a PAW worker or changing tracked workstreams:

```powershell
npm run preview:worktree:attached -- --name pr-41 --mode sandbox --graph .streamliner\workstreams\session-launching-and-tracking\graph.json
```

Run sandbox mode in an async Copilot shell.

Sandbox mode still uses isolated preview state under `.streamliner-preview/`.
It should not touch the user's main Streamliner process, but it allows writes
inside the preview's disposable registries.

## Status and troubleshooting

Check a running preview:

```powershell
npm run preview:status -- --name pr-41
```

Stop a preview when the user asks:

```powershell
npm run preview:stop -- --name pr-41
```

The launcher prints API/Vite log paths under
`.streamliner-preview\<name>\logs\`. If startup fails, inspect those logs before
retrying. Use `--force` only when the status command shows stale PIDs.
Stable preview ports are stored in `.streamliner-preview\<name>\ports.json` and
survive `preview:stop`. If a preview was started with `--attached`, stopping the
Copilot background task also stops the preview.

## Agent notes

- Do not start `npm run dev` for PR preview unless the user specifically asks;
  it uses the normal development ports and can disrupt their active instance.
- Prefer `--attached` for agent-started previews so Copilot tracks the
  background task and no extra terminal windows appear.
- Prefer the rich `session-launching-and-tracking` graph for visual review.
- If another graph is relevant to the PR, pass it with `--graph <path>`.
- Keep the preview URL in your response and say you can stop the preview on
  request. Do not make the user responsible for stopping it.
- Track the preview name and async shell id you used. If the user asks to stop
  the preview, stop the owning Copilot background task when available, or run
  `npm run preview:stop -- --name <name>` from the worktree.
