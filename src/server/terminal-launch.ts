import { randomUUID } from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { quotePowerShellLiteral } from "../terminal-command";
import { getApiLogger } from "./logger";
export {
  buildCopilotResumeCommand,
  isSafeCopilotResumeSessionId,
  quotePowerShellLiteral,
} from "../terminal-command";

export const DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS = 1_500;

export const TERMINAL_HOST_PREFERENCES = [
  "default",
  "windows-terminal",
  "powershell",
] as const;
export type TerminalHostPreference = (typeof TERMINAL_HOST_PREFERENCES)[number];

export type TerminalLaunchMethod = "windows-terminal" | "powershell";

/** Result of a terminal launch attempt */
export interface TerminalLaunchResult {
  /** Which terminal method was used */
  method: TerminalLaunchMethod;
  /** PID of the spawned process (if available) */
  pid: number | undefined;
}

export interface TerminalLaunchRequest {
  /** Absolute path to set as working directory */
  cwd: string;
  /** Command to execute in the terminal (optional) */
  command?: string;
  /** Additional environment values for the spawned shell */
  env?: Record<string, string>;
  /** Preferred local terminal host for the adapter to honor when possible. */
  hostPreference: TerminalHostPreference;
  /** Tab title (optional; adapter support varies) */
  title?: string;
  /** Tab color as hex string e.g. "#FF0000" (optional; adapter support varies) */
  tabColor?: string;
  /**
   * Streamliner-owned Copilot CLI launch: seed launch-local Copilot startup
   * environment so visible workers do not stop on terminal setup prompts and
   * yolo/allow-all launches do not stop on folder trust prompts.
   */
  prepareCopilotCli?: boolean;
}

/** Options for launching a terminal */
export interface TerminalLaunchOptions extends Omit<TerminalLaunchRequest, "hostPreference"> {
  /** Preferred terminal host. Defaults to Windows Terminal with PowerShell fallback. */
  preferredTerminal?: TerminalHostPreference;
}

export interface TerminalLaunchAdapter {
  readonly id: string;
  launch(request: TerminalLaunchRequest): TerminalLaunchResult;
}

export type TerminalLaunchExecutor = (options: TerminalLaunchOptions) => TerminalLaunchResult;

export interface CopilotTerminalLaunchQueueOptions {
  /** Low-level terminal launcher to run inside the queue. Defaults to launchTerminal. */
  launchTerminal?: TerminalLaunchExecutor;
  /** Override the configured cooldown; mainly used by tests and dependency seams. */
  cooldownMs?: number;
  /** Override the delay primitive; mainly used by tests. */
  delay?: (ms: number) => Promise<void>;
}

/** Cache for Windows Terminal availability check */
let wtAvailabilityCache: boolean | null = null;
let copilotTerminalLaunchTail: Promise<void> = Promise.resolve();

/** Check if Windows Terminal (wt.exe) is available in PATH. Cached per server lifetime. */
export function isWindowsTerminalAvailable(): boolean {
  if (wtAvailabilityCache !== null) {
    return wtAvailabilityCache;
  }

  try {
    execSync("where wt", { stdio: "ignore" });
    wtAvailabilityCache = true;
    return true;
  } catch {
    wtAvailabilityCache = false;
    return false;
  }
}

/** Clear the WT availability cache (for testing) */
export function clearWindowsTerminalCache(): void {
  wtAvailabilityCache = null;
}

export function resetCopilotTerminalLaunchQueueForTest(): void {
  copilotTerminalLaunchTail = Promise.resolve();
}

export function copilotTerminalLaunchCooldownMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.STREAMLINER_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  getApiLogger().withScope("terminal-launch").warn(
    "invalid STREAMLINER_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS; using default",
    { value: raw, defaultMs: DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS },
  );
  return DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function isPowerShellCoreAvailable(): boolean {
  try {
    execSync("where pwsh", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function selectPowerShellExecutable(): string {
  return isPowerShellCoreAvailable() ? "pwsh.exe" : "powershell.exe";
}

/**
 * Normalize the compatibility launch options into the adapter-facing request.
 */
export function normalizeTerminalLaunchRequest(
  options: TerminalLaunchOptions,
): TerminalLaunchRequest {
  const request: TerminalLaunchRequest = {
    cwd: options.cwd,
    command: options.command,
    env: options.env,
    hostPreference: options.preferredTerminal ?? "default",
    title: options.title,
    tabColor: options.tabColor,
  };
  if (options.prepareCopilotCli !== undefined) {
    request.prepareCopilotCli = options.prepareCopilotCli;
  }
  return request;
}

function escapeForWindowsTerminal(value: string): string {
  return value.replace(/;/g, "\\;");
}

/**
 * Build a sanitized environment for spawned terminal processes.
 *
 * `npm run dev:api` (and any `npm run` script) prepends the project's
 * `node_modules/.bin` to PATH. Children of the API server inherit that PATH,
 * so a relaunched `copilot --resume=<id>` resolves to the local copy in
 * `node_modules/@github/copilot-win32-x64/copilot.exe` instead of the user's
 * globally-installed Copilot CLI. The local copy does not have the
 * Streamliner plugin configured, so no hooks fire.
 *
 * Strip any `node_modules/.bin` entry from PATH so the spawned shell falls
 * through to the user's normal command resolution.
 */
export function buildSpawnEnv(
  extraEnv: Record<string, string> | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const pathKey = platform === "win32" ? "Path" : "PATH";
  if (platform === "win32") {
    const pathValue = env[pathKey]
      ?? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1];
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") {
        delete env[key];
      }
    }
    if (pathValue !== undefined) {
      env[pathKey] = pathValue;
    }
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (platform === "win32" && key.toUpperCase() === "PATH") {
        env[pathKey] = value;
      } else {
        env[key] = value;
      }
    }
  }
  if (pathKey && typeof env[pathKey] === "string") {
    const separator = platform === "win32" ? ";" : ":";
    const filtered = env[pathKey]!
      .split(separator)
      .filter((entry) => !/[\\/]node_modules[\\/]\.bin\b/i.test(entry))
      .join(separator);
    env[pathKey] = filtered;
  }
  return env;
}

