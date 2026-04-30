# Work Shaping

## Problem Statement

Streamliner needs a backend surface that can prepare launch context for a selected workstream graph node before prompt/profile composition and terminal launch exist. The value is to give downstream launch code a stable package reference containing project design context, workstream intent/state, and node/tracker context without assuming a PAW work directory.

## Work Breakdown

Core functionality:

- Load a workstream graph from an explicit path or the API's configured default graph path.
- Resolve the selected node, target repo metadata, checkpoint/wave placement, upstream nodes, downstream nodes, and sibling nodes.
- Read the workstream brief and referenced design docs from the repository checkout.
- Resolve node tracker context from GitHub issue metadata when possible and record unavailable tracker content when it is not available.
- Write a generated file-based package under Streamliner's local runtime state with `manifest.json` and Layer 0-3 markdown files.
- Expose the package through a backend API endpoint for downstream prompt/profile and terminal-launch work.

Supporting functionality:

- Preserve source references for every generated layer so workers can navigate back to canonical files/issues.
- Keep generated context out of Git and out of `graph.json`.
- Add tests around package generation, unavailable inputs, and API routing.
- Update the session-system design doc if the exported package contract becomes more concrete than the existing design.

## Edge Cases

- Missing graph path: return a clear client error instead of guessing.
- Unknown node id: return a clear client error.
- Missing brief or design file: still generate the package and record the input under `unavailableInputs`.
- Missing or unreachable GitHub tracker: include the tracker URL/source reference and record unavailable tracker details.
- Local tracker path outside or missing from the workstream: include a source reference when available and record unavailable content when not.
- Node without a checkpoint: generate Layer 3 with an explicit "not listed in a checkpoint" note.

## Rough Architecture

The API should register a new launch-context route under `/api`. The route delegates to a server module that owns path resolution, package assembly, generated-file writes, and manifest shape. The assembler should reuse `parseWorkstreamDocument` from the existing workstream parser, derive the workstream directory from `graph.json`, and write files below a runtime root such as:

```text
~/.streamliner/state/{projectKey}/{workstreamId}/launch-contexts/{contextId}/
  manifest.json
  context/
    layer-0-design.md
    layer-1-intent.md
    layer-2-state.md
    layer-3-node.md
```

The API response should include a stable context id/path plus package metadata, not inline all generated context. Downstream launch profiles can point the worker at this path.

## Critical Analysis

The smallest useful slice is a deterministic backend assembler with graceful degradation. It should not wait for launch profiles, launch claims, or PAW setup. A direct backend implementation is preferable to an SDK/LLM-based helper for this issue because the known inputs are structured files, and deterministic output is easier to test and depend on in later Wave 3 tasks.

## Codebase Fit

Existing server routes live under `src/server/routes`, with app registration in `src/server/app.ts`. Existing graph loading uses `src/server/local-files.ts`, and workstream validation is already available via `parseWorkstreamDocument` in `src/workstream-view-model.ts`. Runtime state currently appears under `~/.streamliner/state/` for registry/log/plugin data, so launch context packages should follow that local-state convention.

## Risks and Gotchas

- Do not write launch/session/runtime data into `.streamliner/workstreams/.../graph.json`.
- Do not require PAW artifacts; this package must work for non-PAW launch profiles.
- Avoid a network dependency in tests by making tracker resolution injectable.
- Keep API errors explicit; generated packages can record unavailable optional inputs, but invalid required request state should be a client error.

## Open Questions for Downstream Stages

None.

