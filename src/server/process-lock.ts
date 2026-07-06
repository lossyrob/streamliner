import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { resolveSessionRegistryRoot } from "../session-registry/runtime";
import {
  isProcessLockStale,
  type ProcessLockMetadata,
} from "../session-registry/lock-liveness";

export class StreamlinerApiLockError extends Error {
  constructor(lockPath: string, options?: ErrorOptions) {
    super(`Another Streamliner API process appears to own ${lockPath}.`, options);
    this.name = "StreamlinerApiLockError";
  }
}

function readLockMetadata(lockPath: string): ProcessLockMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const candidate = parsed as { pid?: unknown; acquiredAt?: unknown };
  if (
    typeof candidate.pid !== "number" ||
    !Number.isInteger(candidate.pid) ||
    candidate.pid <= 0
  ) {
    return null;
  }
  // Tolerate lock files that predate the acquiredAt field: the PID check still
  // applies, only the reboot heuristic is skipped for them.
  const acquiredAt =
    typeof candidate.acquiredAt === "string" ? candidate.acquiredAt : "";
  return { pid: candidate.pid, acquiredAt };
}

export interface ApiProcessLockOptions {
  host?: string;
  port?: number;
}

export function acquireApiProcessLock(options: ApiProcessLockOptions = {}): () => void {
  const rootDir = resolveSessionRegistryRoot();
  const lockPath = join(rootDir, "api.lock");
  mkdirSync(rootDir, { recursive: true });

  const existing = readLockMetadata(lockPath);
  if (existing && isProcessLockStale(existing)) {
    rmSync(lockPath, { force: true });
  }

  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
          host: options.host ?? null,
          port: options.port ?? null,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error: unknown) {
    throw new StreamlinerApiLockError(lockPath, { cause: error });
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }

  return () => {
    if (readLockMetadata(lockPath)?.pid === process.pid) {
      rmSync(lockPath, { force: true });
    }
  };
}
