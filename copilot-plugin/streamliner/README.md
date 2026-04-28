# Streamliner Copilot CLI plugin

This plugin marks real Copilot CLI sessions as trusted Streamliner sessions.
It uses Copilot CLI hooks for `sessionStart`, `userPromptSubmitted`, and
`sessionEnd`, then emits privacy-preserving lifecycle signals.

## Local marketplace install

Register this checkout as a local Copilot CLI plugin marketplace, then install
the Streamliner plugin from that marketplace:

```powershell
copilot plugin marketplace add C:\Users\robemanuele\proj\streamliner\manual-session-registry
copilot plugin install streamliner@streamliner-local
```

After install, normal `copilot` and Agency-launched Copilot sessions load the
plugin from Copilot CLI's plugin cache. Re-run the install command after editing
the plugin so the CLI refreshes that cache.

## Local development

Load the plugin for a Copilot CLI session with `--plugin-dir`:

```powershell
copilot --plugin-dir C:\Users\robemanuele\proj\streamliner\manual-session-registry\copilot-plugin\streamliner
```

Direct path installs also work with an absolute path, but Copilot CLI warns that
direct installs are deprecated in favor of `plugin@marketplace` installs.

Hooks write events to `%USERPROFILE%\.streamliner\state\session-signals\pending`
when no local HTTP endpoint is configured. The Streamliner session worker drains
that spool and records trusted sessions in the registry.

## Optional environment variables

| Variable | Purpose |
| --- | --- |
| `STREAMLINER_SESSION_SIGNAL_ENDPOINT` | Optional HTTP endpoint, typically `http://127.0.0.1:<port>/api/sessions/signals`. If the POST succeeds, no spool file is written. |
| `STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT` | Overrides the local signal spool root. Defaults to `%USERPROFILE%\.streamliner\state\session-signals`. |

The hook script does not persist prompt text. It only records prompt length,
session id, cwd, lifecycle timestamps, source/reason fields, and whether the
session was launched through Agency.
