import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LAUNCH_CLAIM_DEFAULT_BINDING_WINDOW_MS,
  LAUNCH_CLAIM_DEFAULT_RETENTION_WINDOW_MS,
  LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH,
  LAUNCH_CLAIM_LINEAGE_METADATA_MAX_BYTES,
  parseLaunchClaim,
  sanitizeFailureReason,
  validateLineageMetadata,
} from "../launch-claim-schema";
import {
  LaunchClaimAlreadyExistsError,
  type LaunchClaimChangeEvent,
  type LaunchClaimCreateInput,
  LaunchClaimNotFoundError,
} from "../launch-claim-contract";
import {
  getDefaultLaunchClaimRoot,
  getEnvLaunchClaimRoot,
  LaunchClaimFileStore,
} from "./launch-claim-store";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-launch-claim-test-"));
}

function makeInput(overrides: Partial<LaunchClaimCreateInput> = {}): LaunchClaimCreateInput {
  return {
    launchClaimId: overrides.launchClaimId ?? "claim-001",
    workstreamId: overrides.workstreamId ?? "session-launching-and-tracking",
    nodeId: overrides.nodeId ?? "launch-claim-binding",
    launchNonce: overrides.launchNonce ?? "abc123nonce",
    expectedCwd: overrides.expectedCwd ?? "C:/work/repo",
    expectedBranch: overrides.expectedBranch ?? null,
    expectedRepo: overrides.expectedRepo ?? null,
    contextId: overrides.contextId ?? null,
    launchedAt: overrides.launchedAt ?? "2026-05-02T01:00:00.000Z",
    bindingWindowMs: overrides.bindingWindowMs ?? LAUNCH_CLAIM_DEFAULT_BINDING_WINDOW_MS,
    retentionWindowMs: overrides.retentionWindowMs ?? LAUNCH_CLAIM_DEFAULT_RETENTION_WINDOW_MS,
    reservedRegistryId: overrides.reservedRegistryId ?? null,
    lineageMetadata: overrides.lineageMetadata ?? null,
  };
}

describe("sanitizeFailureReason", () => {
  it("returns null for null/undefined/empty/non-string input", () => {
    expect(sanitizeFailureReason(null)).toBeNull();
    expect(sanitizeFailureReason(undefined)).toBeNull();
    expect(sanitizeFailureReason("")).toBeNull();
    expect(sanitizeFailureReason("   ")).toBeNull();
    expect(sanitizeFailureReason(42 as unknown as string)).toBeNull();
  });

  it("strips control chars and collapses whitespace", () => {
    const dirty = "first line\n\n  second\tline\u0001\u0007 third";
    expect(sanitizeFailureReason(dirty)).toBe("first line; second; line third");
  });

  it("truncates strings longer than the cap and appends ellipsis", () => {
    const long = "a".repeat(LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH + 50);
    const sanitized = sanitizeFailureReason(long);
    expect(sanitized).not.toBeNull();
    expect(sanitized!.length).toBe(LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH);
    expect(sanitized!.endsWith("…")).toBe(true);
  });
});

describe("validateLineageMetadata", () => {
  it("returns null for null/undefined input", () => {
    expect(validateLineageMetadata(null)).toBeNull();
    expect(validateLineageMetadata(undefined)).toBeNull();
  });

  it("rejects arrays and non-objects", () => {
    expect(() =>
      validateLineageMetadata([1, 2, 3] as unknown as Record<string, unknown>),
    ).toThrow(TypeError);
  });

  it("rejects payloads exceeding the byte cap", () => {
    const oversize = { padding: "x".repeat(LAUNCH_CLAIM_LINEAGE_METADATA_MAX_BYTES + 100) };
    expect(() => validateLineageMetadata(oversize)).toThrow(RangeError);
  });

  it("returns a deep clone of valid input", () => {
    const input = { reviewSession: "abc", labels: ["one", "two"] };
    const cloned = validateLineageMetadata(input);
    expect(cloned).toEqual(input);
    expect(cloned).not.toBe(input);
  });
});

describe("getEnvLaunchClaimRoot", () => {
  it("defaults to ~/.streamliner/state/launch-claims when env unset", () => {
    expect(getEnvLaunchClaimRoot({})).toBe(getDefaultLaunchClaimRoot());
  });

  it("honors STREAMLINER_LAUNCH_CLAIMS_ROOT", () => {
    const env = { STREAMLINER_LAUNCH_CLAIMS_ROOT: "/tmp/custom-claims" };
    const result = getEnvLaunchClaimRoot(env);
    expect(result.endsWith("custom-claims")).toBe(true);
  });
});

