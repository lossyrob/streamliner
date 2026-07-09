import { randomUUID } from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  quotePosixShellLiteral,
  quotePowerShellLiteral,
  type CopilotCommandShellDialect,
} from "../terminal-command";
import { getApiLogger } from "./logger";
export {
  buildCopilotResumeCommand,
  buildCopilotResumePosixCommand,
  isSafeCopilotResumeSessionId,
  quotePosixShellLiteral,
  quotePowerShellLiteral,
  type CopilotCommandShellDialect,
} from "../terminal-command";

export const DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS = 15_000;
const DEFAULT_COPILOT_REQUIRED_PLUGINS = ["streamliner@streamliner-local"] as const;

export const TERMINAL_HOST_PREFERENCES = [
  "default",
  "mac-terminal",
  "iterm2",
  "windows-terminal",
  "powershell",
] as const;
export type TerminalHostPreference = (typeof TERMINAL_HOST_PREFERENCES)[number];

export type TerminalLaunchMethod = "windows-terminal" | "powershell" | "mac-terminal" | "iterm2";

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
  /** Preferred terminal host. Defaults to the platform adapter. */
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
  /** Override or disable Copilot plugin preflight; mainly used by tests. */
  pluginPreflight?: false | CopilotPluginPreflightOptions;
  /** Override command quoting dialect for plugin preflight; mainly used by tests. */
  commandShellDialect?: CopilotCommandShellDialect;
}

export interface CopilotPluginPreflightOptions {
  /** Copilot settings path. Defaults to ~/.copilot/settings.json. */
  settingsPath?: string;
  /** Copilot managed config path. Defaults to ~/.copilot/config.json. */
  configPath?: string;
  /** Installed plugin cache root. Defaults to ~/.copilot/installed-plugins. */
  installedPluginsRoot?: string;
  /** Required plugin sources. Defaults to enabledPlugins from settings, then Streamliner. */
  requiredPlugins?: readonly string[];
  /** Environment source for feature flags and required-plugin overrides. */
  env?: NodeJS.ProcessEnv;
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

function defaultCopilotSettingsPath(): string {
  return join(homedir(), ".copilot", "settings.json");
}

function defaultCopilotConfigPath(): string {
  return join(homedir(), ".copilot", "config.json");
}

function defaultCopilotInstalledPluginsRoot(): string {
  return join(homedir(), ".copilot", "installed-plugins");
}

function splitPluginSources(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function envDisablesCopilotPluginPreflight(env: NodeJS.ProcessEnv): boolean {
  const raw = env.STREAMLINER_COPILOT_PLUGIN_PREFLIGHT;
  if (raw === undefined) {
    return false;
  }
  return /^(?:0|false|off|no)$/i.test(raw.trim());
}

function configuredRequiredCopilotPlugins(
  env: NodeJS.ProcessEnv,
  settingsPath: string,
): string[] {
  const configured = env.STREAMLINER_COPILOT_REQUIRED_PLUGINS;
  if (configured !== undefined && configured.trim().length > 0) {
    return splitPluginSources(configured);
  }

  const enabled = enabledCopilotPluginsFromSettings(settingsPath);
  return enabled.length > 0 ? enabled : [...DEFAULT_COPILOT_REQUIRED_PLUGINS];
}

function enabledCopilotPluginsFromSettings(settingsPath: string): string[] {
  if (!existsSync(settingsPath)) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
  } catch (error: unknown) {
    getApiLogger().withScope("terminal-launch").warn(
      "could not read Copilot enabled plugin settings; using default Streamliner plugin preflight",
      { settingsPath, err: error },
    );
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const enabledPlugins = (parsed as Record<string, unknown>).enabledPlugins;
  if (!enabledPlugins || typeof enabledPlugins !== "object" || Array.isArray(enabledPlugins)) {
    return [];
  }
  return Object.entries(enabledPlugins)
    .filter(([, enabled]) => enabled === true)
    .map(([source]) => source)
    .filter((source) => source.trim().length > 0);
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error: unknown) {
    getApiLogger().withScope("terminal-launch").warn(
      "could not read Copilot plugin configuration JSON",
      { path, err: error },
    );
    return null;
  }
}

function configuredPluginCachePaths(configPath: string): Map<string, string> {
  const parsed = readJsonFile(configPath);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Map();
  }
  const installedPlugins = (parsed as Record<string, unknown>).installedPlugins;
  if (!Array.isArray(installedPlugins)) {
    return new Map();
  }
  const cachePaths = new Map<string, string>();
  for (const plugin of installedPlugins) {
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      continue;
    }
    const record = plugin as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const marketplace = typeof record.marketplace === "string" ? record.marketplace : "";
    const cachePath = typeof record.cache_path === "string" ? record.cache_path : "";
    if (name && marketplace && cachePath) {
      cachePaths.set(`${name}@${marketplace}`, cachePath);
    }
  }
  return cachePaths;
}

