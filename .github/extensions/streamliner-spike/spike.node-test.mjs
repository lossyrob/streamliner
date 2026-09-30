import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    readNodeArtifactSnapshot,
} from "./lib/git-artifact-provider.mjs";
import {
    claimPreparedLaunch,
    completeClaimedLaunch,
    initializeClaimedLaunch,
    prepareLaunch,
} from "./lib/orchestration.mjs";
import { buildProjection } from "./lib/projection.mjs";
import { buildPortfolioProjection } from "./lib/portfolio-projection.mjs";
import { createCanvasServer } from "./lib/renderer.mjs";
import { RuntimeStore } from "./lib/runtime-store.mjs";
import {
    PortfolioPositionStore,
    portfolioPositionDomain,
    portfolioPositionDomainKey,
} from "./lib/portfolio-position-store.mjs";
import {
    CANVAS_ASSET_ROUTE,
    CANVAS_ASSET_VERSION,
    PORTFOLIO_CANVAS_ASSETS,
} from "./lib/ui-assets.mjs";
import {
    assertCanvasAssetVersion,
    assertPortfolioArtifactSchema,
    assertPortfolioPositionsSchema,
    assertRuntimeStateSchema,
    assertWorkstreamArtifactSchema,
    COMPATIBILITY_MANIFEST,
    inspectCompatibility,
} from "./lib/compatibility.mjs";
import { projectionToFlow } from "./ui/src/projection-adapter.mjs";
import {
    dependencyFocusIds,
    filterPortfolio,
    applyPortfolioPositions,
    portfolioToFlow,
    positionPatchForDraggedNodes,
} from "./portfolio-ui/src/portfolio-adapter.mjs";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(extensionRoot, "fixtures", "artifact-tree");
const seedScript = join(extensionRoot, "seed-toy-artifacts.mjs");
const createdRoots = [];

function git(cwd, ...args) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
    }).trim();
}

function createFixtureRepository() {
    const root = mkdtempSync(join(tmpdir(), "streamliner-spike-"));
    createdRoots.push(root);
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "Streamliner Spike Test");
    git(root, "config", "user.email", "streamliner-spike@example.invalid");
    git(root, "remote", "add", "origin", "https://github.com/lossyrob/streamliner.git");
    cpSync(fixtureRoot, root, { recursive: true });
    git(root, "add", ".");
    git(root, "commit", "-m", "Seed artifact fixture");
    return {
        root,
        firstRevision: git(root, "rev-parse", "HEAD"),
        workstreamPath: ".streamliner/workstreams/app-native-spike",
    };
}

test.after(() => {
    for (const root of createdRoots) {
        rmSync(root, { recursive: true, force: true });
    }
});

test("compatibility manifest accepts the package contract and diagnoses every unsupported probe", () => {
    assert.equal(
        COMPATIBILITY_MANIFEST.package.name,
        "streamliner-app-native-spike",
    );
    assert.equal(COMPATIBILITY_MANIFEST.package.version, "0.1.0");
    assert.equal(assertWorkstreamArtifactSchema(1), 1);
    assert.equal(assertPortfolioArtifactSchema(1), 1);
    assert.equal(assertRuntimeStateSchema(1), 1);
    assert.equal(assertPortfolioPositionsSchema(1), 1);
    assert.equal(
        assertCanvasAssetVersion(
            "streamliner-spike-workstream",
            "react-flow-v1",
        ),
        "react-flow-v1",
    );

    const report = inspectCompatibility({
        workstreamArtifactSchemaVersion: 2,
        portfolioArtifactSchemaVersion: 2,
        runtimeStateSchemaVersion: 2,
        portfolioPositionsSchemaVersion: 2,
        workstreamCanvasAssetVersion: "react-flow-v2",
        portfolioCanvasAssetVersion: "portfolio-v2",
    });
    assert.equal(report.compatible, false);
    assert.equal(report.diagnostics.length, 6);
    assert.equal(
        report.diagnostics.every((diagnostic) =>
            diagnostic.code === "streamliner_app_native_spike_incompatible"
            && diagnostic.message.includes("streamliner-app-native-spike@0.1.0")
        ),
        true,
    );
});

