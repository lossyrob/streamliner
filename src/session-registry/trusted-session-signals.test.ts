import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  drainTrustedSessionSignalSpool,
  SESSION_REGISTRY_SIGNAL_FAILED_DIR,
  SESSION_REGISTRY_SIGNAL_PENDING_DIR,
  writeTrustedSessionSignalSpoolFile,
} from "./trusted-session-signals";
import { SessionRegistryFileStore } from "./file-store";

const createdRoots: string[] = [];
const signalScriptPath = resolve(
  "copilot-plugin",
  "streamliner",
  "scripts",
  "streamliner-signal.mjs",
);

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-session-signals-"));
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runSignalScript(
  hookName: string,
  payload: Record<string, unknown>,
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [signalScriptPath, hookName], {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`streamliner-signal exited with ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

describe("trusted session signal spool", () => {
  it("spools hook stdin as prompt lengths without persisting raw prompt text", async () => {
    const signalRoot = createRootDir();
    const initialPrompt = "secret kickoff prompt that must not be persisted";

    await runSignalScript(
      "sessionStart",
      {
        sessionId: "hook-spool-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
        source: "new",
        initialPrompt,
      },
      {
        STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT: signalRoot,
        STREAMLINER_SESSION_SIGNAL_ENDPOINT: "",
      },
    );

    const pendingFiles = readdirSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR));
    expect(pendingFiles).toHaveLength(1);
    const rawSignal = readFileSync(
      join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR, pendingFiles[0]),
      "utf8",
    );
    expect(rawSignal).not.toContain(initialPrompt);
    const signal = JSON.parse(rawSignal) as Record<string, unknown>;
    expect(signal).toEqual(
      expect.objectContaining({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "hook-spool-session",
        cwd: "C:\\repo",
        hookSource: "new",
        executionKind: "copilot_cli",
        initialPromptLength: initialPrompt.length,
      }),
    );
    expect(signal).not.toHaveProperty("initialPrompt");
  });

  it("posts hook stdin as prompt lengths without sending raw prompt text", async () => {
    const signalRoot = createRootDir();
    const prompt = "secret follow-up prompt that must not be sent";
    const receivedBodies: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedBodies.push(body);
        res.statusCode = 200;
        res.end("{}");
      });
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });

    try {
      const { port } = server.address() as AddressInfo;
      await runSignalScript(
        "userPromptSubmitted",
        {
          sessionId: "hook-post-session",
          timestamp: "2026-04-24T20:01:00.000Z",
          cwd: "C:\\repo",
          prompt,
        },
        {
          STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT: signalRoot,
          STREAMLINER_SESSION_SIGNAL_ENDPOINT: `http://127.0.0.1:${port}/signals`,
        },
      );
    } finally {
      await closeServer(server);
    }

    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).not.toContain(prompt);
    const signal = JSON.parse(receivedBodies[0]) as Record<string, unknown>;
    expect(signal).toEqual(
      expect.objectContaining({
        event: "prompt.submitted",
        source: "copilot-cli-hook",
        sessionId: "hook-post-session",
        cwd: "C:\\repo",
        executionKind: "copilot_cli",
        promptLength: prompt.length,
      }),
    );
    expect(signal).not.toHaveProperty("prompt");
    expect(existsSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR))).toBe(false);
  });

  it("writes collision-safe complete files for same-session same-timestamp signals", () => {
    const rootDir = createRootDir();
    const now = () => new Date("2026-04-24T20:00:00.000Z");

    const first = writeTrustedSessionSignalSpoolFile(
      {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "same-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
      },
      { rootDir, now },
    );
    const second = writeTrustedSessionSignalSpoolFile(
      {
        event: "prompt.submitted",
        source: "copilot-cli-hook",
        sessionId: "same-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
        promptLength: 42,
      },
      { rootDir, now },
    );

    const pendingFiles = readdirSync(join(rootDir, SESSION_REGISTRY_SIGNAL_PENDING_DIR));
    expect(first).not.toBe(second);
    expect(pendingFiles).toHaveLength(2);
    expect(pendingFiles.every((fileName) => fileName.endsWith(".json"))).toBe(true);
    expect(pendingFiles.some((fileName) => fileName.endsWith(".tmp"))).toBe(false);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
  });

  it("drops Streamliner SDK helper hook signals without failing ingest", () => {
    const signalRoot = createRootDir();
    const registryRoot = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });

    writeTrustedSessionSignalSpoolFile(
      {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "sdk-helper-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\Users\\robemanuele\\.streamliner\\state\\copilot-sdk-session-fs",
        hookSource: "new",
        executionKind: "copilot_cli",
      },
      { rootDir: signalRoot },
    );

    expect(drainTrustedSessionSignalSpool(store, { rootDir: signalRoot })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(readdirSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR))).toEqual([]);
    expect(existsSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_FAILED_DIR))).toBe(false);
    expect(store.listSessions({ includeArchived: true })).toEqual([]);
  });

  it("drains prompt signals even when they arrive before session start", () => {
    const signalRoot = createRootDir();
    const registryRoot = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });

    writeTrustedSessionSignalSpoolFile(
      {
        event: "prompt.submitted",
        source: "copilot-cli-hook",
        sessionId: "prompt-first-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
        executionKind: "agency",
        promptLength: 588,
      },
      { rootDir: signalRoot },
    );

    expect(drainTrustedSessionSignalSpool(store, { rootDir: signalRoot })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(readdirSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR))).toEqual([]);
    expect(existsSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_FAILED_DIR))).toBe(false);
    expect(store.getSession("prompt-first-session")).toEqual(
      expect.objectContaining({
        lifecycleStatus: "active",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: null,
        trustedLastSignalAt: "2026-04-24T20:00:00.000Z",
        trustedExecutionKind: "agency",
        trustedLastPromptLength: 588,
      }),
    );
  });

  it("leaves signals pending when the registry is locked", () => {
    const signalRoot = createRootDir();
    const registryRoot = createRootDir();
    const store = new SessionRegistryFileStore({
      rootDir: registryRoot,
      writeLockWaitTimeoutMs: 0,
    });
    const warnings: string[] = [];

    writeTrustedSessionSignalSpoolFile(
      {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "locked-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
      },
      { rootDir: signalRoot },
    );
    writeFileSync(
      join(registryRoot, "registry.lock"),
      JSON.stringify({ pid: process.pid, acquiredAt: "2026-04-24T20:00:00.000Z" }),
      "utf8",
    );

    expect(
      drainTrustedSessionSignalSpool(store, {
        rootDir: signalRoot,
        logger: { warn: (message) => warnings.push(message) },
      }),
    ).toEqual({ processed: 0, failed: 0 });
    expect(readdirSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR))).toHaveLength(1);
    expect(existsSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_FAILED_DIR))).toBe(false);
    expect(warnings[0]).toContain("registry locked; will retry");

    rmSync(join(registryRoot, "registry.lock"), { force: true });
    expect(drainTrustedSessionSignalSpool(store, { rootDir: signalRoot })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(readdirSync(join(signalRoot, SESSION_REGISTRY_SIGNAL_PENDING_DIR))).toEqual([]);
    expect(store.getSession("locked-session")).toEqual(
      expect.objectContaining({ lifecycleStatus: "active" }),
    );
  });

  it("preserves repo and branch when later drained signals omit them", () => {
    const signalRoot = createRootDir();
    const registryRoot = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });

    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "metadata-session",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\repo",
      repo: "lossyrob/streamliner",
      branch: "feature/manual-session-registry",
      hookSource: "new",
      executionKind: "copilot_cli",
    });

    writeTrustedSessionSignalSpoolFile(
      {
        event: "prompt.submitted",
        source: "copilot-cli-hook",
        sessionId: "metadata-session",
        timestamp: "2026-04-24T20:01:00.000Z",
        cwd: "C:\\repo",
        promptLength: 24,
      },
      { rootDir: signalRoot },
    );

    expect(drainTrustedSessionSignalSpool(store, { rootDir: signalRoot })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(store.getSession("metadata-session")).toEqual(
      expect.objectContaining({
        repo: "lossyrob/streamliner",
        branch: "feature/manual-session-registry",
        trustedLastSignalAt: "2026-04-24T20:01:00.000Z",
        trustedLastPromptLength: 24,
      }),
    );
  });
});
