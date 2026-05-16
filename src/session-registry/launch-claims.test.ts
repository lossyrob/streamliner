import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LAUNCH_NONCE_MIN_LENGTH,
  LAUNCH_NONCE_PROMPT_LINE_PREFIX,
  applyReservedRowCleanup,
  createLaunchClaim,
  defaultMintLaunchNonce,
  isClaimPastRetention,
  isClaimWindowOpen,
  kickoffNonceLine,
  markClaimFailed,
  reconcileOrphanReservedRows,
} from "./launch-claims";
import { LaunchClaimFileStore } from "./launch-claim-store";
import { SessionRegistryFileStore } from "./file-store";

function makeRegistryRoot(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-registry-claims-"));
}

function makeClaimRoot(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-launch-claims-store-"));
}

describe("kickoffNonceLine", () => {
  it("returns the canonical prompt line containing the nonce", () => {
    const line = kickoffNonceLine("abc123");
    expect(line).toBe(`${LAUNCH_NONCE_PROMPT_LINE_PREFIX}abc123`);
    expect(line.includes("abc123")).toBe(true);
  });
});

describe("defaultMintLaunchNonce", () => {
  it("produces ≥128-bit URL-safe base64 tokens", () => {
    const nonce = defaultMintLaunchNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(LAUNCH_NONCE_MIN_LENGTH);
    expect(/^[A-Za-z0-9_-]+$/.test(nonce)).toBe(true);
    expect(nonce.includes("\n")).toBe(false);
  });
});

describe("isClaimWindowOpen / isClaimPastRetention", () => {
  it("treats now < launchedAt + bindingWindowMs as open", () => {
    const launchedAt = "2026-05-02T01:00:00.000Z";
    const launchedAtMs = Date.parse(launchedAt);
    const claim = {
      launchedAt,
      bindingWindowMs: 5 * 60 * 1000,
      retentionWindowMs: 60 * 60 * 1000,
      updatedAt: launchedAt,
    } as never;
    expect(isClaimWindowOpen(claim, launchedAtMs + 60_000)).toBe(true);
    expect(isClaimWindowOpen(claim, launchedAtMs + 6 * 60 * 1000)).toBe(false);
  });

  it("treats now > updatedAt + retentionWindowMs as past retention", () => {
    const updatedAt = "2026-05-02T01:00:00.000Z";
    const updatedAtMs = Date.parse(updatedAt);
    const claim = {
      launchedAt: updatedAt,
      bindingWindowMs: 5 * 60 * 1000,
      retentionWindowMs: 60 * 60 * 1000,
      updatedAt,
    } as never;
    expect(isClaimPastRetention(claim, updatedAtMs + 30 * 60 * 1000)).toBe(false);
    expect(isClaimPastRetention(claim, updatedAtMs + 61 * 60 * 1000)).toBe(true);
  });
});