test("artifact readers reject unsupported schemas with explicit compatibility diagnostics", () => {
    const fixture = createFixtureRepository();
    const graphPath = join(
        fixture.root,
        ".streamliner",
        "workstreams",
        "app-native-spike",
        "graph.json",
    );
    const graph = JSON.parse(readFileSync(graphPath, "utf8"));
    graph.schemaVersion = 2;
    writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
    rmSync(join(
        fixture.root,
        ".streamliner",
        "workstreams",
        "app-native-spike",
        "brief.md",
    ));
    rmSync(join(
        fixture.root,
        ".streamliner",
        "workstreams",
        "app-native-spike",
        "tasks",
        "app-native-implementation.md",
    ));
    const portfolioPath = join(fixture.root, ".streamliner", "portfolio.json");
    const portfolio = JSON.parse(readFileSync(portfolioPath, "utf8"));
    portfolio.schemaVersion = 2;
    writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
    git(fixture.root, "add", ".");
    git(fixture.root, "commit", "-m", "Use unsupported schemas");
    const revision = git(fixture.root, "rev-parse", "HEAD");

    assert.throws(
        () => readNodeArtifactSnapshot({
            repoPath: fixture.root,
            revision,
            workstreamPath: fixture.workstreamPath,
            nodeId: "app-native-implementation",
        }),
        /incompatibility: workstream artifact schemaVersion 2.*supported range is 1\.\.1/,
    );
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    assert.throws(
        () => buildPortfolioProjection({
            repoPath: fixture.root,
            revision,
            portfolioPath: ".streamliner/portfolio.json",
            store: new RuntimeStore({ stateFile: join(stateRoot, "runtime.json") }),
        }),
        /incompatibility: portfolio artifact schemaVersion 2.*supported range is 1\.\.1/,
    );
});

test("artifact provider reads one exact revision without changing checkout", () => {
    const fixture = createFixtureRepository();
    const briefPath = join(
        fixture.root,
        ".streamliner",
        "workstreams",
        "app-native-spike",
        "brief.md",
    );
    writeFileSync(briefPath, `${readFileSync(briefPath, "utf8")}\nLater checkout content.\n`);
    git(fixture.root, "add", ".");
    git(fixture.root, "commit", "-m", "Move working branch ahead");
    const currentRevision = git(fixture.root, "rev-parse", "HEAD");

    const snapshot = readNodeArtifactSnapshot({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        nodeId: "app-native-implementation",
    });

    assert.equal(snapshot.commit, fixture.firstRevision);
    assert.equal(git(fixture.root, "rev-parse", "HEAD"), currentRevision);
    assert.equal(git(fixture.root, "branch", "--show-current"), "main");
    assert.equal(snapshot.brief.includes("Later checkout content."), false);
    assert.equal(snapshot.hashes.graph.length, 64);
    assert.equal(snapshot.hashes.task.length, 64);
});

test("binding token persists hashed and claims idempotently in one child session", () => {
    const fixture = createFixtureRepository();
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const store = new RuntimeStore({ stateFile: join(stateRoot, "runtime.json") });
    const prepared = prepareLaunch({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        nodeId: "app-native-implementation",
        preparedBySessionId: "orchestrator-session",
        store,
    });

    const persisted = readFileSync(store.stateFile, "utf8");
    assert.equal(persisted.includes(prepared.bindingToken), false);
    assert.throws(() => claimPreparedLaunch({
        bindingToken: "invalid-binding-token-value",
        claimingSessionId: "child-session",
        store,
    }), /invalid/);

    const claimed = claimPreparedLaunch({
        bindingToken: prepared.bindingToken,
        claimingSessionId: "child-session",
        store,
    });
    assert.equal(claimed.artifactRevision, fixture.firstRevision);
    assert.deepEqual(claimed.context.layers.map((layer) => layer.id), [0, 1, 2, 3]);
    assert.equal(claimed.context.sourceManifest.graph.revision, fixture.firstRevision);
    assert.equal(claimed.context.sourceManifest.brief.revision, fixture.firstRevision);
    assert.equal(claimed.context.sourceManifest.task.revision, fixture.firstRevision);
    assert.ok(claimed.context.budget.actualCharacters <= claimed.context.budget.maxCharacters);
    assert.match(
        claimed.context.layers.find((layer) => layer.id === 2).content.currentState,
        /Plugin distribution validation is now ready/,
    );
    assert.match(
        claimed.context.layers.find((layer) => layer.id === 0).content.boundaries,
        /Out of scope/,
    );

    const reclaimed = claimPreparedLaunch({
        bindingToken: prepared.bindingToken,
        claimingSessionId: "child-session",
        store,
    });
    assert.equal(reclaimed.reclaimed, true);
    assert.throws(() => claimPreparedLaunch({
        bindingToken: prepared.bindingToken,
        claimingSessionId: "different-session",
        store,
    }), /another session/);
});

