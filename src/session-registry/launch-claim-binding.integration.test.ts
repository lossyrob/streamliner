import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiLogger } from "../server/logger";
import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import { runLaunchClaimBindingPass } from "./launch-claim-binding";
import { runLaunchClaimSweep } from "./launch-claim-sweep";
import { createLaunchClaim, kickoffNonceLine, reconcileOrphanReservedRows } from "./launch-claims";
import {
  type DiscoveredCopilotSession,
} from "./copilot-session-discovery";

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

function writeSessionStateFiles(
  sessionStateRoot: string,
  sessionId: string,
  cwd: string,
  promptText: string,
): void {
  const dir = join(sessionStateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "workspace.yaml"),
    [`id: ${sessionId}`, `cwd: ${cwd}`].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({
      type: "user.message",
      data: { content: promptText },
      timestamp: "2026-05-02T01:30:01.000Z",
    }) + "\n",
    "utf8",
  );
}

function discoveredSession(
  sessionId: string,
  cwd: string,
  branch: string | null = null,
  repo: string | null = null,
): DiscoveredCopilotSession {
  return {
    sessionId,
    title: "discovered",
    description: "",
    cwd,
    repo,
    branch,
    lastSeenAt: "2026-05-02T01:30:00.000Z",
    lifecycleStatus: "active",
    observedSessionKind: "interactive",
    copilotProcessState: "live",
    copilotProcessId: 0,
  };
}

