# PAW Launch Configuration and Prompt Defaults Implementation Plan

## Overview

Implement the PAW graph launch preparation slice for issue #33. The work adds a backend launch-preparation contract that stages the generated Streamliner context, runs PAW initialization through a prep runner using the real `paw-init` skill prompt, has PAW init install the staged context into the PAW work area, builds a kickoff prompt with identity/nonce sections, and returns a structured handoff for later terminal launch. The graph UI exposes a text-guided PAW init dialog from the selected node inspector before invoking preparation.

### Hot Rescope: Text-Guided PAW Init

After previewing PR #41, the dialog briefly expanded into a front end for the PAW `WorkflowContext.md` header fields. That richer form was then deferred to follow-up issue #43 because it should use PAW-owned metadata for structured presets, specialists, constraints, and derived fields. The implemented PR scope returns to a natural-language PAW workflow instructions textarea with lightweight reusable text profiles for common PAW workflow snippets. Streamliner stages the worker-facing context in local state before PAW init, then runs a fully capable SDK `paw-init` session with Copilot CLI-style repository, shell, GitHub, configured MCP, and custom-tool access. PAW init installs the staged context into the PAW work directory through Streamliner's `complete_paw_init` completion tool, and the dialog can load/save the generated `WorkflowContext.md` for final review before terminal launch. If PAW init asks a clarification question, launch preparation reports a typed error instead of waiting indefinitely.

## Current State Analysis

