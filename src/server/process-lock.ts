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

export class StreamlinerApiLockError extends Error {
  constructor(lockPath: string, options?: ErrorOptions) {
    super(`Another Streamliner API process appears to own ${lockPath}.`, options);
    this.name = "StreamlinerApiLockError";
  }
}

function getErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return getErrorCode(error) !== "ESRCH";
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const existing = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return typeof existing.pid === "number" &&
      Number.isInteger(existing.pid) &&
      existing.pid > 0
      ? existing.pid
      : null;
  } catch (error: unknown) {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    return null;
  }
}

export function acquireApiProcessLock(): () => void {
  const rootDir = resolveSessionRegistryRoot();
  const lockPath = join(rootDir, "api.lock");
  mkdirSync(rootDir, { recursive: true });

  const existingPid = readLockPid(lockPath);
  if (typeof existingPid === "number" && !processExists(existingPid)) {
    rmSync(lockPath, { force: true });
  }

  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2),
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
    if (readLockPid(lockPath) === process.pid) {
      rmSync(lockPath, { force: true });
    }
  };
}
