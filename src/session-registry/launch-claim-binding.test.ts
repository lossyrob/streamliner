import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiLogger, resetApiLoggerForTests, getApiLogger } from "../server/logger";
import type { LaunchClaimStore } from "../launch-claim-contract";
import type { DiscoveredCopilotSession } from "./copilot-session-discovery";
import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import { runLaunchClaimBindingPass } from "./launch-claim-binding";
import { bindClaimViaTrustedSignal, createLaunchClaim, kickoffNonceLine } from "./launch-claims";

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `streamliner-binding-${prefix}-`));
}

function writeEventsFile(sessionStateRoot: string, sessionId: string, content: string): void {
  const dir = join(sessionStateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), content, "utf8");
}

function discoveredSessionRecord(
  overrides: Partial<DiscoveredCopilotSession> = {},
): DiscoveredCopilotSession {
  return {
    sessionId: overrides.sessionId ?? "copilot-A",
    title: "discovered",
    description: "",
    cwd: overrides.cwd ?? "C:/repo/work",
    repo: overrides.repo ?? null,
    branch: overrides.branch ?? null,
    lastSeenAt: overrides.lastSeenAt ?? "2026-05-02T01:30:00.000Z",
    lifecycleStatus: "active",
    observedSessionKind: "interactive",
    copilotProcessState: "live",
    copilotProcessId: 123,
  };
}

function makeUserMessageEventLine(content: string): string {
  return JSON.stringify({
    type: "user.message",
    data: { content },
    timestamp: "2026-05-02T01:30:01.000Z",
  });
}

let registryRoot: string;
let claimRoot: string;
let sessionStateRoot: string;
let logRoot: string;
let registryStore: SessionRegistryFileStore;
let claimStore: LaunchClaimFileStore;
let logger: ApiLogger;

beforeEach(() => {
  registryRoot = makeTmp("registry");
  claimRoot = makeTmp("claim");
  sessionStateRoot = makeTmp("session-state");
  logRoot = makeTmp("logs");
  registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
  claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
  logger = new ApiLogger({ logDir: logRoot, mirrorConsole: false, purgeOnStart: false });
  resetApiLoggerForTests(logger);
});

afterEach(() => {
  resetApiLoggerForTests(null);
  rmSync(registryRoot, { recursive: true, force: true });
  rmSync(claimRoot, { recursive: true, force: true });
  rmSync(sessionStateRoot, { recursive: true, force: true });
  rmSync(logRoot, { recursive: true, force: true });
});

describe("runLaunchClaimBindingPass — happy path", () => {
  it("binds a Path A reserved row by fusing a separately-discovered observed row", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/repo/work",
      },
      {
        mintLaunchClaimId: () => "claim-HAPPY",
        mintRegistryRowId: () => "reg-HAPPY",
        mintNonce: () => "NONCEnonceNONCE0000000",
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Simulate discovery creating a separate observed row before binding.
    registryStore.upsertSession({
      id: "observed-HAPPY",
      title: "discovered",
      description: "",
      cwd: "C:/repo/work",
      repo: null,
      branch: null,
      copilotSessionId: "copilot-HAPPY",
      lastSeenAt: "2026-05-02T01:30:00.000Z",
      origin: { kind: "observed", importedFromCopilotSessionId: "copilot-HAPPY" },
      lifecycleStatus: "active",
    });

    // events.jsonl with the nonce in a user.message.
    writeEventsFile(
      sessionStateRoot,
      "copilot-HAPPY",
      makeUserMessageEventLine(`Hello\n${kickoffNonceLine("NONCEnonceNONCE0000000")}\nlater message`) +
        "\n",
    );

    const result = await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-HAPPY", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    expect(result.claimsBoundThisCycle).toBe(1);

    const updatedClaim = claimStore.getClaim("claim-HAPPY");
    expect(updatedClaim?.status).toBe("bound");
    expect(updatedClaim?.boundCopilotSessionId).toBe("copilot-HAPPY");
    expect(updatedClaim?.boundRegistryId).toBe("reg-HAPPY");

    const reservedRow = registryStore.getSession("reg-HAPPY");
    expect(reservedRow?.copilotSessionId).toBe("copilot-HAPPY");
    expect(reservedRow?.graphBinding).toEqual({
      workstreamId: "ws",
      nodeId: "n",
      launchClaimId: "claim-HAPPY",
    });
    expect(registryStore.getSession("observed-HAPPY")).toBeNull();
  });

  it("Path B (no reservation): binds graphBinding directly onto the observed row", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/repo/work",
        reserveRegistryRow: false,
      },
      {
        mintLaunchClaimId: () => "claim-PATHB",
        mintNonce: () => "PATHBnonce0000000000PB",
      },
    );
    expect(outcome.ok).toBe(true);

    registryStore.upsertSession({
      id: "observed-PATHB",
      title: "discovered",
      description: "",
      cwd: "C:/repo/work",
      repo: null,
      branch: null,
      copilotSessionId: "copilot-PATHB",
      lastSeenAt: "2026-05-02T01:30:00.000Z",
      origin: { kind: "observed", importedFromCopilotSessionId: "copilot-PATHB" },
      lifecycleStatus: "active",
    });

    writeEventsFile(
      sessionStateRoot,
      "copilot-PATHB",
      makeUserMessageEventLine(kickoffNonceLine("PATHBnonce0000000000PB")) + "\n",
    );

    const result = await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-PATHB", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    expect(result.claimsBoundThisCycle).toBe(1);
    const updatedRow = registryStore.getSession("observed-PATHB");
    expect(updatedRow?.graphBinding?.launchClaimId).toBe("claim-PATHB");
    expect(updatedRow?.origin.kind).toBe("observed");
  });
});

