# Stable role identifiers and contracts

## Node

- Workstream: `plugin-role-skills`
- Node ID: `stable-role-identifiers`
- Type: research
- Status: ready

## Outcome

Streamliner has a reviewed, versioned role vocabulary that can be implemented by
the canonical plugin and consumed immediately by Actor Fabric. The contract
defines public role IDs and skill names, shared role layering, explicit
activation, authority boundaries, and the minimum project/workstream/node scope
metadata needed for binding and launch context.

## Inputs

- `.streamliner/workstreams/plugin-role-skills/brief.md`
- `.streamliner/shaping/candidates/streamliner-agent-skill-context.md`
- `.streamliner/roles/project-workstream-designer.md`
- `.streamliner/roles/workstream-creator.md`
- `docs/design/operating-model.md`
- `docs/design/design-layer.md`
- `docs/design/concepts/context-package.md`
- `C:\Users\robemanuele\proj\others\namra\streamliner-skills`
- DBAgent `paw-lite_loop_v7.md` and `paw-review-loop-v3.md`
- Installed `paw-pr-lifecycle` Implementer and Reviewer guides

## Scope

### In scope

- Define the version and compatibility envelope for `role-context-v1`.
- Define public role IDs and skill names for:
  - Project Workstream Designer
  - Workstream Formation
  - Workstream Orchestrator
  - Workstream Node Worker core
  - Workstream Node Implementer
  - Workstream Node Reviewer
- Define the relationship between Node Worker core and the public Implementer
  and Reviewer subroles.
- Define Streamliner Core vocabulary shared by all role skills.
- Define explicit activation: builder prompt, launch prompt, UI action, helper,
  or custom-agent entry point.
- Confirm there is no role inference, role-selection algorithm, or loaded-role
  receipt.
- Define stable authority, outcome-anchor, documentation, field-report, and real
  review obligations at the correct role layer.
- Keep reviewer watch-through-merge in `paw-pr-lifecycle` policy rather than the
  stable Reviewer role.
- Define the role/scope metadata Actor Fabric consumes: role ID, project key,
  optional workstream ID, and optional node ID.
- Define the orientation-only responsibility of the `streamliner` entry skill.
- Record provenance for useful content adapted from Namra's repository.
- Update project design docs or create a decision record if the accepted role
  contract changes project-level intended behavior.

### Out of scope

- Implementing plugin skills.
- Defining `launch-policy-v1` merge and failure semantics.
- Implementing Telex addressing, station binding, or actor lifecycle.
- Implementing worker or orchestrator launch integration.
- Creating GitHub issues.

## Expected output

- An accepted `role-context-v1` contract and public role/skill inventory.
- Stable role identifiers and scope metadata available as an early export to
  Actor Fabric Wave 1.
- A shared-content plan that prevents drift between skills, optional agents,
  launch prompts, and documentation.
- Any required Design or decision-record update.
- Recommended brief or graph refinements if contract decisions change later
  nodes.

## Success criteria

- Every initial role has one public identifier, one canonical skill name, and a
  clear authority boundary.
- Node Worker core, Implementer, and Reviewer compose without duplicating or
  contradicting obligations.
- A launch caller can state the role explicitly without inspecting session
  behavior or skill history.
- Actor Fabric can bind a role and scope without inventing role names.
- Project docs remain authoritative and role skills remain reference-first.
- A cold implementer can distinguish stable role obligations from PAW and
  `paw-pr-lifecycle` mechanics.
- A cold reviewer can distinguish the real-review obligation from optional
  watch-through-merge lifecycle policy.

## Downstream export

Completion makes the `role-identifiers-available` checkpoint consumable by Actor
Fabric Wave 1. It also unblocks the launch-policy contract and plugin packaging
nodes in this workstream.

## Documentation impact

Design impact is expected because this node defines public role and authority
contracts consumed across multiple workstreams.
