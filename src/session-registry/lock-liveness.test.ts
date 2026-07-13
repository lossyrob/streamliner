import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOCK_BOOT_STALE_MARGIN_MS,
  createLockFileAtomically,
  currentUptimeMs,
  isAcquiredBeforeCurrentBoot,
  isProcessLockStale,
  newLockMetadata,
  parseLockMetadata,
  processExists,
  readLockMetadataFile,
} from "./lock-liveness";

const { rmSyncMock } = vi.hoisted(() => ({ rmSyncMock: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  rmSyncMock.mockImplementation(actual.rmSync);
  return { ...actual, rmSync: rmSyncMock };
});

// Far above any plausible live PID; process.kill(pid, 0) reports ESRCH.
const DEAD_PID = 999999999;

const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("processExists", () => {
  it("reports the current process as alive", () => {
    expect(processExists(process.pid)).toBe(true);
  });

  it("reports an unused PID as dead", () => {
    expect(processExists(DEAD_PID)).toBe(false);
  });

  it("rejects invalid PIDs without signaling process groups", () => {
    // process.kill(0, 0) would signal the current process group; guard first.
    expect(processExists(0)).toBe(false);
    expect(processExists(-1)).toBe(false);
    expect(processExists(1.5)).toBe(false);
  });
});

describe("currentUptimeMs", () => {
  it("returns the override when provided", () => {
    expect(currentUptimeMs({ uptimeMs: 42_000 })).toBe(42_000);
  });

  it("returns null for implausible uptime", () => {
    expect(currentUptimeMs({ uptimeMs: Number.NaN })).toBeNull();
    expect(currentUptimeMs({ uptimeMs: -1 })).toBeNull();
  });

  it("reads real OS uptime by default", () => {
    const value = currentUptimeMs();
    expect(value).not.toBeNull();
    expect(value as number).toBeGreaterThanOrEqual(0);
  });
});

describe("isAcquiredBeforeCurrentBoot", () => {
  const overrides = { uptimeMs: 100_000, bootStaleMarginMs: 0 };

  it("is true when the recorded uptime exceeds the current uptime (previous, longer boot)", () => {
    expect(
      isAcquiredBeforeCurrentBoot({ pid: 1, acquiredUptimeMs: 100_001 }, overrides),
    ).toBe(true);
  });

  it("is false when the recorded uptime is within the current session", () => {
    expect(
      isAcquiredBeforeCurrentBoot({ pid: 1, acquiredUptimeMs: 100_000 }, overrides),
    ).toBe(false);
    expect(
      isAcquiredBeforeCurrentBoot({ pid: 1, acquiredUptimeMs: 5_000 }, overrides),
    ).toBe(false);
  });

  it("applies the safety margin so near-boundary locks are not reclaimed", () => {
    const withMargin = { uptimeMs: 100_000, bootStaleMarginMs: 10_000 };
    // threshold = 100_000 + 10_000 = 110_000
    expect(
      isAcquiredBeforeCurrentBoot({ pid: 1, acquiredUptimeMs: 110_001 }, withMargin),
    ).toBe(true);
    expect(
      isAcquiredBeforeCurrentBoot({ pid: 1, acquiredUptimeMs: 105_000 }, withMargin),
    ).toBe(false);
  });

  it("is false (conservative) for legacy locks without acquiredUptimeMs", () => {
    expect(isAcquiredBeforeCurrentBoot({ pid: 1 }, overrides)).toBe(false);
    expect(
      isAcquiredBeforeCurrentBoot(
        { pid: 1, acquiredUptimeMs: Number.NaN },
        overrides,
      ),
    ).toBe(false);
  });

  it("is false when current uptime is unavailable", () => {
    expect(
      isAcquiredBeforeCurrentBoot(
        { pid: 1, acquiredUptimeMs: 100_000 },
        { uptimeMs: Number.NaN },
      ),
    ).toBe(false);
  });

  it("defaults to a positive safety margin", () => {
    expect(LOCK_BOOT_STALE_MARGIN_MS).toBeGreaterThan(0);
  });
});

describe("isProcessLockStale", () => {
  it("is stale when the owning process is gone", () => {
    expect(
      isProcessLockStale({ pid: DEAD_PID, acquiredUptimeMs: 5_000 }),
    ).toBe(true);
  });

  it("is not stale for a live process acquired during the current boot", () => {
    expect(
      isProcessLockStale(
        { pid: process.pid, acquiredUptimeMs: 5_000 },
        { uptimeMs: 100_000, bootStaleMarginMs: 0 },
      ),
    ).toBe(false);
  });

  it("is stale when a live (reused) PID holds a lock from a previous, longer boot", () => {
    expect(
      isProcessLockStale(
        { pid: process.pid, acquiredUptimeMs: 200_000 },
        { uptimeMs: 100_000, bootStaleMarginMs: 0 },
      ),
    ).toBe(true);
  });

  it("is not stale (fails safe) for a live PID on a legacy lock without uptime", () => {
    expect(
      isProcessLockStale({ pid: process.pid, acquiredAt: "2000-01-01T00:00:00.000Z" }),
    ).toBe(false);
  });
});

describe("newLockMetadata", () => {
  it("stamps pid, wall clock, and system uptime", () => {
    const meta = newLockMetadata();
    expect(meta.pid).toBe(process.pid);
    expect(typeof meta.acquiredAt).toBe("string");
    expect(typeof meta.acquiredUptimeMs).toBe("number");
    expect(meta.acquiredUptimeMs as number).toBeGreaterThanOrEqual(0);
  });

  it("merges extra fields", () => {
    const meta = newLockMetadata({ host: "127.0.0.1", port: 4319 });
    expect(meta.host).toBe("127.0.0.1");
    expect(meta.port).toBe(4319);
    expect(meta.pid).toBe(process.pid);
  });
});

describe("parseLockMetadata", () => {
  it("parses a full lock record", () => {
    const meta = parseLockMetadata(
      JSON.stringify({ pid: 123, acquiredAt: "2026-01-01T00:00:00.000Z", acquiredUptimeMs: 7 }),
    );
    expect(meta).toEqual({ pid: 123, acquiredAt: "2026-01-01T00:00:00.000Z", acquiredUptimeMs: 7 });
  });

  it("returns null for unparseable or non-object content", () => {
    expect(parseLockMetadata("")).toBeNull();
    expect(parseLockMetadata("not json")).toBeNull();
    expect(parseLockMetadata("42")).toBeNull();
    expect(parseLockMetadata("null")).toBeNull();
  });

  it("returns null for a missing or non-positive-integer PID", () => {
    expect(parseLockMetadata(JSON.stringify({ acquiredAt: "x" }))).toBeNull();
    expect(parseLockMetadata(JSON.stringify({ pid: 0 }))).toBeNull();
    expect(parseLockMetadata(JSON.stringify({ pid: -3 }))).toBeNull();
    expect(parseLockMetadata(JSON.stringify({ pid: 1.5 }))).toBeNull();
  });

  it("tolerates legacy records missing acquiredAt/acquiredUptimeMs", () => {
    expect(parseLockMetadata(JSON.stringify({ pid: 42 }))).toEqual({ pid: 42 });
  });

  it("ignores malformed optional fields", () => {
    expect(
      parseLockMetadata(JSON.stringify({ pid: 42, acquiredAt: 5, acquiredUptimeMs: "x" })),
    ).toEqual({ pid: 42 });
  });
});

describe("readLockMetadataFile", () => {
  it("reads and parses an existing lock file", () => {
    const root = mkdtempSync(join(tmpdir(), "streamliner-lock-liveness-"));
    createdRoots.push(root);
    const lockPath = join(root, "api.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 99, acquiredUptimeMs: 1 }), "utf8");
    expect(readLockMetadataFile(lockPath)).toEqual({ pid: 99, acquiredUptimeMs: 1 });
  });

  it("returns null when the file is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "streamliner-lock-liveness-"));
    createdRoots.push(root);
    expect(readLockMetadataFile(join(root, "missing.lock"))).toBeNull();
  });
});

describe("createLockFileAtomically", () => {
  it("preserves the link error when temporary-file cleanup fails", () => {
    const root = mkdtempSync(join(tmpdir(), "streamliner-lock-liveness-"));
    createdRoots.push(root);
    const lockPath = join(root, "api.lock");
    writeFileSync(lockPath, "existing", "utf8");
    const remove = rmSyncMock.getMockImplementation();
    rmSyncMock.mockImplementation((path, options) => {
      if (String(path).endsWith(".tmp")) {
        throw new Error("cleanup failed");
      }
      return remove?.(path, options);
    });

    expect(() => createLockFileAtomically(lockPath, { pid: process.pid })).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
  });
});
