#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadDotEnvFile } from "./load-env.mjs";

loadDotEnvFile();

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "4319";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 1_000;

function parsePositiveInteger(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}.`);
  }
  return parsed;
}

function formatHostForUrl(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function checkApiLockDiagnostic() {
  const root = resolve(
    process.env.STREAMLINER_SESSION_REGISTRY_ROOT ??
      join(homedir(), ".streamliner", "state", "session-registry"),
  );
  const lockPath = join(root, "api.lock");
  try {
    const raw = readFileSync(lockPath, "utf8");
    const meta = JSON.parse(raw);
    const pid = meta.pid;
    let isAlive = false;
    if (typeof pid === "number") {
      try {
        process.kill(pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }
    }
    return (
      `\n[Diagnostic] Found api.lock at ${lockPath}:\n` +
      `  Held by PID: ${pid} (${isAlive ? "process is alive" : "process is dead/stale"})\n` +
      `  Acquired at: ${meta.acquiredAt ?? "unknown"}\n` +
      `  Run "npm run api:unlock" to inspect and clear stale lock files.`
    );
  } catch {
    return "";
  }
}

async function waitForApi() {
  const host = process.env.STREAMLINER_API_HOST ?? DEFAULT_API_HOST;
  const port = process.env.STREAMLINER_API_PORT ?? DEFAULT_API_PORT;
  const timeoutMs = parsePositiveInteger(
    "STREAMLINER_API_WAIT_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
  );
  const pollMs = parsePositiveInteger(
    "STREAMLINER_API_WAIT_POLL_MS",
    DEFAULT_POLL_MS,
  );
  const requestTimeoutMs = parsePositiveInteger(
    "STREAMLINER_API_WAIT_REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const healthUrl = `http://${formatHostForUrl(host)}:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  let lastError = "API did not respond.";

  process.stdout.write(`Waiting for Streamliner API at ${healthUrl}...\n`);

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(healthUrl, requestTimeoutMs);
      if (response.ok) {
        process.stdout.write(`Streamliner API ready at ${healthUrl}\n`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }

  const lockDiag = checkApiLockDiagnostic();
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Streamliner API at ${healthUrl}. Last error: ${lastError}${lockDiag}`,
  );
}

waitForApi().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
