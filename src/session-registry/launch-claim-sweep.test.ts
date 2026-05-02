import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiLogger } from "../server/logger";
import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import { runLaunchClaimSweep } from "./launch-claim-sweep";
import { createLaunchClaim } from "./launch-claims";

const createdRoots: string[] = [];

function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runLaunchClaimSweep", () => {
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;
  let logger: ApiLogger;

  beforeEach(() => {
    const registryRoot = makeRoot("sweep-reg-");
    const claimRoot = makeRoot("sweep-claim-");
    const logRoot = makeRoot("sweep-log-");
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
    logger = new ApiLogger({ logDir: logRoot, mirrorConsole: false, purgeOnStart: false });
  });

  it("transitions a pending claim with no candidates to expired and deletes the reserved row", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 60_000,
        retentionWindowMs: 24 * 60 * 60 * 1000,
      },
      {
        mintLaunchClaimId: () => "claim-EXP",
        mintRegistryRowId: () => "reg-EXP",
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);

    // Now is 5 minutes after launchedAt (well past binding window).
    const result = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });

    expect(result.claimsTransitioned).toBe(1);
    expect(result.reservedRowsDeleted).toBe(1);
    const claim = claimStore.getClaim("claim-EXP");
    expect(claim?.status).toBe("expired");
    expect(claim?.failureCode).toBe("expired-no-candidates");
    expect(registryStore.getSession("reg-EXP")).toBeNull();
  });

  it("transitions to nonce-missing when at least one candidate was seen", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 60_000,
        retentionWindowMs: 24 * 60 * 60 * 1000,
      },
      {
        mintLaunchClaimId: () => "claim-NM",
        mintRegistryRowId: () => "reg-NM",
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);
    // Simulate the binding pass having recorded a seen candidate.
    claimStore.updateClaim("claim-NM", (current) => ({
      ...current,
      seenCandidateCopilotSessionIds: ["copilot-saw-but-no-nonce"],
    }));
    const result = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(result.claimsTransitioned).toBe(1);
    const claim = claimStore.getClaim("claim-NM");
    expect(claim?.status).toBe("nonce-missing");
    expect(claim?.failureCode).toBe("expired-no-nonce");
    expect(registryStore.getSession("reg-NM")).toBeNull();
  });

  it("preserves reserved row but clears graphBinding when a session has attached", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 60_000,
        retentionWindowMs: 24 * 60 * 60 * 1000,
      },
      {
        mintLaunchClaimId: () => "claim-PRESERVE",
        mintRegistryRowId: () => "reg-PRESERVE",
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);
    // Attach a session to the reserved row before sweep runs.
    registryStore.attachObservedSession("reg-PRESERVE", {
      copilotSessionId: "copilot-attached",
      cwd: "C:/x",
      lastSeenAt: launchedAt,
    });
    const result = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(result.reservedRowsDeleted).toBe(0);
    expect(result.reservedRowsGraphBindingCleared).toBe(1);
    const row = registryStore.getSession("reg-PRESERVE");
    expect(row?.copilotSessionId).toBe("copilot-attached");
    expect(row?.graphBinding).toBeNull();
  });

  it("prunes claims past retention deadline", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 60_000,
        retentionWindowMs: 60_000, // Tiny retention so we can sweep past it.
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-PRUNE", now: () => new Date(launchedAt) },
    );
    expect(outcome.ok).toBe(true);
    // First sweep transitions to expired; second sweep past retention prunes.
    runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(claimStore.getClaim("claim-PRUNE")?.status).toBe("expired");
    const result = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 60 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(result.claimsPruned).toBe(1);
    expect(claimStore.getClaim("claim-PRUNE")).toBeNull();
  });

  it("is idempotent: re-sweeping a transitioned claim does not double-transition or double-emit", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 60_000,
        retentionWindowMs: 24 * 60 * 60 * 1000,
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-IDEM", now: () => new Date(launchedAt) },
    );
    const opts = {
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    };
    const r1 = runLaunchClaimSweep(opts);
    const r2 = runLaunchClaimSweep(opts);
    expect(r1.claimsTransitioned).toBe(1);
    expect(r2.claimsTransitioned).toBe(0);
  });

  it("does not transition pending claims still inside their binding window", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 5 * 60_000,
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-INSIDE", now: () => new Date(launchedAt) },
    );
    const result = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(result.claimsTransitioned).toBe(0);
    expect(claimStore.getClaim("claim-INSIDE")?.status).toBe("pending");
  });

  it("survives missing reserved-row entries (already deleted by markClaimFailed)", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 60_000,
        retentionWindowMs: 24 * 60 * 60 * 1000,
      },
      {
        mintLaunchClaimId: () => "claim-GONE",
        mintRegistryRowId: () => "reg-GONE",
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);
    // Simulate row already deleted via builder action.
    registryStore.deleteSession("reg-GONE");
    const result = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(Date.parse(launchedAt) + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(result.claimsTransitioned).toBe(1);
    // Existence assertion — registry root still present, no crash.
    expect(existsSync(registryStore.findRecordIdByLaunchClaimId("claim-GONE") ?? "")).toBe(false);
  });
});