function fallbackPluginCachePath(pluginSource: string, installedPluginsRoot: string): string | null {
  const [pluginName, marketplace] = pluginSource.split("@", 2);
  if (!pluginName || !marketplace) {
    return null;
  }
  return join(installedPluginsRoot, marketplace, pluginName);
}

export function resolveCopilotPluginDirsForLaunch(
  options: CopilotPluginPreflightOptions = {},
): string[] {
  const env = options.env ?? process.env;
  if (envDisablesCopilotPluginPreflight(env)) {
    return [];
  }

  const settingsPath = options.settingsPath ?? defaultCopilotSettingsPath();
  const configPath = options.configPath ?? defaultCopilotConfigPath();
  const installedPluginsRoot = options.installedPluginsRoot ?? defaultCopilotInstalledPluginsRoot();
  const requiredPlugins = options.requiredPlugins
    ? [...options.requiredPlugins]
    : configuredRequiredCopilotPlugins(env, settingsPath);
  if (requiredPlugins.length === 0) {
    return [];
  }

  const configuredCachePaths = configuredPluginCachePaths(configPath);
  const pluginDirs: string[] = [];
  const missing: string[] = [];
  for (const pluginSource of requiredPlugins) {
    const configuredPath = configuredCachePaths.get(pluginSource);
    const candidates = [
      configuredPath,
      fallbackPluginCachePath(pluginSource, installedPluginsRoot),
    ].filter((candidate): candidate is string => Boolean(candidate));
    const existingPath = candidates.find((candidate) => existsSync(candidate));
    if (existingPath) {
      pluginDirs.push(existingPath);
    } else {
      missing.push(`${pluginSource}${candidates.length ? ` (${candidates.join(" or ")})` : ""}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      [
        "Copilot plugin preflight could not find required plugin directories.",
        `Missing: ${missing.join(", ")}`,
        "Close sessions that may be using the plugin cache, then repair with `copilot plugin install <plugin@marketplace>`.",
      ].join(" "),
    );
  }

  return [...new Set(pluginDirs)];
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

const POSIX_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function buildTerminalLaunchScriptEnv(request: TerminalLaunchRequest): Record<string, string> {
  return request.prepareCopilotCli
    ? {
      ...(request.env ?? {}),
      ...copilotPromptBypassEnv(request.command),
    }
    : { ...(request.env ?? {}) };
}

function createMacTerminalLaunchScript(request: TerminalLaunchRequest): string {
  const root = terminalLaunchScriptRoot();
  mkdirSync(root, { recursive: true });
  const scriptPath = join(root, `launch-${Date.now()}-${randomUUID()}.sh`);
  const lines = [
    "#!/bin/zsh",
    "set -euo pipefail",
    "rm -f -- \"$0\"",
    `cd -- ${quotePosixShellLiteral(request.cwd)}`,
  ];

  for (const [name, value] of Object.entries(buildTerminalLaunchScriptEnv(request))) {
    if (!POSIX_ENV_NAME_PATTERN.test(name)) {
      throw new Error(`Cannot export invalid POSIX environment variable name: ${name}`);
    }
    lines.push(`export ${name}=${quotePosixShellLiteral(value)}`);
  }

  if (request.title) {
    lines.push(`printf '\\033]0;%s\\007' ${quotePosixShellLiteral(request.title)}`);
  }

  if (request.command) {
    lines.push(
      "set +e",
      request.command,
      "streamliner_command_status=$?",
      "set -e",
      "printf '\\n[streamliner] Command exited with status %s. Starting interactive shell.\\n' \"$streamliner_command_status\"",
      "exec /bin/zsh -l",
    );
  } else {
    lines.push("exec /bin/zsh -l");
  }

  writeFileSync(scriptPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o700 });
  return scriptPath;
}

export interface CopilotInteractiveCommandOptions {
  /** Copilot CLI flags kept as distinct argv-style values and shell-literal quoted. */
  cliArgs: string[];
  /** Arbitrary prompt text; shell-escaped before embedding so multiline/user text is never shell-interpolated. */
  kickoffPrompt: string;
}

/**
 * Builds the PowerShell command used by the current Windows terminal adapter for
 * visible Copilot CLI worker launches.
 *
 * The kickoff prompt and CLI args intentionally use different encoding paths:
 * prompt text is base64-encoded before embedding because it may contain
 * arbitrary multiline prose, while `cliArgs` remain individual Copilot CLI flags
 * that are PowerShell-literal quoted and parsed normally by Copilot.
 */
export function buildCopilotInteractiveCommand(options: CopilotInteractiveCommandOptions): string {
  const promptBase64 = Buffer.from(options.kickoffPrompt, "utf8").toString("base64");
  const decodedPrompt =
    `$streamlinerKickoffPrompt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(${quotePowerShellLiteral(promptBase64)}))`;
  const cliArgs = options.cliArgs.map(quotePowerShellLiteral).join(" ");
  const commandParts = [
    "copilot",
    cliArgs,
    "-i",
    "$streamlinerKickoffPrompt",
  ].filter((part) => part.length > 0);
  return `${decodedPrompt}; ${commandParts.join(" ")}`;
}

/**
 * Builds the zsh-compatible command used by the macOS Terminal adapter for
 * visible Copilot CLI worker launches.
 */
export function buildCopilotInteractivePosixCommand(options: CopilotInteractiveCommandOptions): string {
  const promptBase64 = Buffer.from(options.kickoffPrompt, "utf8").toString("base64");
  const promptSetup = [
    `streamliner_kickoff_prompt_base64=${quotePosixShellLiteral(promptBase64)}`,
    "if streamliner_kickoff_prompt=$(printf '%s' \"$streamliner_kickoff_prompt_base64\" | base64 --decode 2>/dev/null); then",
    "  :",
    "else",
    "  streamliner_kickoff_prompt=$(printf '%s' \"$streamliner_kickoff_prompt_base64\" | base64 -D)",
    "fi",
  ].join("\n");
  const cliArgs = options.cliArgs.map(quotePosixShellLiteral).join(" ");
  const commandParts = [
    "copilot",
    cliArgs,
    "-i",
    "\"$streamliner_kickoff_prompt\"",
  ].filter((part) => part.length > 0);
  return `${promptSetup}\n${commandParts.join(" ")}`;
}

export function buildCopilotInteractiveCommandForShell(
  options: CopilotInteractiveCommandOptions,
  shellDialect: CopilotCommandShellDialect,
): string {
  return shellDialect === "posix"
    ? buildCopilotInteractivePosixCommand(options)
    : buildCopilotInteractiveCommand(options);
}

function quoteCommandShellLiteral(
  value: string,
  shellDialect: CopilotCommandShellDialect,
): string {
  return shellDialect === "posix"
    ? quotePosixShellLiteral(value)
    : quotePowerShellLiteral(value);
}

function addCopilotPluginDirArgs(
  command: string | undefined,
  pluginDirs: readonly string[],
  shellDialect: CopilotCommandShellDialect = "powershell",
): string | undefined {
  if (!command || pluginDirs.length === 0) {
    return command;
  }
  const pluginArgs = pluginDirs
    .flatMap((pluginDir) => ["--plugin-dir", pluginDir])
    .map((arg) => quoteCommandShellLiteral(arg, shellDialect))
    .join(" ");
  const copilotCommandPattern = shellDialect === "posix"
    ? /(^|[;\n]\s*)copilot(?=\s|$)/
    : /(^|;\s*)copilot(?=\s|$)/;
  return command.replace(
    copilotCommandPattern,
    (_match, prefix: string) => `${prefix}copilot ${pluginArgs}`,
  );
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

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function buildMacTerminalCommand(scriptPath: string): string {
  return [
    "/bin/zsh",
    "-lc",
    quotePosixShellLiteral("exec \"$1\""),
    "streamliner-launch",
    quotePosixShellLiteral(scriptPath),
  ].join(" ");
}

export class MacTerminalLaunchAdapter implements TerminalLaunchAdapter {
  readonly id = "mac";

  launch(request: TerminalLaunchRequest): TerminalLaunchResult {
    const scriptPath = createMacTerminalLaunchScript(request);
    const terminalCommand = buildMacTerminalCommand(scriptPath);

    if (request.hostPreference === "iterm2") {
      return this.launchITerm2(request, terminalCommand);
    }

    return this.launchTerminalApp(request, terminalCommand);
  }

  private launchTerminalApp(
    request: TerminalLaunchRequest,
    terminalCommand: string,
  ): TerminalLaunchResult {
    const appleScript =
      `tell application "Terminal" to do script ${quoteAppleScriptString(terminalCommand)}`;
    return this.spawnAppleScript(request, appleScript, "mac-terminal", "macOS Terminal");
  }

  private launchITerm2(
    request: TerminalLaunchRequest,
    terminalCommand: string,
  ): TerminalLaunchResult {
    const appleScript =
      `tell application "iTerm2" to create window with default profile command ${quoteAppleScriptString(terminalCommand)}`;
    return this.spawnAppleScript(request, appleScript, "iterm2", "iTerm2");
  }

  private spawnAppleScript(
    request: TerminalLaunchRequest,
    appleScript: string,
    method: TerminalLaunchMethod,
    terminalName: string,
  ): TerminalLaunchResult {
    const child = spawn("osascript", ["-e", appleScript], {
      detached: true,
      stdio: "ignore",
      env: buildTerminalSpawnEnv(request),
    });

    child.unref();

    if (child.pid === undefined) {
      throw new Error(`Failed to spawn ${terminalName} process`);
    }

    return {
      method,
      pid: child.pid,
    };
  }
}

const WINDOWS_TERMINAL_LAUNCH_ADAPTER = new WindowsTerminalLaunchAdapter();
const MAC_TERMINAL_LAUNCH_ADAPTER = new MacTerminalLaunchAdapter();

export function selectDefaultTerminalLaunchAdapter(platform: NodeJS.Platform): TerminalLaunchAdapter {
  return platform === "darwin"
    ? MAC_TERMINAL_LAUNCH_ADAPTER
    : WINDOWS_TERMINAL_LAUNCH_ADAPTER;
}

export function getDefaultTerminalLaunchAdapter(
  platform: NodeJS.Platform = process.platform,
): TerminalLaunchAdapter {
  return selectDefaultTerminalLaunchAdapter(platform);
}

export function selectTerminalCommandShellDialect(
  platform: NodeJS.Platform = process.platform,
): CopilotCommandShellDialect {
  return platform === "darwin" ? "posix" : "powershell";
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
    let launchOptions = options;
    if (queueOptions.pluginPreflight !== false) {
      const pluginDirs = resolveCopilotPluginDirsForLaunch(queueOptions.pluginPreflight);
      if (pluginDirs.length > 0 && options.command) {
        const shellDialect = queueOptions.commandShellDialect
          ?? selectTerminalCommandShellDialect(process.platform);
        launchOptions = {
          ...options,
          command: addCopilotPluginDirArgs(options.command, pluginDirs, shellDialect),
        };
      }
    }
    result = launch(launchOptions);
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
