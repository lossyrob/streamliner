import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  LAUNCH_CLAIM_SCHEMA_VERSION,
  type LaunchClaim,
  type LaunchClaimIndex,
  type LaunchClaimIndexEntry,
  parseLaunchClaim,
  parseLaunchClaimIndex,
  projectLaunchClaimToIndexEntry,
} from "../launch-claim-schema";
import {
  LaunchClaimAlreadyExistsError,
  type LaunchClaimChangeEvent,
  type LaunchClaimChangeListener,
  type LaunchClaimCreateInput,
  type LaunchClaimListOptions,
  LaunchClaimLockedError,
  LaunchClaimNotFoundError,
  type LaunchClaimStore,
} from "../launch-claim-contract";

const DEFAULT_LAUNCH_CLAIMS_ROOT = resolve(
  homedir(),
  ".streamliner",
  "state",
  "launch-claims",
);

const ENTRY_EXTENSION = ".json";
const SHARED_SLEEP_BUFFER = new SharedArrayBuffer(4);
const SHARED_SLEEP_ARRAY = new Int32Array(SHARED_SLEEP_BUFFER);
const WRITE_LOCK_WAIT_TIMEOUT_MS = 5_000;
const WRITE_LOCK_WAIT_INTERVAL_MS = 50;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface LaunchClaimFileStoreOptions {
  rootDir?: string;
  writeLockWaitTimeoutMs?: number;
}

export function getDefaultLaunchClaimRoot(): string {
  return DEFAULT_LAUNCH_CLAIMS_ROOT;
}

export function getEnvLaunchClaimRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STREAMLINER_LAUNCH_CLAIMS_ROOT;
  if (override && override.trim().length > 0) {
    return resolve(override.trim());
  }
  return DEFAULT_LAUNCH_CLAIMS_ROOT;
}

interface LockMetadata {
  pid: number;
  acquiredAt: string;
}

function sleepSync(ms: number): void {
  Atomics.wait(SHARED_SLEEP_ARRAY, 0, 0, ms);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

function renameWithRetries(from: string, to: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (code !== "EPERM" && code !== "EACCES") {
        throw error;
      }
      lastError = error;
      sleepSync(25 * (attempt + 1));
    }
  }
  throw lastError;
}

function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  renameWithRetries(tempPath, path);
}

