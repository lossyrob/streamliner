import {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from "node:crypto";

import { readNodeArtifactSnapshot } from "./git-artifact-provider.mjs";

const MAX_CONTEXT_CHARACTERS = 12000;
const MAX_TASK_CHARACTERS = 4200;
const MAX_BRIEF_SECTION_CHARACTERS = 1800;

function clip(value, maximum) {
    const text = String(value || "").trim();
    if (text.length <= maximum) {
        return { text, truncated: false };
    }
    return {
        text: `${text.slice(0, maximum - 20).trimEnd()}\n\n[truncated]`,
        truncated: true,
    };
}

function markdownSection(markdown, heading) {
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingMatch = new RegExp(
        `^## ${escapedHeading}[\\t ]*$`,
        "im",
    ).exec(normalized);
    if (!headingMatch) {
        return "";
    }
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const remaining = normalized.slice(sectionStart).replace(/^\n/, "");
    const nextHeading = /^## [^\n]+$/m.exec(remaining);
    return remaining.slice(0, nextHeading?.index ?? remaining.length).trim();
}

function tokenHash(token) {
    return createHash("sha256").update(token).digest("hex");
}

function hashesEqual(left, right) {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    return leftBuffer.length === rightBuffer.length
        && timingSafeEqual(leftBuffer, rightBuffer);
}

function buildContextBundle(snapshot, provenance) {
    const nodeById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
    const upstream = snapshot.node.dependsOn.map((id) => nodeById.get(id));
    const downstream = snapshot.graph.nodes.filter((node) =>
        node.dependsOn.includes(snapshot.node.id)
    );
    const task = clip(snapshot.task, MAX_TASK_CHARACTERS);
    const currentState = clip(
        markdownSection(snapshot.brief, "Current State"),
        MAX_BRIEF_SECTION_CHARACTERS,
    );
    const boundaries = clip(
        markdownSection(snapshot.brief, "Boundaries"),
        MAX_BRIEF_SECTION_CHARACTERS,
    );
    const sourceManifest = {
        graph: {
            path: snapshot.graphPath,
            revision: snapshot.commit,
            sha256: snapshot.hashes.graph,
        },
        brief: {
            path: snapshot.briefPath,
            revision: snapshot.commit,
            sha256: snapshot.hashes.brief,
        },
        task: {
            path: snapshot.taskPath,
            revision: snapshot.commit,
            sha256: snapshot.hashes.task,
        },
    };
    const artifactDigest = createHash("sha256")
        .update(JSON.stringify(sourceManifest))
        .digest("hex");
    const layers = [
        {
            id: 0,
            title: "Project design context",
            content: {
                workstream: snapshot.graph.title,
                purpose: snapshot.graph.summary,
                repositories: snapshot.graph.repos,
                designReferences: (snapshot.graph.designRefs || []).slice(0, 8),
                boundaries: boundaries.text,
            },
        },
        {
            id: 1,
            title: "Worker mission",
            content: {
                node: {
                    id: snapshot.node.id,
                    type: snapshot.node.type,
                    title: snapshot.node.title,
                    summary: snapshot.node.summary,
                    durableStatus: snapshot.node.status,
                },
                task: task.text,
            },
        },
        {
            id: 2,
            title: "Relevant state",
            content: {
                workstreamStatus: snapshot.graph.status,
                currentState: currentState.text,
                upstream: upstream.map((node) => ({
                    id: node.id,
                    title: node.title,
                    status: node.status,
                })),
            },
        },
        {
            id: 3,
            title: "Coordination context",
            content: {
                downstream: downstream.map((node) => ({
                    id: node.id,
                    type: node.type,
                    title: node.title,
                    status: node.status,
                })),
                launchProvenance: provenance,
                completionProtocol: [
                    "Work only in the App-created child worktree.",
                    "Do not create another worktree, terminal, or Streamliner session.",
                    "Record completion with streamliner_spike_complete_launch.",
                    "Report to the creator with the native send_session_message tool.",
                ],
            },
        },
    ];
    const markdown = layers.map((layer) => (
        `## Layer ${layer.id} - ${layer.title}\n\n`
        + `${JSON.stringify(layer.content, null, 2)}`
    )).join("\n\n");
    if (markdown.length > MAX_CONTEXT_CHARACTERS) {
        throw new Error(
            `Prepared context exceeded its ${MAX_CONTEXT_CHARACTERS}-character budget.`,
        );
    }
    return {
        schemaVersion: 1,
        contextId: `ctx-${randomUUID()}`,
        artifact: {
            repositoryKey: snapshot.repositoryKey,
            requestedRevision: snapshot.requestedRevision,
            revision: snapshot.commit,
            workstreamPath: snapshot.workstreamPath,
            workstreamId: snapshot.graph.id,
            nodeId: snapshot.node.id,
            digest: artifactDigest,
        },
        sourceManifest,
        budget: {
            maxCharacters: MAX_CONTEXT_CHARACTERS,
            actualCharacters: markdown.length,
            truncatedSources: [
                ...(task.truncated ? [snapshot.taskPath] : []),
                ...(currentState.truncated ? [`${snapshot.briefPath}#current-state`] : []),
                ...(boundaries.truncated ? [`${snapshot.briefPath}#boundaries`] : []),
            ],
        },
        layers,
        markdown,
    };
}

function validateLaunchable(snapshot) {
    if (snapshot.node.type === "gate") {
        throw new Error(`Gate ${snapshot.node.id} requires builder evaluation, not a worker launch.`);
    }
    if (snapshot.node.status !== "ready") {
        throw new Error(
            `Node ${snapshot.node.id} is ${snapshot.node.status}; this spike launches only ready nodes.`,
        );
    }
    const nodeById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
    const incomplete = snapshot.node.dependsOn.filter((id) => {
        const status = nodeById.get(id)?.status;
        return status !== "completed" && status !== "retired";
    });
    if (incomplete.length > 0) {
        throw new Error(
            `Node ${snapshot.node.id} has incomplete dependencies: ${incomplete.join(", ")}.`,
        );
    }
}

export function prepareLaunch({
    repoPath,
    revision,
    workstreamPath,
    nodeId,
    preparedBySessionId,
    store,
}) {
    const snapshot = readNodeArtifactSnapshot({
        repoPath,
        revision,
        workstreamPath,
        nodeId,
    });
    validateLaunchable(snapshot);
    const preparedAt = new Date().toISOString();
    const launchId = `launch-${randomUUID()}`;
    const bindingToken = randomBytes(32).toString("base64url");
    const provenance = {
        launchId,
        preparedAt,
        preparedBySessionId,
        requestedRevision: revision,
        artifactRevision: snapshot.commit,
        provider: "git-exact-revision-v1",
        sessionOwner: "copilot-app",
    };
    const contextBundle = buildContextBundle(snapshot, provenance);
    const record = {
        schemaVersion: 1,
        launchId,
        repositoryKey: snapshot.repositoryKey,
        repositoryRoot: snapshot.root,
        workstreamId: snapshot.graph.id,
        workstreamPath: snapshot.workstreamPath,
        nodeId,
        requestedRevision: revision,
        artifactRevision: snapshot.commit,
        artifactDigest: contextBundle.artifact.digest,
        status: "prepared",
        preparedAt,
        preparedBySessionId,
        bindingTokenHash: tokenHash(bindingToken),
        claimedAt: null,
        claimedBySessionId: null,
        completedAt: null,
        completionSummary: null,
        completionEvidence: null,
        contextBundle,
    };
    store.mutate((state) => {
        state.launches.push(record);
    });
    return {
        schemaVersion: 1,
        launchId,
        bindingToken,
        artifactRevision: snapshot.commit,
        artifactDigest: contextBundle.artifact.digest,
        workstreamId: snapshot.graph.id,
        nodeId,
        contextBudget: contextBundle.budget,
        stateFile: store.stateFile,
        appNativeNextStep: {
            owner: "copilot-app",
            operation: "create_session",
            instruction: "Create a local child worktree session and require its first action to claim this binding token.",
            claimTool: "streamliner_spike_claim_launch",
        },
    };
}

export function claimPreparedLaunch({
    bindingToken,
    claimingSessionId,
    store,
}) {
    const candidateHash = tokenHash(bindingToken);
    return store.mutate((state) => {
        const launch = state.launches.find((record) =>
            hashesEqual(record.bindingTokenHash, candidateHash)
        );
        if (!launch) {
            throw new Error("Binding token is invalid.");
        }
        let reclaimed = false;
        if (launch.status === "prepared") {
            launch.status = "claimed";
            launch.claimedAt = new Date().toISOString();
            launch.claimedBySessionId = claimingSessionId;
        } else if (
            ["claimed", "completed"].includes(launch.status)
            && launch.claimedBySessionId === claimingSessionId
        ) {
            reclaimed = true;
        } else {
            throw new Error("Binding token was already claimed by another session.");
        }
        return {
            schemaVersion: 1,
            launchId: launch.launchId,
            status: launch.status,
            reclaimed,
            claimedBySessionId: launch.claimedBySessionId,
            artifactRevision: launch.artifactRevision,
            artifactDigest: launch.artifactDigest,
            context: launch.contextBundle,
        };
    });
}

export function completeClaimedLaunch({
    launchId,
    summary,
    evidence,
    completingSessionId,
    store,
}) {
    return store.mutate((state) => {
        const launch = state.launches.find((record) => record.launchId === launchId);
        if (!launch) {
            throw new Error(`Launch ${launchId} does not exist.`);
        }
        if (launch.claimedBySessionId !== completingSessionId) {
            throw new Error(`Launch ${launchId} is not claimed by this session.`);
        }
        if (!["claimed", "completed"].includes(launch.status)) {
            throw new Error(`Launch ${launchId} cannot complete from ${launch.status}.`);
        }
        launch.status = "completed";
        launch.completedAt = launch.completedAt || new Date().toISOString();
        launch.completionSummary = summary;
        launch.completionEvidence = evidence;
        return {
            schemaVersion: 1,
            launchId,
            status: launch.status,
            artifactRevision: launch.artifactRevision,
            completedAt: launch.completedAt,
            summary: launch.completionSummary,
            evidence: launch.completionEvidence,
        };
    });
}