describe("runLaunchClaimBindingPass — degraded paths", () => {
  it("does not bind when nonce is missing; records candidate as seen", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/repo/work" },
      { mintLaunchClaimId: () => "claim-NM", mintRegistryRowId: () => "reg-NM", mintNonce: () => "MISSINGnonce00000000NM" },
    );
    expect(outcome.ok).toBe(true);
    registryStore.upsertSession({
      id: "observed-NM",
      title: "no nonce",
      description: "",
      cwd: "C:/repo/work",
      repo: null,
      branch: null,
      copilotSessionId: "copilot-NM",
      lastSeenAt: "2026-05-02T01:30:00.000Z",
      origin: { kind: "observed", importedFromCopilotSessionId: "copilot-NM" },
      lifecycleStatus: "active",
    });
    writeEventsFile(
      sessionStateRoot,
      "copilot-NM",
      makeUserMessageEventLine("hello world without the nonce") + "\n",
    );
    await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-NM", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    const claim = claimStore.getClaim("claim-NM");
    expect(claim?.status).toBe("pending");
    expect(claim?.seenCandidateCopilotSessionIds).toEqual(["copilot-NM"]);
    expect(claim?.evidence.attempts.some((a) => a.reason === "no-nonce-match")).toBe(true);
  });

  it("does not bind when discovered session has no events.jsonl yet (events-file-unreadable)", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/repo/work" },
      { mintLaunchClaimId: () => "claim-NF" },
    );
    expect(outcome.ok).toBe(true);

    await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-NF", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    const claim = claimStore.getClaim("claim-NF");
    expect(claim?.status).toBe("pending");
    expect(
      claim?.evidence.attempts.some((a) => a.reason === "events-file-unreadable"),
    ).toBe(true);
  });

  it("transitions to ambiguous when multiple candidates match the nonce", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/repo/work" },
      { mintLaunchClaimId: () => "claim-AMB", mintNonce: () => "AMBIGUOUSnonce123456" },
    );
    expect(outcome.ok).toBe(true);
    writeEventsFile(
      sessionStateRoot,
      "copilot-AMB1",
      makeUserMessageEventLine(kickoffNonceLine("AMBIGUOUSnonce123456")) + "\n",
    );
    writeEventsFile(
      sessionStateRoot,
      "copilot-AMB2",
      makeUserMessageEventLine(kickoffNonceLine("AMBIGUOUSnonce123456")) + "\n",
    );
    const result = await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-AMB1", cwd: "C:/repo/work" }),
        discoveredSessionRecord({ sessionId: "copilot-AMB2", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    expect(result.claimsTransitionedToAmbiguous).toBe(1);
    const claim = claimStore.getClaim("claim-AMB");
    expect(claim?.status).toBe("ambiguous");
    expect(claim?.failureCode).toBe("ambiguous-candidates");
  });

  it("does not downgrade a claim bound by a trusted signal during ambiguity resolution", async () => {
    const launchClaimId = "claim-RACE";
    const launchNonce = "RACEnonce1234567890";
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/repo/work" },
      { mintLaunchClaimId: () => launchClaimId, mintNonce: () => launchNonce },
    );
    expect(outcome.ok).toBe(true);
    registryStore.upsertSession({
      id: "observed-RACE1",
      title: "race candidate",
      description: "",
      cwd: "C:/repo/work",
      repo: null,
      branch: null,
      copilotSessionId: "copilot-RACE1",
      lastSeenAt: "2026-05-02T01:30:00.000Z",
      origin: { kind: "observed", importedFromCopilotSessionId: "copilot-RACE1" },
      lifecycleStatus: "active",
    });
    writeEventsFile(
      sessionStateRoot,
      "copilot-RACE1",
      makeUserMessageEventLine(kickoffNonceLine(launchNonce)) + "\n",
    );
    writeEventsFile(
      sessionStateRoot,
      "copilot-RACE2",
      makeUserMessageEventLine(kickoffNonceLine(launchNonce)) + "\n",
    );
    let trustedSignalBound = false;
    const racingClaimStore: LaunchClaimStore = {
      createClaim: (input) => claimStore.createClaim(input),
      getClaim: (id) => claimStore.getClaim(id),
      listClaims: (options) => claimStore.listClaims(options),
      updateClaim: (id, mutator) => {
        if (id === launchClaimId && !trustedSignalBound) {
          trustedSignalBound = true;
          const bind = bindClaimViaTrustedSignal(registryStore, claimStore, {
            launchClaimId,
            copilotSessionId: "copilot-RACE1",
            cwd: "C:/repo/work",
            at: "2026-05-02T01:30:29.000Z",
            now: () => new Date("2026-05-02T01:30:29.000Z"),
          });
          expect(bind.ok).toBe(true);
        }
        return claimStore.updateClaim(id, mutator);
      },
      deleteClaim: (id) => claimStore.deleteClaim(id),
      subscribe: (listener) => claimStore.subscribe(listener),
    };

    const result = await runLaunchClaimBindingPass({
      registryStore,
      claimStore: racingClaimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-RACE1", cwd: "C:/repo/work" }),
        discoveredSessionRecord({ sessionId: "copilot-RACE2", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });

    expect(result.claimsTransitionedToAmbiguous).toBe(0);
    const claim = claimStore.getClaim(launchClaimId);
    expect(claim?.status).toBe("bound");
    expect(claim?.boundCopilotSessionId).toBe("copilot-RACE1");
    expect(claim?.failureCode).toBeNull();
  });

  it("idempotency: rerunning on unchanged inputs produces no new evidence entries", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/repo/work" },
      { mintLaunchClaimId: () => "claim-IDEM", mintNonce: () => "IDEMnonce0000000000IDM" },
    );
    expect(outcome.ok).toBe(true);
    registryStore.upsertSession({
      id: "observed-IDEM",
      title: "no nonce",
      description: "",
      cwd: "C:/repo/work",
      repo: null,
      branch: null,
      copilotSessionId: "copilot-IDEM",
      lastSeenAt: "2026-05-02T01:30:00.000Z",
      origin: { kind: "observed", importedFromCopilotSessionId: "copilot-IDEM" },
      lifecycleStatus: "active",
    });
    writeEventsFile(
      sessionStateRoot,
      "copilot-IDEM",
      makeUserMessageEventLine("no match here") + "\n",
    );
    const opts = {
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-IDEM", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    } as const;
    await runLaunchClaimBindingPass(opts);
    const after1 = claimStore.getClaim("claim-IDEM");
    const attempts1 = after1?.evidence.attempts.length ?? 0;
    await runLaunchClaimBindingPass(opts);
    const after2 = claimStore.getClaim("claim-IDEM");
    const attempts2 = after2?.evidence.attempts.length ?? 0;
    expect(attempts2).toBe(attempts1);
  });

  it("rejects candidates whose branch differs from expectedBranch", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/repo/work",
        expectedBranch: "feature/x",
      },
      { mintLaunchClaimId: () => "claim-BR", mintNonce: () => "BRnonce0000000000BR000" },
    );
    expect(outcome.ok).toBe(true);
    writeEventsFile(
      sessionStateRoot,
      "copilot-BR",
      makeUserMessageEventLine(kickoffNonceLine("BRnonce0000000000BR000")) + "\n",
    );
    await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({
          sessionId: "copilot-BR",
          cwd: "C:/repo/work",
          branch: "feature/y",
        }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    const claim = claimStore.getClaim("claim-BR");
    expect(claim?.status).toBe("pending");
    // Candidate was rejected during narrowing; no candidate evidence.
    expect(claim?.evidence.attempts.find((a) => a.reason === "no-candidates")).toBeDefined();
  });

  it("records no-candidates evidence when expectedCwd has no discovered session", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/different/cwd" },
      { mintLaunchClaimId: () => "claim-NC" },
    );
    expect(outcome.ok).toBe(true);
    await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-OTHER", cwd: "C:/other/cwd" }),
      ],
      sessionStateRoot,
      now: () => new Date("2026-05-02T01:30:30.000Z"),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    const claim = claimStore.getClaim("claim-NC");
    expect(claim?.status).toBe("pending");
    expect(claim?.seenCandidateCopilotSessionIds).toHaveLength(0);
    expect(claim?.evidence.attempts.find((a) => a.reason === "no-candidates")).toBeDefined();
  });

  it("does not consider claims past their binding window", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/repo/work",
        bindingWindowMs: 60 * 1000, // 60s
      },
      { mintLaunchClaimId: () => "claim-EXP", mintNonce: () => "EXPnonce0000000000EXP0" },
    );
    expect(outcome.ok).toBe(true);
    writeEventsFile(
      sessionStateRoot,
      "copilot-EXP",
      makeUserMessageEventLine(kickoffNonceLine("EXPnonce0000000000EXP0")) + "\n",
    );
    // Now is well past launchedAt + bindingWindowMs.
    const result = await runLaunchClaimBindingPass({
      registryStore,
      claimStore,
      discoveredSessions: [
        discoveredSessionRecord({ sessionId: "copilot-EXP", cwd: "C:/repo/work" }),
      ],
      sessionStateRoot,
      now: () => new Date(Date.now() + 60 * 60 * 1000),
      logger: getApiLogger().withScope("launch-claim.binding"),
    });
    expect(result.claimsConsidered).toBe(0);
    expect(claimStore.getClaim("claim-EXP")?.status).toBe("pending");
  });
});