test("App-aware PAW initialization is idempotent in the claimed worktree", () => {
    const fixture = createFixtureRepository();
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    const store = new RuntimeStore({ stateFile: join(stateRoot, "runtime.json") });
    const prepared = prepareLaunch({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        nodeId: "plugin-distribution-validation",
        preparedBySessionId: "orchestrator-session",
        store,
    });
    claimPreparedLaunch({
        bindingToken: prepared.bindingToken,
        claimingSessionId: "paw-child-session",
        store,
    });
    const initialized = initializeClaimedLaunch({
        launchId: prepared.launchId,
        initializingSessionId: "paw-child-session",
        workspacePath: fixture.root,
        store,
    });
    assert.equal(initialized.reused, false);
    assert.equal(initialized.appOwnedWorktree, true);
    assert.equal(initialized.nestedWorktreeCreated, false);
    assert.equal(initialized.terminalLaunched, false);
    const workflowContext = readFileSync(
        join(fixture.root, initialized.paths.workflowContext),
        "utf8",
    );
    assert.match(workflowContext, /Execution Mode: current-checkout/);
    assert.match(workflowContext, /Work ID: plugin-distribution-validation/);
    assert.match(workflowContext, /Repository Identity: github\.com\/lossyrob\/streamliner@/);
    const claim = JSON.parse(readFileSync(
        join(fixture.root, initialized.paths.claim),
        "utf8",
    ));
    assert.equal(claim.artifactRevision, fixture.firstRevision);
    assert.equal(claim.claimedBySessionId, "paw-child-session");
    const reused = initializeClaimedLaunch({
        launchId: prepared.launchId,
        initializingSessionId: "paw-child-session",
        workspacePath: fixture.root,
        store,
    });
    assert.equal(reused.reused, true);
    assert.equal(reused.initializedAt, initialized.initializedAt);
    assert.throws(() => initializeClaimedLaunch({
        launchId: prepared.launchId,
        initializingSessionId: "different-session",
        workspacePath: fixture.root,
        store,
    }), /not claimed by this App session/);
});

test("projection overlays prepared, claimed, and completed App bindings", () => {
    const fixture = createFixtureRepository();
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    const store = new RuntimeStore({ stateFile: join(stateRoot, "runtime.json") });
    const prepared = prepareLaunch({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        nodeId: "app-native-implementation",
        preparedBySessionId: "orchestrator-session",
        store,
    });
    let projection = buildProjection({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        store,
    });
    assert.equal(
        projection.nodes.find((node) => node.id === "app-native-implementation").runtimeStatus,
        "launch-prepared",
    );

    claimPreparedLaunch({
        bindingToken: prepared.bindingToken,
        claimingSessionId: "child-session",
        store,
    });
    projection = buildProjection({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        store,
    });
    assert.equal(
        projection.nodes.find((node) => node.id === "app-native-implementation").runtimeStatus,
        "session-claimed",
    );

    completeClaimedLaunch({
        launchId: prepared.launchId,
        summary: "Proof artifact committed.",
        evidence: "spike-proof/app-native-child.md",
        completingSessionId: "child-session",
        store,
    });
    projection = buildProjection({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: fixture.workstreamPath,
        store,
    });
    assert.equal(
        projection.nodes.find((node) => node.id === "app-native-implementation").runtimeStatus,
        "runtime-completed",
    );
    assert.equal(
        projection.nodes.find((node) => node.id === "builder-acceptance-gate").runtimeStatus,
        "gate-ready",
    );
});

