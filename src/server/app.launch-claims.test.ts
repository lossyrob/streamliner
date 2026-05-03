import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStreamlinerApiApp,
  type StreamlinerApiApp,
} from "./app";
import { LaunchClaimFileStore } from "../session-registry/launch-claim-store";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createLaunchClaim } from "../session-registry/launch-claims";
import {
  LAUNCH_CLAIMS_API_BASE_PATH,
  type LaunchClaimDetailResponse,
  type LaunchClaimListResponse,
} from "../session-registry/launch-claims-http-api";

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

describe("createStreamlinerApiApp — launch-claim wiring", () => {
  let registryStore: SessionRegistryFileStore;
  let launchClaimStore: LaunchClaimFileStore;
  let apiApp: StreamlinerApiApp;

  beforeEach(() => {
    registryStore = new SessionRegistryFileStore({ rootDir: makeRoot("app-launch-reg-") });
    launchClaimStore = new LaunchClaimFileStore({ rootDir: makeRoot("app-launch-claim-") });
    apiApp = createStreamlinerApiApp({
      store: registryStore,
      launchClaimStore,
    });
  });

  it("mounts GET /api/launch-claims when launchClaimStore is supplied", async () => {
    const response = await request(apiApp.app).get(LAUNCH_CLAIMS_API_BASE_PATH);
    expect(response.status).toBe(200);
    const body = response.body as LaunchClaimListResponse;
    expect(body.apiVersion).toBe(1);
    expect(body.items).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("returns the claim record after createLaunchClaim writes it", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      launchClaimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-bootstrap" },
    );
    expect(outcome.ok).toBe(true);
    const response = await request(apiApp.app).get(
      `${LAUNCH_CLAIMS_API_BASE_PATH}/claim-bootstrap`,
    );
    expect(response.status).toBe(200);
    const body = response.body as LaunchClaimDetailResponse;
    expect(body.claim.launchClaimId).toBe("claim-bootstrap");
  });

  it("does NOT mount /api/launch-claims when launchClaimStore is omitted", async () => {
    const standalone = createStreamlinerApiApp({ store: registryStore });
    const response = await request(standalone.app).get(LAUNCH_CLAIMS_API_BASE_PATH);
    // 404 (route not registered) — we don't mount the loopback-rejecting router at all.
    expect(response.status).toBe(404);
  });

  it("rejects non-loopback requests on the launch-claims route with 403", async () => {
    const response = await request(apiApp.app)
      .get(LAUNCH_CLAIMS_API_BASE_PATH)
      .set("X-Forwarded-For", "8.8.8.8");
    expect(response.status).toBe(403);
  });
});
