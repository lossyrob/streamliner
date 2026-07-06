import { uptime } from "node:os";

/**
 * Reboot-safe liveness checks for advisory lock files.
 *
 * Streamliner guards single-writer resources (the local API process, the
 * session registry, and the launch-claim store) with on-disk lock files that
 * record the owning process's PID. The naive staleness test — "is a process
 * with this PID still alive?" — is not safe across a machine restart: the
 * operating system freely reuses PIDs, so after a reboot the dead owner's PID
 * is often reassigned to an unrelated live process. `process.kill(pid, 0)`
 * then reports the lock as held forever, wedging startup (`api.lock`) or
 * spinning the background worker on "registry locked; will retry"
 * (`registry.lock`).
 *
 * Every lock file also records `acquiredAt`. Because no process can have
 * acquired a lock before the machine last booted, a lock whose `acquiredAt`
 * predates the current boot is definitively abandoned regardless of whether
 * its PID happens to exist again. This module combines both signals so a lock
 * is treated as stale when the owning PID is gone OR the lock predates boot.
 */

export interface ProcessLockMetadata {
  pid: number;
  acquiredAt: string;
}

/**
 * Test/diagnostic overrides. Production callers pass nothing and the real
 * wall clock and OS uptime are used.
 */
export interface LockLivenessOverrides {
  /** Current wall-clock time in ms. Defaults to `Date.now()`. */
  nowMs?: number;
  /** System uptime in ms. Defaults to `os.uptime() * 1000`. */
  uptimeMs?: number;
  /**
   * How far before the computed boot time `acquiredAt` must fall before the
   * lock is considered pre-boot. Absorbs small clock skew / NTP adjustments so
   * a lock held by a genuinely live process is never reclaimed. Defaults to
   * {@link LOCK_BOOT_STALE_MARGIN_MS}.
   */
  bootStaleMarginMs?: number;
}

/**
 * Safety margin subtracted from the computed boot time. A lock only counts as
 * "acquired before boot" when it predates boot by more than this margin, so a
 * modest backward wall-clock adjustment cannot make an active lock look stale.
 */
export const LOCK_BOOT_STALE_MARGIN_MS = 60_000;

export function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the process exists but is owned by another user; treat it as
    // alive so we never steal a lock we merely lack permission to signal.
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

/**
 * Estimated wall-clock time of the last system boot, in ms since the epoch.
 * Returns `null` when uptime is unavailable or implausible so callers fall
 * back to the PID check alone rather than risk reclaiming live locks.
 */
export function systemBootTimeMs(overrides: LockLivenessOverrides = {}): number | null {
  const nowMs = overrides.nowMs ?? Date.now();
  const uptimeMs = overrides.uptimeMs ?? uptime() * 1000;
  if (!Number.isFinite(nowMs) || !Number.isFinite(uptimeMs) || uptimeMs <= 0) {
    return null;
  }
  const bootTimeMs = nowMs - uptimeMs;
  return bootTimeMs > 0 ? bootTimeMs : null;
}

/**
 * True when `acquiredAt` falls before the last system boot (minus the safety
 * margin). Such a lock cannot belong to a still-running process.
 */
export function isAcquiredBeforeBoot(
  acquiredAt: string,
  overrides: LockLivenessOverrides = {},
): boolean {
  const acquiredMs = Date.parse(acquiredAt);
  if (!Number.isFinite(acquiredMs)) {
    return false;
  }
  const bootTimeMs = systemBootTimeMs(overrides);
  if (bootTimeMs === null) {
    return false;
  }
  const marginMs = overrides.bootStaleMarginMs ?? LOCK_BOOT_STALE_MARGIN_MS;
  return acquiredMs < bootTimeMs - marginMs;
}

/**
 * True when a lock described by `metadata` can be safely reclaimed: either its
 * owning process is gone, or it was acquired before the machine last booted
 * (covering PID reuse across a restart).
 */
export function isProcessLockStale(
  metadata: ProcessLockMetadata,
  overrides: LockLivenessOverrides = {},
): boolean {
  if (!processExists(metadata.pid)) {
    return true;
  }
  return isAcquiredBeforeBoot(metadata.acquiredAt, overrides);
}
