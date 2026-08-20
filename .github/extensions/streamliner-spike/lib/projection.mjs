import { readWorkstreamSnapshot } from "./git-artifact-provider.mjs";

function latestLaunch(launches) {
    return [...launches].sort((left, right) =>
        right.preparedAt.localeCompare(left.preparedAt)
    )[0] || null;
}

function publicBinding(launch) {
    if (!launch) {
        return null;
    }
    return {
        launchId: launch.launchId,
        status: launch.status,
        preparedAt: launch.preparedAt,
        preparedBySessionId: launch.preparedBySessionId,
        claimedAt: launch.claimedAt,
        claimedBySessionId: launch.claimedBySessionId,
        completedAt: launch.completedAt,
        completionSummary: launch.completionSummary,
        completionEvidence: launch.completionEvidence,
        artifactRevision: launch.artifactRevision,
        artifactDigest: launch.artifactDigest,
    };
}

function runtimeStatus(node, binding, dependenciesComplete) {
    if (binding?.status === "completed") {
        return "runtime-completed";
    }
    if (binding?.status === "claimed") {
        return "session-claimed";
    }
    if (binding?.status === "prepared") {
        return "launch-prepared";
    }
    if (node.type === "gate" && dependenciesComplete && node.status !== "completed") {
        return "gate-ready";
    }
    if (node.status === "planned" && dependenciesComplete) {
        return "operationally-ready";
    }
    return node.status;
}

export function buildProjection({
    repoPath,
    revision,
    workstreamPath,
    store,
}) {
    const snapshot = readWorkstreamSnapshot({
        repoPath,
        revision,
        workstreamPath,
    });
    const state = store.read();
    const matchingLaunches = state.launches.filter((launch) =>
        launch.repositoryKey === snapshot.repositoryKey
        && launch.workstreamId === snapshot.graph.id
        && launch.artifactRevision === snapshot.commit
    );
    const launchesByNode = new Map();
    for (const launch of matchingLaunches) {
        const existing = launchesByNode.get(launch.nodeId) || [];
        existing.push(launch);
        launchesByNode.set(launch.nodeId, existing);
    }
    const nodesById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
    const operationallyComplete = new Set(
        snapshot.graph.nodes
            .filter((node) => ["completed", "retired"].includes(node.status))
            .map((node) => node.id),
    );
    for (const [nodeId, launches] of launchesByNode) {
        if (latestLaunch(launches)?.status === "completed") {
            operationallyComplete.add(nodeId);
        }
    }
    const nodes = snapshot.graph.nodes.map((node) => {
        const binding = latestLaunch(launchesByNode.get(node.id) || []);
        const dependencies = node.dependsOn.map((dependencyId) => ({
            id: dependencyId,
            title: nodesById.get(dependencyId)?.title || dependencyId,
            complete: operationallyComplete.has(dependencyId),
        }));
        const dependenciesComplete = dependencies.every((dependency) => dependency.complete);
        return {
            id: node.id,
            type: node.type,
            title: node.title,
            summary: node.summary,
            durableStatus: node.status,
            runtimeStatus: runtimeStatus(node, binding, dependenciesComplete),
            dependenciesComplete,
            dependencies,
            binding: publicBinding(binding),
        };
    });
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        artifact: {
            provider: "git-exact-revision-v1",
            repositoryKey: snapshot.repositoryKey,
            requestedRevision: revision,
            revision: snapshot.commit,
            workstreamPath: snapshot.workstreamPath,
            graphPath: snapshot.graphPath,
            graphSha256: snapshot.hashes.graph,
            briefSha256: snapshot.hashes.brief,
        },
        workstream: {
            id: snapshot.graph.id,
            projectKey: snapshot.graph.projectKey || snapshot.graph.repos?.[0]?.id,
            title: snapshot.graph.title,
            summary: snapshot.graph.summary,
            durableStatus: snapshot.graph.status,
        },
        summary: {
            nodeCount: nodes.length,
            gateCount: nodes.filter((node) => node.type === "gate").length,
            preparedCount: matchingLaunches.filter((launch) => launch.status === "prepared").length,
            claimedCount: matchingLaunches.filter((launch) => launch.status === "claimed").length,
            completedCount: matchingLaunches.filter((launch) => launch.status === "completed").length,
        },
        nodes,
        edges: snapshot.graph.nodes.flatMap((node) =>
            node.dependsOn.map((dependencyId) => ({
                from: dependencyId,
                to: node.id,
            }))
        ),
    };
}
