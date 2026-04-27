# Terminal Tab Color Spike Plan

## Approach Summary

Issue #15 is a focused spike, not a feature implementation. The work will produce an evidence-backed Wave 2 answer for whether Streamliner should reflect a registry entry's `color` into Windows Terminal tabs during local Windows launch/relaunch.

The evidence gate must run before the final conclusion is written. Current documentation and local probe evidence point to a constrained-feasible contract: Windows Terminal supports `wt new-tab --tabColor <#RGB|#RRGGBB>` and `--title` for newly created tabs, and `--window` can target an existing terminal window for new commands, but the supported CLI does not provide a reliable way to recolor an already-open tab. The downstream `session-relaunch` contract should therefore treat terminal color as an optional launch-time projection of the registry color, not as identity, not as required for relaunch, and not as something Streamliner can retrofit onto existing tabs.

Implementation should be documentation-first:

1. Validate the bridge with a concrete evidence matrix before editing the durable design contract. The matrix must include: probe, source/citation, observed behavior, confidence, and contract implication. Required probes are official Windows Terminal CLI docs; local `wt.exe` availability and version; minimum version support for `--tabColor`; accepted `--tabColor` formats (`#RGB`, `#RRGGBB`, rejected named colors or alpha forms); `--title` with whitespace/special characters; explicit `wt.exe new-tab` versus relying on the Windows default terminal; unavailable/invalid-color behavior; `--window` behavior for valid and invalid targets; and the lack of a supported existing-tab recolor command.
2. Add Decision 006 to capture the durable invariant: terminal color is optional launch-time presentation, never registry identity, and never an automatic recolor of an existing tab.
3. Update `docs/design/session-system.md` with a Windows Terminal color bridge contract under Terminal Integration.
4. Keep Decision 004/005 intact: registry color remains the source of truth; no registry schema, identity, or environment-model change is needed.
5. Define registry-to-terminal normalization: the terminal bridge receives hex only; palette tokens must be resolved before crossing the bridge; unknown tokens, absent colors, and invalid hex values are treated as "no color".
6. Explicitly analyze launch-contract impact. The expected result is additive presentation fields for future launch/relaunch specs (`terminalTitle`, normalized `tabColor`, terminal-host strategy), not a registry or environment-model change.
7. Record explicit fallback semantics so `session-relaunch` can proceed when Windows Terminal is unavailable, the color value is absent/invalid, the terminal rejects the argument, the terminal host is not local Windows Terminal, or the tab already exists.
8. Define the command-composition boundary. The bridge contract must document Windows Terminal's command separator/escaping hazards (`;`, quoting, whitespace) and state that launch/relaunch code must use argument-vector construction or equivalent escaping before invoking `wt.exe`; this spike does not implement command launching.
9. Preserve PR #14 context as provisional: it currently adds the registry UI/code and still includes `color` as registry metadata, but this spike should not depend on unmerged implementation details.

## Work Items

- [x] Validate local Windows Terminal bridge evidence and constraints in an evidence matrix: official CLI docs, local `wt.exe` presence and version, active `WT_SESSION`/`WT_PROFILE_ID` environment when available, `new-tab --tabColor` accepted formats, unsupported color formats, `--title`, explicit `wt.exe` invocation, command separator and quoting/escaping behavior, failure/fallback triggers, no supported existing-tab recolor, and whether any `--window` strategy is reliable enough for Wave 2.
- [x] Reconcile provisional registry context from PR #14: current state, whether it still carries registry `color`, and whether the shape remains compatible with `session-system.md`'s "palette token or hex" contract. If PR #14 keeps that shape, no plan change is needed; if it drops `color`, keep the bridge contract forward-looking and flag that relaunch cannot consume it until color returns; if it changes the shape, revise the normalization clause before final PR.
- [x] Add Decision 006 for optional terminal color projection and update design index/sidebar coordination points.
- [x] Update the session system design with the Windows Terminal color bridge contract, registry color normalization, launch/relaunch handoff fields, tab-title source, command escaping/caller boundary, idempotency/windowing/profile stance, environment preconditions, observability, and fallback behavior.
- [x] Verify design-doc consistency and project checks: frontmatter intact, index/sidebar updated for the new decision, cross-links resolve, `npm run docs:build`, and other existing project checks touched by the change.
- [x] Prepare the final PR inputs with an issue-#15 title and an evidence-backed spike conclusion.

## Evidence Matrix Shape

