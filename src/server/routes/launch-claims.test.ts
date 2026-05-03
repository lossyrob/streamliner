import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { LaunchClaimFileStore } from "../../session-registry/launch-claim-store";
import { createLaunchClaim } from "../../session-registry/launch-claims";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import {
  LAUNCH_CLAIMS_API_BASE_PATH,
  type LaunchClaimDetailResponse,
  type LaunchClaimListResponse,
} from "../../session-registry/launch-claims-http-api";
import { createLaunchClaimsRouter } from "./launch-claims";

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

describe("createLaunchClaimsRouter", () => {
  let app: express.Express;
  let claimStore: LaunchClaimFileStore;
  let registryStore: SessionRegistryFileStore;

  beforeEach(() => {
    claimStore = new LaunchClaimFileStore({ rootDir: makeRoot("rt-claims-") });
    registryStore = new SessionRegistryFileStore({ rootDir: makeRoot("rt-reg-") });
    app = express();
    app.use(express.json());
    app.use(LAUNCH_CLAIMS_API_BASE_PATH, createLaunchClaimsRouter({ claimStore }));
  });

  it("serves an empty list with envelope on a fresh store", async () => {
    const response = await request(app).get(LAUNCH_CLAIMS_API_BASE_PATH);
    expect(response.status).toBe(200);
    const body = response.body as LaunchClaimListResponse;
    expect(body.apiVersion).toBe(1);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.meta.total).toBe(0);
  });

  it("returns the claim record by id", async () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-router" },
    );
    expect(outcome.ok).toBe(true);
    const response = await request(app).get(`${LAUNCH_CLAIMS_API_BASE_PATH}/claim-router`);
    expect(response.status).toBe(200);
    const body = response.body as LaunchClaimDetailResponse;
    expect(body.claim.launchClaimId).toBe("claim-router");
  });

  it("rejects non-loopback requests with 403", async () => {
    const response = await request(app)
      .get(LAUNCH_CLAIMS_API_BASE_PATH)
      .set("X-Forwarded-For", "8.8.8.8");
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Launch claim API must originate from loopback.",
    });
  });
});
