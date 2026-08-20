import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANVAS_ASSET_VERSION = "react-flow-v1";
export const CANVAS_ASSET_ROUTE = `/ui/${CANVAS_ASSET_VERSION}/`;
export const CANVAS_ASSET_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    CANVAS_ASSET_VERSION,
);

export function assertCanvasAssetsAvailable() {
    const indexPath = resolve(CANVAS_ASSET_ROOT, "index.html");
    const manifestPath = resolve(CANVAS_ASSET_ROOT, "manifest.json");
    if (!existsSync(indexPath) || !existsSync(manifestPath)) {
        throw new Error(
            "Streamliner spike Canvas assets are missing. Run npm run build:streamliner-spike.",
        );
    }
}