test("artifact seeding is deterministic and canonicalizes checkout line endings", () => {
    const fixture = createFixtureRepository();
    const artifactRef = "refs/heads/test-artifact-ref";
    const first = JSON.parse(execFileSync(
        process.execPath,
        [seedScript, artifactRef, fixture.root],
        { encoding: "utf8", windowsHide: true },
    ));
    const second = JSON.parse(execFileSync(
        process.execPath,
        [seedScript, artifactRef, fixture.root],
        { encoding: "utf8", windowsHide: true },
    ));
    assert.equal(first.artifactRevision, second.artifactRevision);
    assert.equal(first.sourceCheckoutUnchanged, true);
    const seededBrief = git(
        fixture.root,
        "cat-file",
        "blob",
        `${first.artifactRevision}:.streamliner/workstreams/app-native-spike/brief.md`,
    );
    assert.equal(seededBrief.includes("\r"), false);
});

test("runtime store fails closed instead of evicting an abandoned lock", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    const store = new RuntimeStore({
        stateFile: join(stateRoot, "runtime.json"),
        lockTimeoutMilliseconds: 50,
    });
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(store.lockFile, JSON.stringify({
        ownerId: "abandoned-owner",
        pid: 2147483647,
        createdAt: "2000-01-01T00:00:00.000Z",
    }));
    assert.throws(() => store.mutate(() => {}), /Timed out/);
    assert.equal(existsSync(store.lockFile), true);
    assert.equal(store.read().launches.length, 0);
});

test("runtime store rejects incompatible persisted schemas explicitly", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    const stateFile = join(stateRoot, "runtime.json");
    writeFileSync(stateFile, JSON.stringify({
        schemaVersion: 2,
        updatedAt: null,
        launches: [],
    }));
    const store = new RuntimeStore({ stateFile });
    assert.throws(
        () => store.read(),
        /incompatibility: runtime state schemaVersion 2.*required version is 1/,
    );
});

function exampleProjection() {
    return {
        schemaVersion: 1,
        generatedAt: "2026-08-20T20:27:30.431Z",
        artifact: {
            revision: "fefc3cf54f142054c1ec4c95080bb425d301f415",
        },
        workstream: {
            id: "app-native-spike",
            title: "App-native Streamliner spike",
            summary: "Exercise the App-native workstream graph.",
        },
        summary: {
            nodeCount: 3,
            gateCount: 1,
            preparedCount: 0,
            claimedCount: 0,
            completedCount: 1,
        },
        nodes: [
            {
                id: "research",
                type: "research",
                title: "Research",
                summary: "Map the boundary.",
                durableStatus: "completed",
                runtimeStatus: "completed",
                dependenciesComplete: true,
                dependencies: [],
                binding: null,
            },
            {
                id: "implementation",
                type: "task",
                title: "Implementation",
                summary: "Exercise an App worker.",
                durableStatus: "ready",
                runtimeStatus: "runtime-completed",
                dependenciesComplete: true,
                dependencies: [{ id: "research", title: "Research", complete: true }],
                binding: {
                    launchId: "launch-proof",
                    status: "completed",
                    claimedBySessionId: "child-session",
                    completionEvidence: "spike-proof/app-native-child.md",
                },
            },
            {
                id: "acceptance-gate",
                type: "gate",
                title: "Acceptance gate",
                summary: "Review the proof.",
                durableStatus: "planned",
                runtimeStatus: "gate-ready",
                dependenciesComplete: true,
                dependencies: [{
                    id: "implementation",
                    title: "Implementation",
                    complete: true,
                }],
                binding: null,
            },
        ],
        edges: [
            { from: "research", to: "implementation" },
            { from: "implementation", to: "acceptance-gate" },
        ],
    };
}

