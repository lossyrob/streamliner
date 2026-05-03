import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import {
  bindClaimViaTrustedSignal,
  createLaunchClaim,
} from "./launch-claims";

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

describe("bindClaimViaTrustedSignal — Tier 2 launch-claim binding", () => {
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;

  beforeEach(() => {
    registryStore = new SessionRegistryFileStore({ rootDir: makeRoot("tier2-reg-") });
    claimStore = new LaunchClaimFileStore({ rootDir: makeRoot("tier2-claim-") });
  });

  function createReservedClaim(launchClaimId: string, cwd = "C:/x"): void {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: cwd },
      {
        mintLaunchClaimId: () => launchClaimId,
        mintRegistryRowId: () => `reg-${launchClaimId}`,
      },
    );
    expect(outcome.ok).toBe(true);
  }

  function simulateTrustedSignalIngest(
    sessionId: string,
    cwd: string,
  ): void {
    // Mirrors recordTrustedSessionSignal's behavior of creating a fresh
    // observed row keyed by sessionId.
    registryStore.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId,
      timestamp: "2026-05-03T00:00:00.000Z",
      cwd,
      hookSource: "new",
      executionKind: "copilot_cli",
    });
  }

  it("happy path: fuses observation row into reserved row, claim becomes bound", () => {
    createReservedClaim("claim-T2-HAPPY");
    simulateTrustedSignalIngest("copilot-T2-HAPPY", "C:/x");
    const outcome = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-HAPPY",
      copilotSessionId: "copilot-T2-HAPPY",
      cwd: "C:/x",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.registryId).toBe("reg-claim-T2-HAPPY");

    const claim = claimStore.getClaim("claim-T2-HAPPY");
    expect(claim?.status).toBe("bound");
    expect(claim?.boundCopilotSessionId).toBe("copilot-T2-HAPPY");
    expect(claim?.boundRegistryId).toBe("reg-claim-T2-HAPPY");
    expect(claim?.evidence.attempts.some((a) => a.reason === "trusted-signal-claim-id-match")).toBe(
      true,
    );

    // Reserved row absorbed the observation; trusted-signal row deleted.
    const reservedRow = registryStore.getSession("reg-claim-T2-HAPPY");
    expect(reservedRow?.copilotSessionId).toBe("copilot-T2-HAPPY");
    expect(reservedRow?.graphBinding?.launchClaimId).toBe("claim-T2-HAPPY");
    // Sanity: the bare trusted-signal-created row should be gone.
    expect(registryStore.findRecordIdByCopilotSession("copilot-T2-HAPPY")).toBe(
      "reg-claim-T2-HAPPY",
    );
  });

  it("returns claim-not-found when claim id is unknown", () => {
    const outcome = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "missing",
      copilotSessionId: "copilot-X",
      cwd: "C:/x",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("claim-not-found");
  });

  it("returns already-bound when claim is already bound", () => {
    createReservedClaim("claim-T2-DUPE");
    simulateTrustedSignalIngest("copilot-T2-DUPE", "C:/x");
    const first = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-DUPE",
      copilotSessionId: "copilot-T2-DUPE",
      cwd: "C:/x",
    });
    expect(first.ok).toBe(true);
    // A second hook signal carrying the same claim id (e.g., a child
    // process inheriting the env var) should be rejected gracefully.
    const second = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-DUPE",
      copilotSessionId: "copilot-T2-DUPE-CHILD",
      cwd: "C:/x",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already-bound");
  });

  it("returns claim-out-of-window when binding window has closed", () => {
    createReservedClaim("claim-T2-LATE");
    simulateTrustedSignalIngest("copilot-T2-LATE", "C:/x");
    const outcome = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-LATE",
      copilotSessionId: "copilot-T2-LATE",
      cwd: "C:/x",
      now: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h in the future
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("claim-out-of-window");
  });

  it("returns expected-cwd-mismatch when signal cwd doesn't match claim cwd", () => {
    createReservedClaim("claim-T2-CWD", "C:/expected/path");
    simulateTrustedSignalIngest("copilot-T2-CWD", "C:/different/path");
    const outcome = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-CWD",
      copilotSessionId: "copilot-T2-CWD",
      cwd: "C:/different/path",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("expected-cwd-mismatch");
  });

  it("returns registry-row-missing when no observed row exists yet for the session id", () => {
    createReservedClaim("claim-T2-NOROW");
    // Skip the trusted-signal ingest step.
    const outcome = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-NOROW",
      copilotSessionId: "copilot-T2-NOROW",
      cwd: "C:/x",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("registry-row-missing");
  });

  it("Path B (no reservation): writes graphBinding directly onto the trusted-signal row", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-T2-PATHB" },
    );
    expect(outcome.ok).toBe(true);
    simulateTrustedSignalIngest("copilot-T2-PATHB", "C:/x");
    const result = bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-PATHB",
      copilotSessionId: "copilot-T2-PATHB",
      cwd: "C:/x",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = registryStore.getSession(result.registryId);
    expect(row?.graphBinding?.launchClaimId).toBe("claim-T2-PATHB");
    expect(row?.origin.kind).toBe("observed");
  });

  it("idempotency: re-running on the same bound claim does not corrupt state", () => {
    createReservedClaim("claim-T2-IDEM");
    simulateTrustedSignalIngest("copilot-T2-IDEM", "C:/x");
    bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-IDEM",
      copilotSessionId: "copilot-T2-IDEM",
      cwd: "C:/x",
    });
    const claim = claimStore.getClaim("claim-T2-IDEM");
    expect(claim?.status).toBe("bound");
    const evidenceCount = claim?.evidence.attempts.length ?? 0;
    // Second invocation: should fail-safe with already-bound, no new evidence.
    bindClaimViaTrustedSignal(registryStore, claimStore, {
      launchClaimId: "claim-T2-IDEM",
      copilotSessionId: "copilot-T2-IDEM",
      cwd: "C:/x",
    });
    const claimAfter = claimStore.getClaim("claim-T2-IDEM");
    expect(claimAfter?.evidence.attempts.length).toBe(evidenceCount);
  });
});
