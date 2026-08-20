import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readNodeArtifactSnapshot } from "./lib/git-artifact-provider.mjs";
import {
    claimPreparedLaunch,
    completeClaimedLaunch,
    prepareLaunch,
} from "./lib/orchestration.mjs";
import { buildProjection } from "./lib/projection.mjs";
import { RuntimeStore } from "./lib/runtime-store.mjs";

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
        /worker is ready and gates downstream acceptance/,
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
