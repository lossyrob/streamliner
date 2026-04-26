import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  drainTrustedSessionSignalSpool,
  SESSION_REGISTRY_SIGNAL_FAILED_DIR,
  SESSION_REGISTRY_SIGNAL_PENDING_DIR,
  writeTrustedSessionSignalSpoolFile,
} from "./trusted-session-signals";
import { SessionRegistryFileStore } from "./file-store";

const createdRoots: string[] = [];

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

describe("trusted session signal spool", () => {
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
