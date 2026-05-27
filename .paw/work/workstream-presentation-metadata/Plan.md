# Plan

## Approach Summary

Add committed workstream presentation metadata as `presentation.shortName` and `presentation.color`. Treat `presentation.color` as the workstream-level visual identity used by dense list surfaces and as the default terminal tab/session color for new launches. Keep `launchDefaults.terminal.tabColor` as a deprecated legacy input: parse it as a compatibility fallback and migrate it into `presentation.color` on configuration save while removing the old persisted field when possible.

## Work Items

- [x] **Schema and migration**: Add presentation metadata types and parsing to the workstream schema/view model, expose it through `WorkstreamGraphSummary` / `WorkstreamRegistryEntry` / `WorkstreamRegistryListEntry`, and update `workstream-identity`, path registry, and source registry summaries in lockstep. Preserve legacy `launchDefaults.terminal.tabColor` by interpreting it as `presentation.color` when the new field is absent.
- [x] **Configuration UI and API**: Extend the workstream configuration patch payload and dialog so users can edit short name and color; move the color control out of terminal defaults while leaving terminal host/title defaults under `launchDefaults.terminal`.
- [x] **Launch default resolution**: Resolve launch terminal colors from explicit per-launch input first, then `presentation.color`, then legacy `launchDefaults.terminal.tabColor`; update client defaults, server-side launch preparation, and the `node-launch.ts` handoff reservation/terminal path consistently. Add a `{workstreamShortName}` terminal title-template variable.
- [x] **Workstream list visuals**: Show a compact short-name label and color swatch on tracked workstream cards, falling back to the full title/id when no short name or color is configured.
- [x] **Tests, docs, and screenshots**: Update schema/configuration/launch/template tests, including legacy-only parse fallback, legacy + new coexistence precedence, save-time rewrite that removes `launchDefaults.terminal.tabColor` while writing `presentation.color`, and launch color resolution. Document the new graph fields and deprecated compatibility behavior, and capture representative screenshots for the list and launch dialog/default color behavior.

## Key Decisions

- Use `presentation` rather than `display` because the metadata describes durable workstream identity across UI and terminal launch presentation, not only one display surface.
- Keep the initial short-name surface focused on dense workstream cards and terminal title templates; graph headers, session grouping labels, and portfolio prototype color state remain out of scope for this issue.
- Explicit launch-dialog color edits remain authoritative for that launch. The workstream color only supplies the default.
- Save-time migration removes `launchDefaults.terminal.tabColor` when the configuration endpoint rewrites the graph, but parsers and launch resolution continue to accept it for legacy graphs that have not been saved yet.
- New launches inherit `presentation.color` into the handoff terminal color, which drives the reserved session row and terminal tab color. Existing session rows are not retroactively recolored in this issue.
- `{workstreamShortName}` falls back to the full workstream title when `presentation.shortName` is unset. `shortName` is normalized as a trimmed non-empty string with no schema-level maximum in this issue; compact surfaces truncate with CSS rather than rejecting otherwise valid graph files.

## Open Questions

None.
