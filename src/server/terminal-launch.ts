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

function launchWindowsTerminal(options: TerminalLaunchOptions): TerminalLaunchResult {
  const args: string[] = ["new-tab"];

  // Add title if provided
  if (options.title) {
    args.push("--title", options.title);
  }

  // Add tab color if provided and valid
  if (options.tabColor && isValidHexColor(options.tabColor)) {
    args.push("--tabColor", options.tabColor);
  }

  // Add working directory
  args.push("-d", options.cwd);

  // Add command if provided
  if (options.command) {
    args.push("powershell", "-NoExit", "-Command", options.command);
  }

  const child = spawn("wt.exe", args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  return {
    method: "windows-terminal",
    pid: child.pid,
  };
}

function launchPowerShellTerminal(
  options: TerminalLaunchOptions
): TerminalLaunchResult {
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

  const args = ["-NoExit", "-Command", psCommand];

  const child = spawn("powershell.exe", args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

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
