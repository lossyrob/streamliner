import {
    normalizeArtifactPath,
    readBlobAtRevision,
    readWorkstreamSnapshot,
    resolveArtifactRevision,
} from "./git-artifact-provider.mjs";
import { buildProjectionFromSnapshot } from "./projection.mjs";
import { isPortfolioDomainId } from "./portfolio-position-store.mjs";

function parseManifest(text, path) {
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON in ${path}: ${error.message}`);
    }
    if (
        manifest?.schemaVersion !== 1
        || typeof manifest.id !== "string"
        || !isPortfolioDomainId(manifest.id)
        || !isPortfolioDomainId(manifest.project?.id)
        || !Array.isArray(manifest.workstreams)
        || manifest.workstreams.length < 3
        || !Array.isArray(manifest.dependencies)
    ) {
        throw new Error(`${path} is not a schemaVersion 1 portfolio manifest.`);
    }
    const workstreamIds = new Set();
    for (const workstream of manifest.workstreams) {
        if (
            !isPortfolioDomainId(workstream?.id)
            || workstreamIds.has(workstream.id)
            || !Array.isArray(workstream.waves)
        ) {
            throw new Error(`${path} contains an invalid portfolio workstream.`);
        }
        workstreamIds.add(workstream.id);
        const waveIds = new Set();
        const checkpointIds = new Set();
        for (const wave of workstream.waves) {
            if (
                !isPortfolioDomainId(wave?.id)
                || waveIds.has(wave.id)
                || !isPortfolioDomainId(wave.publicCheckpoint?.id)
                || checkpointIds.has(wave.publicCheckpoint.id)
            ) {
                throw new Error(`${path} contains an invalid public checkpoint.`);
            }
            waveIds.add(wave.id);
            checkpointIds.add(wave.publicCheckpoint.id);
        }
    }
    return manifest;
}

function waveStatus(nodes) {
    const statuses = nodes.map((node) => node.runtimeStatus);
    if (statuses.length === 0) return "planned";
    if (statuses.every((status) => ["completed", "runtime-completed"].includes(status))) {
        return "completed";
    }
    if (statuses.some((status) => ["blocked"].includes(status))) return "blocked";
    if (statuses.some((status) => [
        "ready",
        "in-progress",
        "operationally-ready",
        "gate-ready",
        "launch-prepared",
        "session-claimed",
    ].includes(status))) return "in-progress";
    return "planned";
}

export function buildPortfolioProjection({
    repoPath,
    revision,
    portfolioPath,
    store,
}) {
    const resolved = resolveArtifactRevision(repoPath, revision);
    const manifestPath = normalizeArtifactPath(portfolioPath, "portfolioPath");
    const manifestText = readBlobAtRevision(resolved.root, resolved.commit, manifestPath);
    const manifest = parseManifest(manifestText, manifestPath);
    const runtimeState = store.read();
    const workstreams = manifest.workstreams.map((entry) => {
        const workstreamPath = normalizeArtifactPath(entry.path, "workstream path");
        const snapshot = readWorkstreamSnapshot({
            repoPath: resolved.root,
            revision: resolved.commit,
            workstreamPath,
        });
        if (snapshot.graph.id !== entry.id) {
            throw new Error(
                `Portfolio workstream ${entry.id} points to graph ${snapshot.graph.id}.`,
            );
        }
        const graphProjection = buildProjectionFromSnapshot(
            snapshot,
            runtimeState,
            resolved.commit,
        );
        const nodeById = new Map(graphProjection.nodes.map((node) => [node.id, node]));
        const waves = entry.waves.map((wave) => {
            const nodes = wave.nodeIds.map((nodeId) => {
                const node = nodeById.get(nodeId);
                if (!node) {
                    throw new Error(`Wave ${wave.id} references missing node ${nodeId}.`);
                }
                return node;
            });
            return {
                ...wave,
                status: waveStatus(nodes),
                completedNodes: nodes.filter((node) =>
                    ["completed", "runtime-completed"].includes(node.runtimeStatus)
                ).length,
                totalNodes: nodes.length,
                nodes,
            };
        });
        return {
            id: entry.id,
            title: graphProjection.workstream.title,
            summary: graphProjection.workstream.summary,
            durableStatus: graphProjection.workstream.durableStatus,
            region: entry.region,
            attention: entry.attention,
            risk: entry.risk,
            availability: entry.availability,
            waves,
            runtimeBindings: graphProjection.summary.preparedCount
                + graphProjection.summary.claimedCount
                + graphProjection.summary.completedCount,
        };
    });
    const workstreamById = new Map(
        workstreams.map((workstream) => [workstream.id, workstream]),
    );
    for (const dependency of manifest.dependencies) {
        const fromWorkstream = workstreamById.get(dependency.from?.workstreamId);
        const toWorkstream = workstreamById.get(dependency.to?.workstreamId);
        const fromWave = fromWorkstream?.waves.find(
            (wave) => wave.id === dependency.from?.waveId,
        );
        const toWave = toWorkstream?.waves.find(
            (wave) => wave.id === dependency.to?.waveId,
        );
        if (!fromWorkstream || !toWorkstream || !fromWave || !toWave) {
            throw new Error(`Dependency ${dependency.id} references a missing workstream.`);
        }
        if (
            fromWave.publicCheckpoint?.id !== dependency.from?.checkpointId
            || toWave.publicCheckpoint?.id !== dependency.to?.checkpointId
        ) {
            throw new Error(`Dependency ${dependency.id} references a missing public checkpoint.`);
        }
    }
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        artifact: {
            provider: "git-exact-revision-v1",
            repositoryKey: resolved.repositoryKey,
            requestedRevision: revision,
            revision: resolved.commit,
            portfolioPath: manifestPath,
        },
        portfolio: {
            id: manifest.id,
            title: manifest.title,
            summary: manifest.summary,
            project: manifest.project,
        },
        summary: {
            workstreamCount: workstreams.length,
            waveCount: workstreams.reduce((total, item) => total + item.waves.length, 0),
            checkpointCount: workstreams.reduce(
                (total, item) => total + item.waves.filter((wave) => wave.publicCheckpoint).length,
                0,
            ),
            dependencyCount: manifest.dependencies.length,
            runtimeBindingCount: workstreams.reduce(
                (total, item) => total + item.runtimeBindings,
                0,
            ),
            attentionCount: workstreams.filter((item) => item.attention === "focus").length,
        },
        workstreams,
        dependencies: manifest.dependencies,
    };
}