describe("createLaunchClaim", () => {
  let registryRoot: string;
  let claimRoot: string;
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;

  beforeEach(() => {
    registryRoot = makeRegistryRoot();
    claimRoot = makeClaimRoot();
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
  });

  afterEach(() => {
    rmSync(registryRoot, { recursive: true, force: true });
    rmSync(claimRoot, { recursive: true, force: true });
  });

  it("happy path: writes row first, then claim, returns both ids (Path A default)", () => {
    let nextId = 0;
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws-1",
        nodeId: "node-A",
        expectedCwd: "C:/repo/work",
        expectedBranch: "feature/x",
      },
      {
        mintNonce: () => "deterministic-nonce-12345",
        mintLaunchClaimId: () => "claim-D",
        mintRegistryRowId: () => `reg-${(nextId += 1)}`,
        now: () => new Date("2026-05-02T01:00:00.000Z"),
      },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.claim.launchClaimId).toBe("claim-D");
    expect(outcome.claim.launchNonce).toBe("deterministic-nonce-12345");
    expect(outcome.claim.reservedRegistryId).toBe("reg-1");
    expect(outcome.reservedRegistryId).toBe("reg-1");

    const reservedRow = registryStore.getSession("reg-1");
    expect(reservedRow).not.toBeNull();
    expect(reservedRow?.origin).toEqual({
      kind: "launched",
      launchClaimId: "claim-D",
    });
    expect(reservedRow?.graphBinding).toEqual({
      workstreamId: "ws-1",
      nodeId: "node-A",
      launchClaimId: "claim-D",
    });
    expect(reservedRow?.copilotSessionId).toBeNull();
    expect(reservedRow?.lifecycleStatus).toBe("active");

    const persistedClaim = claimStore.getClaim("claim-D");
    expect(persistedClaim?.status).toBe("pending");
    expect(persistedClaim?.reservedRegistryId).toBe("reg-1");
  });

  it("records resolved terminal cliArgs on the reserved row", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws-1",
        nodeId: "node-A",
        expectedCwd: "C:/repo/work",
        cliArgs: ["--yolo", "--model=gpt-5.5"],
      },
      {
        mintNonce: () => "deterministic-nonce-12345",
        mintLaunchClaimId: () => "claim-cli",
        mintRegistryRowId: () => "reg-cli",
        now: () => new Date("2026-05-02T01:00:00.000Z"),
      },
    );

    expect(outcome.ok).toBe(true);
    const reservedRow = registryStore.getSession("reg-cli");
    expect(reservedRow?.origin).toEqual({
      kind: "launched",
      launchClaimId: "claim-cli",
      cliArgs: ["--yolo", "--model=gpt-5.5"],
    });
  });

  it("stores durable PAW launch metadata on the reserved row", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws-paw",
        nodeId: "node-paw",
        expectedCwd: "C:/repo/work",
        pawLaunch: {
          workId: "paw-artifact-status-observation",
          workTitle: "PAW Artifact Status Observation",
          workflowKind: "paw-lite",
          pawWorkDir: "C:/repo/work/.paw/work/paw-artifact-status-observation",
          workflowContextPath:
            "C:/repo/work/.paw/work/paw-artifact-status-observation/WorkflowContext.md",
          streamlinerContextPath:
            "C:/repo/work/.paw/work/paw-artifact-status-observation/streamliner/context.md",
        },
      },
      {
        mintLaunchClaimId: () => "claim-PAW",
        mintRegistryRowId: () => "reg-PAW",
      },
    );

    expect(outcome.ok).toBe(true);
    expect(registryStore.getSession("reg-PAW")?.pawLaunch).toEqual({
      workId: "paw-artifact-status-observation",
      workTitle: "PAW Artifact Status Observation",
      workflowKind: "paw-lite",
      pawWorkDir: "C:/repo/work/.paw/work/paw-artifact-status-observation",
      workflowContextPath:
        "C:/repo/work/.paw/work/paw-artifact-status-observation/WorkflowContext.md",
      streamlinerContextPath:
        "C:/repo/work/.paw/work/paw-artifact-status-observation/streamliner/context.md",
    });
  });

  it("Path B (opt-out): no row reserved, claim still written", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws-1",
        nodeId: "node-B",
        expectedCwd: "C:/repo/work",
        reserveRegistryRow: false,
      },
      {
        mintLaunchClaimId: () => "claim-B",
        mintNonce: () => "nonce-B-12345678901234",
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reservedRegistryId).toBeNull();
    expect(outcome.claim.reservedRegistryId).toBeNull();
    expect(registryStore.listSessions()).toHaveLength(0);
  });

  it("rejects invalid input (empty workstreamId/nodeId/expectedCwd)", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "", nodeId: "n", expectedCwd: "C:/x" },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("invalid-input");
  });

  it("rejects oversize lineageMetadata", () => {
    const huge = { padding: "x".repeat(5000) };
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        lineageMetadata: huge,
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("invalid-input");
  });

  it("preserves caller-supplied launchNonce", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        launchNonce: "caller-nonce-abc-12345",
        reserveRegistryRow: false,
      },
      { mintLaunchClaimId: () => "claim-N" },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.claim.launchNonce).toBe("caller-nonce-abc-12345");
  });
});

