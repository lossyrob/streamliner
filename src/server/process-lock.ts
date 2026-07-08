import {
  closeSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { resolveSessionRegistryRoot } from "../session-registry/runtime";
import {
  isProcessLockStale,
  newLockMetadata,
  readLockMetadataFile,
} from "../session-registry/lock-liveness";

export class StreamlinerApiLockError extends Error {
  constructor(lockPath: string, options?: ErrorOptions) {
    super(`Another Streamliner API process appears to own ${lockPath}.`, options);
    this.name = "StreamlinerApiLockError";
  }
}

export interface ApiProcessLockOptions {
  host?: string;
  port?: number;
}

export function acquireApiProcessLock(options: ApiProcessLockOptions = {}): () => void {
  const rootDir = resolveSessionRegistryRoot();
  const lockPath = join(rootDir, "api.lock");
  mkdirSync(rootDir, { recursive: true });

  const existing = readLockMetadataFile(lockPath);
  if (existing && isProcessLockStale(existing)) {
    rmSync(lockPath, { force: true });
  }

  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(
      fd,
      JSON.stringify(
        newLockMetadata({
          host: options.host ?? null,
          port: options.port ?? null,
        }),
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
    if (readLockMetadataFile(lockPath)?.pid === process.pid) {
      rmSync(lockPath, { force: true });
    }
  };
}
