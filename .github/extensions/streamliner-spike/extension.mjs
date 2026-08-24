import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";

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
import { PORTFOLIO_CANVAS_ASSETS } from "./lib/ui-assets.mjs";
import {
    PortfolioPositionStore,
    portfolioPositionDomain,
} from "./lib/portfolio-position-store.mjs";

const DEFAULT_WORKSTREAM_PATH = ".streamliner/workstreams/app-native-spike";
const DEFAULT_PORTFOLIO_PATH = ".streamliner/portfolio.json";
const store = new RuntimeStore();
const positionStore = new PortfolioPositionStore();
const canvasInstances = new Map();

function repoPath(input) {
    return input.repoPath || process.cwd();
}

function workstreamPath(input) {
    return input.workstreamPath || DEFAULT_WORKSTREAM_PATH;
}

function portfolioPath(input) {
    return input.portfolioPath || DEFAULT_PORTFOLIO_PATH;
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

function positionResponse(result) {
    const document = result.document;
    return {
        path: result.path,
        schemaVersion: document.schemaVersion,
        domain: document.domain,
        revision: document.revision,
        generation: document.generation,
        updatedAt: document.updatedAt,
        positions: document.positions,
        pinnedCount: Object.keys(document.positions).filter((id) => id.startsWith("wave:")).length,
        entryCount: Object.keys(document.positions).length,
        ...(result.savedAt ? {
            savedAt: result.savedAt,
            upserts: result.upserts,
            removes: result.removes,
            reset: Boolean(result.reset),
            mutationId: result.mutationId,
            duplicate: Boolean(result.duplicate),
        } : {}),
    };
}

function samePositionDomain(left, right) {
    return left?.repositoryKey === right?.repositoryKey
        && left?.projectId === right?.projectId
        && left?.portfolioId === right?.portfolioId;
}

function broadcastPositionDomain(domain, result) {
    for (const entry of canvasInstances.values()) {
        if (samePositionDomain(entry.positionDomain, domain)) {
            entry.broadcastEvent("positions", result);
        }
    }
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
            getProjection();
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

const portfolioCanvas = createCanvas({
    id: "streamliner-spike-portfolio",
    displayName: "Streamliner portfolio spike",
    description: "Interactive exact-revision portfolio of workstreams, public checkpoints, dependencies, and App bindings.",
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
                description: "Exact commit or local ref containing the portfolio artifacts.",
            },
            portfolioPath: {
                type: "string",
                description: "Repository-relative portfolio manifest path.",
            },
        },
        required: ["revision"],
        additionalProperties: false,
    },
    actions: [
        {
            name: "get_portfolio_projection",
            description: "Read the exact-revision portfolio and current local runtime bindings.",
            handler: async (ctx) => requireCanvasInstance(ctx.instanceId).getProjection(),
        },
        {
            name: "refresh_portfolio",
            description: "Refresh portfolio artifacts and runtime bindings, then notify the open Canvas.",
            handler: async (ctx) => {
                const entry = requireCanvasInstance(ctx.instanceId);
                const projection = entry.getProjection();
                entry.broadcast(projection);
                return projection;
            },
        },
        {
            name: "get_portfolio_positions",
            description: "Read the local durable position overlay for this portfolio.",
            handler: async (ctx) => {
                const entry = requireCanvasInstance(ctx.instanceId);
                return positionResponse(positionStore.read(entry.positionDomain));
            },
        },
        {
            name: "reset_portfolio_positions",
            description: "Remove every local pinned position for this portfolio and restore auto-layout.",
            handler: async (ctx) => {
                const entry = requireCanvasInstance(ctx.instanceId);
                const result = positionResponse(positionStore.reset(entry.positionDomain));
                broadcastPositionDomain(entry.positionDomain, result);
                return result;
            },
        },
    ],
    open: async (ctx) => {
        let entry = canvasInstances.get(ctx.instanceId);
        if (!entry) {
            const config = {
                repoPath: repoPath(ctx.input),
                revision: ctx.input.revision,
                portfolioPath: portfolioPath(ctx.input),
            };
            const getProjection = () => buildPortfolioProjection({ ...config, store });
            const initialProjection = getProjection();
            const positionDomain = portfolioPositionDomain(initialProjection);
            const positionsController = {
                get: () => positionResponse(positionStore.read(positionDomain)),
                patch: (patch) => {
                    const result = positionResponse(
                        positionStore.patch(positionDomain, patch),
                    );
                    broadcastPositionDomain(positionDomain, result);
                    return result;
                },
                reset: () => {
                    const result = positionResponse(positionStore.reset(positionDomain));
                    broadcastPositionDomain(positionDomain, result);
                    return result;
                },
            };
            const server = await createCanvasServer({
                getProjection,
                assets: PORTFOLIO_CANVAS_ASSETS,
                projectionRoute: "/api/portfolio/projection",
                refreshRoute: "/api/portfolio/refresh",
                positionsRoute: "/api/portfolio/positions",
                positionsController,
            });
            entry = {
                ...server,
                config,
                getProjection,
                positionDomain,
                positionsController,
            };
            canvasInstances.set(ctx.instanceId, entry);
        }
        const projection = entry.getProjection();
        return {
            title: projection.portfolio.title,
            status: `${projection.summary.workstreamCount} workstreams | ${projection.artifact.revision.slice(0, 8)}`,
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
            name: "streamliner_spike_initialize_paw",
            description: "Idempotently initialize PAW artifacts in the current App-owned worktree for a launch claimed by this session.",
            parameters: {
                type: "object",
                properties: {
                    launchId: {
                        type: "string",
                        minLength: 1,
                    },
                },
                required: ["launchId"],
                additionalProperties: false,
            },
            handler: async (args, invocation) => serializeToolResult(
                initializeClaimedLaunch({
                    launchId: args.launchId,
                    initializingSessionId: invocation.sessionId,
                    workspacePath: process.cwd(),
                    store,
                }),
            ),
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
        {
            name: "streamliner_spike_inspect_portfolio",
            description: "Inspect an exact-revision portfolio projection with local runtime bindings.",
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
                    portfolioPath: {
                        type: "string",
                        description: "Repository-relative portfolio manifest path.",
                    },
                },
                required: ["revision"],
                additionalProperties: false,
            },
            handler: async (args) => serializeToolResult(buildPortfolioProjection({
                repoPath: repoPath(args),
                revision: args.revision,
                portfolioPath: portfolioPath(args),
                store,
            })),
        },
    ],
    canvases: [canvas, portfolioCanvas],
});
