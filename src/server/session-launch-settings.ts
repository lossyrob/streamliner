import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SessionLaunchSettings {
  defaultCliArgs: string[];
}

export interface SessionLaunchSettingsInput {
  defaultCliArgs: unknown;
}

interface SessionLaunchSettingsDocument {
  version: 1;
  defaultCliArgs: string[];
  updatedAt: string;
}

export const DEFAULT_COPILOT_CLI_ARGS = ["--yolo"] as const;

const MAX_CLI_ARGS = 100;
const MAX_CLI_ARG_LENGTH = 2_000;

export class SessionLaunchSettingsError extends Error {
  statusCode: number;
  code: string;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "SessionLaunchSettingsError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function defaultSessionLaunchSettingsPath(): string {
  const stateRoot = resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
  return join(stateRoot, "session-launch-settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function malformedSettingsMessage(path: string): string {
  return `Session launch settings store is malformed at ${path}.`;
}

function invalidSettingsFile(path: string): SessionLaunchSettingsError {
  return new SessionLaunchSettingsError("session_launch_settings_malformed", 500, malformedSettingsMessage(path));
}

function invalidSettingsInput(message: string): SessionLaunchSettingsError {
  return new SessionLaunchSettingsError("invalid_session_launch_settings", 400, message);
}

const SEPARATE_VALUE_CLI_OPTIONS = new Set(["--prefer-version"]);

function splitCliArgToken(value: string): string[] {
  for (const option of SEPARATE_VALUE_CLI_OPTIONS) {
    const prefix = `${option}=`;
    if (value.startsWith(prefix)) {
      const optionValue = value.slice(prefix.length);
      if (!optionValue) {
        throw invalidSettingsInput(`${option} requires a value.`);
      }
      return [option, optionValue];
    }
  }
  return [value];
}

function expandCliArgInput(value: string): string[] {
  return value.split(/\s+/g).flatMap(splitCliArgToken);
}

function validateCliArgToken(value: string, expectingValueFor: string | null): string | null {
  if (!value) {
    throw invalidSettingsInput("Default launch args cannot contain empty values.");
  }
  if (value.length > MAX_CLI_ARG_LENGTH) {
    throw invalidSettingsInput(`Default launch args must be ${MAX_CLI_ARG_LENGTH} characters or less.`);
  }
  if (/\s/.test(value)) {
    throw invalidSettingsInput("Default launch args must use whitespace only to separate option tokens from values.");
  }
  if (value === "--resume" || value.startsWith("--resume=")) {
    throw invalidSettingsInput("Streamliner owns --resume during relaunch; remove it from default launch args.");
  }
  if (expectingValueFor) {
    if (value.startsWith("-")) {
      throw invalidSettingsInput(`${expectingValueFor} requires a value.`);
    }
    return null;
  }
  if (!value.startsWith("-")) {
    throw invalidSettingsInput("Default launch args must be option tokens, not positional prompts.");
  }
  if (SEPARATE_VALUE_CLI_OPTIONS.has(value)) {
    return value;
  }
  return null;
}

function validateCliArgs(args: readonly string[]): void {
  let expectingValueFor: string | null = null;
  for (const arg of args) {
    expectingValueFor = validateCliArgToken(arg, expectingValueFor);
  }
  if (expectingValueFor) {
    throw invalidSettingsInput(`${expectingValueFor} requires a value.`);
  }
}

export function normalizeDefaultCliArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalidSettingsInput("defaultCliArgs must be an array of strings.");
  }
  if (value.length > MAX_CLI_ARGS) {
    throw invalidSettingsInput(`defaultCliArgs must contain ${MAX_CLI_ARGS} items or fewer.`);
  }
  const args = value.flatMap((item) => {
    if (typeof item !== "string") {
      throw invalidSettingsInput("defaultCliArgs must be an array of strings.");
    }
    const trimmed = item.trim();
    if (!trimmed) {
      throw invalidSettingsInput("Default launch args cannot contain empty values.");
    }
    return expandCliArgInput(trimmed);
  });
  if (args.length > MAX_CLI_ARGS) {
    throw invalidSettingsInput(`defaultCliArgs must contain ${MAX_CLI_ARGS} items or fewer.`);
  }
  validateCliArgs(args);
  return args;
}

function normalizeStoredDefaultCliArgs(value: unknown, path: string): string[] {
  try {
    return normalizeDefaultCliArgs(value);
  } catch (error: unknown) {
    if (error instanceof SessionLaunchSettingsError) {
      throw invalidSettingsFile(path);
    }
    throw error;
  }
}

function parseDocument(parsed: unknown, path: string): SessionLaunchSettings {
  if (!isRecord(parsed)) {
    throw invalidSettingsFile(path);
  }
  return {
    defaultCliArgs: normalizeStoredDefaultCliArgs(parsed.defaultCliArgs, path),
  };
}

export async function readSessionLaunchSettings(path = defaultSessionLaunchSettingsPath()): Promise<SessionLaunchSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseDocument(parsed, path);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return { defaultCliArgs: [...DEFAULT_COPILOT_CLI_ARGS] };
    }
    if (error instanceof SyntaxError) {
      throw invalidSettingsFile(path);
    }
    throw error;
  }
}

export function readSessionLaunchSettingsSync(path = defaultSessionLaunchSettingsPath()): SessionLaunchSettings {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseDocument(parsed, path);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return { defaultCliArgs: [...DEFAULT_COPILOT_CLI_ARGS] };
    }
    if (error instanceof SyntaxError) {
      throw invalidSettingsFile(path);
    }
    throw error;
  }
}

export async function writeSessionLaunchSettings(
  settings: SessionLaunchSettingsInput,
  path = defaultSessionLaunchSettingsPath(),
): Promise<SessionLaunchSettings> {
  const defaultCliArgs = normalizeDefaultCliArgs(settings.defaultCliArgs);
  const document: SessionLaunchSettingsDocument = {
    version: 1,
    defaultCliArgs,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
  return { defaultCliArgs };
}
