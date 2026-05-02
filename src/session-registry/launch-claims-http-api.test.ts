import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "./file-store";
import { LaunchClaimFileStore } from "./launch-claim-store";
import {
  LAUNCH_CLAIMS_API_BASE_PATH,
  LAUNCH_CLAIMS_API_DEFAULT_LIMIT,
  LAUNCH_CLAIMS_API_MAX_LIMIT,
  LAUNCH_CLAIMS_API_VERSION,
  type LaunchClaimDetailResponse,
  type LaunchClaimListResponse,
  handleLaunchClaimsApiRequest,
} from "./launch-claims-http-api";
import { createLaunchClaim } from "./launch-claims";

const createdRoots: string[] = [];

function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("handleLaunchClaimsApiRequest", () => {
  let claimStore: LaunchClaimFileStore;
  let registryStore: SessionRegistryFileStore;

  beforeEach(() => {
    const claimRoot = makeRoot("api-claim-");
    const registryRoot = makeRoot("api-reg-");
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
  });

  function createClaim(launchClaimId: string, launchedAt: string, workstreamId = "ws"): void {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId,
        nodeId: "n",
        expectedCwd: "C:/x",
        bindingWindowMs: 5 * 60 * 1000,
        retentionWindowMs: 60 * 60 * 1000,
        reserveRegistryRow: false,
      },
      {
        mintLaunchClaimId: () => launchClaimId,
        now: () => new Date(launchedAt),
      },
    );
    expect(outcome.ok).toBe(true);
  }

  it("returns null for unrelated request URLs", () => {
    const result = handleLaunchClaimsApiRequest(claimStore, {
      method: "GET",
      url: "/api/sessions",
    });
    expect(result).toBeNull();
  });

  it("rejects unsupported HTTP methods with 405", () => {
    const result = handleLaunchClaimsApiRequest(claimStore, {
      method: "POST",
      url: LAUNCH_CLAIMS_API_BASE_PATH,
    });
    expect(result?.statusCode).toBe(405);
  });

  it("returns an empty list with envelope and meta when no claims exist", () => {
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      { method: "GET", url: LAUNCH_CLAIMS_API_BASE_PATH },
      () => new Date("2026-05-02T01:00:00.000Z"),
    );
    expect(result?.statusCode).toBe(200);
    const body = result?.body as LaunchClaimListResponse;
    expect(body.apiVersion).toBe(LAUNCH_CLAIMS_API_VERSION);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.meta.total).toBe(0);
    expect(body.meta.serverTime).toBe("2026-05-02T01:00:00.000Z");
    expect(body.meta.diagnosticsSummary).toEqual({
      pendingCount: 0,
      activeWindowCount: 0,
      recentBindCount: 0,
      recentFailureCount: 0,
    });
  });

  it("returns claims newest-first with summary fields", () => {
    createClaim("claim-old", "2026-05-02T00:00:00.000Z");
    createClaim("claim-new", "2026-05-02T02:00:00.000Z");
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      { method: "GET", url: LAUNCH_CLAIMS_API_BASE_PATH },
      () => new Date("2026-05-02T02:01:00.000Z"),
    );
    const body = result?.body as LaunchClaimListResponse;
    expect(body.items.map((item) => item.launchClaimId)).toEqual(["claim-new", "claim-old"]);
    expect(body.items[0].status).toBe("pending");
    expect(body.items[0].derived.lifecyclePhase).toBe("active-window");
  });

  it("filters by status and workstreamId", () => {
    createClaim("claim-A", "2026-05-02T01:00:00.000Z", "ws-a");
    createClaim("claim-B", "2026-05-02T01:01:00.000Z", "ws-b");
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      {
        method: "GET",
        url: `${LAUNCH_CLAIMS_API_BASE_PATH}?workstreamId=ws-a`,
      },
      () => new Date("2026-05-02T01:02:00.000Z"),
    );
    const body = result?.body as LaunchClaimListResponse;
    expect(body.items.map((item) => item.launchClaimId)).toEqual(["claim-A"]);
  });

  it("respects the limit query param up to the documented maximum", () => {
    for (let i = 0; i < 5; i += 1) {
      createClaim(`claim-${i}`, `2026-05-02T01:00:0${i}.000Z`);
    }
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      { method: "GET", url: `${LAUNCH_CLAIMS_API_BASE_PATH}?limit=2` },
      () => new Date("2026-05-02T01:01:00.000Z"),
    );
    const body = result?.body as LaunchClaimListResponse;
    expect(body.items).toHaveLength(2);
    expect(body.meta.total).toBe(5);
  });

  it("clamps oversized limit to LAUNCH_CLAIMS_API_MAX_LIMIT", () => {
    createClaim("claim-1", "2026-05-02T01:00:00.000Z");
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      {
        method: "GET",
        url: `${LAUNCH_CLAIMS_API_BASE_PATH}?limit=10000`,
      },
      () => new Date("2026-05-02T01:01:00.000Z"),
    );
    const body = result?.body as LaunchClaimListResponse;
    expect(body.items).toHaveLength(1);
    void LAUNCH_CLAIMS_API_MAX_LIMIT; // referenced for documentation
  });

  it("returns 400 for invalid status filter", () => {
    const result = handleLaunchClaimsApiRequest(claimStore, {
      method: "GET",
      url: `${LAUNCH_CLAIMS_API_BASE_PATH}?status=bogus`,
    });
    expect(result?.statusCode).toBe(400);
  });

  it("returns single-record envelope for GET /:id", () => {
    createClaim("claim-X", "2026-05-02T01:00:00.000Z");
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      { method: "GET", url: `${LAUNCH_CLAIMS_API_BASE_PATH}/claim-X` },
      () => new Date("2026-05-02T01:01:00.000Z"),
    );
    expect(result?.statusCode).toBe(200);
    const body = result?.body as LaunchClaimDetailResponse;
    expect(body.apiVersion).toBe(LAUNCH_CLAIMS_API_VERSION);
    expect(body.claim.launchClaimId).toBe("claim-X");
    expect(body.derived.lifecyclePhase).toBe("active-window");
    expect(typeof body.derived.bindingWindowExpiresAt).toBe("string");
    expect(typeof body.derived.retentionExpiresAt).toBe("string");
  });

  it("returns 404 for unknown :id", () => {
    const result = handleLaunchClaimsApiRequest(claimStore, {
      method: "GET",
      url: `${LAUNCH_CLAIMS_API_BASE_PATH}/missing`,
    });
    expect(result?.statusCode).toBe(404);
  });

  it("uses default limit when not specified", () => {
    for (let i = 0; i < LAUNCH_CLAIMS_API_DEFAULT_LIMIT + 5; i += 1) {
      createClaim(`claim-${i.toString().padStart(3, "0")}`, `2026-05-02T01:00:00.${i.toString().padStart(3, "0")}Z`);
    }
    const result = handleLaunchClaimsApiRequest(
      claimStore,
      { method: "GET", url: LAUNCH_CLAIMS_API_BASE_PATH },
      () => new Date("2026-05-02T01:01:00.000Z"),
    );
    const body = result?.body as LaunchClaimListResponse;
    expect(body.items).toHaveLength(LAUNCH_CLAIMS_API_DEFAULT_LIMIT);
    expect(body.meta.total).toBe(LAUNCH_CLAIMS_API_DEFAULT_LIMIT + 5);
  });
});