| Probe | Source/Citation | Observed Behavior | Confidence | Contract Implication |
|---|---|---|---|---|
| `wt.exe` availability and version |  |  |  |  |
| Minimum version for `new-tab --tabColor` |  |  |  |  |
| `--tabColor #RGB` |  |  |  |  |
| `--tabColor #RRGGBB` |  |  |  |  |
| Unsupported color formats: named colors, `#RRGGBBAA`, invalid hex |  |  |  |  |
| `--title` with whitespace and punctuation |  |  |  |  |
| Explicit `wt.exe new-tab` versus default-terminal routing |  |  |  |  |
| Command separator and escaping rules for `;`, quotes, whitespace, and cwd/command arguments |  |  |  |  |
| `--window` valid target, invalid target, and default behavior |  |  |  |  |
| Existing-tab recolor via CLI, OSC escape, or settings reload |  |  |  |  |
| Missing, too-old, or rejecting Windows Terminal |  |  |  |  |
| Non-Windows-Terminal host, WSL, devbox, remote context |  |  |  |  |

## Key Decisions

- Work shaping is skipped because issue #15 already defines outcome, inputs, boundaries, inherited decisions, design-impact expectations, and success criteria.
- Windows Terminal (`wt.exe`) is the only terminal bridge in scope. Other local Windows terminal hosts, WSL, devbox, remote contexts, and VS Code integrated terminal color behavior use the no-color fallback path.
- The bridge is feasible only for terminal creation or relaunch that opens a new Windows Terminal tab/pane. It is not feasible as a supported automatic recolor of an existing tab.
- The bridge is fire-and-forget for Wave 2. It does not enumerate existing tabs, recolor existing tabs, target a remembered tab, or guarantee idempotency; repeated relaunches may create duplicate tabs until a future terminal-handle model exists.
- `session-relaunch` should consume the registry row's `color` as launch-time presentation metadata after normalization. The terminal boundary accepts only resolved `#RGB` or `#RRGGBB` values. Unknown palette tokens, invalid hex, and absent colors degrade to an uncolored terminal at the recorded `cwd`.
- `session-relaunch` should explicitly invoke `wt.exe new-tab` when applying Windows Terminal color rather than relying on Windows default-terminal routing. If `wt.exe` is unavailable, launch directly without color.
- `--window` is not required for Wave 2. If evidence is inconclusive or target behavior is brittle, the contract defaults to no `--window` policy rather than storing window identifiers.
- Profile selection is out of scope. The bridge should not pass `-p`; Windows Terminal uses the user's default profile.
- Tab title should come from the registry `title` when non-empty; otherwise relaunch may use its existing default title behavior.
- Launch/relaunch code owns safe command construction. The design contract should warn against shell-string composition around `wt.exe` because of `;` command separators and quoting boundaries; the implementation should use argument arrays or equivalent escaping.
- Observability is part of the contract: launch/relaunch should record locally whether color was requested, normalized, applied, or skipped, including the fallback reason. Absence of terminal color is not a user-facing error.
- No registry schema/identity changes are planned. Any launch-contract changes are additive presentation metadata. If a future implementation needs profile-specific color mapping, terminal window IDs, or cross-platform adapters, that should be follow-up work rather than silently expanding this spike.
- The durable project artifacts should be Decision 006 plus `docs/design/session-system.md`.

## Open Questions

- Does local evidence reveal any Windows Terminal behavior that contradicts the current constrained-feasible conclusion?
- Does PR #14 land or change the registry `color` shape before this PR merges? If yes, re-check the bridge normalization contract before final PR.
- Does `--tabColor` accept anything beyond `#RGB` and `#RRGGBB`, or should all other values be normalized away before the bridge?
- What is the observed behavior when `--window` targets a non-existent window, and does that reinforce the default no-`--window` stance?
- Does an old or unsupported Windows Terminal fail loudly or silently ignore `--tabColor`?
- Is there any supported existing-tab recolor mechanism via CLI, OSC escape, or settings reload, or is launch-time-only the durable answer?

## Done When

- The evidence matrix is populated in the spike output with citations or local observations for each required probe.
- Decision 006 records the invariant that terminal color is optional launch-time presentation, never registry identity, and never an automatic existing-tab recolor.
- `docs/design/session-system.md` includes the Windows Terminal bridge contract, normalized color boundary, fallback triggers, tab-title source, profile/window/idempotency stance, command-construction boundary, environment preconditions, and observability expectations.
- Design index/sidebar/frontmatter coordination is current for any new decision record.
- The final PR title includes issue #15 and the PR description states the evidence-backed conclusion for downstream `session-relaunch`.
