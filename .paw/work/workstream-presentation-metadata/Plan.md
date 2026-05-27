# Plan

## Approach Summary

Add committed workstream presentation metadata as `presentation.shortName` and `presentation.color`. Treat `presentation.color` as the workstream-level visual identity used by dense list surfaces and as the default terminal tab/session color for new launches. Keep `launchDefaults.terminal.tabColor` as a deprecated legacy input: parse it as a compatibility fallback and migrate it into `presentation.color` on configuration save while removing the old persisted field when possible.

## Work Items

- [ ] **Schema and migration**: Add presentation metadata types and parsing to the workstream schema/view model, expose it through workstream summaries/registry entries, and preserve legacy `launchDefaults.terminal.tabColor` by interpreting it as `presentation.color` when the new field is absent.
- [ ] **Configuration UI and API**: Extend the workstream configuration patch payload and dialog so users can edit short name and color; move the color control out of terminal defaults while leaving terminal host/title defaults under `launchDefaults.terminal`.
- [ ] **Launch default resolution**: Resolve launch terminal colors from explicit per-launch input first, then `presentation.color`, then legacy `launchDefaults.terminal.tabColor`; update server-side launch preparation and client defaults consistently. Add a `{workstreamShortName}` terminal title-template variable.
- [ ] **Workstream list visuals**: Show a compact short-name label and color swatch on tracked workstream cards, falling back to the full title/id when no short name or color is configured.
- [ ] **Tests, docs, and screenshots**: Update schema/configuration/launch/template tests, document the new graph fields and deprecated compatibility behavior, and capture representative screenshots for the list and launch dialog/default color behavior.

## Key Decisions

- Use `presentation` rather than `display` because the metadata describes durable workstream identity across UI and terminal launch presentation, not only one display surface.
- Keep the initial short-name surface focused on dense workstream cards and terminal title templates; graph headers, session grouping labels, and portfolio prototype color state remain out of scope for this issue.
- Explicit launch-dialog color edits remain authoritative for that launch. The workstream color only supplies the default.
- Save-time migration removes `launchDefaults.terminal.tabColor` when the configuration endpoint rewrites the graph, but parsers and launch resolution continue to accept it for legacy graphs that have not been saved yet.

## Open Questions

None.
