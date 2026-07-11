# Repository role skills slice

## Node

- Workstream: `plugin-role-skills`
- Node ID: `repository-role-skills-slice`
- Type: task
- Status: planned

## Outcome

The canonical Streamliner Copilot plugin packages the approved role skills and
can be installed from the GitHub repository marketplace by another builder. The
slice exports `role-context-v1`, preserves current session lifecycle hooks, and
does not require private prompt files or manual copying into a personal skills
directory.

## Inputs

- `.streamliner/workstreams/plugin-role-skills/brief.md`
- Accepted output of `stable-role-identifiers`
- Accepted output of `launch-policy-contract-foundation`
- `copilot-plugin/streamliner/**`
- `.github/plugin/marketplace.json`
- `DEVELOPING.md`
- Telex plugin manifest, marketplace, and bootstrap skill pattern
- `C:\Users\robemanuele\proj\small\skills`
- `C:\Users\robemanuele\proj\others\namra\streamliner-skills`

## Scope

### In scope

- Add plugin-distributed skills for:
  - Streamliner orientation
  - Project Workstream Designer
  - Workstream Formation
  - Workstream Orchestrator
  - Workstream Node Worker core
  - Workstream Node Implementer
  - Workstream Node Reviewer
- Reuse shared role content or references so skills do not drift.
- Keep role guidance concise, composable, and reference-first.
- Preserve the existing plugin lifecycle hooks and trusted-signal behavior.
- Add role/lifecycle contract metadata needed for compatibility checks.
- Update plugin manifest and repository marketplace metadata so skills are
  included in the installed plugin.
- Prove installation from the GitHub repository marketplace in a separate
  Copilot configuration.
- Preserve the current `streamliner@streamliner-local` development path until
  the later marketplace identity migration node introduces canonical
  `streamliner@streamliner` with compatibility.
- Add focused tests or validation for manifest shape, installed skill discovery,
  role identifiers, and contract metadata.
- Update installation and development guidance for the role-skills slice.
- Credit adapted Namra content where appropriate.

### Out of scope

- Completing canonical marketplace identity migration.
- Worker or orchestrator launch integration.
- Implementing `launch-policy-v1` parsing or resolution beyond any minimal
  contract metadata needed by the skills.
- Implementing PAW or `paw-pr-lifecycle` mechanics.
- Adding long-form DBAgent launch prompts to the plugin.
- Creating GitHub issues.

## Expected output

- Repository-installable plugin skills for every approved v1 role.
- `role-context-v1` contract metadata shipped with the plugin.
- Preserved lifecycle-hook behavior.
- Installation and compatibility documentation for the first slice.
- Focused validation proving another Copilot configuration discovers and can
  invoke the skills.

## Success criteria

- The plugin installs from the GitHub repository marketplace without manual
  skill copying.
- Every public role skill resolves under its approved identifier and name.
- The orientation skill lists roles but does not infer or select one.
- Role skills point to authoritative project/workstream context rather than
  copying document bodies.
- Node Implementer and Node Reviewer share Node Worker core without losing their
  distinct authority and durable obligations.
- Existing session lifecycle hooks still load and behave as before.
- The plugin exposes enough contract/version metadata for later launch and
  compatibility nodes.
- No local prompt profile or private builder wording is required for the role
  skills to be useful.

## Documentation impact

User Guide and Architecture updates may be needed for installation, plugin
layout, and role-skill discovery. Design should change only if implementation
reveals that the accepted contracts need revision.
