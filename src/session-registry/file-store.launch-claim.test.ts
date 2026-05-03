import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionRegistryPatch } from "../session-registry-contract";
import { SessionRegistryConflictError, SessionRegistryFileStore } from "./file-store";

const createdRoots: string[] = [];

function createRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "streamliner-launch-claim-fs-"));
  createdRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const rootDir of createdRoots.splice(0)) {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("SessionRegistryFileStore — launch-claim atomic primitives", () => {
  let store: SessionRegistryFileStore;

  beforeEach(() => {
    const rootDir = createRootDir();
    store = new SessionRegistryFileStore({ rootDir });
  });

  function makeManualSession(
    overrides: { id?: string; cwd?: string; repo?: string | null; branch?: string | null; graphBinding?: { workstreamId: string; nodeId: string; launchClaimId: string } | null } = {},
  ) {
    return store.upsertSession({
      id: overrides.id ?? "manual-1",
      title: "Manual",
      description: "",
      cwd: overrides.cwd ?? "C:/repo/work",
      repo: overrides.repo ?? "lossyrob/streamliner",
      branch: overrides.branch ?? "feature/test",
      tags: [],
      origin: { kind: "manual" },
      graphBinding: overrides.graphBinding ?? null,
    });
  }

  function makeReservedRow(
    launchClaimId: string,
    overrides: { id?: string; cwd?: string } = {},
  ) {
    return store.upsertSession({
      id: overrides.id ?? `reserved-${launchClaimId}`,
      title: "Reserved",
      description: "",
      cwd: overrides.cwd ?? "C:/repo/work",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "launched", launchClaimId },
      graphBinding: {
        workstreamId: "ws-1",
        nodeId: "node-1",
        launchClaimId,
      },
    });
  }

  describe("deleteSessionIf", () => {
    it("deletes when predicate is true", () => {
      const row = makeManualSession();
      const result = store.deleteSessionIf(row.id, () => true);
      expect(result).toEqual({ deleted: true, reason: "deleted" });
      expect(store.getSession(row.id)).toBeNull();
    });

    it("does not delete when predicate is false", () => {
      const row = makeManualSession();
      const result = store.deleteSessionIf(row.id, () => false);
      expect(result).toEqual({ deleted: false, reason: "predicate-false" });
      expect(store.getSession(row.id)).not.toBeNull();
    });

    it("returns not-found for missing id", () => {
      const result = store.deleteSessionIf("does-not-exist", () => true);
      expect(result).toEqual({ deleted: false, reason: "not-found" });
    });

    it("evaluates predicate against the latest disk state, not a stale snapshot", () => {
      const row = makeReservedRow("claim-A");
      // Predicate that requires copilotSessionId == null. Reserved row
      // has copilotSessionId == null, so delete should succeed.
      const result = store.deleteSessionIf(row.id, (current) => current.copilotSessionId === null);
      expect(result.deleted).toBe(true);
    });
  });

  describe("bindClaimToRow", () => {
    it("writes graphBinding when invariants hold and bumps version on change", () => {
      const row = makeManualSession({ id: "row-1" });
      const result = store.bindClaimToRow(
        row.id,
        {
          cwdAfterNormalize: row.cwd,
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-A",
          },
        },
        {
          graphBinding: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-A",
          },
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.record.graphBinding).toEqual({
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "claim-A",
        });
        expect(result.record.version).toBe(row.version + 1);
      }
    });

    it("rejects when row's cwd no longer matches expected", () => {
      const row = makeManualSession({ id: "row-2" });
      const result = store.bindClaimToRow(
        row.id,
        {
          cwdAfterNormalize: "C:/different/path",
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-A",
          },
        },
        {
          graphBinding: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-A",
          },
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("cwd-changed");
      }
    });

    it("rejects when existing graphBinding has a different launchClaimId", () => {
      const row = makeManualSession({
        id: "row-3",
        graphBinding: {
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "OTHER-claim",
        },
      });
      const result = store.bindClaimToRow(
        row.id,
        {
          cwdAfterNormalize: row.cwd,
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "NEW-claim",
          },
        },
        {
          graphBinding: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "NEW-claim",
          },
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("graph-binding-conflict");
      }
    });

    it("returns row-vanished when row is missing", () => {
      const result = store.bindClaimToRow(
        "missing",
        {
          cwdAfterNormalize: "C:/x",
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: "w",
            nodeId: "n",
            launchClaimId: "c",
          },
        },
        {
          graphBinding: {
            workstreamId: "w",
            nodeId: "n",
            launchClaimId: "c",
          },
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("row-vanished");
      }
    });

    it("clears graphBinding to null and bumps version", () => {
      const row = makeReservedRow("claim-B");
      const result = store.bindClaimToRow(
        row.id,
        {
          cwdAfterNormalize: row.cwd,
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-B",
          },
        },
        { graphBinding: null },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.record.graphBinding).toBeNull();
        expect(result.record.version).toBe(row.version + 1);
      }
    });

    it("does not bump version when graphBinding is unchanged", () => {
      const row = makeReservedRow("claim-C");
      const result = store.bindClaimToRow(
        row.id,
        {
          cwdAfterNormalize: row.cwd,
          branch: null,
          repo: null,
          requireGraphBindingNullOrMatching: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-C",
          },
        },
        {
          graphBinding: {
            workstreamId: "ws-1",
            nodeId: "node-1",
            launchClaimId: "claim-C",
          },
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.record.version).toBe(row.version);
      }
    });
  });

  describe("fuseObservedRowIntoReservedRow", () => {
    it("transfers observation fields onto reserved row and deletes observed row", () => {
      const reserved = makeReservedRow("claim-D");
      const observed = store.upsertSession({
        id: "observed-D",
        title: "Observed",
        description: "",
        cwd: "C:/repo/work",
        repo: "lossyrob/streamliner",
        branch: "feature/discovered",
        copilotSessionId: "copilot-XYZ",
        lastSeenAt: "2026-05-02T01:30:00.000Z",
        observedSessionKind: "interactive",
        copilotProcessState: "live",
        copilotProcessId: 12345,
        origin: { kind: "observed", importedFromCopilotSessionId: "copilot-XYZ" },
      });

      const result = store.fuseObservedRowIntoReservedRow({
        reservedRowId: reserved.id,
        observedRowId: observed.id,
        bindClaim: {
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "claim-D",
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.reservedRecord.copilotSessionId).toBe("copilot-XYZ");
        expect(result.reservedRecord.lastSeenAt).toBe("2026-05-02T01:30:00.000Z");
        expect(result.reservedRecord.copilotProcessId).toBe(12345);
        expect(result.reservedRecord.graphBinding).toEqual({
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "claim-D",
        });
        expect(result.deletedObservedId).toBe(observed.id);
      }

      expect(store.getSession(observed.id)).toBeNull();
      const fused = store.getSession(reserved.id);
      expect(fused?.copilotSessionId).toBe("copilot-XYZ");
    });

    it("rejects fusion when reserved row already attached to a different session", () => {
      const reserved = makeReservedRow("claim-E");
      // Attach a different session id to the reserved row.
      store.attachObservedSession(reserved.id, {
        copilotSessionId: "OLD-session",
        cwd: reserved.cwd,
        lastSeenAt: "2026-05-02T01:00:00.000Z",
      });
      const observed = store.upsertSession({
        id: "observed-E",
        title: "Observed",
        description: "",
        cwd: "C:/repo/work",
        repo: null,
        branch: null,
        copilotSessionId: "DIFFERENT-session",
        lastSeenAt: "2026-05-02T01:30:00.000Z",
        origin: {
          kind: "observed",
          importedFromCopilotSessionId: "DIFFERENT-session",
        },
      });
      const result = store.fuseObservedRowIntoReservedRow({
        reservedRowId: reserved.id,
        observedRowId: observed.id,
        bindClaim: {
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "claim-E",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("reserved-row-already-attached");
      }
      // Both rows still exist.
      expect(store.getSession(reserved.id)).not.toBeNull();
      expect(store.getSession(observed.id)).not.toBeNull();
    });

    it("rejects fusion when reserved row has graphBinding for a different claim", () => {
      const reserved = makeReservedRow("OTHER-claim");
      const observed = store.upsertSession({
        id: "observed-F",
        title: "Observed",
        description: "",
        cwd: "C:/repo/work",
        repo: null,
        branch: null,
        copilotSessionId: "copilot-F",
        lastSeenAt: "2026-05-02T01:30:00.000Z",
        origin: { kind: "observed", importedFromCopilotSessionId: "copilot-F" },
      });
      const result = store.fuseObservedRowIntoReservedRow({
        reservedRowId: reserved.id,
        observedRowId: observed.id,
        bindClaim: {
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "DESIRED-claim",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("graph-binding-conflict");
      }
    });

    it("returns reserved-row-vanished if reserved row missing", () => {
      const observed = store.upsertSession({
        id: "observed-G",
        title: "Observed",
        description: "",
        cwd: "C:/repo/work",
        repo: null,
        branch: null,
        copilotSessionId: "copilot-G",
        lastSeenAt: "2026-05-02T01:30:00.000Z",
        origin: { kind: "observed", importedFromCopilotSessionId: "copilot-G" },
      });
      const result = store.fuseObservedRowIntoReservedRow({
        reservedRowId: "missing-reserved",
        observedRowId: observed.id,
        bindClaim: {
          workstreamId: "ws-1",
          nodeId: "node-1",
          launchClaimId: "claim-G",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("reserved-row-vanished");
      }
    });
  });

  describe("findRecordIdByLaunchClaimId / findRecordIdByCopilotSession", () => {
    it("finds reserved row by launchClaimId", () => {
      const reserved = makeReservedRow("claim-H");
      expect(store.findRecordIdByLaunchClaimId("claim-H")).toBe(reserved.id);
      expect(store.findRecordIdByLaunchClaimId("missing")).toBeNull();
    });

    it("finds observed row by copilot session id", () => {
      const observed = store.upsertSession({
        id: "observed-I",
        title: "Observed",
        description: "",
        cwd: "C:/x",
        repo: null,
        branch: null,
        copilotSessionId: "copilot-I",
        lastSeenAt: "2026-05-02T01:00:00.000Z",
        origin: { kind: "observed", importedFromCopilotSessionId: "copilot-I" },
      });
      expect(store.findRecordIdByCopilotSession("copilot-I")).toBe(observed.id);
      expect(store.findRecordIdByCopilotSession("missing")).toBeNull();
    });
  });
});

describe("SessionRegistryFileStore — FR-7 patchSession({ graphBinding }) explicit coverage", () => {
  let store: SessionRegistryFileStore;

  beforeEach(() => {
    const rootDir = createRootDir();
    store = new SessionRegistryFileStore({ rootDir });
  });

  it("round-trips graphBinding through patchSession and bumps version", () => {
    const row = store.upsertSession({
      id: "row-fr7",
      title: "Manual",
      description: "",
      cwd: "C:/repo",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "manual" },
    });
    expect(row.graphBinding).toBeNull();

    const patch: SessionRegistryPatch = {
      graphBinding: {
        workstreamId: "ws-A",
        nodeId: "node-A",
        launchClaimId: "claim-FR7",
      },
      expectedVersion: row.version,
    };
    const patched = store.patchSession(row.id, patch);
    expect(patched.graphBinding).toEqual({
      workstreamId: "ws-A",
      nodeId: "node-A",
      launchClaimId: "claim-FR7",
    });
    expect(patched.version).toBe(row.version + 1);
  });

  it("rejects stale expectedVersion with 409-equivalent conflict error", () => {
    const row = store.upsertSession({
      id: "row-fr7-conflict",
      title: "Manual",
      description: "",
      cwd: "C:/repo",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "manual" },
    });
    // Apply one patch to bump version.
    const v1 = store.patchSession(row.id, {
      graphBinding: {
        workstreamId: "w",
        nodeId: "n",
        launchClaimId: "first",
      },
      expectedVersion: row.version,
    });
    // Builder using the original snapshot tries to patch with stale version.
    expect(() =>
      store.patchSession(row.id, {
        graphBinding: {
          workstreamId: "w",
          nodeId: "n",
          launchClaimId: "stale",
        },
        expectedVersion: row.version,
      }),
    ).toThrow(SessionRegistryConflictError);
    // The latest persisted graphBinding remains the first one.
    const latest = store.getSession(row.id)!;
    expect(latest.graphBinding?.launchClaimId).toBe("first");
    expect(latest.version).toBe(v1.version);
  });

  it("clearing graphBinding via patchSession works and bumps version", () => {
    const row = store.upsertSession({
      id: "row-fr7-clear",
      title: "Manual",
      description: "",
      cwd: "C:/repo",
      repo: null,
      branch: null,
      tags: [],
      origin: { kind: "manual" },
      graphBinding: {
        workstreamId: "w",
        nodeId: "n",
        launchClaimId: "claim",
      },
    });
    const cleared = store.patchSession(row.id, {
      graphBinding: null,
      expectedVersion: row.version,
    });
    expect(cleared.graphBinding).toBeNull();
    expect(cleared.version).toBe(row.version + 1);
  });
});
