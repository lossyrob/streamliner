import { spawn, execSync } from "node:child_process";

/** Result of a terminal launch attempt */
export interface TerminalLaunchResult {
  /** Which terminal method was used */
  method: "windows-terminal" | "powershell";
  /** PID of the spawned process (if available) */
  pid: number | undefined;
}

/** Options for launching a terminal */
export interface TerminalLaunchOptions {
  /** Absolute path to set as working directory */
  cwd: string;
  /** Command to execute in the terminal (optional) */
  command?: string;
  /** Additional environment values for the spawned shell */
  env?: Record<string, string>;
  /** Preferred terminal host. Defaults to Windows Terminal with PowerShell fallback. */
  preferredTerminal?: "default" | "windows-terminal" | "powershell";
  /** Tab title (optional, Windows Terminal only) */
  title?: string;
  /** Tab color as hex string e.g. "#FF0000" (optional, Windows Terminal only) */
  tabColor?: string;
}

/** Cache for Windows Terminal availability check */
let wtAvailabilityCache: boolean | null = null;

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

function isPowerShellCoreAvailable(): boolean {
  try {
    execSync("where pwsh", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch a terminal with the given options.
 * Tries Windows Terminal first, falls back to PowerShell.
 * Process is spawned detached so it outlives the server.
 */
export function launchTerminal(
  options: TerminalLaunchOptions
): TerminalLaunchResult {
  if (options.preferredTerminal === "powershell") {
    return launchPowerShellTerminal(options);
  }
  if (options.preferredTerminal === "windows-terminal") {
    if (isWindowsTerminalAvailable()) {
      return launchWindowsTerminal(options);
    }
    return launchPowerShellTerminal(options);
  }
  if (isWindowsTerminalAvailable()) {
    return launchWindowsTerminal(options);
  }
  return launchPowerShellTerminal(options);
}

function escapeForWindowsTerminal(value: string): string {
  return value.replace(/;/g, "\\;");
}

/**
 * Build a sanitized environment for spawned terminal processes.
 *
 * `npm run dev:api` (and any `npm run` script) prepends the project's
 * `node_modules/.bin` to PATH. Children of the API server inherit that PATH,
 * so a relaunched `copilot --resume <id>` resolves to the local copy in
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

export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildCopilotInteractiveCommand(options: {
  cliArgs: string[];
  kickoffPrompt: string;
}): string {
  const encodedPrompt = Buffer.from(options.kickoffPrompt, "utf8").toString("base64");
  const decodedPrompt =
    `$streamlinerKickoffPrompt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedPrompt}'))`;
  const cliArgs = options.cliArgs.map(quotePowerShellLiteral).join(" ");
  const commandParts = [
    "copilot",
    cliArgs,
    "-i",
    "$streamlinerKickoffPrompt",
    ".",
  ].filter((part) => part.length > 0);
  return `${decodedPrompt}; ${commandParts.join(" ")}`;
}

function launchWindowsTerminal(options: TerminalLaunchOptions): TerminalLaunchResult {
  const args: string[] = ["new-tab"];

  if (options.title) {
    args.push("--title", escapeForWindowsTerminal(options.title));
    args.push("--suppressApplicationTitle");
  }

  if (options.tabColor && isValidHexColor(options.tabColor)) {
    args.push("--tabColor", options.tabColor);
  }

  args.push("-d", escapeForWindowsTerminal(options.cwd));

  if (options.command) {
    args.push("--appendCommandLine", "-NoExit", "-Command", options.command);
  }

  const child = spawn("wt.exe", args, {
    detached: true,
    stdio: "ignore",
    env: buildSpawnEnv(options.env),
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

function launchPowerShellTerminal(
  options: TerminalLaunchOptions
): TerminalLaunchResult {
  const executable = isPowerShellCoreAvailable() ? "pwsh.exe" : "powershell.exe";
  let psCommand: string;

  if (options.command) {
    // Escape single quotes by doubling them
    const escapedCwd = options.cwd.replace(/'/g, "''");
    psCommand = `Set-Location -LiteralPath '${escapedCwd}'; ${options.command}`;
  } else {
    // Escape single quotes by doubling them
    const escapedCwd = options.cwd.replace(/'/g, "''");
    psCommand = `Set-Location -LiteralPath '${escapedCwd}'`;
  }

  const args = ["-ExecutionPolicy", "Bypass", "-NoExit", "-Command", psCommand];

  const child = spawn(executable, args, {
    detached: true,
    stdio: "ignore",
    env: buildSpawnEnv(options.env),
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

/**
 * Validate that a color string is in valid hex format (#RRGGBB)
 */
function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}
