import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";

import {
    claimPreparedLaunch,
    completeClaimedLaunch,
    prepareLaunch,
} from "./lib/orchestration.mjs";
import { buildProjection } from "./lib/projection.mjs";
import { createCanvasServer } from "./lib/renderer.mjs";
import { RuntimeStore } from "./lib/runtime-store.mjs";

const DEFAULT_WORKSTREAM_PATH = ".streamliner/workstreams/app-native-spike";
const store = new RuntimeStore();
const canvasInstances = new Map();

function repoPath(input) {
    return input.repoPath || process.cwd();
}

function workstreamPath(input) {
    return input.workstreamPath || DEFAULT_WORKSTREAM_PATH;
}

function serializeToolResult(value) {
    return JSON.stringify(value, null, 2);
}

function requireCanvasInstance(instanceId) {
    const entry = canvasInstances.get(instanceId);
    if (!entry) {
        throw new CanvasError(
            "streamliner_spike_instance_unavailable",
            `Canvas instance ${instanceId} is not open.`,
        );
    }
    return entry;
}

const canvas = createCanvas({
    id: "streamliner-spike-workstream",
    displayName: "Streamliner App-native spike",
    description: "Read-only exact-revision toy workstream graph with App-session launch bindings.",
    inputSchema: {
        type: "object",
        properties: {
            repoPath: {
                type: "string",
                description: "Path inside the local Git worktree that owns the artifact ref.",
            },
            revision: {
                type: "string",
                minLength: 1,
                description: "Exact commit or local ref containing the workstream artifacts.",
            },
            workstreamPath: {
                type: "string",
                description: "Repository-relative workstream artifact directory.",
            },
        },
        required: ["revision"],
        additionalProperties: false,
    },
    actions: [
        {
            name: "get_projection",
            description: "Read the current graph and runtime binding projection for this canvas.",
            handler: async (ctx) => {
                const entry = requireCanvasInstance(ctx.instanceId);
                return entry.getProjection();
            },
        },
        {
            name: "refresh",
            description: "Re-read the exact artifact revision and shared runtime binding state.",
            handler: async (ctx) => {
                const entry = requireCanvasInstance(ctx.instanceId);
                const projection = entry.getProjection();
                entry.broadcast(projection);
                return projection;
            },
        },
    ],
    open: async (ctx) => {
        let entry = canvasInstances.get(ctx.instanceId);
        if (!entry) {
            const config = {
                repoPath: repoPath(ctx.input),
                revision: ctx.input.revision,
                workstreamPath: workstreamPath(ctx.input),
            };
            const getProjection = () => buildProjection({ ...config, store });
            const server = await createCanvasServer({ getProjection });
            entry = { ...server, config, getProjection };
            canvasInstances.set(ctx.instanceId, entry);
        }
        const projection = entry.getProjection();
        return {
            title: projection.workstream.title,
            status: `${projection.summary.nodeCount} nodes | ${projection.artifact.revision.slice(0, 8)}`,
            url: entry.url,
        };
    },
    onClose: async (ctx) => {
        const entry = canvasInstances.get(ctx.instanceId);
        if (entry) {
            canvasInstances.delete(ctx.instanceId);
            await entry.close();
        }
    },
});

await joinSession({
    tools: [
        {
            name: "streamliner_spike_prepare_launch",
            description: "Prepare an App-native toy-node launch from one exact Git artifact revision and return a one-time binding token.",
            parameters: {
                type: "object",
                properties: {
                    repoPath: {
                        type: "string",
                        description: "Path inside the local source worktree.",
                    },
                    revision: {
                        type: "string",
                        minLength: 1,
                        description: "Exact commit or local artifact ref to resolve once.",
                    },
                    workstreamPath: {
                        type: "string",
                        description: "Repository-relative workstream directory.",
                    },
                    nodeId: {
                        type: "string",
                        minLength: 1,
                        description: "Ready toy node to prepare.",
                    },
                },
                required: ["revision", "nodeId"],
                additionalProperties: false,
            },
            handler: async (args, invocation) => serializeToolResult(prepareLaunch({
                repoPath: repoPath(args),
                revision: args.revision,
                workstreamPath: workstreamPath(args),
                nodeId: args.nodeId,
                preparedBySessionId: invocation.sessionId,
                store,
            })),
        },
        {
            name: "streamliner_spike_claim_launch",
            description: "Claim a prepared Streamliner spike launch inside the current App-created child session.",
            parameters: {
                type: "object",
                properties: {
                    bindingToken: {
                        type: "string",
                        minLength: 20,
                        description: "Capability token returned by streamliner_spike_prepare_launch.",
                    },
                },
                required: ["bindingToken"],
                additionalProperties: false,
            },
            handler: async (args, invocation) => serializeToolResult(claimPreparedLaunch({
                bindingToken: args.bindingToken,
                claimingSessionId: invocation.sessionId,
                store,
            })),
        },
        {
            name: "streamliner_spike_complete_launch",
            description: "Record completion evidence for a launch claimed by the current App session.",
            parameters: {
                type: "object",
                properties: {
                    launchId: {
                        type: "string",
                        minLength: 1,
                    },
                    summary: {
                        type: "string",
                        minLength: 1,
                        maxLength: 2000,
                    },
                    evidence: {
                        type: "string",
                        maxLength: 2000,
                    },
                },
                required: ["launchId", "summary"],
                additionalProperties: false,
            },
            handler: async (args, invocation) => serializeToolResult(completeClaimedLaunch({
                launchId: args.launchId,
                summary: args.summary,
                evidence: args.evidence || null,
                completingSessionId: invocation.sessionId,
                store,
            })),
        },
        {
            name: "streamliner_spike_inspect_projection",
            description: "Inspect a read-only exact-revision toy workstream projection with persistent App-session launch bindings.",
            parameters: {
                type: "object",
                properties: {
                    repoPath: {
                        type: "string",
                        description: "Path inside the local source worktree.",
                    },
                    revision: {
                        type: "string",
                        minLength: 1,
                        description: "Exact commit or local artifact ref.",
                    },
                    workstreamPath: {
                        type: "string",
                        description: "Repository-relative workstream directory.",
                    },
                },
                required: ["revision"],
                additionalProperties: false,
            },
            handler: async (args) => serializeToolResult(buildProjection({
                repoPath: repoPath(args),
                revision: args.revision,
                workstreamPath: workstreamPath(args),
                store,
            })),
        },
    ],
    canvases: [canvas],
});
