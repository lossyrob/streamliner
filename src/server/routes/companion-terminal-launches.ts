import { Router } from "express";

import type { LaunchClaimStore } from "../../launch-claim-contract";
import { buildLaunchedSessionDescription } from "../../session-registry-filter";
import {
  createLaunchClaim,
  markClaimFailed,
} from "../../session-registry/launch-claims";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import { isLoopbackAddress } from "../config";
import {
  buildCopilotInteractiveCommandForShell,
  launchCopilotTerminal,
  selectTerminalCommandShellDialect,
  TERMINAL_HOST_PREFERENCES,
  type TerminalHostPreference,
  type TerminalLaunchOptions,
  type TerminalLaunchResult,
} from "../terminal-launch";
import type { NodeCompanionTerminalLaunchResponse } from "../../node-launch-record-contract";
import {
  appendLaunchBindingPromptLines,
  summarizeLaunchClaim,
} from "../node-launch";

/**
 * Review companions default to the PAW-Review workflow agent while allowing
 * ad hoc review terminals to opt out and inherit the caller's CLI args.
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
  usePawReviewAgent?: boolean;
  launchBinding?: {
    workstreamId: string;
    nodeId: string;
    branch?: string | null;
    contextId?: string | null;
  };
}

export interface CompanionTerminalLaunchDeps {
  launchTerminal?: (options: TerminalLaunchOptions) => TerminalLaunchResult;
  registryStore?: SessionRegistryFileStore;
  claimStore?: LaunchClaimStore;
  now?: () => Date;
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

function optionalBooleanField(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw Object.assign(new Error(`${label} must be a boolean.`), { statusCode: 400 });
  }
  return value;
}

function optionalLaunchBinding(value: unknown): CompanionTerminalLaunchInput["launchBinding"] {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw Object.assign(new Error("launchBinding must be an object."), { statusCode: 400 });
  }
  return {
    workstreamId: stringField(value.workstreamId, "launchBinding.workstreamId"),
    nodeId: stringField(value.nodeId, "launchBinding.nodeId"),
    branch: optionalStringField(value.branch, "launchBinding.branch") ?? null,
    contextId: optionalStringField(value.contextId, "launchBinding.contextId") ?? null,
  };
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
 * Strip any caller-supplied --agent or --agent=... and prepend PAW-Review
 * when the caller wants the review workflow agent. Prepending (rather than
 * appending) makes the agent decision visible at the start of the rendered
 * command for operators reading logs.
 */
function applyCompanionAgent(cliArgs: string[], usePawReviewAgent: boolean): string[] {
  if (!usePawReviewAgent) {
    return [...cliArgs];
  }
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
  throw Object.assign(
    new Error(`preferredTerminal must be one of: ${TERMINAL_HOST_PREFERENCES.join(", ")}.`),
    { statusCode: 400 },
  );
}

export async function launchCompanionTerminal(
  input: CompanionTerminalLaunchInput,
  deps: CompanionTerminalLaunchDeps = {},
): Promise<CompanionTerminalLaunchResponse> {
  const cliArgs = applyCompanionAgent(input.cliArgs ?? [], input.usePawReviewAgent ?? true);
  const now = deps.now?.() ?? new Date();
  if (input.launchBinding && (!deps.registryStore || !deps.claimStore)) {
    throw Object.assign(
      new Error("Companion launch binding requires session registry and launch-claim stores."),
      { statusCode: 503 },
    );
  }
  const claimOutcome = input.launchBinding && deps.registryStore && deps.claimStore
    ? createLaunchClaim(deps.registryStore, deps.claimStore, {
      workstreamId: input.launchBinding.workstreamId,
      nodeId: input.launchBinding.nodeId,
      expectedCwd: input.cwd,
      expectedBranch: input.launchBinding.branch ?? null,
      expectedRepo: null,
      contextId: input.launchBinding.contextId ?? null,
      reservedRowTitle: input.title,
      reservedRowColor: input.tabColor ?? null,
      reservedRowDescription: buildLaunchedSessionDescription(
        input.launchBinding.workstreamId,
        input.launchBinding.nodeId,
      ),
      cliArgs,
    }, deps.now ? { now: deps.now } : undefined)
    : null;
  if (claimOutcome && !claimOutcome.ok) {
    throw Object.assign(
      new Error(`Failed to reserve companion launch claim: ${claimOutcome.error.message}`),
      { statusCode: 500 },
    );
  }
  const claim = claimOutcome?.ok ? claimOutcome.claim : null;
  const kickoffPrompt = claim
    ? appendLaunchBindingPromptLines(
      input.kickoffPrompt,
      claim.launchNonce,
      claim.launchClaimId,
    )
    : input.kickoffPrompt;
  let terminal: TerminalLaunchResult;
  try {
    terminal = await launchCopilotTerminal({
      cwd: input.cwd,
      command: buildCopilotInteractiveCommandForShell({
        cliArgs,
        kickoffPrompt,
      }, selectTerminalCommandShellDialect()),
      env: claim ? { STREAMLINER_LAUNCH_CLAIM_ID: claim.launchClaimId } : undefined,
      prepareCopilotCli: true,
      preferredTerminal: input.preferredTerminal ?? "default",
      title: input.title,
      tabColor: input.tabColor,
    }, {
      launchTerminal: deps.launchTerminal,
      cooldownMs: deps.launchTerminal ? 0 : undefined,
      pluginPreflight: deps.launchTerminal ? false : undefined,
    });
  } catch (error: unknown) {
    if (claim && deps.registryStore && deps.claimStore) {
      markClaimFailed(
        deps.registryStore,
        deps.claimStore,
        claim.launchClaimId,
        "terminal-spawn-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
  return {
    ...(claim ? { launchClaim: summarizeLaunchClaim(claim, now) } : {}),
    terminal,
    cwd: input.cwd,
    command: { cliArgs },
  };
}

export function createCompanionTerminalLaunchesRouter(
  deps: CompanionTerminalLaunchDeps = {},
): Router {
  const router = Router();

  router.post("/companion-terminal-launches", async (req, res, next) => {
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
      const usePawReviewAgent = optionalBooleanField(
        body.usePawReviewAgent,
        "usePawReviewAgent",
      ) ?? true;
      const launchBinding = optionalLaunchBinding(body.launchBinding);
      const response = await launchCompanionTerminal({
        cwd,
        kickoffPrompt,
        cliArgs: callerCliArgs,
        preferredTerminal,
        title,
        tabColor,
        usePawReviewAgent,
        launchBinding,
      }, deps);
      res.status(201).json(response);
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
