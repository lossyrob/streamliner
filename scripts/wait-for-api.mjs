#!/usr/bin/env node

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

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Streamliner API at ${healthUrl}. Last error: ${lastError}`,
  );
}

waitForApi().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