test("projection adapter creates a read-only React Flow graph with a gate", () => {
    const flow = projectionToFlow(exampleProjection());
    assert.equal(flow.nodes.length, 3);
    assert.equal(flow.edges.length, 2);
    assert.equal(flow.nodes.every((node) => node.draggable === false), true);
    assert.equal(
        flow.nodes.find((node) => node.id === "acceptance-gate").type,
        "workstreamGate",
    );
    assert.equal(
        flow.nodes.find((node) => node.id === "acceptance-gate").data.tone,
        "gate",
    );
    assert.equal(flow.edges.every((edge) => edge.data.complete), true);
    assert.equal(
        flow.nodes.find((node) => node.id === "research").position.y
            < flow.nodes.find((node) => node.id === "implementation").position.y,
        true,
    );
});

test("renderer serves the versioned React Flow bundle and projection API", async (context) => {
    const projection = exampleProjection();
    const server = await createCanvasServer({ getProjection: () => projection });
    context.after(() => server.close());

    const healthResponse = await fetch(new URL("/health", server.url));
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).assetVersion, CANVAS_ASSET_VERSION);

    const indexResponse = await fetch(server.url);
    const index = await indexResponse.text();
    assert.equal(indexResponse.status, 200);
    assert.match(index, new RegExp(CANVAS_ASSET_ROUTE));
    assert.match(indexResponse.headers.get("content-security-policy"), /default-src 'self'/);

    const manifestResponse = await fetch(new URL(
        `${CANVAS_ASSET_ROUTE}manifest.json`,
        server.url,
    ));
    const manifest = await manifestResponse.json();
    assert.equal(manifestResponse.status, 200);
    assert.equal(typeof manifest["index.html"].file, "string");
    const scriptResponse = await fetch(new URL(
        `${CANVAS_ASSET_ROUTE}${manifest["index.html"].file}`,
        server.url,
    ));
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get("content-type"), /javascript/);

    const projectionResponse = await fetch(new URL("/api/projection", server.url));
    assert.deepEqual(await projectionResponse.json(), projection);
    const refreshResponse = await fetch(new URL("/api/refresh", server.url), {
        method: "POST",
    });
    assert.equal(refreshResponse.status, 200);
    assert.equal((await refreshResponse.json()).workstream.id, "app-native-spike");

    const missingResponse = await fetch(new URL(
        `${CANVAS_ASSET_ROUTE}missing.js`,
        server.url,
    ));
    assert.equal(missingResponse.status, 404);
});

test("portfolio projection reads three workstreams from one exact revision", () => {
    const fixture = createFixtureRepository();
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    const store = new RuntimeStore({ stateFile: join(stateRoot, "runtime.json") });
    const projection = buildPortfolioProjection({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        portfolioPath: ".streamliner/portfolio.json",
        store,
    });
    assert.equal(projection.artifact.revision, fixture.firstRevision);
    assert.equal(projection.summary.workstreamCount, 3);
    assert.equal(projection.summary.dependencyCount, 3);
    assert.equal(
        projection.workstreams
            .find((workstream) => workstream.id === "app-native-spike")
            .waves.find((wave) => wave.id === "native-session-loop")
            .status,
        "in-progress",
    );
    assert.deepEqual(
        new Set(projection.dependencies.map((edge) => edge.state)),
        new Set(["validated", "branch-local", "proposed"]),
    );
    assert.equal(
        projection.workstreams.every((workstream) =>
            workstream.waves.every((wave) =>
                wave.nodes.every((node) => typeof node.runtimeStatus === "string")
            )
        ),
        true,
    );
});

test("portfolio projection overlays volatile bindings outside the artifact ref", () => {
    const fixture = createFixtureRepository();
    const stateRoot = mkdtempSync(join(tmpdir(), "streamliner-spike-state-"));
    createdRoots.push(stateRoot);
    const store = new RuntimeStore({ stateFile: join(stateRoot, "runtime.json") });
    prepareLaunch({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        workstreamPath: ".streamliner/workstreams/portfolio-experience",
        nodeId: "portfolio-projection",
        preparedBySessionId: "portfolio-orchestrator",
        store,
    });
    const projection = buildPortfolioProjection({
        repoPath: fixture.root,
        revision: fixture.firstRevision,
        portfolioPath: ".streamliner/portfolio.json",
        store,
    });
    assert.equal(projection.summary.runtimeBindingCount, 1);
    assert.equal(
        projection.workstreams
            .find((workstream) => workstream.id === "portfolio-experience")
            .waves[0].nodes[0].runtimeStatus,
        "launch-prepared",
    );
});

