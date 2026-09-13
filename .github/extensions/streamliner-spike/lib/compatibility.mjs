import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(new URL("../compatibility.json", import.meta.url));
const PACKAGE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function schemaRange(value, name) {
    if (
        !value
        || !Number.isSafeInteger(value.minimum)
        || !Number.isSafeInteger(value.maximum)
        || value.minimum < 1
        || value.maximum < value.minimum
    ) {
        throw new Error(
            `Invalid Streamliner App-native spike compatibility manifest: ${name} must define a positive minimum/maximum range.`,
        );
    }
    return value;
}

function positiveSchemaVersion(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(
            `Invalid Streamliner App-native spike compatibility manifest: ${name} must be a positive integer.`,
        );
    }
    return value;
}

function loadManifest() {
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
        throw new Error(
            `Cannot load Streamliner App-native spike compatibility manifest at ${manifestPath}: ${error.message}`,
        );
    }
    if (
        manifest?.schemaVersion !== 1
        || !PACKAGE_NAME_PATTERN.test(manifest.package?.name || "")
        || !SEMVER_PATTERN.test(manifest.package?.version || "")
        || !manifest.artifactSchemas
        || !manifest.canvasAssets
    ) {
        throw new Error(
            `Invalid Streamliner App-native spike compatibility manifest at ${manifestPath}.`,
        );
    }
    schemaRange(manifest.artifactSchemas.workstream, "artifactSchemas.workstream");
    schemaRange(manifest.artifactSchemas.portfolio, "artifactSchemas.portfolio");
    positiveSchemaVersion(manifest.runtimeStateSchema, "runtimeStateSchema");
    positiveSchemaVersion(
        manifest.portfolioPositionsSchema,
        "portfolioPositionsSchema",
    );
    for (const canvasId of [
        "streamliner-spike-workstream",
        "streamliner-spike-portfolio",
    ]) {
        if (typeof manifest.canvasAssets[canvasId] !== "string"
            || !manifest.canvasAssets[canvasId]) {
            throw new Error(
                `Invalid Streamliner App-native spike compatibility manifest: canvasAssets.${canvasId} is required.`,
            );
        }
    }
    return deepFreeze(manifest);
}

export class StreamlinerCompatibilityError extends Error {
    constructor(message, details) {
        super(message);
        this.name = "StreamlinerCompatibilityError";
        this.code = "streamliner_app_native_spike_incompatible";
        this.details = details;
    }
}

export const COMPATIBILITY_MANIFEST = loadManifest();
export const RUNTIME_STATE_SCHEMA_VERSION =
    COMPATIBILITY_MANIFEST.runtimeStateSchema;
export const PORTFOLIO_POSITIONS_SCHEMA_VERSION =
    COMPATIBILITY_MANIFEST.portfolioPositionsSchema;

function packageIdentity() {
    const { name, version } = COMPATIBILITY_MANIFEST.package;
    return `${name}@${version}`;
}

function actualVersion(value) {
    return Number.isSafeInteger(value) ? String(value) : "missing or invalid";
}

function assertSchemaRange(component, value, range, source) {
    if (
        !Number.isSafeInteger(value)
        || value < range.minimum
        || value > range.maximum
    ) {
        throw new StreamlinerCompatibilityError(
            `Streamliner App-native spike incompatibility: ${component} schemaVersion ${actualVersion(value)} in ${source} is unsupported by ${packageIdentity()}; supported range is ${range.minimum}..${range.maximum}.`,
            {
                component,
                source,
                actual: value ?? null,
                supported: { ...range },
            },
        );
    }
    return value;
}

function assertExactSchema(component, value, expected, source) {
    if (value !== expected) {
        throw new StreamlinerCompatibilityError(
            `Streamliner App-native spike incompatibility: ${component} schemaVersion ${actualVersion(value)} in ${source} is unsupported by ${packageIdentity()}; required version is ${expected}.`,
            {
                component,
                source,
                actual: value ?? null,
                supported: { exact: expected },
            },
        );
    }
    return value;
}

export function assertWorkstreamArtifactSchema(
    value,
    source = "workstream artifact",
) {
    return assertSchemaRange(
        "workstream artifact",
        value,
        COMPATIBILITY_MANIFEST.artifactSchemas.workstream,
        source,
    );
}

export function assertPortfolioArtifactSchema(
    value,
    source = "portfolio artifact",
) {
    return assertSchemaRange(
        "portfolio artifact",
        value,
        COMPATIBILITY_MANIFEST.artifactSchemas.portfolio,
        source,
    );
}

export function assertRuntimeStateSchema(value, source = "runtime state") {
    return assertExactSchema(
        "runtime state",
        value,
        RUNTIME_STATE_SCHEMA_VERSION,
        source,
    );
}

export function assertPortfolioPositionsSchema(
    value,
    source = "portfolio positions",
) {
    return assertExactSchema(
        "portfolio positions",
        value,
        PORTFOLIO_POSITIONS_SCHEMA_VERSION,
        source,
    );
}

export function assertCanvasAssetVersion(canvasId, value) {
    const expected = COMPATIBILITY_MANIFEST.canvasAssets[canvasId];
    if (!expected) {
        throw new StreamlinerCompatibilityError(
            `Streamliner App-native spike incompatibility: Canvas ${canvasId} is not declared by ${packageIdentity()}.`,
            {
                component: "canvas asset",
                source: canvasId,
                actual: value ?? null,
                supported: null,
            },
        );
    }
    if (value !== expected) {
        throw new StreamlinerCompatibilityError(
            `Streamliner App-native spike incompatibility: Canvas ${canvasId} asset version ${value || "missing"} is unsupported by ${packageIdentity()}; required version is ${expected}.`,
            {
                component: "canvas asset",
                source: canvasId,
                actual: value ?? null,
                supported: { exact: expected },
            },
        );
    }
    return value;
}

function compatibilitySnapshot() {
    return JSON.parse(JSON.stringify(COMPATIBILITY_MANIFEST));
}

export function inspectCompatibility(probes = {}) {
    const diagnostics = [];
    const checks = [
        ["workstreamArtifactSchemaVersion", assertWorkstreamArtifactSchema],
        ["portfolioArtifactSchemaVersion", assertPortfolioArtifactSchema],
        ["runtimeStateSchemaVersion", assertRuntimeStateSchema],
        ["portfolioPositionsSchemaVersion", assertPortfolioPositionsSchema],
    ];
    for (const [name, assertion] of checks) {
        if (probes[name] === undefined) continue;
        try {
            assertion(probes[name], `compatibility probe ${name}`);
        } catch (error) {
            if (!(error instanceof StreamlinerCompatibilityError)) throw error;
            diagnostics.push({
                code: error.code,
                message: error.message,
                details: error.details,
            });
        }
    }
    for (const [name, canvasId] of [
        ["workstreamCanvasAssetVersion", "streamliner-spike-workstream"],
        ["portfolioCanvasAssetVersion", "streamliner-spike-portfolio"],
    ]) {
        if (probes[name] === undefined) continue;
        try {
            assertCanvasAssetVersion(canvasId, probes[name]);
        } catch (error) {
            if (!(error instanceof StreamlinerCompatibilityError)) throw error;
            diagnostics.push({
                code: error.code,
                message: error.message,
                details: error.details,
            });
        }
    }
    return {
        schemaVersion: 1,
        compatible: diagnostics.length === 0,
        compatibility: compatibilitySnapshot(),
        diagnostics,
    };
}
