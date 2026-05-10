import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  TERMINAL_HOST_PREFERENCES,
  buildSpawnEnv,
  buildCopilotInteractiveCommand,
  buildCopilotResumeCommand,
  getDefaultTerminalLaunchAdapter,
  normalizeTerminalLaunchRequest,
  isWindowsTerminalAvailable,
  clearWindowsTerminalCache,
  launchTerminal,
  quotePowerShellLiteral,
  type TerminalLaunchAdapter,
} from "./terminal-launch";

vi.mock("node:child_process", () => {
  const mockChild = {
    pid: 12345,
    unref: vi.fn(),
  };

  return {
    spawn: vi.fn(() => mockChild),
    execSync: vi.fn(),
  };
});

const { spawn, execSync } = await import("node:child_process");
const scriptRoots: string[] = [];
let originalScriptRoot: string | undefined;

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

describe("terminal-launch", () => {
  beforeEach(() => {
    originalScriptRoot = process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT;
    const scriptRoot = mkdtempSync(join(tmpdir(), "streamliner-terminal-launch-test-"));
    scriptRoots.push(scriptRoot);
    process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT = scriptRoot;
    clearWindowsTerminalCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalScriptRoot === undefined) {
      delete process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT;
    } else {
      process.env.STREAMLINER_TERMINAL_LAUNCH_SCRIPT_ROOT = originalScriptRoot;
    }
    for (const scriptRoot of scriptRoots.splice(0)) {
      rmSync(scriptRoot, { recursive: true, force: true });
    }
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
      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      expect(spawn).toHaveBeenCalledWith(
        "wt.exe",
        ["new-tab", "-d", "C:\\Users\\test\\workspace"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("includes title when provided", () => {
      launchTerminal({
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
      launchTerminal({
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
      launchTerminal({
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
      launchTerminal({
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
      launchTerminal({
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
      launchTerminal({
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

      launchTerminal({
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
      launchTerminal({
        cwd: "C:\\Users\\test\\workspace",
        env: { STREAMLINER_LAUNCH_CLAIM_ID: "claim-1" },
      });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      const spawnedEnv = (callArgs[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(spawnedEnv).toEqual(expect.objectContaining({
        STREAMLINER_LAUNCH_CLAIM_ID: "claim-1",
      }));
    });

    it("includes title, color, and command together", () => {
      launchTerminal({
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
      launchTerminal({
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

      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      expect(mockChild.unref).toHaveBeenCalled();
    });

    it("returns correct result with method and pid", () => {
      const mockChild = {
        pid: 12345,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

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
      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

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

      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      expect(spawn).toHaveBeenCalledWith(
        "pwsh.exe",
        ["-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\Users\\test\\workspace'"],
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
    });

    it("includes command in PowerShell fallback", () => {
      launchTerminal({
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

    it("escapes single quotes in PowerShell path", () => {
      launchTerminal({
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
      launchTerminal({
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

      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      expect(mockChild.unref).toHaveBeenCalled();
    });

    it("returns correct result with method and pid", () => {
      const mockChild = {
        pid: 54321,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

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

      launchTerminal({
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

  describe("terminal adapter seam", () => {
    it("keeps the compatibility host preference values stable", () => {
      expect([...TERMINAL_HOST_PREFERENCES]).toEqual([
        "default",
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

    it("uses the Windows adapter as the current default adapter", () => {
      expect(getDefaultTerminalLaunchAdapter().id).toBe("windows");
    });
  });

  describe("buildCopilotInteractiveCommand", () => {
    it("builds a PowerShell command that parses the prompt and quotes args", () => {
      const command = buildCopilotInteractiveCommand({
        cliArgs: ["--yolo", "--model", "Rob's model"],
        kickoffPrompt: "Line 1\nLine 2",
      });

      expect(command).toContain("ConvertFrom-Json");
      expect(command).toContain("'--yolo' '--model' 'Rob''s model'");
      expect(command).toContain("-i $streamlinerKickoffPrompt");
      expect(command).not.toContain("$streamlinerKickoffPrompt .");
      expect(command).toContain("\\n");
      expect(command).not.toContain("Line 1\nLine 2");
    });

    it("builds the PowerShell resume command in the same adapter-owned helper", () => {
      expect(buildCopilotResumeCommand("sdk-session-123")).toBe("copilot '--resume=sdk-session-123'");
      expect(() => buildCopilotResumeCommand("-sdk-session-123")).toThrow(/unsupported/);
      expect(quotePowerShellLiteral("it's-a-session")).toBe("'it''s-a-session'");
    });
  });

  describe("spawn options", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
    });

    it("uses detached: true and stdio: 'ignore' for Windows Terminal", () => {
      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      expect(callArgs[2]).toEqual(expect.objectContaining({ detached: true, stdio: "ignore" }));
    });

    it("uses detached: true and stdio: 'ignore' for PowerShell fallback", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

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
        launchTerminal({ cwd: "C:\\Users\\test\\workspace" });
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