describe("markClaimFailed", () => {
  let registryRoot: string;
  let claimRoot: string;
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;

  beforeEach(() => {
    registryRoot = makeRegistryRoot();
    claimRoot = makeClaimRoot();
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
  });

  afterEach(() => {
    rmSync(registryRoot, { recursive: true, force: true });
    rmSync(claimRoot, { recursive: true, force: true });
  });

  it("transitions a pending claim to failed and deletes the unattached reserved row", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
      },
      {
        mintLaunchClaimId: () => "claim-FAIL",
        mintRegistryRowId: () => "reg-FAIL",
      },
    );
    expect(outcome.ok).toBe(true);
    const result = markClaimFailed(
      registryStore,
      claimStore,
      "claim-FAIL",
      "terminal-spawn-failed",
      "spawn ENOENT",
    );
    expect(result.ok).toBe(true);
    expect(result.transitioned).toBe(true);
    expect(result.reservedRowDeleted).toBe(true);
    expect(result.reservedRowGraphBindingCleared).toBe(false);
    expect(result.claim?.status).toBe("failed");
    expect(result.claim?.failureCode).toBe("terminal-spawn-failed");
    expect(registryStore.getSession("reg-FAIL")).toBeNull();
  });

  it("preserves the row but clears graphBinding when copilotSessionId is set", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      {
        workstreamId: "ws",
        nodeId: "n",
        expectedCwd: "C:/x",
        pawLaunch: {
          workId: "work-1",
          workTitle: "Work 1",
          workflowKind: "paw-lite",
          pawWorkDir: "C:/x/.paw/work/work-1",
          workflowContextPath: "C:/x/.paw/work/work-1/WorkflowContext.md",
          streamlinerContextPath: "C:/x/.paw/work/work-1/streamliner/context.md",
        },
      },
      {
        mintLaunchClaimId: () => "claim-PRESERVE",
        mintRegistryRowId: () => "reg-PRESERVE",
      },
    );
    expect(outcome.ok).toBe(true);
    // Simulate observation attaching a session to the reserved row.
    registryStore.attachObservedSession("reg-PRESERVE", {
      copilotSessionId: "copilot-XYZ",
      cwd: "C:/x",
      lastSeenAt: "2026-05-02T01:30:00.000Z",
    });
    const result = markClaimFailed(
      registryStore,
      claimStore,
      "claim-PRESERVE",
      "user-cancelled",
      null,
    );
    expect(result.reservedRowDeleted).toBe(false);
    expect(result.reservedRowGraphBindingCleared).toBe(true);
    const row = registryStore.getSession("reg-PRESERVE");
    expect(row?.copilotSessionId).toBe("copilot-XYZ");
    expect(row?.graphBinding).toBeNull();
    expect(row?.pawLaunch?.pawWorkDir).toBe("C:/x/.paw/work/work-1");
    expect(row?.origin).toEqual({ kind: "launched", launchClaimId: "claim-PRESERVE" });
  });

  it("is idempotent on already-terminal claims", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/x" },
      { mintLaunchClaimId: () => "claim-IDEM" },
    );
    expect(outcome.ok).toBe(true);
    const first = markClaimFailed(
      registryStore,
      claimStore,
      "claim-IDEM",
      "internal-error",
      "boom",
    );
    expect(first.transitioned).toBe(true);
    const second = markClaimFailed(
      registryStore,
      claimStore,
      "claim-IDEM",
      "internal-error",
      "different-reason",
    );
    expect(second.transitioned).toBe(false);
    expect(second.claim?.failureReason).toBe("boom");
  });

  it("sanitizes failureReason: multi-line and over-cap inputs are bounded", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/x", reserveRegistryRow: false },
      { mintLaunchClaimId: () => "claim-SANI" },
    );
    expect(outcome.ok).toBe(true);
    const messy = "line1\nline2\nline3" + "x".repeat(500);
    const result = markClaimFailed(
      registryStore,
      claimStore,
      "claim-SANI",
      "internal-error",
      messy,
    );
    expect(result.claim?.failureReason).not.toBeNull();
    expect(result.claim?.failureReason!.length).toBeLessThanOrEqual(256);
    expect(result.claim?.failureReason!.includes("\n")).toBe(false);
  });

  it("returns ok:false for missing claim", () => {
    const result = markClaimFailed(
      registryStore,
      claimStore,
      "missing",
      "internal-error",
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.claim).toBeNull();
  });
});

describe("applyReservedRowCleanup", () => {
  let registryStore: SessionRegistryFileStore;
  let registryRoot: string;
  beforeEach(() => {
    registryRoot = makeRegistryRoot();
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
  });
  afterEach(() => {
    rmSync(registryRoot, { recursive: true, force: true });
  });

  it("noop when claim has no reservedRegistryId", () => {
    const result = applyReservedRowCleanup(registryStore, {
      reservedRegistryId: null,
    } as never);
    expect(result.reservedRowDeleted).toBe(false);
    expect(result.reservedRowGraphBindingCleared).toBe(false);
  });

  it("noop when reserved row has already been deleted", () => {
    const claim = {
      reservedRegistryId: "missing",
      workstreamId: "w",
      nodeId: "n",
      launchClaimId: "c",
    } as never;
    const result = applyReservedRowCleanup(registryStore, claim);
    expect(result.reservedRowDeleted).toBe(false);
    expect(result.reservedRowGraphBindingCleared).toBe(false);
  });
});

