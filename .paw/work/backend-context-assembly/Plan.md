# Plan

## Approach Summary

Implement backend context assembly as a deterministic server feature that prepares a file-based launch context package for a selected workstream graph node. The package will be written to local Streamliner runtime state, include a manifest plus Layer 0-3 markdown files, and be exposed by a backend route that downstream launch profile/prompt and terminal launch work can consume without PAW.

## Work Items

- [x] Define the launch context package contract and deterministic assembler under `src/server`.
  - Create a versioned `manifest.json` schema that includes `contextId`, nullable `launchNonce`, `projectKey`, `workstreamId`, `nodeId`, `targetRepoIds`, `generatedAt`, `generatorVersion`, `contextPackagePath`, per-layer file paths, source references, source freshness, `layer0Selection`, and `unavailableInputs`.
  - Generate Layer 0-3 markdown files with a generated-file header naming the context id, node id, launch nonce or preview marker, brief SHA/hash, generation time, and "do not edit" marker.
  - Resolve source freshness using Git object hashes when files are tracked and content SHA-256 hashes when a file is untracked or git metadata is unavailable, recording degraded freshness in `unavailableInputs`.
  - Use a fresh context id per preparation call, write into a temporary package directory, and finalize with rename so downstream consumers never read a half-written package.
- [x] Add an API route that prepares a launch context package from graph path/default graph plus node id.
  - Add `POST /api/launch-contexts` with request `{ graphPath?: string, nodeId: string, outputDir?: string, launchNonce?: string | null }`.
  - Return `{ contextId, contextPackagePath, manifestPath, manifest, unavailableInputs }`.
  - Return explicit 400/404 client errors for missing node id, missing graph configuration, missing graph file, invalid graph, unknown node id, or invalid output dir; reserve 500 for unexpected filesystem/git failures.
  - Keep `outputDir` optional so future PAW launch profiles can direct files into `.paw/work/<work-id>/context/` after profile-specific setup, while non-PAW/default launches use runtime state.
- [x] Cover package generation, unavailable inputs, and route behavior with Vitest tests.
  - Happy path: dogfood-style graph + brief + design refs produce a manifest, source references, layer files, deterministic Layer 0 selection, and sibling/upstream node context.
  - Degraded path: missing design/tracker/local spec content records `unavailableInputs` while producing a usable package.
  - API path: missing node id, missing graph configuration, unknown node id, and invalid output dir return stable client errors.
  - Regeneration path: repeated calls produce distinct context ids and do not overwrite prior finalized packages.
- [x] Update `docs/design/session-system.md` to document the concrete package manifest/API contract.
  - Clarify that #31 uses runtime-state `launch-contexts/{contextId}` before launch claims exist; #32 may later associate a context id with a launch nonce instead of requiring this issue to write `launches/{launchNonce}`.
  - Document the manifest table, generated layer file headers, optional output directory, and `POST /api/launch-contexts` response shape.
  - Note Decision 002's archive retention and brief drift questions remain deferred.

## Key Decisions

- Store generated packages under local runtime state by default:

  ```text
  ~/.streamliner/state/{projectKey}/{workstreamId}/launch-contexts/{contextId}/
    manifest.json
    context/
      layer-0-design.md
      layer-1-intent.md
      layer-2-state.md
      layer-3-node.md
  ```

  This deliberately differs from Decision 002's later `launches/{launchNonce}/context/` archive shape because backend context preview can run before launch-claim binding has created a nonce. The manifest keeps nullable `launchNonce` and `launchClaimRef` slots so #32 can associate or copy the package into a nonce-scoped launch archive later without changing the package contract.
- `contextId` is a per-call generated id (`ctx-<timestamp>-<short-random>`). This is stable once returned, but repeated calls produce fresh packages. This issue does not implement retention cleanup; it explicitly defers archive retention to Decision 002's open question.
- Layer 0 selection is deterministic for this slice: include `docs/design/index.md`, all workstream `designRefs`, and paths listed in the brief's `## Design References` section after stripping `streamliner:` prefixes. Include whole files when available, and record each included path with a rationale in `layer0Selection`.
- Layer 3 uses deterministic neighbor summaries: selected node details plus upstream dependency nodes, same-checkpoint sibling nodes, and downstream dependent nodes using `{ id, title, status, summary, trackerRef }` from `graph.json`. Tracker body/spec content is fetched only for the selected node to bound work.
- Make tracker resolution injectable so tests avoid network access. Production should use a best-effort resolver that records GitHub/local tracker references and degrades to `unavailableInputs` on auth, network, missing-file, or unsupported-tracker failures rather than blocking context package generation.
- Return metadata and paths from the API; keep the full context in generated files for downstream prompt/profile code.
- Treat missing optional context inputs as package metadata (`unavailableInputs`) while treating missing graph/node request inputs as errors.
- Support single-checkout dogfood scope first. Multi-repo nodes are represented in `targetRepoIds` and source references, but the implementation assumes the graph/brief/design files are in the API checkout/workstream directory. Cross-repo design repositories are deferred.

## Open Questions

- Decision 002 archive retention policy remains deferred; #31 writes fresh packages and does not prune finalized packages.
- Decision 002 brief drift warnings remain deferred; #31 records source freshness at generation time only.
- Coordination notes beyond graph/tracker/design/brief inputs are not implemented in this slice because no durable coordination-note source exists yet.
