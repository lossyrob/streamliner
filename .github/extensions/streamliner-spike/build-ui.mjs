import react from "@vitejs/plugin-react";
import { build } from "vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    PORTFOLIO_CANVAS_ASSETS,
    WORKSTREAM_CANVAS_ASSETS,
} from "./lib/ui-assets.mjs";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const targets = [
    { source: "ui", assets: WORKSTREAM_CANVAS_ASSETS },
    { source: "portfolio-ui", assets: PORTFOLIO_CANVAS_ASSETS },
];

for (const target of targets) {
    const uiRoot = resolve(extensionRoot, target.source);
    await build({
        configFile: false,
        root: uiRoot,
        base: target.assets.route,
        publicDir: false,
        plugins: [react()],
        build: {
            outDir: target.assets.root,
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
    normalizeGeneratedText(target.assets.root);
    process.stdout.write(
        `Built ${target.assets.version} Canvas assets at ${target.assets.root}\n`,
    );
}

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