test("portfolio adapter transforms checkpoint dependencies and filters focus", () => {
    const projection = {
        ...exampleProjection(),
        portfolio: { id: "portfolio", title: "Portfolio", project: { title: "Project" } },
        workstreams: [
            {
                id: "one",
                title: "One",
                summary: "One",
                region: "A",
                attention: "focus",
                risk: "low",
                availability: "validated",
                runtimeBindings: 0,
                waves: [{
                    id: "one-wave",
                    index: 0,
                    title: "One wave",
                    summary: "One",
                    completedNodes: 1,
                    totalNodes: 1,
                    status: "completed",
                    publicCheckpoint: { title: "One checkpoint", availability: "validated", export: "contract" },
                    nodes: exampleProjection().nodes.slice(0, 1),
                }],
            },
            {
                id: "two",
                title: "Two",
                summary: "Two",
                region: "B",
                attention: "watch",
                risk: "high",
                availability: "proposed",
                runtimeBindings: 0,
                waves: [{
                    id: "two-wave",
                    index: 0,
                    title: "Two wave",
                    summary: "Two",
                    completedNodes: 0,
                    totalNodes: 1,
                    status: "planned",
                    publicCheckpoint: { title: "Two checkpoint", availability: "proposed", export: "canvas" },
                    nodes: exampleProjection().nodes.slice(1, 2),
                }],
            },
        ],
        dependencies: [{
            id: "one-to-two",
            label: "Contract",
            state: "proposed",
            from: { workstreamId: "one", waveId: "one-wave", export: "contract" },
            to: { workstreamId: "two", waveId: "two-wave", import: "input" },
            risk: "Risk",
            action: "Act",
        }],
    };
    const flow = portfolioToFlow(projection, {
        level: "summary",
        filters: { attentionOnly: false, dependencyState: "all" },
        selection: { type: "dependency", id: "one-to-two" },
        onSelectTask: () => {},
    });
    assert.equal(flow.nodes.filter((node) => node.type === "portfolioHeader").length, 2);
    assert.equal(flow.edges.some((edge) => edge.id === "one-to-two"), true);
    assert.equal(dependencyFocusIds(projection, { type: "dependency", id: "one-to-two" }).size, 3);
    const attention = filterPortfolio(projection, {
        attentionOnly: true,
        dependencyState: "all",
    });
    assert.deepEqual(attention.workstreams.map((item) => item.id), ["one"]);
    assert.equal(attention.dependencies.length, 0);
});

test("renderer serves the portfolio bundle on portfolio-specific API routes", async (context) => {
    const projection = { portfolio: { id: "portfolio" }, workstreams: [], dependencies: [] };
    const server = await createCanvasServer({
        getProjection: () => projection,
        assets: PORTFOLIO_CANVAS_ASSETS,
        projectionRoute: "/api/portfolio/projection",
        refreshRoute: "/api/portfolio/refresh",
    });
    context.after(() => server.close());
    const health = await (await fetch(new URL("/health", server.url))).json();
    assert.equal(health.assetVersion, "portfolio-v1");
    assert.deepEqual(
        await (await fetch(new URL("/api/portfolio/projection", server.url))).json(),
        projection,
    );
    assert.equal(
        (await fetch(new URL("/api/projection", server.url))).status,
        404,
    );
});

test("portfolio positions use stable domain identity independent of revision", () => {
    const first = portfolioPositionDomain({
        artifact: { repositoryKey: "1234567890abcdef1234", revision: "a".repeat(40) },
        portfolio: { id: "portfolio", project: { id: "project" } },
    });
    const second = portfolioPositionDomain({
        artifact: { repositoryKey: "1234567890abcdef1234", revision: "b".repeat(40) },
        portfolio: { id: "portfolio", project: { id: "project" } },
    });
    assert.deepEqual(first, second);
    assert.equal(portfolioPositionDomainKey(first), portfolioPositionDomainKey(second));
});