function isoNow(): string {
  return new Date().toISOString();
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function validateClaimId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid launch claim id: ${id}`);
  }
}

function entryFileName(launchClaimId: string): string {
  return `${launchClaimId}${ENTRY_EXTENSION}`;
}

function buildIndex(claims: Iterable<LaunchClaim>): LaunchClaimIndex {
  const entries: LaunchClaimIndexEntry[] = [];
  for (const claim of claims) {
    entries.push(projectLaunchClaimToIndexEntry(claim));
  }
  // Newest-first by launchedAt; tie-break by launchClaimId for determinism.
  entries.sort((a, b) => {
    if (a.launchedAt > b.launchedAt) return -1;
    if (a.launchedAt < b.launchedAt) return 1;
    return a.launchClaimId.localeCompare(b.launchClaimId);
  });
  return { schemaVersion: LAUNCH_CLAIM_SCHEMA_VERSION, entries };
}

function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class LaunchClaimFileStore implements LaunchClaimStore {
  private readonly rootDir: string;
  private readonly entriesDir: string;
  private readonly quarantineDir: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly recoveryLockPath: string;
  private readonly writeLockWaitTimeoutMs: number;
  private readonly listeners = new Set<LaunchClaimChangeListener>();

  constructor(options?: LaunchClaimFileStoreOptions) {
    this.rootDir = resolve(options?.rootDir ?? DEFAULT_LAUNCH_CLAIMS_ROOT);
    this.entriesDir = join(this.rootDir, "entries");
    this.quarantineDir = join(this.rootDir, "quarantine");
    this.indexPath = join(this.rootDir, "index.json");
    this.lockPath = join(this.rootDir, "launch-claims.lock");
    this.recoveryLockPath = join(this.rootDir, "launch-claims.lock.recovery");
    this.writeLockWaitTimeoutMs =
      options?.writeLockWaitTimeoutMs ?? WRITE_LOCK_WAIT_TIMEOUT_MS;
  }

  /** Returns the resolved root directory (testing and diagnostics). */
  getRootDir(): string {
    return this.rootDir;
  }

  createClaim(input: LaunchClaimCreateInput): LaunchClaim {
    validateClaimId(input.launchClaimId);
    const now = isoNow();
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      if (records.has(input.launchClaimId)) {
        throw new LaunchClaimAlreadyExistsError(input.launchClaimId);
      }
      const claim: LaunchClaim = {
        schemaVersion: LAUNCH_CLAIM_SCHEMA_VERSION,
        launchClaimId: input.launchClaimId,
        workstreamId: input.workstreamId,
        nodeId: input.nodeId,
        launchNonce: input.launchNonce,
        expectedCwd: input.expectedCwd,
        expectedBranch: input.expectedBranch,
        expectedRepo: input.expectedRepo,
        contextId: input.contextId,
        launchedAt: input.launchedAt,
        bindingWindowMs: input.bindingWindowMs,
        retentionWindowMs: input.retentionWindowMs,
        status: "pending",
        boundCopilotSessionId: null,
        boundRegistryId: null,
        reservedRegistryId: input.reservedRegistryId,
        failureReason: null,
        failureCode: null,
        seenCandidateCopilotSessionIds: [],
        evidence: { attempts: [] },
        lineageMetadata: input.lineageMetadata,
        createdAt: now,
        updatedAt: now,
      };
      // Round-trip validate on write to catch invalid inputs early.
      const validated = parseLaunchClaim(JSON.parse(JSON.stringify(claim)));
      records.set(validated.launchClaimId, validated);
      this.persistEntry(validated);
      this.persistIndex(records);
      this.emitChange({
        kind: "claim.upserted",
        launchClaimId: validated.launchClaimId,
        snapshot: cloneValue(validated),
      });
      return cloneValue(validated);
    });
  }

  getClaim(launchClaimId: string): LaunchClaim | null {
    const records = this.loadEntriesFromDisk();
    const claim = records.get(launchClaimId);
    return claim ? cloneValue(claim) : null;
  }

  listClaims(options: LaunchClaimListOptions = {}): LaunchClaimIndexEntry[] {
    const records = this.loadEntriesFromDisk();
    const index = buildIndex(records.values());
    let entries = index.entries;
    if (options.status !== undefined) {
      const statusSet = new Set(
        Array.isArray(options.status) ? options.status : [options.status],
      );
      entries = entries.filter((entry) => statusSet.has(entry.status));
    }
    if (options.workstreamId) {
      entries = entries.filter((entry) => entry.workstreamId === options.workstreamId);
    }
    if (options.nodeId) {
      entries = entries.filter((entry) => entry.nodeId === options.nodeId);
    }
    if (options.limit !== undefined && options.limit >= 0) {
      entries = entries.slice(0, options.limit);
    }
    return entries.map((entry) => cloneValue(entry));
  }

  updateClaim(
    launchClaimId: string,
    mutator: (current: LaunchClaim) => LaunchClaim,
  ): LaunchClaim {
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const current = records.get(launchClaimId);
      if (!current) {
        throw new LaunchClaimNotFoundError(launchClaimId);
      }
      const draft = mutator(cloneValue(current));
      if (draft.launchClaimId !== launchClaimId) {
        throw new Error(
          `LaunchClaim mutator returned mismatched launchClaimId: expected ${launchClaimId}, got ${draft.launchClaimId}.`,
        );
      }
      const next: LaunchClaim = {
        ...draft,
        updatedAt: deepEquals(current, draft) ? current.updatedAt : isoNow(),
      };
      const validated = parseLaunchClaim(JSON.parse(JSON.stringify(next)));
      records.set(launchClaimId, validated);
      this.persistEntry(validated);
      this.persistIndex(records);
      if (!deepEquals(current, validated)) {
        this.emitChange({
          kind: "claim.upserted",
          launchClaimId: validated.launchClaimId,
          snapshot: cloneValue(validated),
        });
      }
      return cloneValue(validated);
    });
  }

  deleteClaim(launchClaimId: string): boolean {
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      if (!records.has(launchClaimId)) {
        return false;
      }
      records.delete(launchClaimId);
      const entryPath = join(this.entriesDir, entryFileName(launchClaimId));
      rmSync(entryPath, { force: true });
      this.persistIndex(records);
      this.emitChange({ kind: "claim.deleted", launchClaimId });
      return true;
    });
  }

  subscribe(listener: LaunchClaimChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(event: LaunchClaimChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors must not break store mutations.
      }
    }
  }

  private loadEntriesFromDisk(): Map<string, LaunchClaim> {
    this.ensureDirectories();
    const records = new Map<string, LaunchClaim>();
    let entries: string[];
    try {
      entries = readdirSync(this.entriesDir);
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (code === "ENOENT") {
        return records;
      }
      throw error;
    }
    for (const filename of entries) {
      if (!filename.endsWith(ENTRY_EXTENSION)) {
        continue;
      }
      const filePath = join(this.entriesDir, filename);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.quarantine(filePath, raw);
        continue;
      }
      let claim: LaunchClaim;
      try {
        claim = parseLaunchClaim(parsed);
      } catch {
        this.quarantine(filePath, raw);
        continue;
      }
      records.set(claim.launchClaimId, claim);
    }
    return records;
  }

  private quarantine(filePath: string, raw: string): void {
    try {
      mkdirSync(this.quarantineDir, { recursive: true });
      const quarantineName = `${Date.now()}-${randomUUID()}.json`;
      writeFileSync(join(this.quarantineDir, quarantineName), raw, "utf8");
      rmSync(filePath, { force: true });
    } catch {
      // Best effort.
    }
  }

  private persistEntry(claim: LaunchClaim): void {
    const filePath = join(this.entriesDir, entryFileName(claim.launchClaimId));
    writeJsonFile(filePath, claim);
  }

  private persistIndex(records: Map<string, LaunchClaim>): void {
    const index = buildIndex(records.values());
    writeJsonFile(this.indexPath, index);
  }

  private ensureDirectories(): void {
    mkdirSync(this.entriesDir, { recursive: true });
    mkdirSync(this.quarantineDir, { recursive: true });
  }

  private withWriteLock<T>(operation: () => T): T {
    this.ensureDirectories();
    const lockFd = this.acquireLock();
    try {
      return operation();
    } finally {
      this.releaseLock(lockFd);
    }
  }

  private acquireLock(): number {
    let recoveryLockFd: number | null = null;
    const deadline = Date.now() + this.writeLockWaitTimeoutMs;
    try {
      for (;;) {
        if (recoveryLockFd === null && this.hasActiveRecoveryLock()) {
          if (Date.now() < deadline) {
            sleepSync(WRITE_LOCK_WAIT_INTERVAL_MS);
            continue;
          }
          throw new LaunchClaimLockedError(`Launch claim store is locked at ${this.lockPath}.`);
        }
        let fd: number;
        try {
          fd = openSync(this.lockPath, "wx");
        } catch (error: unknown) {
          const code =
            error instanceof Error && "code" in error
              ? String((error as NodeJS.ErrnoException).code)
              : "";
          if (code === "EEXIST") {
            if (recoveryLockFd === null) {
              recoveryLockFd = this.acquireRecoveryLock();
            }
            if (recoveryLockFd !== null && this.removeStaleLock()) {
              continue;
            }
            if (recoveryLockFd !== null) {
              this.releaseRecoveryLock(recoveryLockFd);
              recoveryLockFd = null;
            }
            if (Date.now() < deadline) {
              sleepSync(WRITE_LOCK_WAIT_INTERVAL_MS);
              continue;
            }
            throw new LaunchClaimLockedError(`Launch claim store is locked at ${this.lockPath}.`);
          }
          throw error;
        }
        try {
          writeFileSync(
            fd,
            JSON.stringify({ pid: process.pid, acquiredAt: isoNow() }),
            "utf8",
          );
        } catch (error: unknown) {
          try {
            closeSync(fd);
          } catch {
            // best effort
          }
          try {
            unlinkSync(this.lockPath);
          } catch {
            // best effort
          }
          throw error;
        }
        if (recoveryLockFd !== null) {
          this.releaseRecoveryLock(recoveryLockFd);
          recoveryLockFd = null;
        }
        return fd;
      }
    } finally {
      if (recoveryLockFd !== null) {
        this.releaseRecoveryLock(recoveryLockFd);
      }
    }
  }

  private releaseLock(fd: number): void {
    try {
      closeSync(fd);
    } finally {
      rmSync(this.lockPath, { force: true });
    }
  }

  private removeStaleLock(): boolean {
    const meta = this.readLockMetadata(this.lockPath);
    if (!meta || processExists(meta.pid)) {
      return false;
    }
    rmSync(this.lockPath, { force: true });
    return true;
  }

  private acquireRecoveryLock(): number | null {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let fd: number;
      try {
        fd = openSync(this.recoveryLockPath, "wx");
      } catch (error: unknown) {
        const code =
          error instanceof Error && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : "";
        if (code === "EEXIST") {
          if (attempt === 0 && !this.hasActiveRecoveryLock()) {
            continue;
          }
          return null;
        }
        throw error;
      }
      try {
        writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, acquiredAt: isoNow() }),
          "utf8",
        );
      } catch (error: unknown) {
        try {
          closeSync(fd);
        } catch {
          // best effort
        }
        try {
          unlinkSync(this.recoveryLockPath);
        } catch {
          // best effort
        }
        throw error;
      }
      return fd;
    }
    return null;
  }

  private releaseRecoveryLock(fd: number): void {
    try {
      closeSync(fd);
    } finally {
      rmSync(this.recoveryLockPath, { force: true });
    }
  }

  private hasActiveRecoveryLock(): boolean {
    const meta = this.readLockMetadata(this.recoveryLockPath);
    if (!meta) {
      return false;
    }
    if (processExists(meta.pid)) {
      return true;
    }
    rmSync(this.recoveryLockPath, { force: true });
    return false;
  }

  private readLockMetadata(lockPath: string): LockMetadata | null {
    if (!existsSync(lockPath)) {
      return null;
    }
    try {
      const raw = readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { pid?: unknown }).pid === "number" &&
        typeof (parsed as { acquiredAt?: unknown }).acquiredAt === "string"
      ) {
        return {
          pid: (parsed as LockMetadata).pid,
          acquiredAt: (parsed as LockMetadata).acquiredAt,
        };
      }
    } catch {
      // fall through
    }
    return null;
  }

  /**
   * Loads the persisted index file directly (cheap reads). Returns null
   * when the file does not exist or is unparseable; in that case callers
   * should call `listClaims()` which rebuilds from entries.
   */
  readIndexFromDisk(): LaunchClaimIndex | null {
    try {
      const raw = readFileSync(this.indexPath, "utf8");
      const parsed = JSON.parse(raw);
      return parseLaunchClaimIndex(parsed);
    } catch {
      return null;
    }
  }

  /** Statistics for diagnostics (per-store). */
  stats(): { rootDir: string; entryCount: number; indexExists: boolean } {
    const records = this.loadEntriesFromDisk();
    let indexExists = false;
    try {
      statSync(this.indexPath);
      indexExists = true;
    } catch {
      indexExists = false;
    }
    return { rootDir: this.rootDir, entryCount: records.size, indexExists };
  }
}
