# Streamliner App-native spike plugin

This source package contributes three Copilot components without the legacy
Streamliner lifecycle hooks:

| Component | Source | Installed path |
|---|---|---|
| Agent | `agents/streamliner-app-native-worker.agent.md` | `agents/` |
| Skill | `skills/streamliner-app-native-launch/SKILL.md` | `skills/` |
| SDK extension and both Canvases | `.github/extensions/streamliner-spike/` | `extensions/streamliner-spike/` |

The extension remains canonical under `.github/extensions/streamliner-spike/`.
The package builder copies it into the installable output, so the plugin does
not maintain a second extension implementation. The plugin manifest registers
the provider parent `extensions/`, allowing Copilot CLI and the App to discover
its `streamliner-spike/extension.mjs` child provider.

## Build

From the repository root:

```powershell
npm run build:streamliner-app-native-plugin
```

The deterministic package is written to
`dist\streamliner-app-native-spike`. Its `package-manifest.json` records sorted
file hashes and a package digest without timestamps or machine-specific paths.
Two builds from the same checkout produce the same digest.

The optional `--out` argument accepts a new directory outside the repository or
a directory already marked by this builder's `package-manifest.json`. Inside
the repository, use the dedicated default. The builder rejects unowned paths
before recursive cleanup.

## Local private install

Build first, then install the generated directory into the current user's
private Copilot plugin cache:

```powershell
copilot plugin install ./dist/streamliner-app-native-spike
```

Copilot CLI `1.0.81-8` accepts that slash-relative form. To avoid relative-path
parsing differences entirely, resolve and pass an absolute Windows path:

```powershell
$pluginPath = (Resolve-Path ./dist/streamliner-app-native-spike).Path
copilot plugin install $pluginPath
```

For an isolated SDK or CLI smoke test that should not persist an installation:

```powershell
copilot --plugin-dir ./dist/streamliner-app-native-spike
```

After a persistent install, start a fresh Copilot App session in any repository.
The package supplies the extension independently of project-scoped
`.github\extensions`.

This spike package is intended for local/private evaluation only. Do not upload
it to a gist, marketplace, or remote package registry.

## Worker agent

Plugin agents are namespace-qualified. When creating the App worker session,
select:

```text
streamliner-app-native-spike:streamliner-app-native-worker
```

The unqualified `streamliner-app-native-worker` name does not resolve from an
installed plugin.

## Inspect compatibility

Call `streamliner_app_native_spike_inspect_compatibility` with no arguments to
read the installed contract. Optional version probes return structured
incompatibility diagnostics. Both Canvases expose the same contract through
their `get_compatibility` action.

The canonical `compatibility.json` currently declares:

| Contract | Supported value |
|---|---|
| Package | `streamliner-app-native-spike@0.1.0` |
| Workstream artifact schema | `1..1` |
| Portfolio artifact schema | `1..1` |
| Runtime-state schema | `1` |
| Portfolio positions schema | `1` |
| Workstream Canvas assets | `react-flow-v1` |
| Portfolio Canvas assets | `portfolio-v1` |

## Cleanup

Remove the cached plugin and local generated package:

```powershell
copilot plugin uninstall streamliner-app-native-spike
Remove-Item -Recurse -Force ./dist/streamliner-app-native-spike
```

Cleanup does not remove local spike runtime or position state. If that evidence
must be discarded, first confirm no extension process owns the corresponding
lock file, then remove only the package-specific directory under
`%USERPROFILE%\.copilot\extensions\streamliner-spike\artifacts`.
