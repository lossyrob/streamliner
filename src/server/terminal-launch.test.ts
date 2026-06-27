import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  TERMINAL_HOST_PREFERENCES,
  DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS,
  buildSpawnEnv,
  copilotTerminalLaunchCooldownMs,
  buildCopilotInteractiveCommand,
  buildCopilotInteractivePosixCommand,
  buildCopilotResumeCommand,
  buildCopilotResumePosixCommand,
  getDefaultTerminalLaunchAdapter,
  MacTerminalLaunchAdapter,
  resolveCopilotPluginDirsForLaunch,
  normalizeTerminalLaunchRequest,
  selectDefaultTerminalLaunchAdapter,
  isWindowsTerminalAvailable,
  clearWindowsTerminalCache,
  launchCopilotTerminal,
  launchTerminal,
  quotePosixShellLiteral,
  quotePowerShellLiteral,
  resetCopilotTerminalLaunchQueueForTest,
  type TerminalLaunchAdapter,
  type TerminalLaunchExecutor,
  WindowsTerminalLaunchAdapter,
} from "./terminal-launch";

vi.mock("node:child_process", () => {
  const mockChild = {
    pid: 12345,
    unref: vi.fn(),
  };

  return {
    spawn: vi.fn(() => mockChild),
    execFileSync: vi.fn(),
    execSync: vi.fn(),
  };
});

const { spawn, execSync } = await import("node:child_process");
const scriptRoots: string[] = [];
let originalScriptRoot: string | undefined;
let originalCopilotAllowAll: string | undefined;
let originalCopilotSetupTerminal: string | undefined;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function readLaunchScriptFromSpawnCall(callIndex = 0): { path: string; content: string } {
  const args = vi.mocked(spawn).mock.calls[callIndex]?.[1] as string[] | undefined;
  if (!args) {
    throw new Error(`Missing spawn call ${callIndex}.`);
  }
  const scriptPath = args.at(-1);
  if (!scriptPath) {
    throw new Error(`Missing script path in spawn call ${callIndex}.`);
  }
  return {
    path: scriptPath,
    content: readFileSync(scriptPath, "utf8"),
  };
}

function readAppleScriptFromSpawnCall(callIndex = 0): string {
  const args = vi.mocked(spawn).mock.calls[callIndex]?.[1] as string[] | undefined;
  const scriptFlagIndex = args?.indexOf("-e") ?? -1;
  const appleScript = scriptFlagIndex >= 0 ? args?.[scriptFlagIndex + 1] : undefined;
  if (!appleScript) {
    throw new Error(`Missing AppleScript in spawn call ${callIndex}.`);
  }
  return appleScript;
}

function readMacLaunchScriptFromSpawnCall(callIndex = 0): { path: string; content: string } {
  const appleScript = readAppleScriptFromSpawnCall(callIndex);
  const scriptPath = appleScript?.match(/\/bin\/zsh '([^']+\.sh)'/)?.[1];
  if (!scriptPath) {
    throw new Error(`Missing macOS launch script path in spawn call ${callIndex}.`);
  }
  return {
    path: scriptPath,
    content: readFileSync(scriptPath, "utf8"),
  };
}

const windowsAdapter = new WindowsTerminalLaunchAdapter();

function launchWithWindowsAdapter(options: Parameters<typeof launchTerminal>[0]) {
  return launchTerminal(options, windowsAdapter);
}

