import { mkdirSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";

import type { SessionFsConfig, SessionFsProvider } from "@github/copilot-sdk";

const SESSION_FS_HOST_ROOT = resolve(
  homedir(),
  ".streamliner",
  "state",
  "copilot-sdk-session-fs",
);
const SESSION_FS_PATH_API = process.platform === "win32" ? win32 : posix;
const SESSION_FS_STATE_PATH = SESSION_FS_PATH_API.join(
  SESSION_FS_HOST_ROOT,
  ".session-state",
);

function sanitizeSessionIdForPath(sessionId: string): string {
  const sanitized = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "session";
}

export interface CopilotSdkSessionFsHandle {
  rootDir: string;
  provider: SessionFsProvider;
  cleanup: () => Promise<void>;
}

const DEFAULT_COPILOT_SESSION_STATE_ROOT = resolve(
  homedir(),
  ".copilot",
  "session-state",
);

function isWithinVirtualRoot(basePath: string, candidatePath: string): boolean {
  const relativePath = SESSION_FS_PATH_API.relative(basePath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !SESSION_FS_PATH_API.isAbsolute(relativePath))
  );
}

function toRelativeSessionFsPath(virtualPath: string): string {
  if (!virtualPath || virtualPath === ".") {
    return "";
  }

  const normalizedPath = SESSION_FS_PATH_API.normalize(virtualPath);
  const candidateRelative = SESSION_FS_PATH_API.isAbsolute(normalizedPath)
    ? isWithinVirtualRoot(SESSION_FS_HOST_ROOT, normalizedPath)
      ? SESSION_FS_PATH_API.relative(SESSION_FS_HOST_ROOT, normalizedPath)
      : (() => {
          const error = new Error(
            `SessionFs path is outside the configured root: ${virtualPath}`,
          ) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        })()
    : normalizedPath;

  const segments = candidateRelative
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    const error = new Error(
      `SessionFs path escapes the configured root: ${virtualPath}`,
    ) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }

  return segments.length > 0 ? join(...segments) : "";
}

function toLocalPath(rootDir: string, virtualPath: string): string {
  const relativePath = toRelativeSessionFsPath(virtualPath);
  return relativePath.length > 0 ? resolve(rootDir, relativePath) : rootDir;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export function getCopilotSdkSessionFsConfig(): SessionFsConfig {
  mkdirSync(SESSION_FS_HOST_ROOT, { recursive: true });
  return {
    initialCwd: SESSION_FS_HOST_ROOT,
    sessionStatePath: SESSION_FS_STATE_PATH,
    conventions: process.platform === "win32" ? "windows" : "posix",
  };
}

export function createCopilotSdkSessionFsHandle(
  sessionId: string,
): CopilotSdkSessionFsHandle {
  const rootDir = resolve(SESSION_FS_HOST_ROOT, sanitizeSessionIdForPath(sessionId));
  const provider: SessionFsProvider = {
    async readFile(path) {
      return await readFile(toLocalPath(rootDir, path), "utf8");
    },
    async writeFile(path, content, mode) {
      const filePath = toLocalPath(rootDir, path);
      await ensureParentDirectory(filePath);
      await writeFile(filePath, content, { encoding: "utf8", mode });
    },
    async appendFile(path, content, mode) {
      const filePath = toLocalPath(rootDir, path);
      await ensureParentDirectory(filePath);
      await appendFile(filePath, content, { encoding: "utf8", mode });
    },
    async exists(path) {
      try {
        await access(toLocalPath(rootDir, path), fsConstants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async stat(path) {
      const info = await stat(toLocalPath(rootDir, path));
      return {
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        size: info.size,
        mtime: info.mtime.toISOString(),
        birthtime: info.birthtime.toISOString(),
      };
    },
    async mkdir(path, recursive, mode) {
      await mkdir(toLocalPath(rootDir, path), { recursive, mode });
    },
    async readdir(path) {
      return await readdir(toLocalPath(rootDir, path));
    },
    async readdirWithTypes(path) {
      const entries = await readdir(toLocalPath(rootDir, path), {
        withFileTypes: true,
      });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }));
    },
    async rm(path, recursive, force) {
      await rm(toLocalPath(rootDir, path), { recursive, force });
    },
    async rename(src, dest) {
      const destinationPath = toLocalPath(rootDir, dest);
      await ensureParentDirectory(destinationPath);
      await rename(toLocalPath(rootDir, src), destinationPath);
    },
  };

  return {
    rootDir,
    provider,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export async function cleanupResidualDefaultCopilotSessionState(
  sessionId: string,
): Promise<void> {
  const defaultSessionDir = resolve(DEFAULT_COPILOT_SESSION_STATE_ROOT, sessionId);
  if (!isWithinVirtualRoot(DEFAULT_COPILOT_SESSION_STATE_ROOT, defaultSessionDir)) {
    return;
  }
  await rm(defaultSessionDir, { recursive: true, force: true });
}
