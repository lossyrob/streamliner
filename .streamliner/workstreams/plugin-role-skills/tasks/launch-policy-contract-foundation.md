# Launch policy contract foundation

## Node

- Workstream: `plugin-role-skills`
- Node ID: `launch-policy-contract-foundation`
- Type: research
- Status: planned

## Outcome

Streamliner has an accepted `launch-policy-v1` contract that separates stable
plugin role semantics, non-overridable shared policy, shared defaults,
builder-local profiles, and per-launch edits. The contract is typed,
deterministically merged, versioned, provenance-aware, and explicit about
validation and failure behavior.

## Inputs

- `.streamliner/workstreams/plugin-role-skills/brief.md`
- Output of `stable-role-identifiers`
- `docs/design/workstream-format.md`
- `docs/design/session-system.md`
- Current graph `launchPolicy` and `launchDefaults` behavior
- Current local PAW prompt-profile behavior
- DBAgent `paw-lite_loop_v7.md` and `paw-review-loop-v3.md`
- Installed `paw-pr-lifecycle` skill
- Shared Project Operations ownership split with Artifact Sync

## Scope

### In scope

- Define the typed schema and versioning rules for `launch-policy-v1`.
- Classify fields as:
  - non-overridable policy;
  - portable shared defaults;
  - builder-local settings;
  - per-launch editable values.
- Define the precedence:
  `plugin contract -> shared project policy -> shared workstream/node defaults
  -> builder-local override -> per-launch edit`.
- Define deterministic merge, conflict, inheritance, and provenance behavior.
- Define references and compatibility ranges for plugin role contracts and
  external lifecycle contracts.
- Define validation diagnostics for missing, malformed, stale, untrusted, or
  incompatible inputs.
- Require automated launches to block when required role or policy inputs are
  missing or invalid.
- Allow interactive launches to continue only through an explicit, prominently
  warned builder override when the contract permits it.
- Preserve non-overridable policy even when local or per-launch values are
  present.
- Define what Artifact Sync stores and resolves, including provenance, without
  transferring policy semantics to that workstream.
- Define a migration path from current graph `launchPolicy`,
  `launchDefaults`, and local prompt profiles.
- Produce a validation and compatibility test matrix for implementation nodes.
- Update project design docs or create a decision record for the accepted
  contract.

### Out of scope

- Implementing the schema parser or launch resolver.
- Moving local long-form prompt profiles into shared artifacts.
- Implementing artifact-root storage or synchronization.
- Changing PAW workflow or `paw-pr-lifecycle` mechanics.
- Creating GitHub issues.

## Expected output

- The accepted `launch-policy-v1` schema and merge contract.
- A field classification and provenance model.
- Compatibility/version and failure/remediation rules.
- An implementation test matrix covering automated and interactive launch
  behavior.
- The exact storage/resolution contract exported to Artifact Sync.
- Any required Design or decision-record update.

## Success criteria

- The same shared inputs resolve to the same effective non-local policy for two
  builders.
- Builder-local models, wording, terminal preferences, accounts, and
  experiments remain local.
- Local and per-launch edits cannot silently weaken non-overridable policy.
- Automated launch failure is deterministic and typed.
- Interactive override is explicit, warned, auditable in runtime evidence, and
  unavailable where policy forbids it.
- Artifact Sync can store and resolve policy plus provenance without defining
  precedence or validation behavior.
- Contract compatibility attaches to named role/lifecycle behavior rather than
  script paths or polling internals.

## Documentation impact

Design impact is expected because this node defines the shared launch-policy
contract and cross-workstream ownership boundary.
