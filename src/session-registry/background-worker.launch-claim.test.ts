import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiLogger } from "../server/logger";
import { SessionRegistryBackgroundWorker } from "./background-worker";
import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import { __resetCopilotDiscoveryCacheForTests } from "./copilot-session-discovery";

const createdRoots: string[] = [];

function createRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(dir);
  return dir;
}

afterEach(() => {
  __resetCopilotDiscoveryCacheForTests();
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SessionRegistryBackgroundWorker — launch-claim startup recovery", () => {
  let registryRoot: string;
  let claimRoot: string;
  let sessionStateRoot: string;
  let logRoot: string;
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;
  let logger: ApiLogger;

  beforeEach(() => {
    registryRoot = createRoot("registry-startup-");
    claimRoot = createRoot("claim-startup-");
    sessionStateRoot = createRoot("session-state-startup-");
    logRoot = createRoot("logs-startup-");
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
    logger = new ApiLogger({ logDir: logRoot, mirrorConsole: false, purgeOnStart: false });
  });

  it("runs reconcileOrphanReservedRows synchronously before the first poll cycle", async () => {
    // Create an orphan launched row (no matching claim).
    registryStore.upsertSession({
      id: "orphan-startup",
      title: "orphan",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "missing-claim" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "n",
        launchClaimId: "missing-claim",
      },
    });
    expect(registryStore.getSession("orphan-startup")).not.toBeNull();

    const worker = new SessionRegistryBackgroundWorker(registryStore, {
      sessionRoot: sessionStateRoot,
      pollIntervalMs: 1_000_000,
      initialDelayMs: 1_000_000,
      claimStore,
      claimLogger: logger,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    worker.start();
    // Reconciliation runs synchronously inside start(). Stop the timers
    // immediately so the test does not hang.
    await worker.stop();
    expect(registryStore.getSession("orphan-startup")).toBeNull();
  });

  it("preserves orphan managed SDK rows after startup reconciliation marks them interrupted", async () => {
    registryStore.upsertSession({
      id: "orphan-managed-startup",
      title: "managed orphan",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "missing-managed-claim" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "managed-node",
        launchClaimId: "missing-managed-claim",
      },
      runtime: {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        permissionProfile: "managed-autonomous",
        launchClaimId: "missing-managed-claim",
        launchNonce: "managed-nonce",
        sdkSessionId: "sdk-session",
        sdkWorkspacePath: "C:/x/.copilot/sdk",
        sdkStateRoot: "C:/x/.copilot",
        startedAt: "2026-05-02T01:00:00.000Z",
        lastStateChangedAt: "2026-05-02T01:00:00.000Z",
        progressEvents: [],
        evidence: [],
      },
    });

    const worker = new SessionRegistryBackgroundWorker(registryStore, {
      sessionRoot: sessionStateRoot,
      pollIntervalMs: 1_000_000,
      initialDelayMs: 1_000_000,
      claimStore,
      claimLogger: logger,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      now: () => new Date("2026-05-10T04:00:00.000Z"),
    });
    worker.start();
    await worker.stop();

    const row = registryStore.getSession("orphan-managed-startup");
    expect(row).not.toBeNull();
    expect(row?.runtime?.lifecycleState).toBe("interrupted");
    expect(row?.graphBinding).toBeNull();
  });

  it("does not run startup reconciliation when claimStore is omitted", async () => {
    registryStore.upsertSession({
      id: "orphan-noclaim",
      title: "orphan",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "missing" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "n",
        launchClaimId: "missing",
      },
    });
    const worker = new SessionRegistryBackgroundWorker(registryStore, {
      sessionRoot: sessionStateRoot,
      pollIntervalMs: 1_000_000,
      initialDelayMs: 1_000_000,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    worker.start();
    await worker.stop();
    expect(registryStore.getSession("orphan-noclaim")).not.toBeNull();
  });

  it("does not re-run startup reconciliation on subsequent runCycle invocations", async () => {
    const worker = new SessionRegistryBackgroundWorker(registryStore, {
      sessionRoot: sessionStateRoot,
      pollIntervalMs: 1_000_000,
      initialDelayMs: 1_000_000,
      claimStore,
      claimLogger: logger,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    worker.start();
    // Create an orphan AFTER startup reconciliation has run.
    registryStore.upsertSession({
      id: "post-startup-orphan",
      title: "later",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "later-missing" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "n",
        launchClaimId: "later-missing",
      },
    });
    // runCycle should NOT run reconciliation again.
    await worker.runCycle();
    expect(registryStore.getSession("post-startup-orphan")).not.toBeNull();
    await worker.stop();
  });
});
