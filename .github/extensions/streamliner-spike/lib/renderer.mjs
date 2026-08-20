import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import {
    assertCanvasAssetsAvailable,
    CANVAS_ASSET_ROOT,
    CANVAS_ASSET_ROUTE,
    CANVAS_ASSET_VERSION,
} from "./ui-assets.mjs";

const CONTENT_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".woff2", "font/woff2"],
]);

function commonHeaders() {
    return {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    };
}

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, {
        ...commonHeaders(),
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(`${JSON.stringify(value)}\n`);
}

function assetPathForRoute(route) {
    if (route === "/") {
        return resolve(CANVAS_ASSET_ROOT, "index.html");
    }
    if (!route.startsWith(CANVAS_ASSET_ROUTE)) {
        return null;
    }
    let assetName;
    try {
        assetName = decodeURIComponent(route.slice(CANVAS_ASSET_ROUTE.length))
            || "index.html";
    } catch {
        return null;
    }
    if (assetName.includes("\0") || assetName.includes("\\")) {
        return null;
    }
    const candidate = resolve(CANVAS_ASSET_ROOT, ...assetName.split("/"));
    const relativePath = relative(CANVAS_ASSET_ROOT, candidate);
    if (
        relativePath.startsWith(`..${sep}`)
        || relativePath === ".."
        || isAbsolute(relativePath)
    ) {
        return null;
    }
    return candidate;
}

function sendAsset(response, assetPath) {
    try {
        if (!statSync(assetPath).isFile()) {
            sendJson(response, 404, { error: "Not found" });
            return;
        }
        const isIndex = assetPath.endsWith(`${sep}index.html`);
        response.writeHead(200, {
            ...commonHeaders(),
            "Cache-Control": isIndex
                ? "no-store"
                : "public, max-age=31536000, immutable",
            "Content-Type": CONTENT_TYPES.get(extname(assetPath))
                || "application/octet-stream",
            ...(isIndex ? {
                "Content-Security-Policy": [
                    "default-src 'self'",
                    "connect-src 'self'",
                    "img-src 'self' data:",
                    "script-src 'self'",
                    "style-src 'self' 'unsafe-inline'",
                    "font-src 'self'",
                ].join("; "),
            } : {}),
        });
        response.end(readFileSync(assetPath));
    } catch (error) {
        if (error.code === "ENOENT") {
            sendJson(response, 404, { error: "Not found" });
            return;
        }
        throw error;
    }
}

export async function createCanvasServer({ getProjection }) {
    assertCanvasAssetsAvailable();
    const eventStreams = new Set();
    const broadcast = (projection) => {
        const payload = `event: projection\ndata: ${JSON.stringify(projection)}\n\n`;
        for (const response of eventStreams) {
            response.write(payload);
        }
    };
    const server = createServer((request, response) => {
        const route = new URL(request.url || "/", "http://127.0.0.1").pathname;
        if (request.method === "GET" && route === "/health") {
            sendJson(response, 200, {
                ok: true,
                binding: "127.0.0.1",
                assetVersion: CANVAS_ASSET_VERSION,
            });
            return;
        }
        if (request.method === "GET" && route === "/events") {
            response.writeHead(200, {
                ...commonHeaders(),
                "Content-Type": "text/event-stream",
                Connection: "keep-alive",
            });
            response.write(": connected\n\n");
            eventStreams.add(response);
            request.on("close", () => eventStreams.delete(response));
            return;
        }
        if (
            (request.method === "GET" && route === "/api/projection")
            || (request.method === "POST" && route === "/api/refresh")
        ) {
            try {
                const projection = getProjection();
                if (request.method === "POST") {
                    broadcast(projection);
                }
                sendJson(response, 200, projection);
            } catch (error) {
                sendJson(response, 500, { error: error.message });
            }
            return;
        }
        if (request.method === "GET") {
            const assetPath = assetPathForRoute(route);
            if (assetPath) {
                sendAsset(response, assetPath);
                return;
            }
        }
        sendJson(response, 404, { error: "Not found" });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Loopback canvas server did not expose a TCP port.");
    }
    return {
        url: `http://127.0.0.1:${address.port}/`,
        broadcast,
        close: () => new Promise((resolve, reject) => {
            for (const response of eventStreams) {
                response.end();
            }
            eventStreams.clear();
            server.close((error) => error ? reject(error) : resolve());
        }),
    };
}
