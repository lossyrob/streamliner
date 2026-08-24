import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    assertCanvasAssetVersion,
    COMPATIBILITY_MANIFEST,
} from "./compatibility.mjs";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assetDefinition(canvasId) {
    const version = COMPATIBILITY_MANIFEST.canvasAssets[canvasId];
    assertCanvasAssetVersion(canvasId, version);
    return {
        canvasId,
        version,
        route: `/ui/${version}/`,
        root: resolve(extensionRoot, "assets", version),
    };
}

export const WORKSTREAM_CANVAS_ASSETS = assetDefinition(
    "streamliner-spike-workstream",
);
export const PORTFOLIO_CANVAS_ASSETS = assetDefinition(
    "streamliner-spike-portfolio",
);
export const CANVAS_ASSET_VERSION = WORKSTREAM_CANVAS_ASSETS.version;
export const CANVAS_ASSET_ROUTE = WORKSTREAM_CANVAS_ASSETS.route;
export const CANVAS_ASSET_ROOT = WORKSTREAM_CANVAS_ASSETS.root;

export function assertCanvasAssetsAvailable(assets = WORKSTREAM_CANVAS_ASSETS) {
    assertCanvasAssetVersion(assets.canvasId, assets.version);
    const indexPath = resolve(assets.root, "index.html");
    const manifestPath = resolve(assets.root, "manifest.json");
    if (!existsSync(indexPath) || !existsSync(manifestPath)) {
        throw new Error(
            `Streamliner spike Canvas assets ${assets.version} are missing. Run npm run build:streamliner-spike.`,
        );
    }
}
