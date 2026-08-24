# Validate plugin-installed App launch contract

## Outcome

Turn the proven project-scoped spike into a minimal, versioned Copilot plugin
package that can provide its SDK extension, both Canvases, a launch skill, and a
worker agent to a fresh App session whose repository does not contain the spike
extension.

## Implementation requirements

- Add a canonical compatibility manifest for package version, workstream and
  portfolio artifact schema ranges, runtime-state schema, positions schema, and
  both Canvas asset versions.
- Fail with explicit incompatible diagnostics rather than partially loading
  unsupported schemas.
- Add a globally unique compatibility inspection tool and expose compatibility
  through both Canvas declarations where useful.
- Create a plugin source package named `streamliner-app-native-spike` with
  documented `agents`, `skills`, and `extensions` components. Do not include the
  legacy lifecycle hooks in this package.
- Include a plugin-owned `streamliner-app-native-worker` agent and
  `streamliner-app-native-launch` skill that require token claim, idempotent
  App-aware PAW initialization, same-session work, and native App messaging.
- Add a deterministic build script that copies the canonical extension into a
  local installable package without hand-maintaining a second implementation.
- Add automated tests for manifest/package assembly, version/schema checks, and
  reproducible package output.
- Document local/private installation and cleanup. Do not publish a gist or
  remote package.

## PAW lifecycle constraints

- Work only in the current App-created worktree and branch.
- First claim the Streamliner token, then call
  `streamliner_spike_initialize_paw` with the returned launch ID.
- Consume `.paw/work/plugin-distribution-validation/context.md` as the claimed
  Layer 0-3 source of truth.
- Do not create another worktree, launch a terminal, push, create a PR, or call
  `streamliner_spike_complete_launch`.
- Run focused package/extension tests, lint, and build.
- Commit the implementation and PAW artifacts with the required Copilot trailer,
  then report the exact commit, SDK session ID, compatibility versions, checks,
  and residual uncertainty through native `send_session_message`.

## Success criteria

- The package builds twice with identical hashes.
- Existing project extension behavior remains green.
- A later independent reviewer can evaluate the change against this task and
  claimed context.
- Completion remains pending until the orchestrator has integrated the accepted
  change, created a draft PR, and returned that evidence to this session.