describe("Launch Claim Binding — end-to-end integration", () => {
  let registryRoot: string;
  let claimRoot: string;
  let sessionStateRoot: string;
  let logRoot: string;
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;
  let logger: ApiLogger;

  beforeEach(() => {
    registryRoot = makeRoot("integration-reg-");
    claimRoot = makeRoot("integration-claim-");
    sessionStateRoot = makeRoot("integration-session-state-");
    logRoot = makeRoot("integration-logs-");
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
    logger = new ApiLogger({ logDir: logRoot, mirrorConsole: false, purgeOnStart: false });
  });

  it("createLaunchClaim → discovery → bind → graphBinding visible via list/store; sweep prunes after retention", async () => {
    const cwd = "C:/repo/launch-claim-binding";
    const launchedAt = "2026-05-02T01:30:00.000Z";
    const launchedAtMs = Date.parse(launchedAt);

    // Step 1: createLaunchClaim writes the reserved row + claim atomically.
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "session-launching-and-tracking",
        nodeId: "launch-claim-binding",
        expectedCwd: cwd,
        bindingWindowMs: 5 * 60_000,
        retentionWindowMs: 60 * 60_000,
        cliArgs: ["--yolo", "--model=gpt-5.5"],
      },
      {
        mintLaunchClaimId: () => "claim-INTEGRATION",
        mintRegistryRowId: () => "reg-INTEGRATION",
        mintNonce: () => "INTEGRATIONnonce0000000000",
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Reserved row is immediately visible with origin.kind: launched + graphBinding.
    const reservedSnapshot = registryStore.getSession("reg-INTEGRATION");
    expect(reservedSnapshot?.origin).toEqual({
      kind: "launched",
      launchClaimId: "claim-INTEGRATION",
      cliArgs: ["--yolo", "--model=gpt-5.5"],
    });
    expect(reservedSnapshot?.graphBinding?.launchClaimId).toBe("claim-INTEGRATION");
    expect(reservedSnapshot?.copilotSessionId).toBeNull();

    // Step 2: simulate Copilot CLI session appearing on disk + writing the
    // kickoff nonce into events.jsonl. The trusted-signal layer (in real
    // operation) would also fire and create an observed row, which we
    // simulate here.
    writeSessionStateFiles(
      sessionStateRoot,
      "copilot-INTEGRATION",
      cwd,
      `Welcome.\n${kickoffNonceLine("INTEGRATIONnonce0000000000")}\nPlease begin.`,
    );
    registryStore.upsertSession({
      id: "observed-INTEGRATION",
      title: "discovered",
      description: "",
      cwd,
      repo: null,
      branch: null,
      copilotSessionId: "copilot-INTEGRATION",
      lastSeenAt: launchedAt,
      origin: {
        kind: "observed",
        importedFromCopilotSessionId: "copilot-INTEGRATION",
      },
      lifecycleStatus: "active",
    });

    // Step 3: binding pass runs (this is what background-worker.runCycle does).
    const bindResult = await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [discoveredSession("copilot-INTEGRATION", cwd)],
      sessionStateRoot,
      now: () => new Date(launchedAtMs + 30_000),
      logger: logger.withScope("launch-claim.binding"),
    });
    expect(bindResult.claimsBoundThisCycle).toBe(1);

    // Step 4: assertions.
    // (a) Claim is bound.
    const boundClaim = claimStore.getClaim("claim-INTEGRATION");
    expect(boundClaim?.status).toBe("bound");
    expect(boundClaim?.boundCopilotSessionId).toBe("copilot-INTEGRATION");
    expect(boundClaim?.boundRegistryId).toBe("reg-INTEGRATION");

    // (b) Reserved row absorbed observation; duplicate was deleted.
    const fusedRow = registryStore.getSession("reg-INTEGRATION");
    expect(fusedRow?.copilotSessionId).toBe("copilot-INTEGRATION");
    expect(fusedRow?.origin).toEqual({
      kind: "launched",
      launchClaimId: "claim-INTEGRATION",
      cliArgs: ["--yolo", "--model=gpt-5.5"],
    });
    expect(fusedRow?.graphBinding).toEqual({
      workstreamId: "session-launching-and-tracking",
      nodeId: "launch-claim-binding",
      launchClaimId: "claim-INTEGRATION",
    });
    expect(registryStore.getSession("observed-INTEGRATION")).toBeNull();

    // (c) listSessions returns the bound row only (no duplicate observed row).
    const listed = registryStore.listSessions();
    expect(listed.filter((row) => row.copilotSessionId === "copilot-INTEGRATION")).toHaveLength(1);

    // (d) Idempotency: second binding pass on same inputs is a no-op.
    const secondBind = await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [discoveredSession("copilot-INTEGRATION", cwd)],
      sessionStateRoot,
      now: () => new Date(launchedAtMs + 60_000),
      logger: logger.withScope("launch-claim.binding"),
    });
    expect(secondBind.claimsBoundThisCycle).toBe(0);
    const stillBound = claimStore.getClaim("claim-INTEGRATION");
    expect(stillBound?.status).toBe("bound");

    // (e) Sweep at any time keeps bound claims intact until retention expires.
    runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(launchedAtMs + 6 * 60_000), // past binding window but inside retention
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(claimStore.getClaim("claim-INTEGRATION")?.status).toBe("bound");

    // (f) Sweep past retention prunes the claim file.
    const prune = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(launchedAtMs + 2 * 60 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(prune.claimsPruned).toBe(1);
    expect(claimStore.getClaim("claim-INTEGRATION")).toBeNull();
    // The bound registry row and durable graph binding survive claim-file pruning
    // and the next startup reconciliation pass.
    const reconcile = reconcileOrphanReservedRows(registryStore, claimStore);
    expect(reconcile.rowsDeleted).toBe(0);
    expect(reconcile.rowsGraphBindingCleared).toBe(0);
    expect(registryStore.getSession("reg-INTEGRATION")?.graphBinding).toEqual({
      workstreamId: "session-launching-and-tracking",
      nodeId: "launch-claim-binding",
      launchClaimId: "claim-INTEGRATION",
    });
  });

  it("end-to-end nonce-missing scenario: claim transitions, reserved row deleted, no graphBinding leaks", async () => {
    const cwd = "C:/repo/work";
    const launchedAt = "2026-05-02T02:00:00.000Z";
    const launchedAtMs = Date.parse(launchedAt);
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: cwd,
        bindingWindowMs: 60_000,
        retentionWindowMs: 60 * 60_000,
      },
      {
        mintLaunchClaimId: () => "claim-NM-INT",
        mintRegistryRowId: () => "reg-NM-INT",
        mintNonce: () => "NMINT00000000000000000000",
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);

    // A Copilot session appears in cwd but the kickoff prompt does NOT include the nonce.
    writeSessionStateFiles(
      sessionStateRoot,
      "copilot-NM-INT",
      cwd,
      "Hi! I'm here but no nonce.",
    );
    await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [discoveredSession("copilot-NM-INT", cwd)],
      sessionStateRoot,
      now: () => new Date(launchedAtMs + 30_000),
      logger: logger.withScope("launch-claim.binding"),
    });
    const stillPending = claimStore.getClaim("claim-NM-INT");
    expect(stillPending?.status).toBe("pending");
    expect(stillPending?.seenCandidateCopilotSessionIds).toEqual(["copilot-NM-INT"]);

    // Sweep past binding window.
    const sweep = runLaunchClaimSweep({
      registryStore,
      claimStore,
      now: () => new Date(launchedAtMs + 5 * 60_000),
      logger: logger.withScope("launch-claim.sweep"),
    });
    expect(sweep.claimsTransitioned).toBe(1);
    expect(sweep.reservedRowsDeleted).toBe(1);
    const transitioned = claimStore.getClaim("claim-NM-INT");
    expect(transitioned?.status).toBe("nonce-missing");
    expect(registryStore.getSession("reg-NM-INT")).toBeNull();
  });
});