Graph node selection is already coordinated in `GraphDashboard`, which owns `selectedNodeId`, derives `selectedEntry`, renders `WorkstreamCanvas`, and renders `NodeInspector` beside the canvas ([src/App.tsx:769-887](src/App.tsx#L769-L887)). `NodeInspector` currently displays selected-node metadata, tracker, repos, dependencies, and dependents, but it has no launch action ([src/components/NodeInspector.tsx:42-160](src/components/NodeInspector.tsx#L42-L160)).

Backend context assembly already exists through `prepareLaunchContextPackage`, which accepts a selected `nodeId`, optional `graphPath`, optional `outputDir`, optional `launchNonce`, and injectable context-generation dependencies ([src/server/launch-context.ts:99-110](src/server/launch-context.ts#L99-L110)). When `outputDir` is supplied, context assembly writes or overwrites `streamliner/context.md` under that directory ([src/server/launch-context.ts:844-869](src/server/launch-context.ts#L844-L869), [src/server/launch-context.ts:887-918](src/server/launch-context.ts#L887-L918)). The context route exposes only context packages today, not full PAW launch handoff data ([src/server/routes/launch-contexts.ts:24-49](src/server/routes/launch-contexts.ts#L24-L49)).

Terminal launch is deliberately separate. `launchTerminal` starts a detached visible terminal only when called, and relaunch invokes it from `relaunchSession` ([src/server/terminal-launch.ts:56-69](src/server/terminal-launch.ts#L56-L69), [src/session-registry/relaunch.ts:119-191](src/session-registry/relaunch.ts#L119-L191)). This phase must not call those terminal helpers.

The session-system design doc already documents launch preparation, context delivery, kickoff prompts, and the backend context API, but its launch-profile language is broader than the PAW-only MVP described by issue #33 ([docs/design/session-system.md:35-123](docs/design/session-system.md#L35-L123), [docs/design/session-system.md:175-245](docs/design/session-system.md#L175-L245)).

## Desired End State

The selected-node inspector exposes a PAW launch action for ready graph nodes whose graph source has a backend-readable local path. Activating it opens a configuration dialog that shows natural-language PAW workflow instructions, default Copilot CLI args, terminal preference, and graph source before any backend preparation request is made.

The backend provides a preparation endpoint that accepts the selected node and launch configuration, stages the Streamliner context package in Streamliner state, runs PAW initialization through a fully capable SDK-backed `PawInitRunner` using the installed `paw-init` skill, installs the staged context into the PAW work directory, builds a kickoff prompt referencing the PAW workflow context and installed Streamliner context file, and returns a structured handoff containing cwd/worktree, branch, PAW work directory, context path, kickoff prompt, CLI args, environment/session-state data, launch metadata, and context package references. The default SDK runner should match Copilot CLI PAW init capabilities while using `complete_paw_init` as the structured Streamliner handoff.

Verification will cover backend contract behavior, staged context handoff, PAW init failure/question handling, explicit empty CLI-arg overrides, API route errors, UI dialog behavior, cancel/no-request behavior, and a representative screenshot of the graph UI with the launch dialog open.

## What We're NOT Doing

- Starting Copilot CLI, spawning terminals, or wiring visible worker launch.
- Creating, storing, or binding launch claims beyond preserving supplied launch nonce/identity metadata in the handoff and prompt.
- Building a generic non-PAW launch-profile system.
- Building the full PAW WorkflowContext configuration UI; that work is tracked in issue #43.
- Changing backend context assembly source collection or Layer 0-3 context-generation behavior except where needed to consume its existing output.
- Treating PAW control state as Streamliner's runtime workflow-progress source.
- Supporting browser-directory graph launch preparation when the backend lacks a local graph path; the UI should avoid presenting those nodes as launchable or surface an unsupported-source preparation error.
- Persisting host-specific launch defaults in local runtime configuration; issue #33 accepts those values only as launch-time overrides.

## Phase Status

- [x] **Phase 1: Backend PAW launch preparation contract** - Add typed launch configuration defaults, PAW init runner abstraction, kickoff prompt builder, structured handoff, route, and server tests.
- [x] **Phase 2: Graph launch configuration UI** - Add selected-node launch action, modal configuration dialog, preparation request handling, result/error display, styles, and UI tests.
- [x] **Phase 3: Documentation and verification** - Update session-system design, create PAW Docs.md as-built reference, run project checks, and capture a representative UI screenshot.
- [x] **Phase 4: Text-guided PAW init rescope** - Replace the temporary expanded WorkflowContext form with natural-language PAW init instructions, staged context installation, and SDK question/failure handling.
- [x] **Phase 5: Fully capable SDK PAW init** - Replace the constrained one-tool PAW init adapter with a Copilot CLI-style SDK session that can use built-in tools while returning completion through Streamliner's handoff tool.

Phase 2 depends on the Phase 1 route/types. Phase 3 depends on the completed backend and UI behavior so the as-built docs and screenshot match the implementation.

## Phase Candidates

---

## Phase 1: Backend PAW launch preparation contract

### Changes Required:

- **`src/server/launch-preparation.ts`**: Add the preparation domain module. Define launch configuration, normalized request input, typed committed defaults, explicit defaults-merge semantics, structured handoff output, launch metadata, and a `PawInitRunner` abstraction. Committed non-secret defaults should start as source-controlled TypeScript constants in this module; host-specific preferences are accepted as launch-time request overrides for this MVP and are not persisted by issue #33. The defaults merge must distinguish omitted CLI args (`undefined`, use defaults) from an explicit empty array (builder cleared args). The structured handoff output should expose named fields for `cwd`, `branch`, `pawWorkDir`, `workflowContextPath`, `streamlinerContextPath`, `kickoffPrompt`, `cliArgs`, `environment`, `sessionStateRoot`, `launchMetadata`, and `contextPackage`.
- **`PawInitRunner` default implementation**: Implement the default runner as a fully capable Copilot SDK session that preloads the installed `paw-init` skill, enables config discovery, approves built-in tool use, and provides the Streamliner-owned `complete_paw_init` tool. The prompt instructs PAW init to derive workflow settings from natural-language instructions, use defaults instead of asking questions, write `WorkflowContext.md` through the normal PAW path, and call the tool with work title/id and target branch. The tool copies the staged Streamliner context into `<pawWorkDir>\streamliner\context.md` and verifies the PAW-written WorkflowContext records the installed context as an Additional Input. Tests should use an injected runner to avoid invoking the real SDK.
- **`prepareLaunchContextPackage` integration**: Call the existing context assembly contract before PAW init without `outputDir`, so it writes a staged context package under Streamliner state. Pass that staged package to PAW init so `complete_paw_init` can install it into the PAW work directory. The prepared handoff identity should be sourced from current launch context metadata plus the PAW init result, selected graph node, target repo, optional tracker/issue, and supplied nonce; `launchClaimRef` may remain absent until issue #32 owns claim binding.
- **`src/server/routes/launch-preparations.ts`**: Add `POST /api/launch-preparations` route parsing the selected `nodeId`, optional `graphPath`, optional `launchNonce`, and launch configuration. Return structured JSON on success and typed preparation errors on client/server failures.
- **`src/server/app.ts`**: Register the new route and expose route dependencies for tests, following the existing `launchContextDeps` pattern ([src/server/app.ts:25-33](src/server/app.ts#L25-L33), [src/server/app.ts:95-101](src/server/app.ts#L95-L101)).
- **Tests: `src/server/launch-preparation.test.ts` and/or `src/server/launch-context.test.ts` additions**: Cover default config, explicit empty CLI args versus omitted args, context output under PAW work directory, named handoff shape, workflow context path, kickoff prompt with no custom message, kickoff prompt with a multi-paragraph builder custom message, route success, route validation errors, PAW init failure, context-preparation failure, a missing/unavailable selected-node context package producing a typed error naming the missing context as the blocking input, and preservation of nonce/identity metadata. Expected identity fields in assertions are workstream ID, node ID, tracker/issue reference when available, branch, target repo, and nonce. Use injected runners/context generators so tests do not invoke the real SDK.

### Success Criteria:

#### Automated Verification:
- [ ] Backend tests pass: `npm test -- --run src/server/launch-preparation.test.ts src/server/launch-context.test.ts`
- [ ] Type/build check passes for backend changes: `npm run build`

#### Manual Verification:
- [ ] Preparation response contains cwd/worktree, branch, PAW work directory, workflow context path, Streamliner context path, kickoff prompt, CLI args, environment, session-state root, launch metadata, and context package references.
- [ ] Kickoff prompt references context files and includes the builder custom-message section only when a custom message is provided.
- [ ] Preparation errors identify the blocking step and affected input for PAW init and context preparation failures.
- [ ] Handoff field names are pinned by structural tests so adjacent launch-claim and terminal-integration work can consume them.
- [ ] Preparation code path does not call terminal launch helpers.

---

## Phase 2: Graph launch configuration UI

### Changes Required:

- **`src/App.tsx`**: Add launch dialog state to `GraphDashboard`, derive defaults for the selected node, call `POST /api/launch-preparations` only after the builder confirms, and display prepared handoff/error state. Pass a launch callback into `NodeInspector`.
- **`src/components/NodeInspector.tsx`**: Add a PAW launch action only for selected launchable nodes, defined for this MVP as `entry.operationalStatus === "ready"` on the researched `WorkstreamDerivedNode` view-model entry plus a backend-readable graph path. Preserve the current metadata/dependency rendering and show a clear disabled/unsupported state for selected nodes that are not ready or lack a backend-readable source.
- **`src/components/PawLaunchDialog.tsx`**: Render the PAW-focused configuration dialog as a dedicated component. Fields should include natural-language PAW workflow instructions, terminal preference, CLI argument defaults/overrides, graph source, and prepared handoff state. The dialog should support cancel without network requests.
- **`src/streamliner-theme.css`**: Add styles for the launch dialog and any inspector launch affordance, reusing existing sheet/action patterns where practical ([src/streamliner-theme.css:842-957](src/streamliner-theme.css#L842-L957), [src/streamliner-theme.css:1986-2050](src/streamliner-theme.css#L1986-L2050)).
- **Tests: `src/App.test.tsx`**: Add UI tests for opening the dialog from a ready selected graph node, hiding/disabling launch for non-ready or backend-unreadable sources, canceling without preparation, submitting defaults/custom message to the preparation route, honoring empty CLI args, and displaying success/error feedback. Follow existing fetch mock and helper patterns ([src/App.test.tsx:1-245](src/App.test.tsx#L1-L245)).

### Success Criteria:

#### Automated Verification:
- [x] UI tests pass: `npm test -- --run src/App.test.tsx`
- [x] Full test suite passes: `npm test -- --run`
- [x] Lint passes: `npm run lint`

#### Manual Verification:
- [x] Selecting a launchable node shows a launch action in the inspector.
- [x] Non-ready or backend-unreadable graph nodes are not presented as launchable.
- [x] Launch action opens the configuration dialog before any preparation request.
- [x] Cancel closes the dialog without calling preparation.
- [x] Submit displays preparation progress and then a handoff summary without starting a terminal.
- [x] Dialog remains visually usable on the representative session-launching graph.

---

## Phase 3: Documentation and verification

### Changes Required:

- **`.paw/work/issue-33-launch-prompt-profiles/Docs.md`**: Create the PAW as-built technical reference using `paw-docs-guidance`, covering backend route, launch configuration defaults, prompt structure, UI flow, and verification.
- **`docs/design/session-system.md`**: Update launch contract/design text to describe the PAW-only Wave 3 MVP, PAW launch configuration, kickoff prompt template, custom-message placement, structured handoff, and the boundary that terminal launch/claim binding remain separate. Load/follow the `design-docs` skill while editing, decide whether older generic profile language is removed or recast as deferred future work, and keep frontmatter/code paths/sidebar/index coordination valid.
- **Visual verification**: Capture a screenshot with the launch dialog open using `scripts/screenshot.mjs` against `.streamliner\workstreams\session-launching-and-tracking\graph.json`.

### Success Criteria:

#### Automated Verification:
- [x] Docs build passes: `npm run docs:build`
- [x] Final full verification passes: `npm test -- --run`, `npm run lint`, `npm run build`

#### Manual Verification:
- [x] Docs accurately describe the implemented PAW-only launch preparation contract.
- [x] Code/docs review confirms no generic non-PAW launch-profile abstraction was introduced for the MVP.
- [x] Screenshot confirms the selected-node launch dialog is visible and readable on the representative graph.
- [x] Local screenshot artifacts are not staged for commit.

---

## Phase 4: Text-guided PAW init rescope

### Changes Required:

- **Dialog UX**: Replace the temporary expanded WorkflowContext configuration form with a natural-language PAW workflow instructions textarea, CLI args, terminal preference, graph source, and handoff state. The Run PAW init button is disabled when instructions are empty.
- **Backend ordering**: Stage the Streamliner context package before PAW init by calling `prepareLaunchContextPackage` without `outputDir`.
- **PAW init prompt**: Build the SDK prompt in `buildPawInitPrompt`, preload `paw-init`, and instruct the skill to use defaults/best judgment instead of asking questions. If it cannot proceed, it should return blocked JSON.
- **Context installation tool**: Provide `complete_paw_init` as the structured SDK completion tool. The PAW init session can use built-in tools and writes WorkflowContext through the normal PAW path. The tool copies the staged context into the PAW work dir and verifies `Additional Inputs` records the installed Streamliner context without rewriting WorkflowContext.
- **Failure handling**: Treat SDK clarification questions, missing tool calls, blocked status, missing WorkflowContext, or missing installed Streamliner context as typed `paw_init_failed` errors.
- **Tests**: Update backend and UI tests to cover staged context handoff, workflow instructions submission, empty-instructions blocking, explicit empty CLI args, and route behavior.

### Success Criteria:

#### Automated Verification:
- [x] Targeted launch prep and UI tests pass: `npm test -- --run src/server/launch-preparation.test.ts src/App.test.tsx`
- [ ] Lint passes: `npm run lint`
- [ ] Type/build check passes: `npm run build`

#### Manual Verification:
- [ ] Screenshot confirms the text-guided PAW init dialog remains readable on the representative graph.
- [ ] PR preview is restarted so the user can test the PAW init prompt flow.

---

## References

- Issue: https://github.com/lossyrob/streamliner/issues/33
- Spec: `.paw/work/issue-33-launch-prompt-profiles/Spec.md`
- Research: `.paw/work/issue-33-launch-prompt-profiles/CodeResearch.md`