test("portfolio position store validates schema and merges concurrent partial patches", () => {
    const root = mkdtempSync(join(tmpdir(), "streamliner-portfolio-positions-"));
    createdRoots.push(root);
    const domain = {
        repositoryKey: "1234567890abcdef1234",
        projectId: "project",
        portfolioId: "portfolio",
    };
    const first = new PortfolioPositionStore({ positionsRoot: root });
    const second = new PortfolioPositionStore({ positionsRoot: root });
    const firstResult = first.patch(domain, {
        mutationId: "mutation-one",
        generation: 0,
        baseRevision: 0,
        upsert: { "wave:one:first": { x: 10, y: 20 } },
    });
    assert.equal(firstResult.document.revision, 1);
    assert.throws(() => second.patch(domain, {
        mutationId: "mutation-two",
        generation: 0,
        baseRevision: 0,
        upsert: { "wave:two:first": { x: 30, y: 40 } },
    }), /revision 0 is stale/);
    const secondResult = second.patch(domain, {
        mutationId: "mutation-two",
        generation: 0,
        baseRevision: 1,
        upsert: { "wave:two:first": { x: 30, y: 40 } },
    });
    assert.equal(secondResult.document.revision, 2);
    const duplicate = first.patch(domain, {
        mutationId: "mutation-one",
        generation: 0,
        baseRevision: 0,
        upsert: { "wave:one:first": { x: -100, y: -100 } },
    });
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.document.positions["wave:one:first"].x, 10);
    first.patch(domain, {
        mutationId: "mutation-three",
        generation: 0,
        baseRevision: 2,
        upsert: { "ws:one": { x: 5, y: 15 } },
        remove: ["wave:one:first"],
    });
    const result = second.read(domain);
    assert.deepEqual(Object.keys(result.document.positions).sort(), [
        "wave:two:first",
        "ws:one",
    ]);
    assert.equal(result.document.schemaVersion, 1);
    assert.equal(
        readdirSync(join(root, domain.repositoryKey)).some((name) => name.endsWith(".tmp")),
        false,
    );
    assert.throws(
        () => first.patch(domain, {
            mutationId: "mutation-bad-id",
            generation: 0,
            baseRevision: 3,
            upsert: { "../escape": { x: 1, y: 2 } },
        }),
        /Invalid portfolio position id/,
    );
    assert.throws(
        () => first.patch(domain, {
            mutationId: "mutation-infinite",
            generation: 0,
            baseRevision: 3,
            upsert: { "wave:one:first": { x: Infinity, y: 2 } },
        }),
        /finite/,
    );
    const resetResult = second.reset(domain);
    assert.equal(resetResult.count, 0);
    assert.equal(resetResult.document.generation, 1);
    assert.deepEqual(first.read(domain).document.positions, {});
    assert.throws(
        () => first.patch(domain, {
            mutationId: "mutation-stale-generation",
            generation: 0,
            baseRevision: resetResult.document.revision,
            upsert: { "wave:one:first": { x: 90, y: 100 } },
        }),
        /stale/,
    );
    assert.deepEqual(first.read(domain).document.positions, {});
    writeFileSync(first.pathFor(domain), JSON.stringify({
        schemaVersion: 2,
        domain,
        positions: {},
    }));
    assert.throws(
        () => first.read(domain),
        /incompatibility: portfolio positions schemaVersion 2.*required version is 1/,
    );
});

