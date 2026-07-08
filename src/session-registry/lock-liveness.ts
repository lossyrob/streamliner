import { readFileSync } from "node:fs";
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
 * To distinguish "the real owner is still running" from "the PID was reused
 * after a reboot", each lock records the **system uptime at acquisition**
 * (`acquiredUptimeMs`, from `os.uptime()`). System uptime is monotonic and
 * resets to ~0 at every boot, so:
 *
 *   - A lock acquired during the *current* boot session has
 *     `acquiredUptimeMs <= currentUptimeMs` (it was taken earlier in the same,
 *     ever-increasing uptime timeline).
 *   - A lock whose `acquiredUptimeMs` *exceeds* the current uptime can only
 *     have been written during a *previous, longer-running* boot session — the
 *     machine has since restarted and the PID was reused. That lock is
 *     abandoned and safe to reclaim even though its PID is live.
 *
 * Crucially this comparison is **immune to wall-clock changes** (NTP steps,
 * manual clock edits, VM host time sync), unlike comparing a persisted
 * wall-clock `acquiredAt` against a `Date.now() - uptime` boot estimate. The
 * only residual case it does not auto-reclaim — a previous boot that acquired
 * the lock at a *lower* uptime than the current session has already reached,
 * with the PID since reused — fails **safe**: the lock is simply left in place
 * (the pre-existing "manual cleanup" symptom) rather than a live lock being
 * stolen out from under a running writer (which would corrupt via two writers).
 *
 * `acquiredAt` (wall clock) is still recorded for human-readable diagnostics
 * but is intentionally **not** used for staleness decisions.
 */

export interface ProcessLockMetadata {
  pid: number;
  /** Wall-clock acquisition time (ISO 8601). Diagnostics only. */
  acquiredAt?: string;
  /** `os.uptime() * 1000` at acquisition. Monotonic, reboot-relative. */
  acquiredUptimeMs?: number;
}

/**
 * Test/diagnostic overrides. Production callers pass nothing and the real OS
 * uptime is used.
 */
export interface LockLivenessOverrides {
  /** Current system uptime in ms. Defaults to `os.uptime() * 1000`. */
  uptimeMs?: number;
  /**
   * Slack added to the current uptime before a lock counts as belonging to a
   * previous boot. Absorbs uptime read jitter between acquisition and check so
   * a lock held by the genuine current owner is never reclaimed. Only ever
   * delays reclamation, so it is safe to keep generous.
   */
  bootStaleMarginMs?: number;
}

/**
 * Slack (ms) added to the current uptime when deciding whether a lock predates
 * the current boot. A lock only counts as pre-boot when its recorded
 * `acquiredUptimeMs` exceeds the current uptime by more than this margin.
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
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    // ESRCH is the only definitive "no such process". Everything else — EPERM
    // (exists but owned by another user) or any unexpected error — fails
    // closed to "alive" so we never steal a lock we cannot prove is dead.
    return code !== "ESRCH";
  }
}

/** Current system uptime in ms, or `null` when unavailable/implausible. */
export function currentUptimeMs(overrides: LockLivenessOverrides = {}): number | null {
  const value = overrides.uptimeMs ?? uptime() * 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * True when `metadata` was acquired during a boot session *before* the current
 * one — i.e. its recorded uptime exceeds the current uptime (plus margin), so
 * a live PID owning it must be a post-reboot reuse. Returns false (conservative)
 * for legacy locks that predate `acquiredUptimeMs`, or when uptime is
 * unavailable, so an unprovable lock is never reclaimed while its PID is live.
 */
export function isAcquiredBeforeCurrentBoot(
  metadata: ProcessLockMetadata,
  overrides: LockLivenessOverrides = {},
): boolean {
  const acquiredUptimeMs = metadata.acquiredUptimeMs;
  if (typeof acquiredUptimeMs !== "number" || !Number.isFinite(acquiredUptimeMs)) {
    return false;
  }
  const nowUptimeMs = currentUptimeMs(overrides);
  if (nowUptimeMs === null) {
    return false;
  }
  const marginMs = overrides.bootStaleMarginMs ?? LOCK_BOOT_STALE_MARGIN_MS;
  return acquiredUptimeMs > nowUptimeMs + marginMs;
}

/**
 * True when a lock described by `metadata` can be safely reclaimed: either its
 * owning process is gone, or it was acquired during a previous boot session
 * (covering PID reuse across a restart).
 */
export function isProcessLockStale(
  metadata: ProcessLockMetadata,
  overrides: LockLivenessOverrides = {},
): boolean {
  if (!processExists(metadata.pid)) {
    return true;
  }
  return isAcquiredBeforeCurrentBoot(metadata, overrides);
}

/**
 * Build fresh lock metadata for the current process, stamped with the current
 * wall clock and system uptime. `extra` fields (e.g. api.lock's host/port) are
 * merged in.
 */
export function newLockMetadata(
  extra: Record<string, unknown> = {},
): ProcessLockMetadata & Record<string, unknown> {
  return {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    acquiredUptimeMs: Math.round(uptime() * 1000),
    ...extra,
  };
}

/**
 * Parse lock-file contents into {@link ProcessLockMetadata}. Shared by all lock
 * owners so the PID/uptime validation rules cannot drift apart. Returns `null`
 * for missing/unparseable content or a non-positive-integer PID. `acquiredAt`
 * and `acquiredUptimeMs` are optional so legacy lock files still parse (their
 * PID liveness still applies; only the reboot heuristic is unavailable).
 */
export function parseLockMetadata(raw: string): ProcessLockMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.pid !== "number" ||
    !Number.isInteger(candidate.pid) ||
    candidate.pid <= 0
  ) {
    return null;
  }
  const metadata: ProcessLockMetadata = { pid: candidate.pid };
  if (typeof candidate.acquiredAt === "string") {
    metadata.acquiredAt = candidate.acquiredAt;
  }
  if (
    typeof candidate.acquiredUptimeMs === "number" &&
    Number.isFinite(candidate.acquiredUptimeMs)
  ) {
    metadata.acquiredUptimeMs = candidate.acquiredUptimeMs;
  }
  return metadata;
}

/**
 * Read and parse a lock file. Returns `null` when the file is absent,
 * unreadable, or invalid.
 */
export function readLockMetadataFile(lockPath: string): ProcessLockMetadata | null {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  return parseLockMetadata(raw);
}
