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
import type { NodeCompanionTerminalLaunchResponse } from "../../node-launch-record-contract";

/**
 * The companion terminal launch always runs the PAW Review workflow agent.
 * Hard-coded here (rather than passed by the caller) because:
 *   1. The endpoint is purpose-built for PAW Review companions; there is no
 *      use case for a different agent on this route today.
 *   2. The original PR shipped without enforcing the agent flag, so
 *      handoff.cliArgs from the parent node launch (e.g. ["--yolo"]) would
 *      be the only thing the companion received -- the companion would
 *      then start with the default agent instead of PAW-Review.
 * If a future use case requires a different agent, lift this into a request
 * field with PAW-Review as the default.
 */
const COMPANION_AGENT_FLAG = "--agent=PAW-Review";

export type CompanionTerminalLaunchResponse = NodeCompanionTerminalLaunchResponse;

export interface CompanionTerminalLaunchInput {
  cwd: string;
  kickoffPrompt: string;
  cliArgs?: string[];
  preferredTerminal?: TerminalHostPreference;
  title?: string;
  tabColor?: string;
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

/**
 * Strip any caller-supplied --agent or --agent=... and prepend the
 * companion's required agent flag. Prepending (rather than appending) makes
 * the agent decision visible at the start of the rendered command for
 * operators reading logs.
 */
function applyCompanionAgent(cliArgs: string[]): string[] {
  const filtered: string[] = [];
  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === "--agent") {
      // Drop the flag and its separate-token value (defensive — Streamliner's
      // own buildCopilotInteractiveCommand only emits the joined form, but a
      // caller may not).
      i += 1;
      continue;
    }
    if (arg.startsWith("--agent=")) {
      continue;
    }
    filtered.push(arg);
  }
  return [COMPANION_AGENT_FLAG, ...filtered];
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

export function launchCompanionTerminal(
  input: CompanionTerminalLaunchInput,
  deps: CompanionTerminalLaunchDeps = {},
): CompanionTerminalLaunchResponse {
  const cliArgs = applyCompanionAgent(input.cliArgs ?? []);
  const terminal = (deps.launchTerminal ?? launchTerminal)({
    cwd: input.cwd,
    command: buildCopilotInteractiveCommand({
      cliArgs,
      kickoffPrompt: input.kickoffPrompt,
    }),
    preferredTerminal: input.preferredTerminal ?? "default",
    title: input.title,
    tabColor: input.tabColor,
  });
  return {
    terminal,
    cwd: input.cwd,
    command: { cliArgs },
  };
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
      const callerCliArgs = optionalCliArgs(body.cliArgs);
      const title = optionalStringField(body.title, "title");
      const tabColor = optionalStringField(body.tabColor, "tabColor");
      const preferredTerminal = terminalHostPreference(body.preferredTerminal);
      const response = launchCompanionTerminal({
        cwd,
        kickoffPrompt,
        cliArgs: callerCliArgs,
        preferredTerminal,
        title,
        tabColor,
      }, deps);
      res.status(201).json(response);
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