const COPILOT_ALL_ALLOW_FLAG_PATTERN = /(?:^|[\s'"`])--(?:yolo|allow-all)(?=$|[\s='"`])/;

function copilotPromptBypassEnv(command: string | undefined): Record<string, string> {
  const env: Record<string, string> = {
    COPILOT_SETUP_TERMINAL: "false",
  };
  if (command && COPILOT_ALL_ALLOW_FLAG_PATTERN.test(command)) {
    env.COPILOT_ALLOW_ALL = "true";
  }
  return env;
}

function buildTerminalSpawnEnv(request: TerminalLaunchRequest): NodeJS.ProcessEnv {
  const extraEnv = request.prepareCopilotCli
    ? {
      ...(request.env ?? {}),
      ...copilotPromptBypassEnv(request.command),
    }
    : request.env;
  return buildSpawnEnv(extraEnv);
}

function terminalLaunchScriptRoot(): string {
  return resolve(process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT ?? join(
    homedir(),
    ".streamliner",
    "state",
    "terminal-launches",
  ));
}

function createPowerShellLaunchScript(request: TerminalLaunchRequest): string {
  const root = terminalLaunchScriptRoot();
  mkdirSync(root, { recursive: true });
  const scriptPath = join(root, `launch-${Date.now()}-${randomUUID()}.ps1`);
  const escapedCwd = request.cwd.replace(/'/g, "''");
  const lines = [
    "$streamlinerLaunchScriptPath = $PSCommandPath",
    "if ($streamlinerLaunchScriptPath) { Remove-Item -LiteralPath $streamlinerLaunchScriptPath -Force -ErrorAction Continue }",
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath '${escapedCwd}'`,
  ];
  if (request.command) {
    lines.push(request.command);
  }
  writeFileSync(scriptPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return scriptPath;
}

export interface CopilotInteractiveCommandOptions {
  /** Copilot CLI flags kept as distinct argv-style values and PowerShell-literal quoted. */
  cliArgs: string[];
  /** Arbitrary prompt text; JSON-escaped before embedding so multiline/user text is never shell-interpolated. */
  kickoffPrompt: string;
}

/**
 * Builds the PowerShell command used by the current Windows terminal adapter for
 * visible Copilot CLI worker launches.
 *
 * The kickoff prompt and CLI args intentionally use different encoding paths:
 * prompt text is serialized as JSON and parsed inside PowerShell because it may
 * contain arbitrary multiline prose, while `cliArgs` remain individual Copilot
 * CLI flags that are PowerShell-literal quoted and parsed normally by Copilot.
 */
export function buildCopilotInteractiveCommand(options: CopilotInteractiveCommandOptions): string {
  const promptJson = JSON.stringify(options.kickoffPrompt);
  const decodedPrompt =
    `$streamlinerKickoffPrompt = ConvertFrom-Json ${quotePowerShellLiteral(promptJson)}`;
  const cliArgs = options.cliArgs.map(quotePowerShellLiteral).join(" ");
  const commandParts = [
    "copilot",
    cliArgs,
    "-i",
    "$streamlinerKickoffPrompt",
  ].filter((part) => part.length > 0);
  return `${decodedPrompt}; ${commandParts.join(" ")}`;
}

export class WindowsTerminalLaunchAdapter implements TerminalLaunchAdapter {
  readonly id = "windows";

  launch(request: TerminalLaunchRequest): TerminalLaunchResult {
    if (request.hostPreference === "powershell") {
      return this.launchPowerShellTerminal(request);
    }
    if (request.hostPreference === "windows-terminal") {
      if (isWindowsTerminalAvailable()) {
        return this.launchWindowsTerminal(request);
      }
      return this.launchPowerShellTerminal(request);
    }
    if (isWindowsTerminalAvailable()) {
      return this.launchWindowsTerminal(request);
    }
    return this.launchPowerShellTerminal(request);
  }

  private launchWindowsTerminal(request: TerminalLaunchRequest): TerminalLaunchResult {
    const args: string[] = ["new-tab"];

    if (request.title) {
      args.push("--title", escapeForWindowsTerminal(request.title));
      args.push("--suppressApplicationTitle");
    }

    if (request.tabColor && isValidHexColor(request.tabColor)) {
      args.push("--tabColor", request.tabColor);
    }

    args.push("-d", escapeForWindowsTerminal(request.cwd));

    if (request.command) {
      args.push(selectPowerShellExecutable(), "-NoExit", "-File", createPowerShellLaunchScript(request));
    }

    const child = spawn("wt.exe", args, {
      detached: true,
      stdio: "ignore",
      env: buildTerminalSpawnEnv(request),
    });

    child.unref();

    if (child.pid === undefined) {
      throw new Error("Failed to spawn Windows Terminal process");
    }

    return {
      method: "windows-terminal",
      pid: child.pid,
    };
  }

  private launchPowerShellTerminal(request: TerminalLaunchRequest): TerminalLaunchResult {
    const executable = selectPowerShellExecutable();
    const escapedCwd = request.cwd.replace(/'/g, "''");
    const args = request.command
      ? ["-NoExit", "-File", createPowerShellLaunchScript(request)]
      : ["-NoExit", "-Command", `Set-Location -LiteralPath '${escapedCwd}'`];

    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      env: buildTerminalSpawnEnv(request),
    });

    child.unref();

    if (child.pid === undefined) {
      throw new Error("Failed to spawn PowerShell process");
    }

    return {
      method: "powershell",
      pid: child.pid,
    };
  }
}

const WINDOWS_TERMINAL_LAUNCH_ADAPTER = new WindowsTerminalLaunchAdapter();

export function getDefaultTerminalLaunchAdapter(): TerminalLaunchAdapter {
  return WINDOWS_TERMINAL_LAUNCH_ADAPTER;
}

/**
 * Launch a terminal with the given compatibility options.
 * Process is spawned detached so it outlives the server.
 */
export function launchTerminal(
  options: TerminalLaunchOptions,
  adapter: TerminalLaunchAdapter = getDefaultTerminalLaunchAdapter(),
): TerminalLaunchResult {
  return adapter.launch(normalizeTerminalLaunchRequest(options));
}

/**
 * Serialize Streamliner-owned visible Copilot CLI terminal starts so concurrent
 * launches do not contend on Copilot's shared plugin/cache state.
 */
export async function launchCopilotTerminal(
  options: TerminalLaunchOptions,
  queueOptions: CopilotTerminalLaunchQueueOptions = {},
): Promise<TerminalLaunchResult> {
  const prior = copilotTerminalLaunchTail;
  let releaseCurrent: () => void = () => {};
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  copilotTerminalLaunchTail = prior.then(() => current, () => current);

  await prior.catch(() => undefined);

  const launch = queueOptions.launchTerminal ?? launchTerminal;
  const cooldownMs = queueOptions.cooldownMs ?? copilotTerminalLaunchCooldownMs();
  const wait = queueOptions.delay ?? delay;
  let result: TerminalLaunchResult | undefined;
  let launchError: unknown;
  let delayError: unknown;

  try {
    result = launch(options);
  } catch (error: unknown) {
    launchError = error;
  }

  try {
    if (cooldownMs > 0) {
      await wait(cooldownMs);
    }
  } catch (error: unknown) {
    delayError = error;
  } finally {
    releaseCurrent();
  }

  if (launchError !== undefined) {
    throw launchError;
  }
  if (delayError !== undefined) {
    throw delayError;
  }
  return result!;
}

/**
 * Validate that a color string is in valid hex format (#RRGGBB)
 */
function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}
