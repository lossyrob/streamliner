import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SessionRegistryManagedLifecycleState,
  SessionRegistryRuntimeMetadata,
  SessionRegistryRuntimeOwner,
} from "../session-registry-schema";
import { SessionRegistryBackgroundWorker } from "./background-worker";
import { SessionRegistryFileStore } from "./file-store";
import {
  MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_INTERRUPTED,
  MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_PRESERVED_TAKEOVER,
  MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON,
  reconcileManagedRuntimeStartupRows,
} from "./managed-runtime-startup-reconciliation";

const createdRoots: string[] = [];
const TEST_TIMESTAMP = "2026-05-10T04:00:00.000Z";

const RECONCILED_ACTIVE_STATES = [
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "pr_ready",
  "review_ready",
  "cleanup_ready",
  "cleaning_up",
] as const satisfies readonly SessionRegistryManagedLifecycleState[];

const PRESERVED_TERMINAL_STATES = [
  "completed",
  "failed",
  "canceled",
  "interrupted",
  "cleaned_up",
] as const satisfies readonly SessionRegistryManagedLifecycleState[];

function createRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function buildRuntime(
  lifecycleState: SessionRegistryManagedLifecycleState,
  runtimeOwner: SessionRegistryRuntimeOwner = "streamliner-sdk",
): SessionRegistryRuntimeMetadata {
  return {
    runtimeKind: "managed-sdk",
    runtimeOwner,
    lifecycleState,
    permissionProfile: "managed-autonomous",
    launchClaimId: `claim-${lifecycleState}`,
    launchNonce: `nonce-${lifecycleState}`,
    sdkSessionId: `sdk-${lifecycleState}`,
    sdkWorkspacePath: "C:\\repo\\.copilot\\sdk",
    sdkStateRoot: "C:\\repo\\.copilot",
    startedAt: "2026-05-10T03:00:00.000Z",
    lastStateChangedAt: "2026-05-10T03:30:00.000Z",
    progressEvents: [],
    evidence: [],
  };
}

function upsertManagedSession(
  store: SessionRegistryFileStore,
  id: string,
  lifecycleState: SessionRegistryManagedLifecycleState,
  runtimeOwner: SessionRegistryRuntimeOwner = "streamliner-sdk",
): void {
  store.upsertSession({
    id,
    title: id,
    description: "",
    cwd: "C:\\repo",
    repo: "lossyrob/streamliner",
    branch: "feature/managed-runtime",
    tags: [],
    origin: { kind: "launched", launchClaimId: `claim-${id}` },
    lifecycleStatus: "active",
    graphBinding: {
      workstreamId: "sdk-managed-worker-runtime",
      nodeId: "managed-runtime-startup-reconciliation",
      launchClaimId: `claim-${id}`,
    },
    runtime: buildRuntime(lifecycleState, runtimeOwner),
  });
}

