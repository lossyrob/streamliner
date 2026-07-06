import { describe, expect, it } from "vitest";

import {
  LOCK_BOOT_STALE_MARGIN_MS,
  isAcquiredBeforeBoot,
  isProcessLockStale,
  processExists,
  systemBootTimeMs,
} from "./lock-liveness";

// Far above any plausible live PID; process.kill(pid, 0) reports ESRCH.
const DEAD_PID = 999999999;

describe("processExists", () => {
  it("reports the current process as alive", () => {
    expect(processExists(process.pid)).toBe(true);
  });

  it("reports an unused PID as dead", () => {
    expect(processExists(DEAD_PID)).toBe(false);
  });

  it("rejects invalid PIDs without signaling process groups", () => {
    expect(processExists(0)).toBe(false);
    expect(processExists(-1)).toBe(false);
    expect(processExists(1.5)).toBe(false);
  });
});

describe("systemBootTimeMs", () => {
  it("subtracts uptime from the current time", () => {
    expect(systemBootTimeMs({ nowMs: 100_000, uptimeMs: 40_000 })).toBe(60_000);
  });

  it("returns null when uptime is unavailable or implausible", () => {
    expect(systemBootTimeMs({ nowMs: 100_000, uptimeMs: 0 })).toBeNull();
    expect(systemBootTimeMs({ nowMs: 100_000, uptimeMs: Number.NaN })).toBeNull();
    // Uptime longer than the epoch offset would place boot before 1970.
    expect(systemBootTimeMs({ nowMs: 100_000, uptimeMs: 200_000 })).toBeNull();
  });

  it("uses the real clock and uptime by default", () => {
    const bootTime = systemBootTimeMs();
    expect(bootTime).not.toBeNull();
    expect(bootTime as number).toBeLessThanOrEqual(Date.now());
  });
});

describe("isAcquiredBeforeBoot", () => {
  // bootTime = nowMs - uptimeMs = 900_000
  const overrides = { nowMs: 1_000_000, uptimeMs: 100_000, bootStaleMarginMs: 0 };

  it("treats timestamps before boot as pre-boot", () => {
    expect(isAcquiredBeforeBoot(new Date(899_999).toISOString(), overrides)).toBe(true);
  });

  it("treats timestamps at or after boot as current", () => {
    expect(isAcquiredBeforeBoot(new Date(900_001).toISOString(), overrides)).toBe(false);
  });

  it("applies the safety margin so near-boot locks are not reclaimed", () => {
    // threshold = bootTime - margin = 890_000
    const withMargin = { nowMs: 1_000_000, uptimeMs: 100_000, bootStaleMarginMs: 10_000 };
    expect(isAcquiredBeforeBoot(new Date(889_999).toISOString(), withMargin)).toBe(true);
    expect(isAcquiredBeforeBoot(new Date(895_000).toISOString(), withMargin)).toBe(false);
  });

  it("returns false for unparseable timestamps", () => {
    expect(isAcquiredBeforeBoot("not-a-date", overrides)).toBe(false);
    expect(isAcquiredBeforeBoot("", overrides)).toBe(false);
  });

  it("returns false when boot time cannot be determined", () => {
    expect(
      isAcquiredBeforeBoot(new Date(0).toISOString(), { nowMs: 1_000, uptimeMs: 0 }),
    ).toBe(false);
  });

  it("defaults to a positive safety margin", () => {
    expect(LOCK_BOOT_STALE_MARGIN_MS).toBeGreaterThan(0);
  });
});

describe("isProcessLockStale", () => {
  it("is stale when the owning process is gone", () => {
    expect(
      isProcessLockStale({ pid: DEAD_PID, acquiredAt: new Date().toISOString() }),
    ).toBe(true);
  });

  it("is not stale for a live process that acquired the lock after boot", () => {
    expect(
      isProcessLockStale(
        { pid: process.pid, acquiredAt: new Date(950_000).toISOString() },
        { nowMs: 1_000_000, uptimeMs: 100_000, bootStaleMarginMs: 0 },
      ),
    ).toBe(false);
  });

  it("is stale when a live (reused) PID holds a lock acquired before boot", () => {
    expect(
      isProcessLockStale(
        { pid: process.pid, acquiredAt: new Date(800_000).toISOString() },
        { nowMs: 1_000_000, uptimeMs: 100_000, bootStaleMarginMs: 0 },
      ),
    ).toBe(true);
  });
});