test("portfolio anchor translation precedes exact wave pins and survives added waves", () => {
    const projection = {
        workstreams: [{
            id: "one",
            waves: [
                { id: "first" },
                { id: "second" },
                { id: "added" },
            ],
        }],
    };
    const nodes = [
        { id: "header:one", position: { x: 40, y: 20 }, data: {} },
        { id: "wave:one:first", position: { x: 40, y: 160 }, data: {} },
        { id: "wave:one:second", position: { x: 40, y: 320 }, data: {} },
        { id: "wave:one:added", position: { x: 40, y: 480 }, data: {} },
    ];
    const positioned = applyPortfolioPositions(nodes, projection, {
        "ws:one": { x: 500, y: 600 },
        "wave:one:second": { x: 900, y: 950 },
    });
    const byId = new Map(positioned.map((node) => [node.id, node.position]));
    assert.deepEqual(byId.get("wave:one:first"), { x: 500, y: 600 });
    assert.deepEqual(byId.get("wave:one:second"), { x: 900, y: 950 });
    assert.deepEqual(byId.get("wave:one:added"), { x: 500, y: 920 });
});

test("drag patches exact wave pins and workstream anchors while ignoring headers", () => {
    const projection = {
        workstreams: [{
            id: "one",
            waves: [{ id: "first" }, { id: "second" }],
        }],
    };
    const nodes = [
        { id: "header:one", position: { x: 0, y: 0 } },
        { id: "wave:one:first", position: { x: 100, y: 200 } },
        { id: "wave:one:second", position: { x: 100, y: 400 } },
    ];
    const patch = positionPatchForDraggedNodes(
        [nodes[0], nodes[1]],
        nodes,
        projection,
    );
    assert.deepEqual(Object.keys(patch.upsert), ["wave:one:first"]);
    const workstreamPatch = positionPatchForDraggedNodes(
        [nodes[1], nodes[2]],
        nodes,
        projection,
    );
    assert.deepEqual(Object.keys(workstreamPatch.upsert).sort(), [
        "wave:one:first",
        "wave:one:second",
        "ws:one",
    ]);
    assert.deepEqual(workstreamPatch.upsert["ws:one"], { x: 100, y: 200 });
});

test("renderer exposes merge-safe portfolio position routes including beacon POST", async (context) => {
    let positions = {};
    let revision = 0;
    let generation = 0;
    const server = await createCanvasServer({
        getProjection: () => ({ portfolio: { id: "portfolio" } }),
        assets: PORTFOLIO_CANVAS_ASSETS,
        projectionRoute: "/api/portfolio/projection",
        refreshRoute: "/api/portfolio/refresh",
        positionsRoute: "/api/portfolio/positions",
        positionsController: {
            get: () => ({ positions, schemaVersion: 1, revision, generation }),
            patch: (patch) => {
                positions = applyPositionPatchForTest(positions, patch);
                revision += 1;
                return { positions, schemaVersion: 1, revision, generation, savedAt: "now" };
            },
            reset: () => {
                positions = {};
                revision += 1;
                generation += 1;
                return {
                    positions,
                    schemaVersion: 1,
                    revision,
                    generation,
                    savedAt: "reset",
                    reset: true,
                };
            },
        },
    });
    context.after(() => server.close());
    const patchResponse = await fetch(new URL("/api/portfolio/positions", server.url), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mutationId: "renderer-mutation-one",
            generation: 0,
            baseRevision: 0,
            upsert: { "wave:one:first": { x: 1, y: 2 } },
        }),
    });
    assert.equal(patchResponse.status, 200);
    const beaconResponse = await fetch(new URL(
        "/api/portfolio/positions?method=patch",
        server.url,
    ), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mutationId: "renderer-mutation-two",
            generation: 0,
            baseRevision: 1,
            remove: ["wave:one:first"],
        }),
    });
    assert.equal(beaconResponse.status, 200);
    assert.deepEqual(
        (await (await fetch(new URL("/api/portfolio/positions", server.url))).json()).positions,
        {},
    );
    await fetch(new URL("/api/portfolio/positions", server.url), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mutationId: "renderer-mutation-three",
            generation: 0,
            baseRevision: 2,
            upsert: { "wave:two:first": { x: 3, y: 4 } },
        }),
    });
    assert.equal(
        (await fetch(new URL("/api/portfolio/positions", server.url), {
            method: "DELETE",
        })).status,
        200,
    );
    assert.deepEqual(positions, {});
});

function applyPositionPatchForTest(current, patch) {
    const next = { ...current };
    for (const id of patch.remove || []) delete next[id];
    Object.assign(next, patch.upsert || {});
    return next;
}
