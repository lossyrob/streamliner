# Streamliner claimed context

## Layer 0 - Project design context

{
  "workstream": "App-native Streamliner spike",
  "purpose": "Prove exact-revision workstream context can bind to Copilot App-owned local sessions without Streamliner-owned worktrees or terminals.",
  "repositories": [
    {
      "id": "streamliner",
      "owner": "lossyrob",
      "name": "streamliner",
      "role": "primary"
    }
  ],
  "designReferences": [
    {
      "repoId": "streamliner",
      "path": "docs/design/index.md"
    },
    {
      "repoId": "streamliner",
      "path": "docs/design/workstream-format.md"
    },
    {
      "repoId": "streamliner",
      "path": "docs/design/concepts/context-package.md"
    }
  ],
  "boundaries": "- **In scope:** local App worktree sessions, exact-revision artifact reads,\n  persistent launch binding, native parent/child messaging, and a read-only\n  loopback Canvas.\n- **Out of scope:** cloud sessions, terminal launch, Telex, a standalone\n  dashboard, production migration, and writes to App internal stores.\n- **Deferred:** shared remote artifact-ref policy, authorization hardening,\n  garbage collection, and production graph editing."
}

## Layer 1 - Worker mission

{
  "node": {
    "id": "plugin-distribution-validation",
    "type": "task",
    "title": "Validate plugin-installed App launch contract",
    "summary": "Package the proven extension with a plugin-owned agent and skill, add explicit compatibility diagnostics, and make the package reproducible for a fresh App session.",
    "durableStatus": "ready"
  },
  "task": "# Validate plugin-installed App launch contract\n\n## Outcome\n\nTurn the proven project-scoped spike into a minimal, versioned Copilot plugin\npackage that can provide its SDK extension, both Canvases, a launch skill, and a\nworker agent to a fresh App session whose repository does not contain the spike\nextension.\n\n## Implementation requirements\n\n- Add a canonical compatibility manifest for package version, workstream and\n  portfolio artifact schema ranges, runtime-state schema, positions schema, and\n  both Canvas asset versions.\n- Fail with explicit incompatible diagnostics rather than partially loading\n  unsupported schemas.\n- Add a globally unique compatibility inspection tool and expose compatibility\n  through both Canvas declarations where useful.\n- Create a plugin source package named `streamliner-app-native-spike` with\n  documented `agents`, `skills`, and `extensions` components. Do not include the\n  legacy lifecycle hooks in this package.\n- Include a plugin-owned `streamliner-app-native-worker` agent and\n  `streamliner-app-native-launch` skill that require token claim, idempotent\n  App-aware PAW initialization, same-session work, and native App messaging.\n- Add a deterministic build script that copies the canonical extension into a\n  local installable package without hand-maintaining a second implementation.\n- Add automated tests for manifest/package assembly, version/schema checks, and\n  reproducible package output.\n- Document local/private installation and cleanup. Do not publish a gist or\n  remote package.\n\n## PAW lifecycle constraints\n\n- Work only in the current App-created worktree and branch.\n- First claim the Streamliner token, then call\n  `streamliner_spike_initialize_paw` with the returned launch ID.\n- Consume `.paw/work/plugin-distribution-validation/context.md` as the claimed\n  Layer 0-3 source of truth.\n- Do not create another worktree, launch a terminal, push, create a PR, or call\n  `streamliner_spike_complete_launch`.\n- Run focused package/extension tests, lint, and build.\n- Commit the implementation and PAW artifacts with the required Copilot trailer,\n  then report the exact commit, SDK session ID, compatibility versions, checks,\n  and residual uncertainty through native `send_session_message`.\n\n## Success criteria\n\n- The package builds twice with identical hashes.\n- Existing project extension behavior remains green.\n- A later independent reviewer can evaluate the change against this task and\n  claimed context.\n- Completion remains pending until the orchestrator has integrated the accepted\n  change, created a draft PR, and returned that evidence to this session."
}

## Layer 2 - Relevant state

{
  "workstreamStatus": "active",
  "currentState": "The architecture research node is complete. The original App-created worker\nproof is preserved. Plugin distribution validation is now ready and gates the\nremaining fresh-repository installation evidence.",
  "upstream": [
    {
      "id": "architecture-research",
      "title": "Map the App-native boundary",
      "status": "completed"
    }
  ]
}

## Layer 3 - Coordination context

{
  "downstream": [
    {
      "id": "plugin-distribution-gate",
      "type": "gate",
      "title": "Plugin distribution accepted",
      "status": "planned"
    }
  ],
  "launchProvenance": {
    "launchId": "launch-2171b54e-8925-409e-ab57-9647b9ab864f",
    "preparedAt": "2026-08-24T19:08:32.476Z",
    "preparedBySessionId": "999de4ab-a9b0-40af-a80f-1d4c67217af8",
    "requestedRevision": "238ebc9fc48c6e628986e6a934dbb1df7a99d9ff",
    "artifactRevision": "238ebc9fc48c6e628986e6a934dbb1df7a99d9ff",
    "provider": "git-exact-revision-v1",
    "sessionOwner": "copilot-app"
  },
  "completionProtocol": [
    "Work only in the App-created child worktree.",
    "Do not create another worktree, terminal, or Streamliner session.",
    "Record completion with streamliner_spike_complete_launch.",
    "Report to the creator with the native send_session_message tool."
  ]
}
