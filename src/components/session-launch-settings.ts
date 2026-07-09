export interface SessionLaunchSettings {
  defaultCliArgs: string[];
}

const SESSION_LAUNCH_SETTINGS_ENDPOINT = "/api/session-launch-settings";
export const FALLBACK_SESSION_LAUNCH_DEFAULT_CLI_ARGS = ["--yolo"] as const;

export class SessionLaunchSettingsRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SessionLaunchSettingsRequestError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SEPARATE_VALUE_CLI_OPTIONS = new Set(["--prefer-version"]);

function splitCliArgToken(value: string): string[] {
  for (const option of SEPARATE_VALUE_CLI_OPTIONS) {
    const prefix = `${option}=`;
    if (value.startsWith(prefix)) {
      const optionValue = value.slice(prefix.length);
      if (!optionValue) {
        throw new Error(`${option} requires a value.`);
      }
      return [option, optionValue];
    }
  }
  return [value];
}

function expandCliArgLine(value: string): string[] {
  return value.split(/\s+/g).flatMap(splitCliArgToken);
}

function validateCliArgToken(value: string, expectingValueFor: string | null): string | null {
  if (!value) {
    throw new Error("Default launch args cannot contain empty values.");
  }
  if (/\s/.test(value)) {
    throw new Error("Default launch args must use whitespace only to separate option tokens from values.");
  }
  if (value === "--resume" || value.startsWith("--resume=")) {
    throw new Error("Streamliner owns --resume during relaunch; remove it from default launch args.");
  }
  if (expectingValueFor) {
    if (value.startsWith("-")) {
      throw new Error(`${expectingValueFor} requires a value.`);
    }
    return null;
  }
  if (!value.startsWith("-")) {
    throw new Error("Default launch args must be option tokens, not positional prompts.");
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
    throw new Error(`${expectingValueFor} requires a value.`);
  }
}

export function parseSessionLaunchCliArgsText(value: string): string[] {
  const args = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(expandCliArgLine);
  validateCliArgs(args);
  return args;
}

export function formatSessionLaunchCliArgsText(args: readonly string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (SEPARATE_VALUE_CLI_OPTIONS.has(arg) && nextArg && !nextArg.startsWith("-")) {
      lines.push(`${arg} ${nextArg}`);
      i += 1;
      continue;
    }
    lines.push(arg);
  }
  return lines.join("\n");
}

function normalizeSettings(value: unknown): SessionLaunchSettings {
  if (!isRecord(value) || !Array.isArray(value.defaultCliArgs)) {
    throw new Error("Session launch settings response is malformed.");
  }
  for (const arg of value.defaultCliArgs) {
    if (typeof arg !== "string") {
      throw new Error("Session launch settings response is malformed.");
    }
  }
  return { defaultCliArgs: [...value.defaultCliArgs] };
}

async function parseSettingsResponse(response: Response): Promise<SessionLaunchSettings> {
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : `Session launch settings request failed with ${response.status}.`;
    throw new SessionLaunchSettingsRequestError(response.status, message);
  }
  return normalizeSettings(payload);
}

export async function loadSessionLaunchSettings(): Promise<SessionLaunchSettings> {
  const response = await fetch(SESSION_LAUNCH_SETTINGS_ENDPOINT, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return parseSettingsResponse(response);
}

export async function saveSessionLaunchSettings(
  settings: SessionLaunchSettings,
): Promise<SessionLaunchSettings> {
  const response = await fetch(SESSION_LAUNCH_SETTINGS_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  return parseSettingsResponse(response);
}
