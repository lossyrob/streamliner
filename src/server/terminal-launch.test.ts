import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import {
  isWindowsTerminalAvailable,
  clearWindowsTerminalCache,
  launchTerminal,
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

describe("terminal-launch", () => {
  beforeEach(() => {
    clearWindowsTerminalCache();
    vi.clearAllMocks();
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
        { detached: true, stdio: "ignore" }
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
        { detached: true, stdio: "ignore" }
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
        { detached: true, stdio: "ignore" }
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
        { detached: true, stdio: "ignore" }
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
        { detached: true, stdio: "ignore" }
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
        { detached: true, stdio: "ignore" }
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
          "powershell",
          "-ExecutionPolicy",
          "Bypass",
          "-NoExit",
          "-Command",
          "npm run dev",
        ],
        { detached: true, stdio: "ignore" }
      );
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
          "powershell",
          "-ExecutionPolicy",
          "Bypass",
          "-NoExit",
          "-Command",
          "npm run dev",
        ],
        { detached: true, stdio: "ignore" }
      );
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
        { detached: true, stdio: "ignore" }
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
        ["-ExecutionPolicy", "Bypass", "-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\Users\\test\\workspace'"],
        { detached: true, stdio: "ignore" }
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
          "-ExecutionPolicy",
          "Bypass",
          "-NoExit",
          "-Command",
          "Set-Location -LiteralPath 'C:\\Users\\test\\workspace'; npm run dev",
        ],
        { detached: true, stdio: "ignore" }
      );
    });

    it("escapes single quotes in PowerShell path", () => {
      launchTerminal({
        cwd: "C:\\Users\\O'Brien\\workspace",
      });

      expect(spawn).toHaveBeenCalledWith(
        "powershell.exe",
        [
          "-ExecutionPolicy",
          "Bypass",
          "-NoExit",
          "-Command",
          "Set-Location -LiteralPath 'C:\\Users\\O''Brien\\workspace'",
        ],
        { detached: true, stdio: "ignore" }
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
          "-ExecutionPolicy",
          "Bypass",
          "-NoExit",
          "-Command",
          "Set-Location -LiteralPath 'C:\\Users\\O''Brien\\workspace'; npm run dev",
        ],
        { detached: true, stdio: "ignore" }
      );
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

  describe("spawn options", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
    });

    it("uses detached: true and stdio: 'ignore' for Windows Terminal", () => {
      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      expect(callArgs[2]).toEqual({ detached: true, stdio: "ignore" });
    });

    it("uses detached: true and stdio: 'ignore' for PowerShell fallback", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      launchTerminal({ cwd: "C:\\Users\\test\\workspace" });

      const callArgs = vi.mocked(spawn).mock.calls[0];
      expect(callArgs[2]).toEqual({ detached: true, stdio: "ignore" });
    });
  });
});



