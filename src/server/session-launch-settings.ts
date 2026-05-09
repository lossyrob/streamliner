import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SessionLaunchSettings {
  defaultCliArgs: string[];
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

function invalidSettingsFile(message: string): SessionLaunchSettingsError {
  return new SessionLaunchSettingsError("session_launch_settings_malformed", 500, message);
}

function invalidSettingsInput(message: string): SessionLaunchSettingsError {
  return new SessionLaunchSettingsError("invalid_session_launch_settings", 400, message);
}

function validateCliArgToken(value: string): void {
  if (!value) {
    throw invalidSettingsInput("Default launch args cannot contain empty values.");
  }
  if (value.length > MAX_CLI_ARG_LENGTH) {
    throw invalidSettingsInput(`Default launch args must be ${MAX_CLI_ARG_LENGTH} characters or less.`);
  }
  if (/\s/.test(value)) {
    throw invalidSettingsInput("Default launch args must be option tokens without whitespace. Use --flag=value for values.");
  }
  if (!value.startsWith("-")) {
    throw invalidSettingsInput("Default launch args must be option tokens, not positional prompts.");
  }
  if (value === "--resume" || value.startsWith("--resume=")) {
    throw invalidSettingsInput("Streamliner owns --resume during relaunch; remove it from default launch args.");
  }
}

export function normalizeDefaultCliArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalidSettingsInput("defaultCliArgs must be an array of strings.");
  }
  if (value.length > MAX_CLI_ARGS) {
    throw invalidSettingsInput(`defaultCliArgs must contain ${MAX_CLI_ARGS} items or fewer.`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw invalidSettingsInput("defaultCliArgs must be an array of strings.");
    }
    const trimmed = item.trim();
    validateCliArgToken(trimmed);
    return trimmed;
  });
}

function normalizeStoredDefaultCliArgs(value: unknown): string[] {
  try {
    return normalizeDefaultCliArgs(value);
  } catch (error: unknown) {
    if (error instanceof SessionLaunchSettingsError) {
      throw invalidSettingsFile("Session launch settings store is malformed.");
    }
    throw error;
  }
}

function parseDocument(parsed: unknown): SessionLaunchSettings {
  if (!isRecord(parsed)) {
    throw invalidSettingsFile("Session launch settings store is malformed.");
  }
  return {
    defaultCliArgs: normalizeStoredDefaultCliArgs(parsed.defaultCliArgs),
  };
}

export async function readSessionLaunchSettings(path = defaultSessionLaunchSettingsPath()): Promise<SessionLaunchSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseDocument(parsed);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return { defaultCliArgs: [...DEFAULT_COPILOT_CLI_ARGS] };
    }
    if (error instanceof SyntaxError) {
      throw invalidSettingsFile("Session launch settings store is malformed.");
    }
    throw error;
  }
}

export async function writeSessionLaunchSettings(
  settings: SessionLaunchSettings,
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
