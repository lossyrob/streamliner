import react from "@vitejs/plugin-react";
import { build } from "vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    CANVAS_ASSET_ROOT,
    CANVAS_ASSET_ROUTE,
    CANVAS_ASSET_VERSION,
} from "./lib/ui-assets.mjs";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(extensionRoot, "ui");

await build({
    configFile: false,
    root: uiRoot,
    base: CANVAS_ASSET_ROUTE,
    publicDir: false,
    plugins: [react()],
    build: {
        outDir: CANVAS_ASSET_ROOT,
        emptyOutDir: true,
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
        manifest: "manifest.json",
        assetsInlineLimit: 0,
        rollupOptions: {
            input: resolve(uiRoot, "index.html"),
            output: {
                entryFileNames: "assets/app-[hash].js",
                chunkFileNames: "assets/chunk-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
    },
});

function normalizeGeneratedText(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            normalizeGeneratedText(path);
        } else if (/\.(css|html|js|json)$/.test(entry.name)) {
            const content = readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
            writeFileSync(path, content, "utf8");
        }
    }
}

normalizeGeneratedText(CANVAS_ASSET_ROOT);

process.stdout.write(
    `Built ${CANVAS_ASSET_VERSION} Canvas assets at ${CANVAS_ASSET_ROOT}\n`,
);
