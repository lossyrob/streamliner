import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStreamlinerApiApp,
  type StreamlinerApiApp,
} from "../server/app";
import { ApiLogger, resetApiLoggerForTests } from "../server/logger";
import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import { bindClaimViaTrustedSignal, createLaunchClaim } from "./launch-claims";
import {
  drainTrustedSessionSignalSpool,
  writeTrustedSessionSignalSpoolFile,
} from "./trusted-session-signals";

const createdRoots: string[] = [];

function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(dir);
  return dir;
}

afterEach(() => {
  resetApiLoggerForTests(null);
  for (const dir of createdRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Tier 2 launch-claim binding — HTTP intake integration", () => {
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;
  let apiApp: StreamlinerApiApp;

  beforeEach(() => {
    registryStore = new SessionRegistryFileStore({ rootDir: makeRoot("tier2-http-reg-") });
    claimStore = new LaunchClaimFileStore({ rootDir: makeRoot("tier2-http-claim-") });
    const logRoot = makeRoot("tier2-http-log-");
    resetApiLoggerForTests(
      new ApiLogger({ logDir: logRoot, mirrorConsole: false, purgeOnStart: false }),
    );
    apiApp = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore: claimStore,
    });
  });

  it("POST /api/sessions/signals binds the claim atomically when the signal carries launchClaimId", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/x" },
      {
        mintLaunchClaimId: () => "claim-HTTP",
        mintRegistryRowId: () => "reg-HTTP",
      },
    );
    expect(outcome.ok).toBe(true);

    const response = await request(apiApp.app)
      .post("/api/sessions/signals")
      .send({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "copilot-HTTP",
        timestamp: "2026-05-03T00:00:00.000Z",
        cwd: "C:/x",
        hookSource: "new",
        executionKind: "copilot_cli",
        launchClaimId: "claim-HTTP",
      });
    expect(response.status).toBe(200);

    // Claim was bound by the onTrustedSignalApplied hook.
    const claim = claimStore.getClaim("claim-HTTP");
    expect(claim?.status).toBe("bound");
    expect(claim?.boundCopilotSessionId).toBe("copilot-HTTP");
    expect(claim?.boundRegistryId).toBe("reg-HTTP");

    // Reserved row absorbed observation; duplicate gone.
    const reserved = registryStore.getSession("reg-HTTP");
    expect(reserved?.copilotSessionId).toBe("copilot-HTTP");
    expect(reserved?.graphBinding?.launchClaimId).toBe("claim-HTTP");
  });

  it("POST /api/sessions/signals without launchClaimId is unaffected (Tier 1 fallback path)", async () => {
    const response = await request(apiApp.app)
      .post("/api/sessions/signals")
      .send({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "copilot-NOCLAIM",
        timestamp: "2026-05-03T00:00:00.000Z",
        cwd: "C:/elsewhere",
        hookSource: "new",
        executionKind: "copilot_cli",
      });
    expect(response.status).toBe(200);
    // No claim → no bind happened.
    expect(claimStore.listClaims()).toEqual([]);
    // But the trusted-signal row was created.
    const observed = registryStore.findRecordIdByCopilotSession("copilot-NOCLAIM");
    expect(observed).not.toBeNull();
    if (observed) {
      const row = registryStore.getSession(observed);
      expect(row?.graphBinding).toBeNull();
    }
  });

  it("HTTP signal failure to bind does not turn the trusted-signal ingest into an HTTP error", async () => {
    // Reference an unknown claim id; the trusted signal is still ingested,
    // and the bind hook silently fails (logs a warning). Caller sees 200.
    const response = await request(apiApp.app)
      .post("/api/sessions/signals")
      .send({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "copilot-UNKNOWN",
        timestamp: "2026-05-03T00:00:00.000Z",
        cwd: "C:/somewhere",
        hookSource: "new",
        executionKind: "copilot_cli",
        launchClaimId: "claim-DOES-NOT-EXIST",
      });
    expect(response.status).toBe(200);
  });
});

describe("Tier 2 launch-claim binding — spool drain integration", () => {
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;
  let spoolRoot: string;

  beforeEach(() => {
    registryStore = new SessionRegistryFileStore({ rootDir: makeRoot("tier2-spool-reg-") });
    claimStore = new LaunchClaimFileStore({ rootDir: makeRoot("tier2-spool-claim-") });
    spoolRoot = makeRoot("tier2-spool-signals-");
  });

  it("spool drain invokes onSignalApplied callback per ingested signal", () => {
    createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/x" },
      {
        mintLaunchClaimId: () => "claim-SPOOL",
        mintRegistryRowId: () => "reg-SPOOL",
      },
    );
    writeTrustedSessionSignalSpoolFile(
      {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "copilot-SPOOL",
        timestamp: "2026-05-03T00:00:00.000Z",
        cwd: "C:/x",
        hookSource: "new",
        executionKind: "copilot_cli",
        launchClaimId: "claim-SPOOL",
      },
      { rootDir: spoolRoot },
    );
    const result = drainTrustedSessionSignalSpool(registryStore, {
      rootDir: spoolRoot,
      onSignalApplied: (signal) => {
        if (signal.launchClaimId && signal.event === "session.started") {
          bindClaimViaTrustedSignal(registryStore, claimStore, {
            launchClaimId: signal.launchClaimId,
            copilotSessionId: signal.sessionId,
            cwd: signal.cwd,
          });
        }
      },
    });
    expect(result.processed).toBe(1);
    const claim = claimStore.getClaim("claim-SPOOL");
    expect(claim?.status).toBe("bound");
  });

  it("spool drain still processes signal when callback throws (logs warning, does not lose signal)", () => {
    writeTrustedSessionSignalSpoolFile(
      {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "copilot-CB-THROW",
        timestamp: "2026-05-03T00:00:00.000Z",
        cwd: "C:/x",
        hookSource: "new",
        executionKind: "copilot_cli",
      },
      { rootDir: spoolRoot },
    );
    const warnings: string[] = [];
    const result = drainTrustedSessionSignalSpool(registryStore, {
      rootDir: spoolRoot,
      logger: { warn: (msg: unknown) => warnings.push(String(msg)) },
      onSignalApplied: () => {
        throw new Error("test callback failure");
      },
    });
    expect(result.processed).toBe(1);
    expect(warnings.some((w) => w.includes("onSignalApplied failed"))).toBe(true);
    // Signal row was still recorded.
    expect(registryStore.findRecordIdByCopilotSession("copilot-CB-THROW")).not.toBeNull();
  });
});
