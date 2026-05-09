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

function validateCliArgToken(value: string): void {
  if (!value) {
    throw new Error("Default launch args cannot contain empty values.");
  }
  if (/\s/.test(value)) {
    throw new Error("Default launch args must be one option token per line. Use --flag=value for values.");
  }
  if (!value.startsWith("-")) {
    throw new Error("Default launch args must be option tokens, not positional prompts.");
  }
  if (value === "--resume" || value.startsWith("--resume=")) {
    throw new Error("Streamliner owns --resume during relaunch; remove it from default launch args.");
  }
}

export function parseSessionLaunchCliArgsText(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      validateCliArgToken(line);
      return line;
    });
}

export function formatSessionLaunchCliArgsText(args: readonly string[]): string {
  return args.join("\n");
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