describe("reconcileOrphanReservedRows", () => {
  let registryRoot: string;
  let claimRoot: string;
  let registryStore: SessionRegistryFileStore;
  let claimStore: LaunchClaimFileStore;

  beforeEach(() => {
    registryRoot = makeRegistryRoot();
    claimRoot = makeClaimRoot();
    registryStore = new SessionRegistryFileStore({ rootDir: registryRoot });
    claimStore = new LaunchClaimFileStore({ rootDir: claimRoot });
  });

  afterEach(() => {
    rmSync(registryRoot, { recursive: true, force: true });
    rmSync(claimRoot, { recursive: true, force: true });
  });

  it("deletes orphan launched rows whose claim is missing and copilotSessionId is null", () => {
    // Manually create a launched row without a corresponding claim.
    registryStore.upsertSession({
      id: "orphan-1",
      title: "Orphan",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "missing-claim" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "n",
        launchClaimId: "missing-claim",
      },
    });

    const result = reconcileOrphanReservedRows(registryStore, claimStore);
    expect(result.rowsInspected).toBe(1);
    expect(result.rowsDeleted).toBe(1);
    expect(registryStore.getSession("orphan-1")).toBeNull();
  });

  it("preserves orphan launched rows that have a copilotSessionId, clears graphBinding", () => {
    registryStore.upsertSession({
      id: "orphan-with-session",
      title: "Orphan",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "gone-claim" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "n",
        launchClaimId: "gone-claim",
      },
    });
    // Simulate observation attaching a session to the launched row.
    registryStore.attachObservedSession("orphan-with-session", {
      copilotSessionId: "real-session",
      cwd: "C:/x",
      lastSeenAt: "2026-05-02T01:00:00.000Z",
    });
    const result = reconcileOrphanReservedRows(registryStore, claimStore);
    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsGraphBindingCleared).toBe(1);
    const row = registryStore.getSession("orphan-with-session");
    expect(row?.copilotSessionId).toBe("real-session");
    expect(row?.graphBinding).toBeNull();

    const second = reconcileOrphanReservedRows(registryStore, claimStore);
    expect(second.rowsDeleted).toBe(0);
    expect(second.rowsGraphBindingCleared).toBe(0);
  });

  it("preserves orphan managed SDK rows without a copilotSessionId and clears graphBinding", () => {
    registryStore.upsertSession({
      id: "orphan-managed-sdk",
      title: "Managed orphan",
      description: "",
      cwd: "C:/x",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId: "gone-managed-claim" },
      lifecycleStatus: "active",
      graphBinding: {
        workstreamId: "ws",
        nodeId: "managed-node",
        launchClaimId: "gone-managed-claim",
      },
      runtime: {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        permissionProfile: "managed-autonomous",
        launchClaimId: "gone-managed-claim",
        launchNonce: "managed-nonce",
        sdkSessionId: "sdk-session",
        sdkWorkspacePath: "C:/x/.copilot/sdk",
        sdkStateRoot: "C:/x/.copilot",
        startedAt: "2026-05-02T01:00:00.000Z",
        lastStateChangedAt: "2026-05-02T01:00:00.000Z",
        progressEvents: [],
        evidence: [],
      },
    });

    const result = reconcileOrphanReservedRows(registryStore, claimStore);

    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsGraphBindingCleared).toBe(1);
    const row = registryStore.getSession("orphan-managed-sdk");
    expect(row).not.toBeNull();
    expect(row?.copilotSessionId).toBeNull();
    expect(row?.graphBinding).toBeNull();
    expect(row?.runtime?.lifecycleState).toBe("running");
  });

  it("leaves rows alone when their claim still exists", () => {
    const outcome = createLaunchClaim(
      registryStore,
      claimStore,
      { workstreamId: "ws", nodeId: "n", expectedCwd: "C:/x" },
      {
        mintLaunchClaimId: () => "claim-OK",
        mintRegistryRowId: () => "reg-OK",
      },
    );
    expect(outcome.ok).toBe(true);
    const result = reconcileOrphanReservedRows(registryStore, claimStore);
    expect(result.rowsInspected).toBe(1);
    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsGraphBindingCleared).toBe(0);
    expect(registryStore.getSession("reg-OK")).not.toBeNull();
  });
});