describe("terminal-launch", () => {
  beforeEach(() => {
    originalScriptRoot = process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT;
    originalCopilotAllowAll = process.env.COPILOT_ALLOW_ALL;
    originalCopilotSetupTerminal = process.env.COPILOT_SETUP_TERMINAL;
    const scriptRoot = mkdtempSync(join(tmpdir(), "streamliner-terminal-launch-test-"));
    scriptRoots.push(scriptRoot);
    process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT = scriptRoot;
    delete process.env.COPILOT_ALLOW_ALL;
    delete process.env.COPILOT_SETUP_TERMINAL;
    clearWindowsTerminalCache();
    resetCopilotTerminalLaunchQueueForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalScriptRoot === undefined) {
      delete process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT;
    } else {
      process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT = originalScriptRoot;
    }
    if (originalCopilotAllowAll === undefined) {
      delete process.env.COPILOT_ALLOW_ALL;
    } else {
      process.env.COPILOT_ALLOW_ALL = originalCopilotAllowAll;
    }
    if (originalCopilotSetupTerminal === undefined) {
      delete process.env.COPILOT_SETUP_TERMINAL;
    } else {
      process.env.COPILOT_SETUP_TERMINAL = originalCopilotSetupTerminal;
    }
    for (const scriptRoot of scriptRoots.splice(0)) {
      rmSync(scriptRoot, { recursive: true, force: true });
    }
    resetCopilotTerminalLaunchQueueForTest();
  });

  describe("isWindowsTerminalAvailable", () => {
    it("returns true when 'where wt' succeeds", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));

      const result = isWindowsTerminalAvailable();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith("where wt", { stdio: "ignore" });
    });

    it("returns false when 'where wt' throws", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const result = isWindowsTerminalAvailable();

      expect(result).toBe(false);
      expect(execSync).toHaveBeenCalledWith("where wt", { stdio: "ignore" });
    });

    it("caches the result (second call doesn't re-exec)", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));

      const result1 = isWindowsTerminalAvailable();
      const result2 = isWindowsTerminalAvailable();

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it("forces re-check after clearWindowsTerminalCache", () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));

      isWindowsTerminalAvailable();
      clearWindowsTerminalCache();
      isWindowsTerminalAvailable();

      expect(execSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("launchTerminal with Windows Terminal available", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
    });

    it("spawns wt.exe with correct args for cwd only", () => {
      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        ["new-tab", "-d", "C:\\Users\\test\\workspace"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("includes title when provided", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        title: "My Session",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        [
          "new-tab",
          "--title",
          "My Session", "--suppressApplicationTitle",
          "-d",
          "C:\\Users\\test\\workspace",
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("includes valid tabColor", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        tabColor: "#FF5733",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        ["new-tab", "--tabColor", "#FF5733", "-d", "C:\\Users\\test\\workspace"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("omits invalid tabColor (invalid format)", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        tabColor: "red",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        ["new-tab", "-d", "C:\\Users\\test\\workspace"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("omits invalid tabColor (wrong hex format)", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        tabColor: "#GGG",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        ["new-tab", "-d", "C:\\Users\\test\\workspace"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("omits invalid tabColor (missing hash)", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        tabColor: "FF0000",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        ["new-tab", "-d", "C:\\Users\\test\\workspace"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("includes command when provided", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        command: "npm run dev",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        [
          "new-tab",
          "-d",
          "C:\\Users\\test\\workspace",
          "pwsh.exe",
          "-NoExit",
          "-File",
          expect.stringMatching(/launch-.*\.ps1$/),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
      const script = readLaunchScriptFromSpawnCall();
      expect(script.content).toContain("Set-Location -LiteralPath 'C:\\Users\\test\\workspace'");
      expect(script.content).toContain("npm run dev");
    });

    it("uses Windows PowerShell inside Windows Terminal when PowerShell Core is unavailable", () => {
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === "where wt") {
          return Buffer.from("");
        }
        if (command === "where pwsh") {
          throw new Error("not found");
        }
        return Buffer.from("");
      });

      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        command: "npm run dev",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        [
          "new-tab",
          "-d",
          "C:\\Users\\test\\workspace",
          "powershell.exe",
          "-NoExit",
          "-File",
          expect.stringMatching(/launch-.*\.ps1$/),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
      const script = readLaunchScriptFromSpawnCall();
      expect(script.content).toContain("Set-Location -LiteralPath 'C:\\Users\\test\\workspace'");
      expect(script.content).toContain("npm run dev");
    });

    it("passes additional environment values to the spawned terminal", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        env: { STREAMLINER_LAUNCH_CLAIM_ID: "claim-1" },
      });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      const spawnedEnv = (callArgs[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(spawnedEnv).toEqual(expect.objectContaining({
        STREAMLINER_LAUNCH_CLAIM_ID: "claim-1",
      }));
    });

    it("adds launch-local Copilot prompt bypass env before launching Streamliner Copilot workers", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        command: "copilot --yolo",
        prepareCopilotCli: true,
      });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      const spawnedEnv = (callArgs[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(spawnedEnv).toEqual(expect.objectContaining({
        COPILOT_SETUP_TERMINAL: "false",
        COPILOT_ALLOW_ALL: "true",
      }));
    });

    it("includes title, color, and command together", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        title: "Dev",
        tabColor: "#00FF00",
        command: "npm run dev",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        [
          "new-tab",
          "--title",
          "Dev", "--suppressApplicationTitle",
          "--tabColor",
          "#00FF00",
          "-d",
          "C:\\Users\\test\\workspace",
          "pwsh.exe",
          "-NoExit",
          "-File",
          expect.stringMatching(/launch-.*\.ps1$/),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
      const script = readLaunchScriptFromSpawnCall();
      expect(script.content).toContain("Set-Location -LiteralPath 'C:\\Users\\test\\workspace'");
      expect(script.content).toContain("npm run dev");
    });

    it("escapes semicolons in title and cwd to prevent WT subcommand injection", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test;workspace",
        title: "foo ; new-tab cmd.exe",
      });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        [
          "new-tab",
          "--title",
          "foo \\; new-tab cmd.exe", "--suppressApplicationTitle",
          "-d",
          "C:\\Users\\test\\;workspace",
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("calls unref() on spawned process", () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(mockChild.unref).toHaveBeenCalled();
    });

    it("returns correct result with method and pid", () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(result).toEqual({
        method: "windows-terminal",
        pid: 12345,
      });
    });
  });

  describe("launchTerminal with Windows Terminal unavailable (PowerShell fallback)", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
    });

    it("falls back to PowerShell when WT unavailable", () => {
      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(spawn).toHaveBeenCalledWith(
        "powershell.exe",
        ["-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\Users\\test\\workspace'"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("prefers PowerShell Core when WT is unavailable and pwsh is available", () => {
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === "where pwsh") {
          return Buffer.from("");
        }
        throw new Error("not found");
      });

      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(spawn).toHaveBeenCalledWith(
        "pwsh.exe",
        ["-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\Users\\test\\workspace'"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("includes command in PowerShell fallback", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        command: "npm run dev",
      });

      expect(spawn).toHaveBeenCalledWith(
        "powershell.exe",
        [
          "-NoExit",
          "-File",
          expect.stringMatching(/launch-.*\.ps1$/),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
      const script = readLaunchScriptFromSpawnCall();
      expect(script.content).toContain("Set-Location -LiteralPath 'C:\\Users\\test\\workspace'");
      expect(script.content).toContain("npm run dev");
    });

    it("does not force all-allow env when a prepared Copilot launch has no all-allow flag", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        command: "copilot --resume=session-1",
        prepareCopilotCli: true,
      });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      const spawnedEnv = (callArgs[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(spawnedEnv).toEqual(expect.objectContaining({
        COPILOT_SETUP_TERMINAL: "false",
      }));
      expect(spawnedEnv?.COPILOT_ALLOW_ALL).toBeUndefined();
    });

    it("escapes single quotes in PowerShell path", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\O'Brien\\workspace",
      });

      expect(spawn).toHaveBeenCalledWith(
        "powershell.exe",
        [
          "-NoExit",
          "-Command",
          "Set-Location -LiteralPath 'C:\\Users\\O''Brien\\workspace'",
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("escapes single quotes in PowerShell path with command", () => {
      launchWithWindowsAdapter({
        cwd: "C:\\Users\\O'Brien\\workspace",
        command: "npm run dev",
      });

      expect(spawn).toHaveBeenCalledWith(
        "powershell.exe",
        [
          "-NoExit",
          "-File",
          expect.stringMatching(/launch-.*\.ps1$/),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
      const script = readLaunchScriptFromSpawnCall();
      expect(script.content).toContain("Set-Location -LiteralPath 'C:\\Users\\O''Brien\\workspace'");
      expect(script.content).toContain("npm run dev");
    });

    it("calls unref() on spawned process", () => {
      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(mockChild.unref).toHaveBeenCalled();
    });

    it("returns correct result with method and pid", () => {
      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      expect(result).toEqual({
        method: "powershell",
        pid: 54321,
      });
    });
  });

  describe("terminal preference", () => {
    it("uses PowerShell directly when requested", () => {
      vi.mocked(execSync).mockImplementation((command) => {
        if (command === "where pwsh") {
          throw new Error("not found");
        }
        return Buffer.from("");
      });

      launchWithWindowsAdapter({
        cwd: "C:\\Users\\test\\workspace",
        preferredTerminal: "powershell",
      });

      expect(spawn).toHaveBeenCalledWith(
        "powershell.exe",
        ["-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\Users\\test\\workspace'"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(execSync).not.toHaveBeenCalledWith("where wt", { stdio: "ignore" });
    });
  });

  describe("macOS Terminal adapter", () => {
    const macAdapter = new MacTerminalLaunchAdapter();

    it("spawns Terminal.app via osascript for the default preference and returns the osascript pid", () => {
      const mockChild = {
        pid: 24680,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = launchTerminal({
        cwd: "/Users/test/workspace",
        title: "Mac Session",
      }, macAdapter);

      expect(spawn).toHaveBeenCalledWith(
        "osascript",
        [
          "-e",
          expect.stringContaining("tell application \"Terminal\" to do script"),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(expect.arrayContaining([
        expect.stringContaining("/bin/zsh '"),
      ]));
      expect(readAppleScriptFromSpawnCall()).toMatch(
        /^tell application "Terminal" to do script "\/bin\/zsh '[^"]+\.sh'"$/,
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(result).toEqual({ method: "mac-terminal", pid: 24680 });
    });

    it("spawns Terminal.app for an explicit mac-terminal preference", () => {
      const result = launchTerminal({
        cwd: "/Users/test/workspace",
        preferredTerminal: "mac-terminal",
      }, macAdapter);

      expect(result.method).toBe("mac-terminal");
      expect(readAppleScriptFromSpawnCall()).toContain(
        "tell application \"Terminal\" to do script",
      );
      expect(readAppleScriptFromSpawnCall()).not.toContain("iTerm2");
    });

    it("spawns iTerm2 via osascript when explicitly requested", () => {
      const mockChild = {
        pid: 13579,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = launchTerminal({
        cwd: "/Users/test/workspace",
        preferredTerminal: "iterm2",
        title: "iTerm Session",
      }, macAdapter);

      const appleScript = readAppleScriptFromSpawnCall();
      expect(spawn).toHaveBeenCalledWith(
        "osascript",
        [
          "-e",
          expect.stringContaining(
            "tell application \"iTerm2\" to create window with default profile command",
          ),
        ],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(appleScript).toMatch(
        /^tell application "iTerm2" to create window with default profile command "\/bin\/zsh '[^"]+\.sh'"$/,
      );
      expect(appleScript).not.toContain("Terminal\" to do script");
      expect(mockChild.unref).toHaveBeenCalled();
      expect(result).toEqual({ method: "iterm2", pid: 13579 });
    });

    it.each(["mac-terminal", "iterm2"] as const)(
      "writes a shared zsh launcher with safe cwd, env, title, command, and shell handoff for %s",
      (preferredTerminal) => {
        launchTerminal({
          cwd: "/Users/test/O'Brien/work space",
          command: "echo \"ready\" && copilot --yolo",
          env: { STREAMLINER_LAUNCH_CLAIM_ID: "claim 'one'" },
          prepareCopilotCli: true,
          preferredTerminal,
          title: "Rob's Session",
        }, macAdapter);

        const script = readMacLaunchScriptFromSpawnCall();
        expect(script.path).toMatch(/launch-.*\.sh$/);
        expect(script.content).toContain("#!/bin/zsh\nset -euo pipefail\nrm -f -- \"$0\"");
        expect(script.content).toContain("cd -- '/Users/test/O'\\''Brien/work space'");
        expect(script.content).toContain("export STREAMLINER_LAUNCH_CLAIM_ID='claim '\\''one'");
        expect(script.content).toContain("export COPILOT_SETUP_TERMINAL='false'");
        expect(script.content).toContain("export COPILOT_ALLOW_ALL='true'");
        expect(script.content).toContain("printf '\\033]0;%s\\007' 'Rob'\\''s Session'");
        expect(script.content).toContain("echo \"ready\" && copilot --yolo");
        expect(script.content).toContain("streamliner_command_status=$?");
        expect(script.content).toContain("exec /bin/zsh -l");
      },
    );

    it("lands in cwd with an interactive shell when no command is provided", () => {
      launchTerminal({
        cwd: "/Users/test/workspace",
      }, macAdapter);

      const script = readMacLaunchScriptFromSpawnCall();
      expect(script.content).toContain("cd -- '/Users/test/workspace'");
      expect(script.content).toContain("exec /bin/zsh -l");
      expect(script.content).not.toContain("streamliner_command_status");
    });

    it.each(["windows-terminal", "powershell"] as const)(
      "uses Terminal.app rather than iTerm2 for explicit %s preference",
      (preferredTerminal) => {
        const result = launchTerminal({
          cwd: "/Users/test/workspace",
          preferredTerminal,
          tabColor: "#FF5733",
        }, macAdapter);

        const args = vi.mocked(spawn).mock.calls[0][1] as string[];
        const appleScript = readAppleScriptFromSpawnCall();
        const script = readMacLaunchScriptFromSpawnCall();
        expect(result.method).toBe("mac-terminal");
        expect(appleScript).toContain("tell application \"Terminal\" to do script");
        expect(appleScript).not.toContain("iTerm2");
        expect(args.join("\n")).not.toContain("tabColor");
        expect(script.content).not.toContain("#FF5733");
      },
    );
  });

  describe("terminal adapter seam", () => {
    it("keeps the compatibility host preference values stable", () => {
      expect([...TERMINAL_HOST_PREFERENCES]).toEqual([
        "default",
        "mac-terminal",
        "iterm2",
        "windows-terminal",
        "powershell",
      ]);
    });

    it("normalizes compatibility options into an adapter launch request", () => {
      expect(normalizeTerminalLaunchRequest({
        cwd: "C:\\Users\\test\\workspace",
        command: "npm run dev",
        env: { STREAMLINER_LAUNCH_CLAIM_ID: "claim-1" },
        preferredTerminal: "powershell",
        title: "Dev",
        tabColor: "#00FF00",
      })).toEqual({
        cwd: "C:\\Users\\test\\workspace",
        command: "npm run dev",
        env: { STREAMLINER_LAUNCH_CLAIM_ID: "claim-1" },
        hostPreference: "powershell",
        title: "Dev",
        tabColor: "#00FF00",
      });
    });

    it("delegates normalized requests to the selected terminal adapter", () => {
      const launch = vi.fn<TerminalLaunchAdapter["launch"]>(
        () => ({ method: "powershell", pid: 42 }),
      );
      const adapter: TerminalLaunchAdapter = {
        id: "test-adapter",
        launch,
      };

      const result = launchTerminal({
        cwd: "C:\\Users\\test\\workspace",
        preferredTerminal: "windows-terminal",
        title: "Portable seam",
      }, adapter);

      expect(result).toEqual({ method: "powershell", pid: 42 });
      expect(adapter.launch).toHaveBeenCalledWith(expect.objectContaining({
        cwd: "C:\\Users\\test\\workspace",
        hostPreference: "windows-terminal",
        title: "Portable seam",
      }));
      expect(spawn).not.toHaveBeenCalled();
    });

    it("allows adapters to report an iTerm2 launch method", () => {
      const launch = vi.fn<TerminalLaunchAdapter["launch"]>(
        () => ({ method: "iterm2", pid: 42 }),
      );
      const adapter: TerminalLaunchAdapter = {
        id: "test-adapter",
        launch,
      };

      const result = launchTerminal({
        cwd: "/Users/test/workspace",
        preferredTerminal: "iterm2",
      }, adapter);

      expect(result).toEqual({ method: "iterm2", pid: 42 });
      expect(adapter.launch).toHaveBeenCalledWith(expect.objectContaining({
        cwd: "/Users/test/workspace",
        hostPreference: "iterm2",
      }));
    });

    it("selects the platform default terminal adapter", () => {
      expect(selectDefaultTerminalLaunchAdapter("darwin").id).toBe("mac");
      expect(selectDefaultTerminalLaunchAdapter("win32").id).toBe("windows");
      expect(selectDefaultTerminalLaunchAdapter("linux").id).toBe("windows");
      expect(getDefaultTerminalLaunchAdapter(process.platform).id).toBe(
        process.platform === "darwin" ? "mac" : "windows",
      );
    });
  });

  describe("launchCopilotTerminal queue", () => {
    it("uses a configurable cooldown with a safe default", () => {
      expect(copilotTerminalLaunchCooldownMs({})).toBe(DEFAULT_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS);
      expect(copilotTerminalLaunchCooldownMs({
        STREAMLINER_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS: "2500",
      })).toBe(2500);
      expect(copilotTerminalLaunchCooldownMs({
        STREAMLINER_COPILOT_TERMINAL_LAUNCH_COOLDOWN_MS: "0",
      })).toBe(0);
    });

    it("serializes Copilot launches until the cooldown delay resolves", async () => {
      const delayResolvers: Array<() => void> = [];
      const events: string[] = [];
      const launch = vi.fn<TerminalLaunchExecutor>((options) => {
        events.push(`launch:${options.title}`);
        return {
          method: "powershell" as const,
          pid: events.length,
        };
      });
      const delay = vi.fn((ms: number) => {
        events.push(`delay:${ms}`);
        return new Promise<void>((resolve) => {
          delayResolvers.push(resolve);
        });
      });

      const first = launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "first",
      }, { launchTerminal: launch, cooldownMs: 25, delay, pluginPreflight: false });
      const second = launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "second",
      }, { launchTerminal: launch, cooldownMs: 25, delay, pluginPreflight: false });

      await flushMicrotasks();

      expect(launch).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["launch:first", "delay:25"]);
      delayResolvers[0]();
      await first;
      await flushMicrotasks();

      expect(launch).toHaveBeenCalledTimes(2);
      expect(events).toEqual(["launch:first", "delay:25", "launch:second", "delay:25"]);
      delayResolvers[1]();
      await second;
    });

    it("does not poison the queue after a launch failure", async () => {
      const launch = vi.fn<TerminalLaunchExecutor>()
        .mockImplementationOnce(() => {
          throw new Error("spawn failed");
        })
        .mockImplementationOnce(() => ({ method: "powershell" as const, pid: 42 }));

      const first = launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "first",
      }, { launchTerminal: launch, cooldownMs: 0, pluginPreflight: false });
      const second = launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "second",
      }, { launchTerminal: launch, cooldownMs: 0, pluginPreflight: false });

      await expect(first).rejects.toThrow("spawn failed");
      await expect(second).resolves.toEqual({ method: "powershell", pid: 42 });
      expect(launch).toHaveBeenCalledTimes(2);
    });

    it("does not delay generic non-Copilot terminal launches", async () => {
      const delayResolvers: Array<() => void> = [];
      const queuedLaunch = vi.fn<TerminalLaunchExecutor>(
        () => ({ method: "powershell" as const, pid: 1 }),
      );
      const queued = launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "queued Copilot",
      }, {
        launchTerminal: queuedLaunch,
        cooldownMs: 25,
        pluginPreflight: false,
        delay: () => new Promise<void>((resolve) => {
          delayResolvers.push(resolve);
        }),
      });
      await flushMicrotasks();

      const directLaunch = vi.fn(() => ({ method: "powershell" as const, pid: 99 }));
      const adapter: TerminalLaunchAdapter = {
        id: "direct-adapter",
        launch: directLaunch,
      };

      expect(launchTerminal({ cwd: "C:\\Users\\test\\workspace" }, adapter))
        .toEqual({ method: "powershell", pid: 99 });
      expect(directLaunch).toHaveBeenCalledTimes(1);

      delayResolvers[0]();
      await queued;
    });

    it("preflights enabled Copilot plugins by passing cache dirs to the launch command", async () => {
      const root = mkdtempSync(join(tmpdir(), "streamliner-copilot-settings-"));
      scriptRoots.push(root);
      const settingsPath = join(root, "settings.json");
      const installedPluginsRoot = join(root, "installed-plugins");
      const streamlinerDir = join(installedPluginsRoot, "streamliner-local", "streamliner");
      const skillsDir = join(installedPluginsRoot, "lossyrob-skills", "lossyrob-skills");
      mkdirSync(streamlinerDir, { recursive: true });
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify({
          enabledPlugins: {
            "streamliner@streamliner-local": true,
            "lossyrob-skills@lossyrob-skills": true,
          },
        }),
        "utf8",
      );
      const launch = vi.fn<TerminalLaunchExecutor>(
        () => ({ method: "powershell" as const, pid: 42 }),
      );

      await launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "plugins",
        command: "copilot '--resume=session-1'",
      }, {
        launchTerminal: launch,
        cooldownMs: 0,
        commandShellDialect: "powershell",
        pluginPreflight: { settingsPath, installedPluginsRoot },
      });

      expect(launch).toHaveBeenCalledWith(expect.objectContaining({
        command: `copilot '--plugin-dir' '${streamlinerDir}' '--plugin-dir' '${skillsDir}' '--resume=session-1'`,
      }));
    });

    it("does not inject plugin args into PowerShell prompt text that mentions copilot", async () => {
      const root = mkdtempSync(join(tmpdir(), "streamliner-copilot-settings-"));
      scriptRoots.push(root);
      const settingsPath = join(root, "settings.json");
      const installedPluginsRoot = join(root, "installed-plugins");
      const streamlinerDir = join(installedPluginsRoot, "streamliner-local", "streamliner");
      mkdirSync(streamlinerDir, { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify({
          enabledPlugins: {
            "streamliner@streamliner-local": true,
          },
        }),
        "utf8",
      );
      const launch = vi.fn<TerminalLaunchExecutor>(
        () => ({ method: "powershell" as const, pid: 42 }),
      );

      const command = buildCopilotInteractiveCommand({
        cliArgs: ["--yolo"],
        kickoffPrompt: "hello; copilot ; Write-Output PWNED #",
      });

      await launchCopilotTerminal({
        cwd: "C:\\Users\\test\\workspace",
        title: "plugins",
        command,
      }, {
        launchTerminal: launch,
        cooldownMs: 0,
        commandShellDialect: "powershell",
        pluginPreflight: { settingsPath, installedPluginsRoot },
      });

      const launchedCommand = launch.mock.calls[0][0].command ?? "";
      expect(launchedCommand).toContain("[System.Convert]::FromBase64String");
      expect(launchedCommand).not.toContain("Write-Output PWNED");
      expect(launchedCommand).toContain(
        `; copilot '--plugin-dir' '${streamlinerDir}' '--yolo' -i $streamlinerKickoffPrompt`,
      );
      expect(launchedCommand.indexOf("--plugin-dir")).toBeGreaterThan(
        launchedCommand.indexOf("; copilot"),
      );
    });

    it("preflights enabled Copilot plugins with POSIX quoting for macOS commands", async () => {
      const root = mkdtempSync(join(tmpdir(), "streamliner-copilot-posix-settings-"));
      scriptRoots.push(root);
      const settingsPath = join(root, "settings.json");
      const configPath = join(root, "config.json");
      const streamlinerDir = join(root, "streamliner's plugin cache");
      mkdirSync(streamlinerDir, { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify({
          enabledPlugins: {
            "streamliner@streamliner-local": true,
          },
        }),
        "utf8",
      );
      writeFileSync(
        configPath,
        JSON.stringify({
          installedPlugins: [{
            name: "streamliner",
            marketplace: "streamliner-local",
            cache_path: streamlinerDir,
          }],
        }),
        "utf8",
      );
      const launch = vi.fn<TerminalLaunchExecutor>(
        () => ({ method: "mac-terminal" as const, pid: 42 }),
      );

      const command = buildCopilotInteractivePosixCommand({
        cliArgs: ["--resume=session-1"],
        kickoffPrompt: "hello\ncopilot in prompt",
      });

      await launchCopilotTerminal({
        cwd: "/Users/test/workspace",
        title: "plugins",
        command,
      }, {
        launchTerminal: launch,
        cooldownMs: 0,
        commandShellDialect: "posix",
        pluginPreflight: { settingsPath, configPath },
      });

      expect(launch).toHaveBeenCalledWith(expect.objectContaining({
        command: expect.stringContaining(
          `\ncopilot '--plugin-dir' ${quotePosixShellLiteral(streamlinerDir)} '--resume=session-1' -i "$streamliner_kickoff_prompt"`,
        ),
      }));
      expect(launch.mock.calls[0][0].command).not.toContain("copilot in prompt");
    });

    it("can disable Copilot plugin preflight with environment", () => {
      expect(resolveCopilotPluginDirsForLaunch({
        requiredPlugins: ["streamliner@streamliner-local"],
        env: { STREAMLINER_COPILOT_PLUGIN_PREFLIGHT: "false" },
      })).toEqual([]);
    });
  });

  describe("buildCopilotInteractiveCommand", () => {
    it("builds a PowerShell command that parses the prompt and quotes args", () => {
      const command = buildCopilotInteractiveCommand({
        cliArgs: ["--yolo", "--model", "Rob's model"],
        kickoffPrompt: "Line 1\nLine 2",
      });

      expect(command).toContain("[System.Convert]::FromBase64String");
      expect(command).toContain("'--yolo' '--model' 'Rob''s model'");
      expect(command).toContain("-i $streamlinerKickoffPrompt");
      expect(command).not.toContain("$streamlinerKickoffPrompt .");
      expect(command).not.toContain("\\n");
      expect(command).not.toContain("Line 1\nLine 2");
    });

    it("builds the PowerShell resume command in the same adapter-owned helper", () => {
      expect(buildCopilotResumeCommand("sdk-session-123")).toBe("copilot '--resume=sdk-session-123'");
      expect(() => buildCopilotResumeCommand("-sdk-session-123")).toThrow(/unsupported/);
      expect(quotePowerShellLiteral("it's-a-session")).toBe("'it''s-a-session'");
    });

    it("adds resume after quoted Copilot CLI args", () => {
      expect(buildCopilotResumeCommand("session-1", ["--yolo", "--model=Rob's model"]))
        .toBe("copilot '--yolo' '--model=Rob''s model' '--resume=session-1'");
    });

    it("quotes POSIX shell literals with spaces and apostrophes", () => {
      expect(quotePosixShellLiteral("Rob's workspace")).toBe("'Rob'\\''s workspace'");
      expect(quotePosixShellLiteral("two words")).toBe("'two words'");
    });

    it("builds a POSIX interactive command without interpolating raw prompt text", () => {
      const command = buildCopilotInteractivePosixCommand({
        cliArgs: ["--yolo", "--model", "Rob's model"],
        kickoffPrompt: "Line 1\nLine 2 with 'quote'",
      });

      expect(command).toContain("streamliner_kickoff_prompt_base64=");
      expect(command).toContain("base64 --decode");
      expect(command).toContain("base64 -D");
      expect(command).toContain("copilot '--yolo' '--model' 'Rob'\\''s model' -i \"$streamliner_kickoff_prompt\"");
      expect(command).not.toContain("Line 1\nLine 2");
      expect(command).not.toContain("ConvertFrom-Json");
    });

    it("builds a POSIX resume command with args before resume and safe session ids", () => {
      expect(buildCopilotResumePosixCommand("session-1", ["--model=Rob's model"]))
        .toBe("copilot '--model=Rob'\\''s model' '--resume=session-1'");
      expect(() => buildCopilotResumePosixCommand("-session-1")).toThrow(/unsupported/);
    });
  });

  describe("spawn options", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
    });

    it("uses detached: true and stdio: 'ignore' for Windows Terminal", () => {
      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      expect(callArgs[2]).toEqual(expect.objectContaining({ detached: true, stdio: "ignore" }));
    });

    it("uses detached: true and stdio: 'ignore' for PowerShell fallback", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      expect(callArgs[2]).toEqual(expect.objectContaining({ detached: true, stdio: "ignore" }));
    });

    it("strips node_modules/.bin entries from PATH so spawned shells use globally-installed tools", () => {
      const originalPath = process.env.PATH;
      const separator = process.platform === "win32" ? ";" : ":";
      const noiseyPath = [
        "C:\\Users\\me\\proj\\streamliner\\node_modules\\.bin",
        "/usr/local/bin",
        "C:\\Users\\me\\proj\\other\\node_modules\\.bin",
        "C:\\Windows\\System32",
      ].join(separator);
      process.env.PATH = noiseyPath;
      try {
        launchWithWindowsAdapter({ cwd: "C:\\Users\\test\\workspace" });
        const callArgs = vi.mocked(spawn).mock.calls[0];
        const spawnedEnv = (callArgs[2] as { env?: NodeJS.ProcessEnv }).env;
        expect(spawnedEnv).toBeDefined();
        const pathKey = Object.keys(spawnedEnv!).find((key) => key.toUpperCase() === "PATH");
        expect(pathKey).toBeDefined();
        const filtered = spawnedEnv![pathKey!]!;
        expect(filtered).not.toMatch(/node_modules[\\/]\.bin/i);
        expect(filtered).toContain("/usr/local/bin");
        expect(filtered).toContain("C:\\Windows\\System32");
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
      }
    });

    it("canonicalizes Windows PATH casing before merging launch env values", () => {
      const env = buildSpawnEnv(
        {
          PATH: [
            "C:\\Users\\me\\repo\\node_modules\\.bin",
            "C:\\Tools",
          ].join(";"),
          STREAMLINER_LAUNCH_CLAIM_ID: "claim-1",
        },
        {
          Path: "C:\\Windows\\System32",
          PATH: "C:\\Unexpected",
          SystemRoot: "C:\\Windows",
        },
        "win32",
      );

      expect(Object.keys(env).filter((key) => key.toUpperCase() === "PATH")).toEqual(["Path"]);
      expect(env.Path).toBe("C:\\Tools");
      expect(env.STREAMLINER_LAUNCH_CLAIM_ID).toBe("claim-1");
      expect(env.SystemRoot).toBe("C:\\Windows");
    });
  });
});
