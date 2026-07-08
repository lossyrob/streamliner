import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StreamlinerApiLockError, acquireApiProcessLock } from "./process-lock";

const ORIGINAL_ROOT = process.env.STREAMLINER_SESSION_REGISTRY_ROOT;
const createdRoots: string[] = [];

function useTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-api-lock-"));
  createdRoots.push(root);
  process.env.STREAMLINER_SESSION_REGISTRY_ROOT = root;
  return root;
}

function readLock(root: string): { pid: number; acquiredAt?: string; acquiredUptimeMs?: number } {
  return JSON.parse(readFileSync(join(root, "api.lock"), "utf8"));
}

afterEach(() => {
  if (ORIGINAL_ROOT === undefined) {
    delete process.env.STREAMLINER_SESSION_REGISTRY_ROOT;
  } else {
    process.env.STREAMLINER_SESSION_REGISTRY_ROOT = ORIGINAL_ROOT;
  }
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("acquireApiProcessLock", () => {
  it("acquires the lock, records owner metadata, and releases it", () => {
    const root = useTempRoot();
    const release = acquireApiProcessLock({ host: "127.0.0.1", port: 4319 });
    const lockPath = join(root, "api.lock");

    expect(existsSync(lockPath)).toBe(true);
    const meta = readLock(root);
    expect(meta.pid).toBe(process.pid);
    expect(typeof meta.acquiredAt).toBe("string");
    expect(typeof meta.acquiredUptimeMs).toBe("number");

    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("reclaims a lock held by a dead process", () => {
    const root = useTempRoot();
    writeFileSync(
      join(root, "api.lock"),
      JSON.stringify({ pid: 999999999, acquiredUptimeMs: Math.round(uptime() * 1000) }),
      "utf8",
    );

    const release = acquireApiProcessLock();
    expect(readLock(root).pid).toBe(process.pid);
    release();
  });

  it("reclaims a stale lock left by a reboot even when the PID was reused", () => {
    const root = useTempRoot();
    const lockPath = join(root, "api.lock");
    // A live PID (this process, standing in for a reused PID) plus an
    // acquiredUptimeMs far beyond the current uptime can only come from a
    // previous, longer-running boot session — exactly the wedged-startup state
    // the user hit after a restart. It must be reclaimed, not left for manual
    // deletion. Using now + 10 min guarantees it exceeds the current uptime.
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        acquiredAt: "2000-01-01T00:00:00.000Z",
        acquiredUptimeMs: Math.round(uptime() * 1000) + 600_000,
      }),
      "utf8",
    );

    const release = acquireApiProcessLock();
    expect(existsSync(lockPath)).toBe(true);
    expect(readLock(root).pid).toBe(process.pid);

    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("throws when a live process holds a fresh current-boot lock", () => {
    const root = useTempRoot();
    const lockPath = join(root, "api.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        acquiredUptimeMs: 1_000,
      }),
      "utf8",
    );

    expect(() => acquireApiProcessLock()).toThrow(StreamlinerApiLockError);
    // The still-active lock is left intact.
    expect(existsSync(lockPath)).toBe(true);
  });

  it("throws for a legacy live lock without acquiredUptimeMs (fails safe)", () => {
    const root = useTempRoot();
    const lockPath = join(root, "api.lock");
    // A legacy `{ pid }`-only lock from a live PID cannot be proven stale
    // (no reboot evidence), so it is respected rather than stolen.
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), "utf8");

    expect(() => acquireApiProcessLock()).toThrow(StreamlinerApiLockError);
    expect(existsSync(lockPath)).toBe(true);
    expect(readLock(root).pid).toBe(process.pid);
  });

  it("reclaims a legacy dead lock without acquiredUptimeMs", () => {
    const root = useTempRoot();
    const lockPath = join(root, "api.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999999999 }), "utf8");

    const release = acquireApiProcessLock();
    expect(readLock(root).pid).toBe(process.pid);
    release();
  });

  it("release leaves a lock reacquired by another process untouched", () => {
    const root = useTempRoot();
    const release = acquireApiProcessLock();
    const lockPath = join(root, "api.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999998, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    release();
    expect(existsSync(lockPath)).toBe(true);
    expect(readLock(root).pid).toBe(999999998);
  });
});
