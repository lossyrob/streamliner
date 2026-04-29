#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const HOOK_EVENT_MAP = new Map([
  ["sessionStart", "session.started"],
  ["sessionEnd", "session.ended"],
  ["userPromptSubmitted", "prompt.submitted"],
]);
const VALID_START_SOURCES = new Set(["new", "resume", "startup"]);
const VALID_END_REASONS = new Set(["complete", "error", "abort", "timeout", "user_exit"]);
const COPILOT_SDK_SESSION_FS_MARKER = "/.streamliner/state/copilot-sdk-session-fs";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = 4319;

function readStdin() {
  return new Promise((resolveStdin, rejectStdin) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolveStdin(raw));
    process.stdin.on("error", rejectStdin);
  });
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function textLength(value) {
  return typeof value === "string" ? value.length : null;
}

function streamlinerStateRoot() {
  return (
    stringValue(process.env.STREAMLINER_STATE_ROOT) ??
    resolve(homedir(), ".streamliner", "state")
  );
}

function signalSpoolRoot() {
  return (
    stringValue(process.env.STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT) ??
    join(streamlinerStateRoot(), "session-signals")
  );
}

async function readApiEndpointFromLockFile() {
  // Lock file location mirrors resolveSessionRegistryRoot() in the API server.
  const lockPath = join(streamlinerStateRoot(), "session-registry", "api.lock");
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const host = stringValue(parsed?.host) ?? DEFAULT_API_HOST;
    const port = Number.isInteger(parsed?.port) && parsed.port > 0 ? parsed.port : DEFAULT_API_PORT;
    return `http://${host}:${port}/api/sessions/signals`;
  } catch {
    return null;
  }
}

async function resolveSignalEndpoint() {
  // Precedence:
  //  1. STREAMLINER_SESSION_SIGNAL_ENDPOINT env var if defined (empty string
  //     means "skip the POST entirely" — useful for tests and spool-only setups).
  //  2. Live API endpoint discovered from api.lock written by the API server.
  //  3. Loopback default (no env vars or lock file required).
  if (process.env.STREAMLINER_SESSION_SIGNAL_ENDPOINT !== undefined) {
    return stringValue(process.env.STREAMLINER_SESSION_SIGNAL_ENDPOINT);
  }
  return (
    (await readApiEndpointFromLockFile()) ??
    `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}/api/sessions/signals`
  );
}

function executionKind() {
  return process.env.MSFT_AGENCY === "true" || stringValue(process.env.AGENCY_SESSION_ID)
    ? "agency"
    : "copilot_cli";
}

function isCopilotSdkSessionFsPath(value) {
  if (!value) {
    return false;
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  const markerIndex = normalized.indexOf(COPILOT_SDK_SESSION_FS_MARKER);
  if (markerIndex < 0) {
    return false;
  }
  const nextCharacter = normalized.charAt(markerIndex + COPILOT_SDK_SESSION_FS_MARKER.length);
  return nextCharacter === "" || nextCharacter === "/";
}

function buildSignal(hookName, payload) {
  const event = HOOK_EVENT_MAP.get(hookName);
  if (!event) {
    return null;
  }

  const sessionId =
    stringValue(payload.sessionId) ??
    stringValue(process.env.AGENCY_SESSION_ID) ??
    stringValue(process.env.COPILOT_AGENT_SESSION_ID);
  const cwd =
    stringValue(payload.cwd) ??
    stringValue(process.env.COPILOT_PROJECT_DIR) ??
    process.cwd();
  if (!sessionId || !cwd) {
    return null;
  }
  if (isCopilotSdkSessionFsPath(cwd)) {
    return null;
  }

  const timestamp = stringValue(payload.timestamp) ?? new Date().toISOString();
  const signal = {
    event,
    source: "copilot-cli-hook",
    sessionId,
    timestamp,
    cwd,
    executionKind: executionKind(),
  };

  const hookSource = stringValue(payload.source);
  if (event === "session.started" && hookSource && VALID_START_SOURCES.has(hookSource)) {
    signal.hookSource = hookSource;
  }
  const endReason = stringValue(payload.reason);
  if (event === "session.ended" && endReason && VALID_END_REASONS.has(endReason)) {
    signal.endReason = endReason;
  }

  const initialPromptLength = textLength(payload.initialPrompt);
  if (event === "session.started" && initialPromptLength !== null) {
    signal.initialPromptLength = initialPromptLength;
  }
  const promptLength = textLength(payload.prompt);
  if (event === "prompt.submitted" && promptLength !== null) {
    signal.promptLength = promptLength;
  }

  return signal;
}

async function postSignal(signal) {
  const endpoint = await resolveSignalEndpoint();
  if (!endpoint || typeof fetch !== "function") {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function spoolSignal(signal) {
  const pendingDir = join(signalSpoolRoot(), "pending");
  await mkdir(pendingDir, { recursive: true });
  const safeSessionId = signal.sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${safeSessionId}-${Math.random()
    .toString(36)
    .slice(2)}.json`;
  const finalPath = join(pendingDir, fileName);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(signal)}\n`, "utf8");
  await rename(tempPath, finalPath);
}

async function writeDebugSnapshot(hookName, payload, signal) {
  if (!stringValue(process.env.STREAMLINER_HOOK_DEBUG)) {
    return;
  }
  try {
    const debugDir = join(signalSpoolRoot(), "debug");
    await mkdir(debugDir, { recursive: true });
    const snapshot = {
      ts: new Date().toISOString(),
      hookName,
      payload,
      signal,
      resolvedEndpoint: await resolveSignalEndpoint(),
      env: {
        COPILOT_AGENT_SESSION_ID: process.env.COPILOT_AGENT_SESSION_ID ?? null,
        AGENCY_SESSION_ID: process.env.AGENCY_SESSION_ID ?? null,
        COPILOT_PROJECT_DIR: process.env.COPILOT_PROJECT_DIR ?? null,
        COPILOT_HOME: process.env.COPILOT_HOME ?? null,
        COPILOT_PLUGIN_ROOT: process.env.COPILOT_PLUGIN_ROOT ?? null,
        STREAMLINER_SESSION_SIGNAL_ENDPOINT:
          process.env.STREAMLINER_SESSION_SIGNAL_ENDPOINT ?? null,
        STREAMLINER_STATE_ROOT: process.env.STREAMLINER_STATE_ROOT ?? null,
        copilotKeys: Object.keys(process.env)
          .filter((key) => /copilot|agent|session/i.test(key))
          .sort(),
      },
      cwd: process.cwd(),
    };
    const fileName = `${snapshot.ts.replace(/[:.]/g, "-")}-${process.pid}-${hookName}.json`;
    await writeFile(join(debugDir, fileName), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch {
    // Never let debug logging fail the hook.
  }
}

async function main() {
  const hookName = process.argv[2];
  const rawInput = await readStdin();
  let payload = {};
  if (rawInput.trim().length > 0) {
    try {
      payload = JSON.parse(rawInput);
    } catch {
      payload = {};
    }
  }

  const signal = buildSignal(hookName, payload);
  await writeDebugSnapshot(hookName, payload, signal);
  if (!signal) {
    return;
  }
  if (await postSignal(signal)) {
    return;
  }
  await spoolSignal(signal);
}

main().catch(() => {
  process.exitCode = 0;
});
