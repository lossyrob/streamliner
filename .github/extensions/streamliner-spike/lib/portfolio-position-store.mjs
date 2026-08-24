import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import {
    readJsonIfExists,
    withFileLock,
    writeJsonAtomic,
} from "./locked-json-file.mjs";
import {
    assertPortfolioPositionsSchema,
    PORTFOLIO_POSITIONS_SCHEMA_VERSION,
} from "./compatibility.mjs";

export { PORTFOLIO_POSITIONS_SCHEMA_VERSION };
const ID_SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const POSITION_ID_PATTERN = new RegExp(
    `^(?:ws:${ID_SEGMENT}|wave:${ID_SEGMENT}:${ID_SEGMENT})$`,
);
const DOMAIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY_KEY_PATTERN = /^[0-9a-f]{20}$/;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_RECENT_MUTATIONS = 128;

function defaultPositionsRoot() {
    const copilotHome = process.env.COPILOT_HOME?.trim() || join(homedir(), ".copilot");
    return join(
        copilotHome,
        "extensions",
        "streamliner-spike",
        "artifacts",
        "portfolio-positions",
    );
}

function assertDomain(domain) {
    if (
        !REPOSITORY_KEY_PATTERN.test(domain?.repositoryKey)
        || !isPortfolioDomainId(domain?.projectId)
        || !isPortfolioDomainId(domain?.portfolioId)
    ) {
        throw new Error("Portfolio position domain is invalid.");
    }
}

export function isPortfolioDomainId(value) {
    return typeof value === "string" && DOMAIN_ID_PATTERN.test(value);
}

export function portfolioPositionDomain(projection) {
    const domain = {
        repositoryKey: projection?.artifact?.repositoryKey,
        projectId: projection?.portfolio?.project?.id,
        portfolioId: projection?.portfolio?.id,
    };
    assertDomain(domain);
    return domain;
}

export function portfolioPositionDomainKey(domain) {
    assertDomain(domain);
    return createHash("sha256")
        .update(`${domain.repositoryKey}:${domain.projectId}:${domain.portfolioId}`)
        .digest("hex")
        .slice(0, 24);
}

export function isPortfolioPositionId(id) {
    return typeof id === "string" && POSITION_ID_PATTERN.test(id);
}

function cleanPosition(id, value, now) {
    if (!isPortfolioPositionId(id)) {
        throw new Error(`Invalid portfolio position id: ${id}`);
    }
    if (
        !value
        || typeof value !== "object"
        || typeof value.x !== "number"
        || typeof value.y !== "number"
        || !Number.isFinite(value.x)
        || !Number.isFinite(value.y)
    ) {
        throw new Error(`Position ${id} must contain finite x and y coordinates.`);
    }
    return {
        x: value.x,
        y: value.y,
        manuallyMoved: true,
        updatedAt: typeof value.updatedAt === "string"
            && !Number.isNaN(Date.parse(value.updatedAt))
            ? value.updatedAt
            : now,
    };
}

function emptyDocument(domain) {
    return {
        schemaVersion: PORTFOLIO_POSITIONS_SCHEMA_VERSION,
        domain,
        revision: 0,
        generation: 0,
        updatedAt: null,
        positions: {},
        recentMutations: [],
    };
}

export class PortfolioPositionStore {
    constructor(options = {}) {
        this.positionsRoot = options.positionsRoot || defaultPositionsRoot();
        this.now = options.now || (() => new Date());
        this.lockTimeoutMilliseconds = options.lockTimeoutMilliseconds ?? 5000;
    }

    pathFor(domain) {
        assertDomain(domain);
        return join(
            this.positionsRoot,
            domain.repositoryKey,
            `${domain.projectId}--${domain.portfolioId}--${portfolioPositionDomainKey(domain)}.json`,
        );
    }

    read(domain) {
        const file = this.pathFor(domain);
        const document = readJsonIfExists(file, emptyDocument(domain));
        assertPortfolioPositionsSchema(document?.schemaVersion, file);
        if (
            document.domain?.repositoryKey !== domain.repositoryKey
            || document.domain?.projectId !== domain.projectId
            || document.domain?.portfolioId !== domain.portfolioId
            || !document.positions
            || typeof document.positions !== "object"
            || Array.isArray(document.positions)
        ) {
            throw new Error(`Unsupported portfolio positions document in ${file}.`);
        }
        const now = this.now().toISOString();
        const positions = {};
        for (const [id, value] of Object.entries(document.positions)) {
            positions[id] = cleanPosition(id, value, now);
        }
        const recentMutations = Array.isArray(document.recentMutations)
            ? document.recentMutations
                .filter((id) => typeof id === "string" && MUTATION_ID_PATTERN.test(id))
                .slice(-MAX_RECENT_MUTATIONS)
            : [];
        return {
            path: file,
            document: {
                schemaVersion: PORTFOLIO_POSITIONS_SCHEMA_VERSION,
                domain,
                revision: Number.isSafeInteger(document.revision)
                    && document.revision >= 0
                    ? document.revision
                    : 0,
                generation: Number.isSafeInteger(document.generation)
                    && document.generation >= 0
                    ? document.generation
                    : 0,
                updatedAt: document.updatedAt || null,
                positions,
                recentMutations,
            },
        };
    }

