import { Router } from "express";

import { isLoopbackAddress } from "../config";
import {
  buildCopilotInteractiveCommand,
  launchTerminal,
  TERMINAL_HOST_PREFERENCES,
  type TerminalHostPreference,
  type TerminalLaunchOptions,
  type TerminalLaunchResult,
} from "../terminal-launch";

export interface CompanionTerminalLaunchResponse {
  terminal: TerminalLaunchResult;
  cwd: string;
  command: {
    cliArgs: string[];
  };
}

export interface CompanionTerminalLaunchDeps {
  launchTerminal?: (options: TerminalLaunchOptions) => TerminalLaunchResult;
}

function hasNonLoopbackForwardedFor(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const values = Array.isArray(value) ? value : value.split(",");
  return values.some((entry) => !isLoopbackAddress(entry.trim()));
}

function isNonLoopbackRequest(req: {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  return (
    !isLoopbackAddress(req.socket.remoteAddress) ||
    hasNonLoopbackForwardedFor(req.headers["x-forwarded-for"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }
  return value.trim();
}

function optionalStringField(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${label} must be a string.`), { statusCode: 400 });
  }
  return value.trim() || undefined;
}

function optionalCliArgs(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw Object.assign(new Error("cliArgs must be an array of strings."), { statusCode: 400 });
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function terminalHostPreference(value: unknown): TerminalHostPreference {
  if (value === undefined || value === null || value === "") {
    return "default";
  }
  if (
    typeof value === "string" &&
    TERMINAL_HOST_PREFERENCES.includes(value as TerminalHostPreference)
  ) {
    return value as TerminalHostPreference;
  }
  throw Object.assign(new Error("preferredTerminal must be default, windows-terminal, or powershell."), { statusCode: 400 });
}

export function createCompanionTerminalLaunchesRouter(
  deps: CompanionTerminalLaunchDeps = {},
): Router {
  const router = Router();

  router.post("/companion-terminal-launches", (req, res, next) => {
    if (isNonLoopbackRequest(req)) {
      res.status(403).json({ error: "Companion terminal launch must originate from loopback." });
      return;
    }
    try {
      const body = isRecord(req.body) ? req.body : {};
      const cwd = stringField(body.cwd, "cwd");
      const kickoffPrompt = stringField(body.kickoffPrompt, "kickoffPrompt");
      const cliArgs = optionalCliArgs(body.cliArgs);
      const title = optionalStringField(body.title, "title");
      const tabColor = optionalStringField(body.tabColor, "tabColor");
      const preferredTerminal = terminalHostPreference(body.preferredTerminal);
      const terminal = (deps.launchTerminal ?? launchTerminal)({
        cwd,
        command: buildCopilotInteractiveCommand({
          cliArgs,
          kickoffPrompt,
        }),
        preferredTerminal,
        title,
        tabColor,
      });
      const response: CompanionTerminalLaunchResponse = {
        terminal,
        cwd,
        command: { cliArgs },
      };
      res.status(201).json(response);
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
