import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, posix, resolve, win32 } from "node:path";

function git(cwd, args, options = {}) {
    try {
        return execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
            ...options,
        });
    } catch (error) {
        const detail = error.stderr?.toString().trim() || error.message;
        throw new Error(`Git ${args[0]} failed: ${detail}`);
    }
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function normalizeRepositoryIdentity(path) {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function normalizeArtifactPath(value, label = "artifact path") {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty repository-relative path.`);
    }
    const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (
        isAbsolute(value)
        || win32.isAbsolute(value)
        || posix.isAbsolute(normalized)
        || normalized.includes(":")
        || normalized.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
        throw new Error(`${label} must stay within the artifact revision.`);
    }
    return normalized;
}

export function resolveRepository(repoPath) {
    const root = git(repoPath, ["rev-parse", "--show-toplevel"]).trim();
    const commonDir = git(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ]).trim();
    const repositoryIdentity = normalizeRepositoryIdentity(commonDir);
    return {
        root,
        repositoryIdentity,
        repositoryKey: sha256(repositoryIdentity).slice(0, 20),
    };
}

export function resolveArtifactRevision(repoPath, revision) {
    if (typeof revision !== "string" || !revision.trim() || revision.startsWith("-")) {
        throw new Error("revision must be a non-empty Git commit or ref.");
    }
    const repository = resolveRepository(repoPath);
    const commit = git(repository.root, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${revision}^{commit}`,
    ]).trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(commit)) {
        throw new Error(`Git resolved ${revision} to an invalid commit id.`);
    }
    return { ...repository, commit, requestedRevision: revision };
}

export function readBlobAtRevision(repoRoot, commit, artifactPath) {
    const normalizedPath = normalizeArtifactPath(artifactPath);
    return git(repoRoot, ["cat-file", "blob", `${commit}:${normalizedPath}`]);
}

function parseGraph(graphText, graphPath) {
    let graph;
    try {
        graph = JSON.parse(graphText);
    } catch (error) {
        throw new Error(`Invalid JSON in ${graphPath}: ${error.message}`);
    }
    if (
        graph?.schemaVersion !== 1
        || typeof graph.id !== "string"
        || typeof graph.title !== "string"
        || !Array.isArray(graph.nodes)
    ) {
        throw new Error(`${graphPath} is not a Streamliner schemaVersion 1 graph.`);
    }
    const ids = new Set();
    for (const node of graph.nodes) {
        if (
            typeof node?.id !== "string"
            || typeof node.title !== "string"
            || !["task", "research", "gate"].includes(node.type)
            || !Array.isArray(node.dependsOn)
        ) {
            throw new Error(`${graphPath} contains an invalid node.`);
        }
        if (ids.has(node.id)) {
            throw new Error(`${graphPath} contains duplicate node ${node.id}.`);
        }
        ids.add(node.id);
    }
    for (const node of graph.nodes) {
        for (const dependencyId of node.dependsOn) {
            if (!ids.has(dependencyId)) {
                throw new Error(`${graphPath} node ${node.id} references missing dependency ${dependencyId}.`);
            }
        }
    }
    return graph;
}

export function readWorkstreamSnapshot({
    repoPath,
    revision,
    workstreamPath,
}) {
    const resolved = resolveArtifactRevision(repoPath, revision);
    const normalizedWorkstreamPath = normalizeArtifactPath(
        workstreamPath,
        "workstreamPath",
    );
    const graphPath = `${normalizedWorkstreamPath}/graph.json`;
    const briefPath = `${normalizedWorkstreamPath}/brief.md`;
    const graphText = readBlobAtRevision(resolved.root, resolved.commit, graphPath);
    const brief = readBlobAtRevision(resolved.root, resolved.commit, briefPath);
    const graph = parseGraph(graphText, graphPath);
    return {
        ...resolved,
        workstreamPath: normalizedWorkstreamPath,
        graphPath,
        briefPath,
        graphText,
        graph,
        brief,
        hashes: {
            graph: sha256(graphText),
            brief: sha256(brief),
        },
    };
}

export function readNodeArtifactSnapshot({
    repoPath,
    revision,
    workstreamPath,
    nodeId,
}) {
    const snapshot = readWorkstreamSnapshot({
        repoPath,
        revision,
        workstreamPath,
    });
    const node = snapshot.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
        throw new Error(`Node ${nodeId} does not exist in ${snapshot.graphPath}.`);
    }
    if (node.tracker?.type !== "local" || typeof node.tracker.path !== "string") {
        throw new Error(`Node ${nodeId} must use a local tracker for this spike.`);
    }
    const trackerPath = normalizeArtifactPath(node.tracker.path, "local tracker path");
    const taskPath = normalizeArtifactPath(
        `${snapshot.workstreamPath}/${trackerPath}`,
        "task path",
    );
    const task = readBlobAtRevision(snapshot.root, snapshot.commit, taskPath);
    return {
        ...snapshot,
        node,
        taskPath,
        task,
        hashes: {
            ...snapshot.hashes,
            task: sha256(task),
        },
    };
}
