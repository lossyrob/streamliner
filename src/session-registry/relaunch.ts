import { existsSync } from "node:fs";

import type { SessionRegistryRecord } from "../session-registry-schema";
import type { SessionRegistryStore } from "../session-registry-contract";
import {
  type TerminalLaunchOptions,
  type TerminalLaunchResult,
  launchTerminal,
} from "../server/terminal-launch";

export const RELAUNCH_ERROR_CODES = [
  "session_not_found",
  "session_archived",
  "session_live",
  "no_cwd",
  "cwd_not_found",
  "spawn_failed",
] as const;
export type RelaunchErrorCode = (typeof RELAUNCH_ERROR_CODES)[number];

export interface RelaunchResult {
  sessionId: string;
  cwd: string;
  method: "windows-terminal" | "powershell";
  copilotResumed: boolean;
  colorApplied: boolean;
  pid: number | undefined;
}

export interface RelaunchError {
  code: RelaunchErrorCode;
  message: string;
}

export type RelaunchOutcome =
  | { ok: true; result: RelaunchResult }
  | { ok: false; error: RelaunchError };

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface RelaunchDeps {
  getSession: (id: string) => SessionRegistryRecord | null;
  existsSync: (path: string) => boolean;
  launchTerminal: (options: TerminalLaunchOptions) => TerminalLaunchResult;
}

function defaultDeps(store: SessionRegistryStore): RelaunchDeps {
  return {
    getSession: (id) => store.getSession(id),
    existsSync,
    launchTerminal,
  };
}

export function validateSessionForRelaunch(
  session: SessionRegistryRecord,
  checkExists: (path: string) => boolean,
): RelaunchError | null {
  if (session.lifecycleStatus === "archived") {
    return {
      code: "session_archived",
      message: `Session "${session.title}" is archived. Unarchive it before relaunching.`,
    };
  }

  if (session.copilotProcessState === "live") {
    return {
      code: "session_live",
      message: `Session "${session.title}" appears to have a live Copilot process. Stop the existing session before relaunching.`,
    };
  }

  const targetPath = session.derivedWorktreePath ?? session.cwd;
  if (!targetPath || targetPath.trim().length === 0) {
    return {
      code: "no_cwd",
      message: `Session "${session.title}" has no working directory recorded.`,
    };
  }

  if (!checkExists(targetPath)) {
    return {
      code: "cwd_not_found",
      message: `Working directory "${targetPath}" does not exist.`,
    };
  }

  return null;
}

export function buildRelaunchParams(session: SessionRegistryRecord): TerminalLaunchOptions {
  const cwd = session.derivedWorktreePath ?? session.cwd;
  const options: TerminalLaunchOptions = { cwd };

  if (session.copilotSessionId) {
    options.command = `copilot --resume ${quotePowerShellLiteral(session.copilotSessionId)}`;
  }

  if (session.title) {
    options.title = session.title;
  }

  if (session.color) {
    options.tabColor = session.color;
  }

  return options;
}

export function relaunchSession(
  store: SessionRegistryStore,
  sessionId: string,
  deps?: Partial<RelaunchDeps>,
): RelaunchOutcome {
  const resolved = { ...defaultDeps(store), ...deps };

  const session = resolved.getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      error: {
        code: "session_not_found",
        message: `Session "${sessionId}" does not exist.`,
      },
    };
  }

  const validationError = validateSessionForRelaunch(session, resolved.existsSync);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const launchOptions = buildRelaunchParams(session);

  try {
    const launchResult = resolved.launchTerminal(launchOptions);
    return {
      ok: true,
      result: {
        sessionId: session.id,
        cwd: launchOptions.cwd,
        method: launchResult.method,
        copilotResumed: !!session.copilotSessionId,
        colorApplied: !!launchOptions.tabColor && launchResult.method === "windows-terminal",
        pid: launchResult.pid,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: "spawn_failed",
        message: `Failed to launch terminal: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