describe("LaunchClaimFileStore", () => {
  let rootDir: string;
  let store: LaunchClaimFileStore;

  beforeEach(() => {
    rootDir = makeRoot();
    store = new LaunchClaimFileStore({ rootDir });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("creates and reads back a claim", () => {
    const claim = store.createClaim(makeInput());
    expect(claim.launchClaimId).toBe("claim-001");
    expect(claim.status).toBe("pending");
    expect(claim.evidence.attempts).toEqual([]);
    expect(claim.seenCandidateCopilotSessionIds).toEqual([]);

    const fetched = store.getClaim("claim-001");
    expect(fetched).toEqual(claim);
  });

  it("rejects duplicate launchClaimId", () => {
    store.createClaim(makeInput());
    expect(() => store.createClaim(makeInput())).toThrow(LaunchClaimAlreadyExistsError);
  });

  it("rejects invalid claim ids", () => {
    expect(() => store.createClaim(makeInput({ launchClaimId: "" }))).toThrow();
    expect(() => store.createClaim(makeInput({ launchClaimId: "../escape" }))).toThrow();
  });

  it("listClaims returns newest first and supports filters and limit", () => {
    store.createClaim(makeInput({ launchClaimId: "a", launchedAt: "2026-05-02T01:00:00.000Z" }));
    store.createClaim(makeInput({ launchClaimId: "b", launchedAt: "2026-05-02T02:00:00.000Z" }));
    store.createClaim(
      makeInput({
        launchClaimId: "c",
        launchedAt: "2026-05-02T03:00:00.000Z",
        workstreamId: "other",
      }),
    );

    const all = store.listClaims();
    expect(all.map((entry) => entry.launchClaimId)).toEqual(["c", "b", "a"]);

    const filtered = store.listClaims({ workstreamId: "session-launching-and-tracking" });
    expect(filtered.map((entry) => entry.launchClaimId)).toEqual(["b", "a"]);

    const limited = store.listClaims({ limit: 1 });
    expect(limited.map((entry) => entry.launchClaimId)).toEqual(["c"]);

    const byStatus = store.listClaims({ status: "bound" });
    expect(byStatus).toHaveLength(0);
  });

  it("updateClaim mutates atomically and bumps updatedAt", async () => {
    store.createClaim(makeInput());
    const original = store.getClaim("claim-001")!;
    // Brief sleep to ensure ISO timestamp difference.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = store.updateClaim("claim-001", (current) => ({
      ...current,
      status: "bound",
      boundCopilotSessionId: "copilot-abc",
      boundRegistryId: "reg-1",
    }));
    expect(updated.status).toBe("bound");
    expect(updated.boundCopilotSessionId).toBe("copilot-abc");
    expect(updated.updatedAt >= original.updatedAt).toBe(true);
  });

  it("updateClaim throws LaunchClaimNotFoundError on missing id", () => {
    expect(() => store.updateClaim("missing", (current) => current)).toThrow(
      LaunchClaimNotFoundError,
    );
  });

  it("deleteClaim removes file and emits delete event", () => {
    store.createClaim(makeInput());
    const events: LaunchClaimChangeEvent[] = [];
    store.subscribe((event) => events.push(event));
    expect(store.deleteClaim("claim-001")).toBe(true);
    expect(store.getClaim("claim-001")).toBeNull();
    expect(events.find((e) => e.kind === "claim.deleted")).toBeDefined();
  });

  it("deleteClaim returns false for missing id", () => {
    expect(store.deleteClaim("missing")).toBe(false);
  });

  it("subscribe receives upsert events on create and update", () => {
    const events: LaunchClaimChangeEvent[] = [];
    const unsubscribe = store.subscribe((event) => events.push(event));
    store.createClaim(makeInput());
    store.updateClaim("claim-001", (current) => ({
      ...current,
      status: "expired",
    }));
    unsubscribe();
    const upsertEvents = events.filter((e) => e.kind === "claim.upserted");
    expect(upsertEvents).toHaveLength(2);
  });

  it("quarantines malformed entry files instead of crashing", () => {
    store.createClaim(makeInput());
    const entryDir = join(rootDir, "entries");
    writeFileSync(join(entryDir, "bad.json"), "{ this is not json", "utf8");
    // listClaims should still succeed.
    const claims = store.listClaims();
    expect(claims).toHaveLength(1);
    const quarantineDir = join(rootDir, "quarantine");
    const quarantined = readdirSync(quarantineDir);
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
  });

  it("validates failure reason on round-trip parse", () => {
    const claim = store.createClaim(makeInput());
    const updated = store.updateClaim(claim.launchClaimId, (current) => ({
      ...current,
      status: "failed",
      failureCode: "terminal-spawn-failed",
      failureReason: "spawn ENOENT".repeat(50),
    }));
    expect(updated.failureReason).not.toBeNull();
    expect(updated.failureReason!.length).toBeLessThanOrEqual(
      LAUNCH_CLAIM_FAILURE_REASON_MAX_LENGTH,
    );
  });

  it("parseLaunchClaim defaults missing seenCandidateCopilotSessionIds to []", () => {
    const minimal = {
      schemaVersion: 1,
      launchClaimId: "x",
      workstreamId: "ws",
      nodeId: "n",
      launchNonce: "nonce",
      expectedCwd: "/tmp",
      expectedBranch: null,
      expectedRepo: null,
      contextId: null,
      launchedAt: "2026-05-02T00:00:00.000Z",
      bindingWindowMs: 1000,
      retentionWindowMs: 1000,
      status: "pending",
      boundCopilotSessionId: null,
      boundRegistryId: null,
      reservedRegistryId: null,
      failureReason: null,
      failureCode: null,
      lineageMetadata: null,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const parsed = parseLaunchClaim(minimal);
    expect(parsed.seenCandidateCopilotSessionIds).toEqual([]);
    expect(parsed.evidence.attempts).toEqual([]);
  });
});