    patch(domain, patch) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
            throw new Error("Position patch must be an object.");
        }
        const upsert = patch.upsert === undefined ? {} : patch.upsert;
        const remove = patch.remove === undefined ? [] : patch.remove;
        const generation = patch.generation;
        const baseRevision = patch.baseRevision;
        const mutationId = patch.mutationId;
        if (
            !upsert
            || typeof upsert !== "object"
            || Array.isArray(upsert)
            || !Array.isArray(remove)
            || !Number.isSafeInteger(generation)
            || generation < 0
            || !Number.isSafeInteger(baseRevision)
            || baseRevision < 0
            || typeof mutationId !== "string"
            || !MUTATION_ID_PATTERN.test(mutationId)
        ) {
            throw new Error(
                "Position patch must include mutationId, non-negative generation/baseRevision, and { upsert?: object, remove?: string[] }.",
            );
        }
        const now = this.now().toISOString();
        const cleanedUpserts = {};
        for (const [id, value] of Object.entries(upsert)) {
            cleanedUpserts[id] = cleanPosition(id, value, now);
        }
        const removals = new Set();
        for (const id of remove) {
            if (!isPortfolioPositionId(id)) {
                throw new Error(`Invalid portfolio position id: ${id}`);
            }
            removals.add(id);
        }
        const file = this.pathFor(domain);
        return withFileLock(
            `${file}.lock`,
            () => {
                const current = this.read(domain).document;
                if (generation !== current.generation) {
                    const error = new Error(
                        `Position generation ${generation} is stale; current generation is ${current.generation}.`,
                    );
                    error.statusCode = 409;
                    error.details = {
                        path: file,
                        conflict: "generation",
                        revision: current.revision,
                        generation: current.generation,
                        updatedAt: current.updatedAt,
                        positions: current.positions,
                    };
                    throw error;
                }
                if (current.recentMutations.includes(mutationId)) {
                    return {
                        ok: true,
                        path: file,
                        document: current,
                        count: Object.keys(current.positions).length,
                        upserts: 0,
                        removes: 0,
                        mutationId,
                        duplicate: true,
                        savedAt: current.updatedAt,
                    };
                }
                if (baseRevision !== current.revision) {
                    const error = new Error(
                        `Position revision ${baseRevision} is stale; current revision is ${current.revision}.`,
                    );
                    error.statusCode = 409;
                    error.details = {
                        path: file,
                        conflict: "revision",
                        revision: current.revision,
                        generation: current.generation,
                        updatedAt: current.updatedAt,
                        positions: current.positions,
                    };
                    throw error;
                }
                const positions = { ...current.positions };
                for (const id of removals) delete positions[id];
                Object.assign(positions, cleanedUpserts);
                const document = {
                    schemaVersion: PORTFOLIO_POSITIONS_SCHEMA_VERSION,
                    domain,
                    revision: current.revision + 1,
                    generation: current.generation,
                    updatedAt: now,
                    positions,
                    recentMutations: [
                        ...current.recentMutations,
                        mutationId,
                    ].slice(-MAX_RECENT_MUTATIONS),
                };
                writeJsonAtomic(file, document);
                return {
                    ok: true,
                    path: file,
                    document,
                    count: Object.keys(positions).length,
                    upserts: Object.keys(cleanedUpserts).length,
                    removes: removals.size,
                    mutationId,
                    duplicate: false,
                    savedAt: now,
                };
            },
            this.lockTimeoutMilliseconds,
        );
    }

    reset(domain) {
        const file = this.pathFor(domain);
        return withFileLock(
            `${file}.lock`,
            () => {
                const current = this.read(domain).document;
                const now = this.now().toISOString();
                const document = {
                    schemaVersion: PORTFOLIO_POSITIONS_SCHEMA_VERSION,
                    domain,
                    revision: current.revision + 1,
                    generation: current.generation + 1,
                    updatedAt: now,
                    positions: {},
                    recentMutations: [],
                };
                writeJsonAtomic(file, document);
                return {
                    ok: true,
                    path: file,
                    document,
                    count: 0,
                    upserts: 0,
                    removes: Object.keys(current.positions).length,
                    reset: true,
                    savedAt: now,
                };
            },
            this.lockTimeoutMilliseconds,
        );
    }
}
