---
name: iterative-ui
description: >
  Canonical workflow for iterative UI development on the Streamliner
  dashboard. Use Playwright-driven screenshots to verify visual changes
  against real graph data before committing. Activate whenever work touches
  src/**/*.tsx, src/streamliner-theme.css, src/workstream-graph.ts (layout
  constants), or any other file that changes what the dashboard renders.
---

# Iterative UI Skill

Streamliner's dashboard is a React + xyflow canvas backed by a per-repo
`graph.json`. Visual changes are easy to regress by eye because a graph may
contain many node types, status pills, highlight modes, and wave/checkpoint
groupings. This skill captures the verified loop for iterating on the UI
with a human in the loop.

**When active**, you must not claim a UI change is complete without at least
one `scripts/screenshot.mjs` capture against a representative graph.

## The loop

```
  1. Make a code change
  2. Run `npm test -- --run` (fast signal)
  3. Capture a screenshot of the affected state(s)
  4. Inspect the screenshot; compare against the expected visual
  5. Iterate (back to 1) or commit
```

Bundle steps 2–4 into a single tool turn whenever possible — tests and
screenshot capture can run in parallel shells.

## Screenshot harness

`scripts/screenshot.mjs` boots the Vite dev server against a specified
graph file (via `STREAMLINER_GRAPH`) and saves a PNG using a headless
Chromium. It is the only supported way for an agent to inspect the
dashboard; do not rely on the user to screenshot for you.

### Basic capture

```bash
node scripts/screenshot.mjs \
  --graph C:/Users/robemanuele/proj/streamliner/streamliner/.streamliner/workstreams/session-launching-and-tracking/graph.json \
  --out   .screenshots/session-launching.png
```

### Useful flags

| Flag | Purpose |
| --- | --- |
| `--viewport WxH` | Change viewport (default `1600x1000`). Wider for dense graphs. |
| `--full-page` | Capture beyond the viewport (rarely needed for the canvas). |
| `--selector <css>` | Override the "ready" selector (default `.react-flow__node`). |
| `--select-node <id>` | Click a node before capturing (for ancestor/descendant highlights). |
| `--delay-ms N` | Settle delay for xyflow fit-view/animations (default `600`). |

### Output

Screenshots go under `.screenshots/` (gitignored). Name files by the state
you are verifying, e.g. `wave-2-lanes.png`, `gate-selected.png`. Keep
before/after pairs when you are iterating on a visual regression:
`before-gate-banners.png`, `after-gate-banners.png`.

## Writing a change with this skill

1. **Pick a representative graph** for the change. Prefer the
   `.streamliner/workstreams/*/graph.json` files in the repo; the
   `session-launching-and-tracking` graph is the richest.
2. **Capture a baseline screenshot** (pre-change) and save it to
   `.screenshots/before-<slug>.png`.
3. **Make the code change.**
4. **Run tests** (`npm test -- --run`). These cover graph layout and
   canvas view-model logic; they catch size/id regressions early.
5. **Capture the after screenshot** to `.screenshots/after-<slug>.png`.
6. **Inspect the image** (use the `view` tool on the PNG). If the change
   does not match your intended visual, revise and repeat from step 3.
7. **Summarize the visual delta** in the commit message or PR description.
   State what you changed and what you verified in the screenshot.
8. **Discard the `.screenshots/` artifacts** before committing — they are
   gitignored on purpose; the workflow is local-only.

## Inspecting multiple states in one pass

Most visual changes affect more than one state. For each state the change
touches, capture a dedicated screenshot:

- **Unselected canvas** — default pan/zoom, no node focused.
- **Node selected** — use `--select-node <id>` to verify ancestor/
  descendant highlighting and the inspector panel.
- **Sidebar / header** — consider a smaller viewport (e.g., `1200x900`)
  to confirm responsive behavior.
- **Different graph** — if the change is generic, also capture against a
  second workstream's graph to avoid over-fitting the design to one shape.

## When not to use this skill

- Pure text / markdown / config changes that do not affect rendered UI.
- Backend-only changes (Vite plugin, schema parsers) that have no visual
  surface.
- Test-only changes.

In those cases the tests alone are sufficient signal.

## Failure modes and fixes

| Symptom | Fix |
| --- | --- |
| Script exits with "timeout waiting for vite ready" | Port may be stuck; retry or kill lingering `node` processes. |
| Screenshot is a blank white canvas | Expand `--delay-ms` (layout hadn't settled) or widen viewport. |
| Screenshot shows "Failed to load workstream" card | The `--graph` path is wrong or the JSON is invalid. Verify with `node -e "JSON.parse(require('fs').readFileSync(path,'utf8'))"`. |
| `--select-node` hangs | Node id is incorrect, or the node is off-screen at the current viewport — zoom out via a larger viewport. |

## Dependencies

- `@playwright/test` (devDependency)
- Chromium downloaded via `npx playwright install chromium`

Both are provisioned in the repo. If a fresh clone fails the first time
with "browserType.launch: Executable doesn't exist", run
`npx playwright install chromium` once.
