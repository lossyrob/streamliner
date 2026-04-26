import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  SESSION_REGISTRY_TRUSTED_SIGNAL_EVENTS,
  type SessionRegistryStore,
  type SessionRegistryTrustedSignalInput,
} from "../session-registry-contract";
import {
  SESSION_REGISTRY_TRUSTED_END_REASONS,
  SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS,
  SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES,
  SESSION_REGISTRY_TRUSTED_START_SOURCES,
  type SessionRegistryTrustedEndReason,
  type SessionRegistryTrustedExecutionKind,
  type SessionRegistryTrustedSignalSource,
  type SessionRegistryTrustedStartSource,
} from "../session-registry-schema";
import { isCopilotSdkSessionFsPath } from "./copilot-sdk-session-paths";

export const SESSION_REGISTRY_SIGNAL_SPOOL_ROOT = resolve(
  homedir(),
  ".streamliner",
  "state",
  "session-signals",
);
export const SESSION_REGISTRY_SIGNAL_PENDING_DIR = "pending";
export const SESSION_REGISTRY_SIGNAL_FAILED_DIR = "failed";

export interface TrustedSessionSignalSpoolOptions {
  rootDir?: string;
  now?: () => Date;
  logger?: Pick<Console, "warn">;
}

export interface TrustedSessionSignalSpoolDrainResult {
  processed: number;
  failed: number;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function ensureString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }
  return value;
}

function ensureOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string when provided.`);
  }
  return value;
}

function ensureOptionalInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${fieldName} to be a non-negative integer when provided.`);
  }
  return value;
}

function normalizeEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
): T {
  const normalized = ensureString(value, fieldName);
  if (!allowed.includes(normalized as T)) {
    throw new Error(`Unsupported ${fieldName} "${normalized}".`);
  }
  return normalized as T;
}

function normalizeOptionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeEnum(value, fieldName, allowed);
}

export function getTrustedSessionSignalSpoolRoot(): string {
  return process.env.STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT ?? SESSION_REGISTRY_SIGNAL_SPOOL_ROOT;
}

export function shouldIgnoreTrustedSessionSignal(
  input: Pick<SessionRegistryTrustedSignalInput, "cwd">,
): boolean {
  return isCopilotSdkSessionFsPath(input.cwd);
}

export function parseTrustedSessionSignalInput(
  value: unknown,
): SessionRegistryTrustedSignalInput {
  if (!isJsonObject(value)) {
    throw new Error("Expected trusted session signal to be a JSON object.");
  }

  const signal: SessionRegistryTrustedSignalInput = {
    event: normalizeEnum(value.event, "signal.event", SESSION_REGISTRY_TRUSTED_SIGNAL_EVENTS),
    source: normalizeEnum<SessionRegistryTrustedSignalSource>(
      value.source,
      "signal.source",
      SESSION_REGISTRY_TRUSTED_SIGNAL_SOURCES,
    ),
    sessionId: ensureString(value.sessionId, "signal.sessionId"),
    timestamp: ensureString(value.timestamp, "signal.timestamp"),
    cwd: ensureString(value.cwd, "signal.cwd"),
  };

  if (hasOwn(value, "repo")) {
    signal.repo = ensureOptionalString(value.repo, "signal.repo");
  }
  if (hasOwn(value, "branch")) {
    signal.branch = ensureOptionalString(value.branch, "signal.branch");
  }
  if (hasOwn(value, "hookSource")) {
    signal.hookSource = normalizeOptionalEnum<SessionRegistryTrustedStartSource>(
      value.hookSource,
      "signal.hookSource",
      SESSION_REGISTRY_TRUSTED_START_SOURCES,
    );
  }
  if (hasOwn(value, "endReason")) {
    signal.endReason = normalizeOptionalEnum<SessionRegistryTrustedEndReason>(
      value.endReason,
      "signal.endReason",
      SESSION_REGISTRY_TRUSTED_END_REASONS,
    );
  }
  if (hasOwn(value, "executionKind")) {
    signal.executionKind = normalizeOptionalEnum<SessionRegistryTrustedExecutionKind>(
      value.executionKind,
      "signal.executionKind",
      SESSION_REGISTRY_TRUSTED_EXECUTION_KINDS,
    );
  }
  if (hasOwn(value, "environmentId")) {
    signal.environmentId = ensureOptionalString(value.environmentId, "signal.environmentId");
  }
  if (hasOwn(value, "initialPromptLength")) {
    signal.initialPromptLength = ensureOptionalInteger(
      value.initialPromptLength,
      "signal.initialPromptLength",
    );
  }
  if (hasOwn(value, "promptLength")) {
    signal.promptLength = ensureOptionalInteger(value.promptLength, "signal.promptLength");
  }

  return signal;
}

export function writeTrustedSessionSignalSpoolFile(
  input: SessionRegistryTrustedSignalInput,
  options: TrustedSessionSignalSpoolOptions = {},
): string {
  const rootDir = options.rootDir ?? getTrustedSessionSignalSpoolRoot();
  const pendingDir = join(rootDir, SESSION_REGISTRY_SIGNAL_PENDING_DIR);
  mkdirSync(pendingDir, { recursive: true });
  const now = options.now ?? (() => new Date());
  const safeSessionId = input.sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${now().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${safeSessionId}-${randomBytes(4).toString("hex")}.json`;
  const targetPath = join(pendingDir, fileName);
  const tempPath = `${targetPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  renameSync(tempPath, targetPath);
  return targetPath;
}

export function drainTrustedSessionSignalSpool(
  store: SessionRegistryStore,
  options: TrustedSessionSignalSpoolOptions = {},
): TrustedSessionSignalSpoolDrainResult {
  const rootDir = options.rootDir ?? getTrustedSessionSignalSpoolRoot();
  const pendingDir = join(rootDir, SESSION_REGISTRY_SIGNAL_PENDING_DIR);
  if (!existsSync(pendingDir)) {
    return { processed: 0, failed: 0 };
  }

  const failedDir = join(rootDir, SESSION_REGISTRY_SIGNAL_FAILED_DIR);
  const files = readdirSync(pendingDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  let processed = 0;
  let failed = 0;

  for (const fileName of files) {
    const sourcePath = join(pendingDir, fileName);
    try {
      const signal = parseTrustedSessionSignalInput(
        JSON.parse(readFileSync(sourcePath, "utf8")) as unknown,
      );
      if (shouldIgnoreTrustedSessionSignal(signal)) {
        rmSync(sourcePath, { force: true });
        processed += 1;
        continue;
      }
      store.recordTrustedSessionSignal(signal);
      rmSync(sourcePath, { force: true });
      processed += 1;
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) {
        continue;
      }
      mkdirSync(failedDir, { recursive: true });
      const failedPath = join(failedDir, basename(fileName));
      try {
        renameSync(sourcePath, failedPath);
      } catch (renameError) {
        if (isErrnoCode(renameError, "ENOENT")) {
          continue;
        }
        throw renameError;
      }
      failed += 1;
      options.logger?.warn(
        `[session-signals] failed to ingest ${fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { processed, failed };
}