describe("reconcileManagedRuntimeStartupRows", () => {
  it("marks stale active Streamliner-owned managed SDK rows interrupted with diagnostic data", () => {
    const registryRoot = createRoot("managed-runtime-startup-registry-");
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    for (const state of RECONCILED_ACTIVE_STATES) {
      upsertManagedSession(store, `stale-${state}`, state);
    }

    const result = reconcileManagedRuntimeStartupRows(store, {
      now: () => new Date(TEST_TIMESTAMP),
    });

    expect(result.rowsReconciled).toBe(RECONCILED_ACTIVE_STATES.length);
    expect(result.activeRowsFound).toBe(RECONCILED_ACTIVE_STATES.length);
    for (const state of RECONCILED_ACTIVE_STATES) {
      const record = store.getSession(`stale-${state}`);
      expect(record?.runtime?.lifecycleState).toBe("interrupted");
      expect(record?.runtime?.lastStateChangedAt).toBe(TEST_TIMESTAMP);
      expect(record?.runtime?.progressEvents.at(-1)).toEqual(
        expect.objectContaining({
          type: "lifecycle",
          timestamp: TEST_TIMESTAMP,
          data: expect.objectContaining({
            reason: MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON,
            action: MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_INTERRUPTED,
            previousLifecycleState: state,
            runtimeOwner: "streamliner-sdk",
            launchClaimId: `claim-${state}`,
            launchNonce: `nonce-${state}`,
            sdkSessionIdPresent: true,
            workstreamId: "sdk-managed-worker-runtime",
            nodeId: "managed-runtime-startup-reconciliation",
          }),
        }),
      );
    }
  });

  it("preserves rows with a verifiably live owner", () => {
    const registryRoot = createRoot("managed-runtime-startup-registry-");
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    upsertManagedSession(store, "live-running", "running");
    const isOwnerLive = vi.fn(() => true);

    const result = reconcileManagedRuntimeStartupRows(store, {
      now: () => new Date(TEST_TIMESTAMP),
      isOwnerLive,
    });

    expect(result.rowsReconciled).toBe(0);
    expect(result.rowsSkippedLiveOwner).toBe(1);
    expect(isOwnerLive).toHaveBeenCalledWith(
      expect.objectContaining({ id: "live-running" }),
    );
    expect(store.getSession("live-running")?.runtime?.lifecycleState).toBe("running");
    expect(store.getSession("live-running")?.runtime?.progressEvents).toHaveLength(0);
  });

  it("does not clobber terminal managed states, terminal takeover, or archived rows", () => {
    const registryRoot = createRoot("managed-runtime-startup-registry-");
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    for (const state of PRESERVED_TERMINAL_STATES) {
      upsertManagedSession(store, `terminal-${state}`, state);
    }
    upsertManagedSession(store, "takeover-terminal-owned", "terminal_takeover", "builder-terminal");
    upsertManagedSession(store, "takeover-sdk-owned", "terminal_takeover");
    upsertManagedSession(store, "archived-running", "running");
    store.archiveSession("archived-running");

    const result = reconcileManagedRuntimeStartupRows(store, {
      now: () => new Date(TEST_TIMESTAMP),
    });

    expect(result.rowsReconciled).toBe(0);
    expect(result.rowsSkippedTerminalTakeover).toBe(1);
    expect(result.rowsSkippedTerminalTakeoverSdkOwnedAnomaly).toBe(1);
    for (const state of PRESERVED_TERMINAL_STATES) {
      expect(store.getSession(`terminal-${state}`)?.runtime?.lifecycleState).toBe(state);
    }
    expect(store.getSession("takeover-terminal-owned")?.runtime?.lifecycleState).toBe(
      "terminal_takeover",
    );
    expect(store.getSession("takeover-sdk-owned")?.runtime?.lifecycleState).toBe(
      "terminal_takeover",
    );
    expect(store.getSession("takeover-sdk-owned")?.runtime?.progressEvents.at(-1)).toEqual(
      expect.objectContaining({
        type: "lifecycle",
        timestamp: TEST_TIMESTAMP,
        data: expect.objectContaining({
          reason: MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON,
          action: MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_PRESERVED_TAKEOVER,
          previousLifecycleState: "terminal_takeover",
          runtimeOwner: "streamliner-sdk",
        }),
      }),
    );
    expect(store.getSession("archived-running")?.runtime?.lifecycleState).toBe("running");
  });

  it("isolates per-row patch failures and continues reconciling remaining rows", () => {
    const registryRoot = createRoot("managed-runtime-startup-registry-");
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    upsertManagedSession(store, "failing-running", "running");
    upsertManagedSession(store, "passing-running", "running");
    const originalPatch = store.patchRuntimeMetadata.bind(store);
    vi.spyOn(store, "patchRuntimeMetadata").mockImplementation((id, patch, now) => {
      if (id === "failing-running") {
        throw new Error("simulated write failure");
      }
      return originalPatch(id, patch, now);
    });
    const logger = { warn: vi.fn() };

    const result = reconcileManagedRuntimeStartupRows(store, {
      now: () => new Date(TEST_TIMESTAMP),
      logger,
    });

    expect(result.rowsFailed).toBe(1);
    expect(result.rowsReconciled).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failing-running"),
      expect.any(Error),
    );
    expect(store.getSession("failing-running")?.runtime?.lifecycleState).toBe("running");
    expect(store.getSession("passing-running")?.runtime?.lifecycleState).toBe(
      "interrupted",
    );
  });

  it("runs synchronously once from background worker startup before poll cycles", async () => {
    const registryRoot = createRoot("managed-runtime-startup-registry-");
    const sessionRoot = createRoot("managed-runtime-startup-session-state-");
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    upsertManagedSession(store, "startup-running", "running");
    const worker = new SessionRegistryBackgroundWorker(store, {
      sessionRoot,
      pollIntervalMs: 1_000_000,
      initialDelayMs: 1_000_000,
      now: () => new Date(TEST_TIMESTAMP),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    worker.start();
    await worker.stop();
    expect(store.getSession("startup-running")?.runtime?.lifecycleState).toBe(
      "interrupted",
    );

    upsertManagedSession(store, "post-startup-running", "running");
    await worker.runCycle();
    expect(store.getSession("post-startup-running")?.runtime?.lifecycleState).toBe(
      "running",
    );
  });
});
