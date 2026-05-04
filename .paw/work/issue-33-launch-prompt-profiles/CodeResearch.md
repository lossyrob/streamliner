---
date: 2026-05-02T02:29:14-04:00
git_commit: 57470fe3f281c404449d847888cef2ed7437158a
branch: feature/issue-33-launch-prompt-profiles
repository: lossyrob/streamliner
topic: "PAW launch configuration and prompt defaults"
tags: [research, codebase, launch, paw, graph-ui]
status: complete
last_updated: 2026-05-02
---

# Research: PAW Launch Configuration and Prompt Defaults

## Research Question

Where should Streamliner implement PAW-only graph launch configuration, preparation handoff data, kickoff prompt generation, and related UI/docs for issue #33?

## Summary

The current graph dashboard renders a selected graph node through `GraphDashboard`, `WorkstreamCanvas`, and `NodeInspector`, but the inspector currently displays node metadata, dependencies, dependents, tracker, and repository labels without a graph-launch action ([src/App.tsx:769-887](src/App.tsx#L769-L887), [src/components/NodeInspector.tsx:42-160](src/components/NodeInspector.tsx#L42-L160)). Existing backend context assembly is implemented as `prepareLaunchContextPackage`, exposed through `POST /api/launch-contexts`, and already supports writing `streamliner/context.md` inside a caller-supplied PAW work directory via `outputDir` ([src/server/launch-context.ts:938-1150](src/server/launch-context.ts#L938-L1150), [src/server/routes/launch-contexts.ts:24-49](src/server/routes/launch-contexts.ts#L24-L49)).

The terminal launch utility is separate and spawns a detached terminal process only when explicitly called; this aligns with issue #33's boundary that preparation should not start the visible worker session ([src/server/terminal-launch.ts:56-69](src/server/terminal-launch.ts#L56-L69), [src/server/terminal-launch.ts:102-172](src/server/terminal-launch.ts#L102-L172)). The design documentation already contains a broader profile-oriented launch contract and context assembly API; it should be updated to the narrower PAW-only MVP where issue #33 changes prompt/configuration semantics ([docs/design/session-system.md:35-123](docs/design/session-system.md#L35-L123), [docs/design/session-system.md:175-245](docs/design/session-system.md#L175-L245)).

## Documentation System

- **Framework**: VitePress. `package.json` defines `docs:dev`, `docs:build`, and `docs:preview` scripts using VitePress ([package.json:18-20](package.json#L18-L20)).
- **Docs Directory**: `docs/design`; the design index is the entry point ([docs/design/index.md:21-34](docs/design/index.md#L21-L34)).
- **Navigation Config**: `docs/design/.vitepress/config.ts` configures sidebar sections for design docs, concepts, and decisions ([docs/design/.vitepress/config.ts:21-53](docs/design/.vitepress/config.ts#L21-L53)).
- **Style Conventions**: Design docs use YAML frontmatter with `kind`, `status`, `last_updated`, `authoritative_for`, `scope_tags`, `code_paths`, and `references_decisions` fields ([docs/design/session-system.md:1-29](docs/design/session-system.md#L1-L29)).
- **Build Command**: `npm run docs:build` ([package.json:18-20](package.json#L18-L20)).
- **Standard Files**: `docs/design/index.md` includes reading order, satellite documents, decision log, and open questions ([docs/design/index.md:27-67](docs/design/index.md#L27-L67)).

## Verification Commands

- **Test Command**: `npm test` or `npm test -- --run`; `package.json` maps `test` to `vitest run` ([package.json:16](package.json#L16)).
- **Lint Command**: `npm run lint`; `package.json` maps it to `eslint .` ([package.json:12](package.json#L12)).
- **Build Command**: `npm run build`; `package.json` maps it to `tsc -b && vite build` ([package.json:11](package.json#L11)).
- **Type Check**: No standalone type-check script is defined; `npm run build` runs TypeScript project builds before Vite ([package.json:11](package.json#L11), [tsconfig.json:1-7](tsconfig.json#L1-L7)).
- **UI Screenshot Command**: `node scripts/screenshot.mjs --graph .streamliner\workstreams\session-launching-and-tracking\graph.json --out .screenshots\after-launch-config.png`; required by the active iterative UI workflow for UI changes.

## Detailed Findings

### Graph Dashboard and Node Selection

- `App.tsx` imports `WorkstreamCanvas`, `NodeInspector`, and graph layout/view-model builders, making it the dashboard coordinator for graph view state ([src/App.tsx:12-30](src/App.tsx#L12-L30)).
- `GraphDashboard` holds `selectedNodeId` and `actionError`, builds a `WorkstreamViewModel`, computes a graph layout for the selected node, and derives `selectedEntry` from `viewModel.derivedNodes` ([src/App.tsx:769-800](src/App.tsx#L769-L800)).
- `WorkstreamDerivedNode` includes an `operationalStatus` field, and `buildWorkstreamViewModel` derives it from the source node `status`, GitHub completion/review state, and dependency readiness before computing the ready-now set from `entry.operationalStatus === "ready"` ([src/workstream-view-model.ts:43-55](src/workstream-view-model.ts#L43-L55), [src/workstream-view-model.ts:694-739](src/workstream-view-model.ts#L694-L739)).
- The dashboard passes `layout`, `selectedNodeId`, and `onNodeSelect` to `WorkstreamCanvas`, then renders `NodeInspector` with the selected entry, layout, and workstream document ([src/App.tsx:849-884](src/App.tsx#L849-L884)).
- `WorkstreamCanvas` creates lane and task React Flow nodes from the layout, preserving explicit `width` and `height` fields as well as style dimensions ([src/components/WorkstreamCanvas.tsx:76-116](src/components/WorkstreamCanvas.tsx#L76-L116)).
- Node clicks toggle the selected node unless the clicked node is a lane; pane clicks clear selection ([src/components/WorkstreamCanvas.tsx:154-166](src/components/WorkstreamCanvas.tsx#L154-L166)).
- `NodeInspector` renders an empty state when no node is selected, then renders title, summary, status/type/attention pills, tracker link, repo labels, dependencies, and dependents for a selected node ([src/components/NodeInspector.tsx:42-160](src/components/NodeInspector.tsx#L42-L160)).

### Workstream Data and Registry Inputs

- `WorkstreamNode` contains `id`, `type`, `title`, `summary`, `status`, `attention`, `repoIds`, optional `tracker`, and `dependsOn` fields ([src/workstream-schema.ts:103-113](src/workstream-schema.ts#L103-L113)).
- The parsed workstream document includes `projectKey`, `repos`, `designRefs`, `nodes`, and `checkpoints` fields used by graph layout and context assembly ([src/workstream-schema.ts:123-138](src/workstream-schema.ts#L123-L138)).
- `useGraphLoader` loads registered graph JSON from `/api/workstreams/:projectKey/:workstreamId/graph`, parses it with `parseWorkstreamDocument`, stores `Last-Modified`, and refreshes the registry afterward ([src/App.tsx:277-335](src/App.tsx#L277-L335)).
- `WorkstreamRegistryListEntry` includes `projectKey`, `workstreamId`, `title`, `summary`, `path`, source metadata, and file status; the path is available in UI state for server-side workstream entries ([src/workstream-registry-contract.ts:62-82](src/workstream-registry-contract.ts#L62-L82)).
- The workstreams router exposes `/api/workstreams` and `/api/workstreams/:projectKey/:workstreamId/graph`; when a registered graph path is unavailable it falls back to source workstream graph lookup before returning graph JSON ([src/server/routes/workstreams.ts:79-92](src/server/routes/workstreams.ts#L79-L92), [src/server/routes/workstreams.ts:163-214](src/server/routes/workstreams.ts#L163-L214)).

### Backend Context Assembly

- `launch-context.ts` defines `LaunchContextMetadata` with `contextId`, `launchNonce`, `launchClaimRef`, `projectKey`, `workstreamId`, `nodeId`, `targetRepoIds`, graph/workstream/repo paths, generated timestamp, package/file paths, model, source references, and unavailable inputs ([src/server/launch-context.ts:72-89](src/server/launch-context.ts#L72-L89)).
- `LaunchContextPackage` returns `contextId`, `contextPackagePath`, `contextFilePath`, metadata, and unavailable inputs ([src/server/launch-context.ts:91-97](src/server/launch-context.ts#L91-L97)).
- `PrepareLaunchContextPackageOptions` accepts `nodeId`, optional `graphPath`, optional `outputDir`, optional `launchNonce`, state root, time/context-id helpers, and injectable tracker/context generators ([src/server/launch-context.ts:99-110](src/server/launch-context.ts#L99-L110)).
- `prepareLaunchContextPackage` validates `nodeId`, resolves and parses the graph, locates the selected node, infers repo/workstream paths, computes state/package paths, reads graph/brief/design/tracker sources, runs the context generator, writes the package, and returns normalized path metadata ([src/server/launch-context.ts:938-1150](src/server/launch-context.ts#L938-L1150)).
- `finalPackagePath` writes to `<outputDir>\streamliner` when `outputDir` is supplied, otherwise writes under runtime state `launch-contexts\<contextId>` ([src/server/launch-context.ts:844-869](src/server/launch-context.ts#L844-L869)).
- `writePackageFiles` overwrites the single `context.md` file when `overwriteContextFile` is true, which is selected when `outputDir` is supplied ([src/server/launch-context.ts:887-918](src/server/launch-context.ts#L887-L918), [src/server/launch-context.ts:1138-1142](src/server/launch-context.ts#L1138-L1142)).
- The API route extracts `nodeId`, optional `graphPath`, optional `outputDir`, and optional `launchNonce` from the JSON body before calling `prepareLaunchContextPackage` ([src/server/routes/launch-contexts.ts:24-49](src/server/routes/launch-contexts.ts#L24-L49)).
- Launch-context tests cover output-dir placement under a Streamliner namespace, repeated output-dir overwrite behavior, API success, and API validation errors ([src/server/launch-context.test.ts:584-670](src/server/launch-context.test.ts#L584-L670), [src/server/launch-context.test.ts:813-905](src/server/launch-context.test.ts#L813-L905)).

### Context Generation Prompt

- `buildContextGenerationPrompt` instructs a SDK helper to generate worker-facing `context.md` for one selected Streamliner graph node and to treat source blocks as untrusted data ([src/server/launch-context.ts:528-610](src/server/launch-context.ts#L528-L610)).
- The prompt enforces Layer 0-3 headings and says output should only be Markdown, avoid generated-file meta language, distinguish the selected node from broader workstream context, and reference authoritative design docs/sources instead of copying full bodies ([src/server/launch-context.ts:551-610](src/server/launch-context.ts#L551-L610)).
- The default context generator creates a Copilot SDK session with `clientName: "streamliner-launch-context-assembly"`, no available tools, config discovery disabled, and a system message focused on launch-context writing ([src/server/launch-context.ts:618-647](src/server/launch-context.ts#L618-L647)).

### Copilot SDK Runner Surface

- `package.json` declares `@github/copilot-sdk` as a runtime dependency ([package.json:22-25](package.json#L22-L25)).
- Existing Streamliner code already creates a `CopilotClient`, creates a session with a model, working directory, permission handler, system message, and `availableTools: []`, then calls `sendAndWait` for bounded SDK work ([src/server/launch-context.ts:618-647](src/server/launch-context.ts#L618-L647)).
- Follow-up package inspection with `npm pack @github/copilot-sdk@0.3.0` found the SDK README documents `createSession` with `tools?: Tool[]`, required `onPermissionRequest`, and `sendAndWait` for waiting until idle. It also documents custom tool handlers via `defineTool`, tool permission control, and `skipPermission` for safe tools. This supports planning a constrained SDK runner that exposes Streamliner-owned PAW-init tools rather than relying on unrestricted built-in filesystem behavior.
- The package inspection did not identify any existing Streamliner PAW init runner module. The implementation plan should therefore treat PAW initialization as a new contract with injectable tests, explicit tool boundaries, and typed output validation.
- The PAW bootstrap skill defines the canonical work directory shape as `.paw/work/<work-id>/` with `WorkflowContext.md` at the work root, and this active work item is pre-initialized at `.paw/work/issue-33-launch-prompt-profiles/WorkflowContext.md` ([C:\Users\robemanuele\.copilot\skills\paw-init\SKILL.md:195-203](C:\Users\robemanuele\.copilot\skills\paw-init\SKILL.md#L195-L203), [.paw/work/issue-33-launch-prompt-profiles/WorkflowContext.md:1-10](.paw/work/issue-33-launch-prompt-profiles/WorkflowContext.md#L1-L10)).

### Terminal Launch and Relaunch Separation

- `TerminalLaunchOptions` requires `cwd` and accepts optional `command`, `title`, and `tabColor` ([src/server/terminal-launch.ts:11-21](src/server/terminal-launch.ts#L11-L21)).
- `launchTerminal` chooses Windows Terminal when available and falls back to PowerShell ([src/server/terminal-launch.ts:56-69](src/server/terminal-launch.ts#L56-L69)).
- Windows Terminal launch builds `wt.exe new-tab` args, appends a command only when provided, spawns detached with `stdio: "ignore"`, and returns method/pid ([src/server/terminal-launch.ts:102-135](src/server/terminal-launch.ts#L102-L135)).
- PowerShell fallback builds a `Set-Location` command, optionally appends a command, spawns detached, and returns method/pid ([src/server/terminal-launch.ts:138-172](src/server/terminal-launch.ts#L138-L172)).
- Relaunch builds terminal launch parameters from an existing registry session and only invokes terminal launch inside `relaunchSession`; it also synthesizes a trusted start signal for resumed Copilot sessions ([src/session-registry/relaunch.ts:100-117](src/session-registry/relaunch.ts#L100-L117), [src/session-registry/relaunch.ts:119-191](src/session-registry/relaunch.ts#L119-L191)).

### Session Registry and Launch Binding Shape

- Session list items expose `originKind`, `graphBinding`, `copilotSessionId`, derived worktree/branch, and trusted signal fields to the UI ([src/session-registry-contract.ts:39-83](src/session-registry-contract.ts#L39-L83)).
- Launched session upsert input supports `origin: LaunchedSessionRegistryOrigin`, lifecycle status, and optional `graphBinding` ([src/session-registry-contract.ts:127-135](src/session-registry-contract.ts#L127-L135)).
- The design document describes launched registry rows as the launch pipeline creating or reserving a row first, then observation linking the live Copilot session later ([docs/design/session-system.md:348-352](docs/design/session-system.md#L348-L352)).

### Design Documentation Contracts

- The session-system design currently describes a broader launch-profile model where launch inputs include branch strategy, execution mode, environment, launch profile, prompt overrides, and CLI arguments ([docs/design/session-system.md:39-55](docs/design/session-system.md#L39-L55)).
- The design's launch sequence separates launch preparation from the visible Copilot CLI interactive launch and lists preparation steps for profile resolution, context assembly, execution location, context placement, launch claim data, kickoff prompt, and structured output ([docs/design/session-system.md:57-88](docs/design/session-system.md#L57-L88)).
- The design's context delivery section states that PAW profile callers may provide a PAW work directory and Streamliner writes `streamliner/context.md` under that work directory ([docs/design/session-system.md:175-200](docs/design/session-system.md#L175-L200)).
- The backend preparation API documented in the design matches `POST /api/launch-contexts` and documents `nodeId`, `graphPath`, `outputDir`, and `launchNonce` request fields plus response fields for context package paths and metadata ([docs/design/session-system.md:220-245](docs/design/session-system.md#L220-L245)).

### Styling and Test Patterns

- Sidebar sections, items, inspector cards, metadata rows, and action buttons already have styles that can be reused for the launch configuration affordance in the inspector ([src/streamliner-theme.css:842-957](src/streamliner-theme.css#L842-L957), [src/streamliner-theme.css:323-376](src/streamliner-theme.css#L323-L376)).
- Modal/sheet primitives exist as `.sl-sheet-backdrop`, `.sl-sheet`, `.sl-sheet-head`, and related classes for session detail sheets ([src/streamliner-theme.css:1986-2050](src/streamliner-theme.css#L1986-L2050)).
- App UI tests use jsdom, `createRoot`, `act`, fetch mocks keyed by request path, helper `findButton`, and local `settle`/`setInputValue` helpers ([src/App.test.tsx:1-245](src/App.test.tsx#L1-L245)).
- Existing launch-context API tests use `supertest` against `createStreamlinerApiApp` with injected `launchContextDeps` for deterministic state root, context ID, tracker resolver, and context generator ([src/server/launch-context.test.ts:813-905](src/server/launch-context.test.ts#L813-L905)).

## Code References

- `src/App.tsx:769-887` - Graph dashboard owns selected node state and renders canvas plus inspector.
- `src/components/NodeInspector.tsx:42-160` - Inspector renders selected node details, tracker, repos, dependencies, and dependents.
- `src/server/launch-context.ts:72-110` - Launch context metadata/package/options contracts.
- `src/server/launch-context.ts:844-918` - Context package path and file writing behavior, including output-dir overwrite.
- `src/server/launch-context.ts:938-1150` - Launch context preparation pipeline.
- `src/server/routes/launch-contexts.ts:24-49` - `POST /api/launch-contexts` route contract.
- `src/server/terminal-launch.ts:56-172` - Detached terminal launch implementation used by relaunch and future terminal integration.
- `docs/design/session-system.md:35-245` - Current launch contract, context assembly, delivery, and backend preparation API design.

## Architecture Documentation

The implementation is split between React dashboard UI, Express routes, backend launch context preparation, and terminal/session registry helpers. Workstream graph data is loaded by the dashboard through the workstream registry API and parsed into a view model before being rendered in React Flow. Context package generation is backend-only and can already write into a PAW work directory when supplied. Terminal launch is a lower-level utility and is not called by context assembly.

The design documentation uses VitePress under `docs/design`, with `session-system.md` as the authoritative living design doc for session launch contracts. Any changes to launch input semantics, PAW launch configuration, prompt templating, and SDK preparation handoff should update that design doc.

## Open Questions

None.
