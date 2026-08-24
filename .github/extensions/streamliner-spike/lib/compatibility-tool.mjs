import { inspectCompatibility } from "./compatibility.mjs";

export const COMPATIBILITY_TOOL_PARAMETERS = {
    type: "object",
    properties: {
        workstreamArtifactSchemaVersion: {
            type: "integer",
            minimum: 0,
            description: "Candidate workstream graph schemaVersion to check.",
        },
        portfolioArtifactSchemaVersion: {
            type: "integer",
            minimum: 0,
            description: "Candidate portfolio manifest schemaVersion to check.",
        },
        runtimeStateSchemaVersion: {
            type: "integer",
            minimum: 0,
            description: "Candidate local runtime-state schemaVersion to check.",
        },
        portfolioPositionsSchemaVersion: {
            type: "integer",
            minimum: 0,
            description: "Candidate portfolio positions schemaVersion to check.",
        },
        workstreamCanvasAssetVersion: {
            type: "string",
            minLength: 1,
            description: "Candidate workstream Canvas asset version to check.",
        },
        portfolioCanvasAssetVersion: {
            type: "string",
            minLength: 1,
            description: "Candidate portfolio Canvas asset version to check.",
        },
    },
    required: [],
    additionalProperties: false,
};

export async function handleCompatibilityInspection(args = {}) {
    return JSON.stringify(inspectCompatibility(args), null, 2);
}

export const COMPATIBILITY_TOOL = {
    name: "streamliner_app_native_spike_inspect_compatibility",
    description: "Inspect the installed App-native Streamliner spike package and optionally check candidate schema or Canvas asset versions.",
    parameters: COMPATIBILITY_TOOL_PARAMETERS,
    handler: handleCompatibilityInspection,
};
