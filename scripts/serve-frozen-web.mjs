#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

import { loadDotEnvFile } from "./load-env.mjs";

loadDotEnvFile();

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5173;
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "4319";
const PROXY_RETRY_DELAYS_MS = [150, 500, 1_000];
const DIST_ROOT = resolve(process.cwd(), "dist");
const INDEX_HTML = join(DIST_ROOT, "index.html");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

function parsePort(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function formatHostForUrl(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isProxyPath(pathname) {
  return pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/_proto" ||
    pathname.startsWith("/_proto/");
}

function requestBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolveBody(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function canRetryProxyRequest(method) {
  return method === "GET" || method === "HEAD";
}

async function fetchUpstreamWithRetries(target, init) {
  let lastError;
  const maxAttempts = canRetryProxyRequest(init.method)
    ? PROXY_RETRY_DELAYS_MS.length + 1
    : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fetch(target, init);
    } catch (error) {
      lastError = error;
      const nextDelay = PROXY_RETRY_DELAYS_MS[attempt];
      if (nextDelay === undefined) {
        break;
      }
      console.warn(
        `Frozen proxy upstream request failed for ${target.pathname}${target.search}; retrying in ${nextDelay}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await delay(nextDelay);
    }
  }
  throw lastError;
}

async function proxyRequest(req, res, targetBaseUrl) {
  const target = new URL(req.url ?? "/", targetBaseUrl);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.toLowerCase() === "host") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const body = req.method === "GET" || req.method === "HEAD"
    ? undefined
    : await requestBody(req);
  const upstream = await fetchUpstreamWithRetries(target, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-encoding") {
      res.setHeader(key, value);
    }
  });
  const bytes = Buffer.from(await upstream.arrayBuffer());
  res.end(bytes);
}

async function resolveStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(/^(\.\.(?:[\\/]|$))+/, "");
  const candidate = resolve(DIST_ROOT, normalized.slice(1));
  if (candidate !== DIST_ROOT && !candidate.startsWith(`${DIST_ROOT}${sep}`)) {
    return null;
  }
  if (!existsSync(candidate)) {
    return INDEX_HTML;
  }
  const candidateStat = await stat(candidate);
  if (candidateStat.isDirectory()) {
    return join(candidate, "index.html");
  }
  return candidate;
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const filePath = await resolveStaticPath(url.pathname);
  if (!filePath || !existsSync(filePath)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream");
  createReadStream(filePath)
    .on("error", () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end("Failed to read static asset");
    })
    .pipe(res);
}

async function main() {
  if (!existsSync(INDEX_HTML)) {
    throw new Error(`Missing ${INDEX_HTML}. Run npm run build before starting the frozen web server.`);
  }

  const host = process.env.STREAMLINER_FROZEN_WEB_HOST ?? DEFAULT_HOST;
  const port = parsePort(process.env.STREAMLINER_FROZEN_WEB_PORT, DEFAULT_PORT);
  const apiHost = process.env.STREAMLINER_API_HOST ?? DEFAULT_API_HOST;
  const apiPort = process.env.STREAMLINER_API_PORT ?? DEFAULT_API_PORT;
  const apiTarget = `http://${formatHostForUrl(apiHost)}:${apiPort}`;

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (isProxyPath(url.pathname)) {
        await proxyRequest(req, res, apiTarget);
        return;
      }
      await serveStatic(req, res);
    })().catch((error) => {
      if (!res.headersSent) {
        res.statusCode = 502;
      }
      res.end(error instanceof Error ? error.message : String(error));
    });
  });

  server.listen(port, host, () => {
    console.log(`Frozen Streamliner web ready at http://${formatHostForUrl(host)}:${port}/`);
    console.log(`Proxying /api and /_proto to ${apiTarget}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
