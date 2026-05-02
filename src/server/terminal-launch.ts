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
  if (isWindowsTerminalAvailable()) {
    return launchWindowsTerminal(options);
  } else {
    return launchPowerShellTerminal(options);
  }
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
function buildSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  if (pathKey && typeof env[pathKey] === "string") {
    const separator = process.platform === "win32" ? ";" : ":";
    const filtered = env[pathKey]!
      .split(separator)
      .filter((entry) => !/[\\/]node_modules[\\/]\.bin\b/i.test(entry))
      .join(separator);
    env[pathKey] = filtered;
  }
  return env;
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
    env: buildSpawnEnv(),
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
    env: buildSpawnEnv(),
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
